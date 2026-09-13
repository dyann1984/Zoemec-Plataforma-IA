/* Trazabilidad de origen de parametros del Cuantificador Parametrico ZOEMEC
   (Fase B). Pedido explicito: ningun valor tecnico (porcentaje de acero,
   dosificacion, desperdicio, recubrimiento, cimbra, rendimientos) se debe
   presentar como universal -- cada uno debe conservar de forma explicita
   quien lo origino, para que la UI, el APU guardado y las exportaciones
   PDF/Excel puedan mostrarlo siempre, no solo durante el wizard.

   Puro: sin React, sin Firebase. Una sola fuente de verdad -- tanto
   QuantifierWizard.jsx (UI en vivo) como parametricApuAssembler.js (lo que
   viaja dentro del APU guardado) llaman a buildParameterTrace(), nunca cada
   uno calcula su propia version de "de donde vino este valor".

   PARAM_ORIGIN -- 6 clasificaciones:
   - USER_PROVIDED:    input geometrico, siempre tecleado por el usuario
                        (la arquitectura nunca defaultea un input, ver
                        parametricElements.js).
   - USER_OVERRIDE:    parametro tecnico que el usuario cambio del valor
                        base sugerido por ZOEMEC (en cualquier modo -- un
                        parametro "configurable" tambien puede sobreescribirse).
                        Una vez sobreescrito, DEJA de figurar como sugerido.
   - ZOEMEC_SUGGESTED: parametro tecnico que sigue exactamente en su valor
                        base sugerido (no confirmado por el usuario).
   - AUXILIARY_DERIVED: dosificacion/desperdicio que vive DENTRO de la
                        composicion de un auxiliar (ej. sacos de cemento por
                        m3, %merma de arena) -- nunca en los params del
                        elemento. Incluye version/fecha del auxiliar para
                        que quede claro CUAL version del auxiliar produjo
                        ese numero.
   - CALCULATED:       salida derivada de calculate() (volumenConcreto,
                        pesoAcero, etc.) -- nunca provista ni sugerida.
   - IMPORTED:         valor que vino de una fuente externa importada (ej.
                        un APU/plantilla previamente importado), cuando
                        aplique -- ver `importedKeys`. Ningun elemento
                        parametrico actual alimenta esta ruta todavia; el
                        soporte queda listo para cuando exista un flujo de
                        importacion hacia el Cuantificador. */
export const PARAM_ORIGIN = Object.freeze({
  USER_PROVIDED: 'USER_PROVIDED',
  USER_OVERRIDE: 'USER_OVERRIDE',
  ZOEMEC_SUGGESTED: 'ZOEMEC_SUGGESTED',
  AUXILIARY_DERIVED: 'AUXILIARY_DERIVED',
  CALCULATED: 'CALCULATED',
  IMPORTED: 'IMPORTED'
});

function traceEntry(overrides){
  return {
    clave: null, nombre: null, valor: null, unidad: null, origen: null,
    valorBaseOriginal: null, modificadoPorUsuario: false,
    auxiliarClave: null, auxiliarVersion: null, auxiliarFecha: null,
    ...overrides
  };
}

/* Construye la lista completa de renglones de trazabilidad para un
   resultado de calculate() ya calculado. Nunca recalcula cantidades ni
   resuelve precios -- solo clasifica el origen de cada valor que ya existe
   en `inputs`/`params`/`calcResult`/`auxiliaries`. */
export function buildParameterTrace({ elementDef, inputs = {}, params = {}, calcResult = null, auxiliaries = [], importedKeys = [] }){
  const trace = [];
  const importedSet = new Set(importedKeys || []);

  (elementDef?.inputs || []).forEach(inputDef => {
    const key = inputDef.key;
    trace.push(traceEntry({
      clave: key, nombre: inputDef.label || key,
      valor: inputs[key],
      unidad: inputDef.unit || null,
      origen: importedSet.has(key) ? PARAM_ORIGIN.IMPORTED : PARAM_ORIGIN.USER_PROVIDED,
      valorBaseOriginal: inputDef.default !== undefined ? inputDef.default : null,
      modificadoPorUsuario: true
    }));
  });

  (elementDef?.params || []).forEach(paramDef => {
    const key = paramDef.key;
    const valorBaseOriginal = paramDef.default;
    const valor = params[key] !== undefined ? params[key] : valorBaseOriginal;
    const modificadoPorUsuario = params[key] !== undefined && params[key] !== valorBaseOriginal;
    trace.push(traceEntry({
      clave: key, nombre: paramDef.label || key,
      valor, unidad: paramDef.unit || null,
      origen: importedSet.has(key) ? PARAM_ORIGIN.IMPORTED
        : modificadoPorUsuario ? PARAM_ORIGIN.USER_OVERRIDE : PARAM_ORIGIN.ZOEMEC_SUGGESTED,
      valorBaseOriginal, modificadoPorUsuario
    }));
  });

  Object.entries(calcResult?.cantidades || {}).forEach(([key, valor]) => {
    trace.push(traceEntry({ clave: key, nombre: key, valor, origen: PARAM_ORIGIN.CALCULATED }));
  });

  (calcResult?.consumos || []).forEach(consumo => {
    if(consumo.tipo !== 'auxiliar') return;
    const aux = (auxiliaries || []).find(a => a.clave === consumo.clave);
    if(!aux) return;
    (aux.composicion || []).forEach(row => {
      trace.push(traceEntry({
        nombre: `${aux.nombre} -> ${row.desc} (dosificación)`,
        valor: row.cantidadPorUnidad, unidad: row.unidad,
        origen: PARAM_ORIGIN.AUXILIARY_DERIVED,
        auxiliarClave: aux.clave, auxiliarVersion: aux.version ?? null, auxiliarFecha: aux.updatedAt ?? null
      }));
      trace.push(traceEntry({
        nombre: `${aux.nombre} -> ${row.desc} (desperdicio)`,
        valor: row.desperdicioPct, unidad: '%',
        origen: PARAM_ORIGIN.AUXILIARY_DERIVED,
        auxiliarClave: aux.clave, auxiliarVersion: aux.version ?? null, auxiliarFecha: aux.updatedAt ?? null
      }));
    });
  });

  return trace;
}

/* Etiqueta de UI por origen -- 4 etiquetas pedidas explicitamente (mas
   Importado, para cuando exista esa ruta). USER_PROVIDED y USER_OVERRIDE
   comparten la misma etiqueta visible ("Proporcionado por usuario"): la
   distincion entre "tecleado como input" y "sobreescrito en modo experto"
   ya queda registrada en el campo `origen`/`modificadoPorUsuario` del
   propio renglon, para auditoria -- la UI solo necesita dejar claro que NO
   es un valor universal sin confirmar. */
export const PARAM_ORIGIN_LABEL_KEY = Object.freeze({
  [PARAM_ORIGIN.USER_PROVIDED]: 'quantOriginUserProvided',
  [PARAM_ORIGIN.USER_OVERRIDE]: 'quantOriginUserProvided',
  [PARAM_ORIGIN.ZOEMEC_SUGGESTED]: 'quantOriginSuggested',
  [PARAM_ORIGIN.AUXILIARY_DERIVED]: 'quantOriginInherited',
  [PARAM_ORIGIN.CALCULATED]: 'quantOriginCalculated',
  [PARAM_ORIGIN.IMPORTED]: 'quantOriginImported'
});

export const PARAM_ORIGIN_CSS_CLASS = Object.freeze({
  [PARAM_ORIGIN.USER_PROVIDED]: 'user',
  [PARAM_ORIGIN.USER_OVERRIDE]: 'user',
  [PARAM_ORIGIN.ZOEMEC_SUGGESTED]: 'suggested',
  [PARAM_ORIGIN.AUXILIARY_DERIVED]: 'inherited',
  [PARAM_ORIGIN.CALCULATED]: 'calculated',
  [PARAM_ORIGIN.IMPORTED]: 'imported'
});
