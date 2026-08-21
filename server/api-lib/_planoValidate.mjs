/* Validacion determinista de la respuesta del modelo para Planos IA / Takeoff
   (RC4 Fase 2). Structured Outputs de OpenAI ayuda, pero el usuario fue
   explicito: "no debe ser la unica defensa". Esta capa revisa tipos, enums,
   rangos y reglas de dominio ANTES de persistir nada, y nunca deja pasar un
   elemento estructuralmente invalido como si fuera confiable.

   Deliberadamente el modelo NUNCA propone "estado": ese campo lo asigna
   siempre este validador (via enforceScaleRule), para que no exista ninguna
   ruta por la que el modelo pueda auto-asignarse VALIDADO_POR_USUARIO o
   RECHAZADO -- esos son, por diseno, acciones humanas exclusivas. */

import { ESCALA_FUENTES, TIPOS_ELEMENTO, PLANO_ELEMENT_STATES, enforceScaleRule } from '../../src/domain/planoReview.js';

export const MAX_PAGES_PER_ANALYSIS = 10;
export const MAX_ELEMENTS_PER_ANALYSIS = 60;
// Limite de documento de Firestore es 1 MiB; se deja margen amplio para el
// resto de campos del documento visual_requests (result, prompt, metadata).
export const MAX_ELEMENTS_JSON_BYTES = 700 * 1024;

/* Guardia dura de paginas (Fase 2, punto 2): un PDF que exceda el tope se
   RECHAZA de forma controlada, con el mensaje exacto aprobado por el
   usuario, antes de gastar una sola llamada a OpenAI. Funcion pura y
   separada de takeoffAnalyze (api/visual-ai.mjs) para poder probarla sin
   red ni credenciales de Firebase/OpenAI. */
export function assertPageLimit(numPages){
  if(numPages > MAX_PAGES_PER_ANALYSIS){
    const error = new Error(`Este analisis admite hasta ${MAX_PAGES_PER_ANALYSIS} paginas. Selecciona un rango o carga unicamente las laminas que deseas cuantificar.`);
    error.status = 413;
    throw error;
  }
}

const TIPOS_SET = new Set(TIPOS_ELEMENTO);
const ESCALA_SET = new Set(Object.values(ESCALA_FUENTES));

function isFiniteNumber(v){
  return typeof v === 'number' && Number.isFinite(v);
}

function isNonEmptyString(v){
  return typeof v === 'string' && v.trim().length > 0;
}

/* Valida UN elemento crudo del modelo. Regresa {ok:true, element} con el
   elemento ya normalizado (estado asignado deterministicamente, nunca por el
   modelo), o {ok:false, reason} sin inventar ni corregir datos faltantes:
   un elemento mal formado se descarta con motivo explicito, no se "arregla"
   adivinando. */
export function validateElement(raw, { numPages = 1 } = {}){
  if(!raw || typeof raw !== 'object') return { ok: false, reason: 'Elemento no es un objeto.' };

  if(!TIPOS_SET.has(raw.tipo)) return { ok: false, reason: `tipo invalido: ${raw.tipo}` };
  if(!isNonEmptyString(raw.descripcion)) return { ok: false, reason: 'descripcion faltante o vacia.' };
  if(!isNonEmptyString(raw.evidencia)) return { ok: false, reason: 'evidencia faltante o vacia (Fase 2: toda propuesta debe citar su evidencia).' };
  if(!ESCALA_SET.has(raw.fuenteEscala)) return { ok: false, reason: `fuenteEscala invalida: ${raw.fuenteEscala}` };

  if(!isFiniteNumber(raw.pagina) || !Number.isInteger(raw.pagina) || raw.pagina < 1 || raw.pagina > numPages){
    return { ok: false, reason: `pagina invalida (${raw.pagina}); debe ser un entero entre 1 y ${numPages}.` };
  }

  if(!isFiniteNumber(raw.confianzaIA) || raw.confianzaIA < 0 || raw.confianzaIA > 100){
    return { ok: false, reason: `confianzaIA invalida (${raw.confianzaIA}); debe ser un numero entre 0 y 100.` };
  }

  let cantidadPropuesta = null;
  if(raw.cantidadPropuesta != null){
    if(!isFiniteNumber(raw.cantidadPropuesta) || raw.cantidadPropuesta < 0){
      return { ok: false, reason: `cantidadPropuesta invalida (${raw.cantidadPropuesta}); debe ser un numero finito >= 0, o null.` };
    }
    cantidadPropuesta = raw.cantidadPropuesta;
  }

  // La unidad solo es obligatoria cuando SI se propone una cantidad: un
  // elemento sin escala determinada puede no tener unidad todavia.
  const unidad = isNonEmptyString(raw.unidad) ? raw.unidad.trim() : '';
  if(cantidadPropuesta != null && !unidad){
    return { ok: false, reason: 'unidad faltante para un elemento con cantidadPropuesta.' };
  }

  const element = {
    tipo: raw.tipo,
    descripcion: raw.descripcion.trim(),
    cantidadPropuesta,
    unidad,
    confianzaIA: Math.round(raw.confianzaIA),
    pagina: raw.pagina,
    evidencia: raw.evidencia.trim(),
    fuenteEscala: raw.fuenteEscala,
    observaciones: isNonEmptyString(raw.observaciones) ? raw.observaciones.trim() : '',
    // Nunca del modelo: siempre calculado aqui, y siempre pasa por la regla
    // de escala determinista antes de considerarse definitivo.
    estado: PLANO_ELEMENT_STATES.PROPUESTO_POR_IA,
    cantidadOriginalIA: cantidadPropuesta,
    unidadOriginalIA: unidad,
    descripcionOriginalIA: raw.descripcion.trim(),
    cantidadCorregida: null,
    unidadCorregida: null,
    descripcionCorregida: null,
    validatedBy: null,
    validatedAt: null,
    motivo: ''
  };

  return { ok: true, element: enforceScaleRule(element) };
}

/* Valida la respuesta completa del modelo (ya parseada de JSON). Nunca lanza
   por datos malos: cada elemento invalido se reporta por separado
   (elementosInvalidos), y los validos se acotan a MAX_ELEMENTS_PER_ANALYSIS y
   a un presupuesto de tamano serializado, dejando constancia explicita
   (resultadoParcial) en vez de guardar una respuesta gigante sin necesidad. */
export function validateTakeoffResponse(parsed, { numPages = 1 } = {}){
  const rawElementos = Array.isArray(parsed?.elementos) ? parsed.elementos : null;
  if(!rawElementos){
    return {
      ok: false,
      error: 'La respuesta del modelo no tiene un arreglo "elementos" valido.',
      elementos: [],
      elementosInvalidos: [],
      resultadoParcial: false,
      elementosDescartados: 0
    };
  }

  const elementosInvalidos = [];
  const elementosValidos = [];
  rawElementos.forEach((raw, index) => {
    const result = validateElement(raw, { numPages });
    if(result.ok) elementosValidos.push(result.element);
    else elementosInvalidos.push({ index, reason: result.reason });
  });

  let resultadoParcial = false;
  let elementosDescartados = 0;
  let final = elementosValidos;

  if(final.length > MAX_ELEMENTS_PER_ANALYSIS){
    elementosDescartados += final.length - MAX_ELEMENTS_PER_ANALYSIS;
    // Se conservan primero los de mayor confianza: si hay que recortar, es
    // mejor perder los mas dudosos que los mas claros.
    final = [...final].sort((a, b) => b.confianzaIA - a.confianzaIA).slice(0, MAX_ELEMENTS_PER_ANALYSIS);
    resultadoParcial = true;
  }

  let serializedSize = Buffer.byteLength(JSON.stringify(final), 'utf8');
  while(serializedSize > MAX_ELEMENTS_JSON_BYTES && final.length > 0){
    final = final.slice(0, -1);
    elementosDescartados += 1;
    resultadoParcial = true;
    serializedSize = Buffer.byteLength(JSON.stringify(final), 'utf8');
  }

  return {
    ok: true,
    elementos: final,
    elementosInvalidos,
    resultadoParcial,
    elementosDescartados
  };
}
