/* Capa de revision y calibracion profesional de APU (Fase 8): construida
   sobre APUs YA generados (finalizeProfessionalAPU), sin llamar a la IA ni a
   Price Intelligence. Todo lo que calcula esta modulo sale de componentes
   reales ya presentes en el APU (apu.calculated, renglones, referencias de
   precio) -- nunca inventa una causa ni fuerza el resultado a acercarse al
   P.U. original del catalogo (ver Regla explicita del usuario: la cercania
   al catalogo NUNCA es el objetivo).

   Modulo puro: sin React, sin DOM. Se apoya en finalizeProfessionalAPU
   (src/domain/apuProfessional.js) para tener apu.calculated/confidence ya
   resueltos. */

import { scopedKey } from '../utils/scopedStorage.js';

const num = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const clamp = value => Math.max(0, Math.min(100, num(value)));

/* ---------- Estado de revision profesional (flujo de aprobacion) ----------
   GENERADO: recien creado, nadie lo reviso.
   REQUIERE_REVISION: el sistema detecto una o mas senales de riesgo (ver
   deriveRevisionStatus) -- es una SUGERENCIA automatica, no un veredicto.
   REVISADO / VALIDADO_POR_USUARIO: SOLO los pone un humano explicitamente
   (ver applyRevisionDecision). Ninguna funcion de este modulo los asigna
   automaticamente: la confianza automatica, por si sola, nunca produce
   VALIDADO_POR_USUARIO (requisito explicito del usuario). */
export const REVISION_STATUS = Object.freeze({
  GENERADO: 'GENERADO',
  REQUIERE_REVISION: 'REQUIERE_REVISION',
  REVISADO: 'REVISADO',
  VALIDADO_POR_USUARIO: 'VALIDADO_POR_USUARIO'
});
export const REVISION_STATUS_LABEL = Object.freeze({
  [REVISION_STATUS.GENERADO]: 'Generado',
  [REVISION_STATUS.REQUIERE_REVISION]: 'Requiere revisión',
  [REVISION_STATUS.REVISADO]: 'Revisado',
  [REVISION_STATUS.VALIDADO_POR_USUARIO]: 'Validado por usuario'
});

/* ---------- Procedencia del rendimiento de un renglon de mano de obra ----------
   IA: propuesto por el modelo, sin ningun humano ni historico detras (default).
   HISTORICO: tomado de la Base Historica ZOEMEC (ver saveValidatedReference).
   USUARIO: un humano lo escribio/modifico a mano, sin necesariamente confirmarlo
   como correcto.
   VALIDADO: un humano lo reviso y confirmo explicitamente (applyRendimientoDecision) --
   unico nivel que incrementa la dimension "rendimientos" de la confianza. */
export const RENDIMIENTO_FUENTE = Object.freeze({
  IA: 'IA', HISTORICO: 'HISTORICO', USUARIO: 'USUARIO', VALIDADO: 'VALIDADO'
});
export const RENDIMIENTO_FUENTE_LABEL = Object.freeze({
  [RENDIMIENTO_FUENTE.IA]: 'Rendimiento IA',
  [RENDIMIENTO_FUENTE.HISTORICO]: 'Rendimiento histórico',
  [RENDIMIENTO_FUENTE.USUARIO]: 'Rendimiento usuario',
  [RENDIMIENTO_FUENTE.VALIDADO]: 'Rendimiento validado'
});

/* Categorias cerradas para clasificar la causa dominante de una desviacion
   grande (ver Fase 8 requisito 6). suggestDeviationCategory() propone UNA
   sola categoria con su evidencia -- es una sugerencia auditable, no un
   veredicto automatico; el reviewer humano puede aceptarla o cambiarla. */
export const DEVIATION_CATEGORY = Object.freeze({
  PRECIO: 'PRECIO',
  RENDIMIENTO: 'RENDIMIENTO',
  CUADRILLA: 'CUADRILLA',
  MATERIAL_OMITIDO: 'MATERIAL_OMITIDO',
  EQUIPO: 'EQUIPO',
  EPP: 'EPP',
  INTERPRETACION_DEL_CONCEPTO: 'INTERPRETACION_DEL_CONCEPTO',
  ESPECIFICACION: 'ESPECIFICACION',
  FUENTE: 'FUENTE',
  OTRO: 'OTRO'
});

/* ---------- 1. Explicacion de diferencia (Fase 8 requisito 2) ----------
   Descompone el PU CALCULADO por ZOEMEC en sus componentes reales
   (mano de obra, materiales, equipo+herramienta+seguridad, indirectos,
   financiamiento, utilidad, cargos), todos ya calculados por el Motor APU v2
   (apu.calculated) -- no se recalcula nada aqui, solo se reorganiza para
   explicar. El catalogo original (referencePU) NO trae su propio desglose
   por componente (es un numero unico del catalogo ISSSTE/cliente), asi que
   NO se inventa una comparacion componente-a-componente contra el original:
   se muestra que compone el PU de ZOEMEC y cual es el componente dominante,
   junto con la diferencia total (unico nivel en el que SI se puede comparar
   contra el original). */
export function explainApuDifference(apu = {}){
  const t = apu.calculated || {};
  const puCalculado = num(t.pu ?? t.total);
  const puOriginal = num(apu.referencePU);
  const tieneOriginal = puOriginal > 0;
  const diferencia = tieneOriginal ? puCalculado - puOriginal : null;
  const diferenciaPct = tieneOriginal ? (diferencia / puOriginal) * 100 : null;

  const directComponentes = [
    { componente: 'manoObra', label: 'Mano de obra', monto: num(t.mo) },
    { componente: 'materiales', label: 'Materiales', monto: num(t.mat) },
    { componente: 'equipo', label: 'Equipo y maquinaria', monto: num(t.equipo) },
    { componente: 'herramienta', label: 'Herramienta menor', monto: num(t.herramienta) },
    { componente: 'seguridad', label: 'Seguridad y EPP', monto: num(t.seguridad) }
  ];
  const direct = num(t.direct) || directComponentes.reduce((s, c) => s + c.monto, 0);
  const cascadaComponentes = [
    { componente: 'indirectos', label: 'Indirectos', monto: num(t.indirect) },
    { componente: 'financiamiento', label: 'Financiamiento', monto: num(t.finance) },
    { componente: 'utilidad', label: 'Utilidad', monto: num(t.utility) },
    { componente: 'cargos', label: 'Cargos adicionales', monto: num(t.cargos) }
  ];
  const withPct = c => ({ ...c, pctDelDirecto: direct > 0 ? Number((c.monto / direct * 100).toFixed(1)) : 0 });
  const componentesDirectos = directComponentes.map(withPct);
  const dominante = componentesDirectos.reduce((a, b) => (b.monto > (a?.monto ?? -1) ? b : a), null);

  return {
    puOriginal: tieneOriginal ? puOriginal : null,
    puCalculado,
    diferencia, diferenciaPct,
    costoDirecto: direct,
    componentesDirectos,
    componentesCascada: cascadaComponentes,
    componenteDominante: dominante,
    recursoDominante: recursoDominante(apu, direct),
    nota: 'El catálogo original no desglosa su P.U. por componente: esta comparación es a nivel de P.U. total. El desglose muestra qué compone el P.U. calculado por ZOEMEC, no una resta componente a componente contra el original.'
  };
}

/* Renglon INDIVIDUAL (no solo categoria) de mayor costo dentro del APU, con
   su propia evidencia de precio -- necesario para que las causas de
   variacion sean especificas ("la llave Helvex HM-17 a $4,034.84, respaldada
   por 1 referencia ALTO") y no genericas ("materiales domina"). Usa
   costoRenglon si ya viene calculado (ver apuProfessional.js#sourceRows);
   si no, cae a precioUnitario/salarioBase/tarifa x cantidad como aproximacion
   visible, nunca oculta el renglon por no tener costoRenglon precalculado. */
function recursoDominante(apu, direct){
  const kinds = [['materials','Material'],['labor','Mano de obra'],['equipment','Equipo'],['seguridad','Seguridad/EPP']];
  let best = null;
  kinds.forEach(([kind,label]) => {
    (Array.isArray(apu[kind]) ? apu[kind] : []).forEach(row => {
      const costo = num(row.costoRenglon, num(row.precioUnitario ?? row.salarioBase ?? row.tarifa) * num(row.consumo ?? row.cantidad ?? 1));
      if(!best || costo > best.costo) best = { kind, kindLabel: label, clave: row.clave, descripcion: row.descripcion, costo, row };
    });
  });
  if(!best) return null;
  const refs = Array.isArray(best.row.priceRecord?.references) ? best.row.priceRecord.references : [];
  const altoRefs = refs.filter(r => r.match?.verdict === 'ALTO');
  return {
    kind: best.kind, kindLabel: best.kindLabel, clave: best.clave, descripcion: best.descripcion,
    costo: best.costo, pctDelDirecto: direct > 0 ? Number((best.costo / direct * 100).toFixed(1)) : 0,
    fuenteEstado: best.row.fuente?.estado || null,
    nRefs: refs.length, nRefsAlto: altoRefs.length,
    evidenciaAlto: altoRefs.length > 0
  };
}

/* ---------- 2. Cobertura de fuentes (Fase 8 requisito 8) ----------
   A diferencia de calculateAPUConfidence().dimensions.precios (que YA pesa
   por calidad de evidencia -- ALTO/MEDIO/sin evidencia, ver apuProfessional.js),
   esta metrica es mas simple y complementaria: que fraccion del COSTO del APU
   tiene *algun* intento de evidencia de mercado registrado (references.length>0
   en su priceRecord), sin importar si esa evidencia paso la validacion tecnica.
   Sirve para distinguir "no hay nada" de "se busco pero no calificaron las
   fuentes" en la Bandeja de Revision. */
export function coberturaFuentes(apu = {}){
  const kinds = ['materials', 'labor', 'equipment', 'seguridad'];
  const rows = kinds.flatMap(k => (Array.isArray(apu[k]) ? apu[k] : []).map(row => ({ row })));
  if(!rows.length) return 0;
  let totalCost = 0, coveredCost = 0;
  rows.forEach(({ row }) => {
    const costo = Math.max(0, num(row.costoRenglon ?? 0));
    totalCost += costo;
    const refs = row.priceRecord?.references;
    if(Array.isArray(refs) && refs.length) coveredCost += costo;
  });
  if(totalCost > 0) return clamp(coveredCost / totalCost * 100);
  const withRefs = rows.filter(({ row }) => Array.isArray(row.priceRecord?.references) && row.priceRecord.references.length).length;
  return clamp(withRefs / rows.length * 100);
}

/* ---------- 3. Estado de revision sugerido (Fase 8 requisito 7) ----------
   Umbrales identicos a los usados en la corrida de validacion de 25
   conceptos (Fase 7): confianza<70, |diferencia%|>25, evidencia de mercado
   <50% del costo, o validacion de precio pendiente. Un humano SIEMPRE puede
   avanzar el estado manualmente (applyRevisionDecision) -- este calculo solo
   decide GENERADO vs REQUIERE_REVISION, nunca REVISADO ni VALIDADO_POR_USUARIO. */
export function deriveRevisionStatus(apu = {}){
  const manual = apu.revisionStatus;
  if(manual === REVISION_STATUS.REVISADO || manual === REVISION_STATUS.VALIDADO_POR_USUARIO) return manual;
  const confidence = apu.confidence?.score;
  const explain = explainApuDifference(apu);
  const diffAbs = explain.diferenciaPct != null ? Math.abs(explain.diferenciaPct) : null;
  const cobertura = coberturaFuentes(apu);
  const pending = num(apu.confidence?.pendingValidation);
  const reasons = [];
  if(confidence != null && confidence < 70) reasons.push('confianza<70%');
  if(diffAbs != null && diffAbs > 25) reasons.push('diferencia_abs>25%');
  if(cobertura < 50) reasons.push('evidencia_mercado<50%');
  if(pending > 0) reasons.push(`${pending}_precio(s)_pendiente(s)_de_validacion`);
  return { status: reasons.length ? REVISION_STATUS.REQUIERE_REVISION : REVISION_STATUS.GENERADO, reasons };
}

/* Aplica una decision HUMANA de revision (Fase 8 requisito 7): nunca la
   deriva el sistema. Guarda quien, cuando, por que y a que version -- base
   minima de un rastro de auditoria para uso contractual. */
export function applyRevisionDecision(apu = {}, { status, usuario, motivo = '' } = {}){
  if(!Object.values(REVISION_STATUS).includes(status)) throw new Error(`Estado de revision invalido: ${status}`);
  const entry = { status, usuario: String(usuario || ''), fecha: new Date().toISOString(), motivo: String(motivo || ''), version: (apu.revisionLog?.length || 0) + 1 };
  return { ...apu, revisionStatus: status, revisionLog: [...(apu.revisionLog || []), entry] };
}

/* ---------- 4. Clasificacion de causa dominante (Fase 8 requisito 6) ----------
   Heuristica AUDITABLE (cada senal queda visible en `evidencia`), pensada
   para acelerar el triage de casos extremos (diff>50%, confianza<65%,
   evidencia<10%) -- es una sugerencia que un humano confirma o corrige, no
   una clasificacion automatica definitiva. */
export function suggestDeviationCategory(apu = {}){
  const explain = explainApuDifference(apu);
  const cobertura = coberturaFuentes(apu);
  const dom = explain.componenteDominante;
  const res = explain.recursoDominante;
  const labor = Array.isArray(apu.labor) ? apu.labor : [];
  const evidencia = [];

  if(!dom || dom.monto <= 0) return { categoria: DEVIATION_CATEGORY.OTRO, evidencia: ['El APU no tiene costo directo positivo que analizar.'] };

  if(dom.componente === 'materiales'){
    const diffAbs = explain.diferenciaPct != null ? Math.abs(explain.diferenciaPct) : null;
    // El renglon dominante SI tiene una referencia tecnica ALTO (marca/modelo
    // verificado) pero el P.U. total sigue muy lejos del original: la
    // evidencia dice que el precio buscado es correcto para ESA especificacion,
    // asi que la causa mas probable es que el catalogo original describa una
    // variante distinta (marca/modelo/version) o un precio de lista, no que la
    // busqueda este mal -- eso es ESPECIFICACION, no PRECIO.
    if(res?.kind === 'materials' && res.evidenciaAlto && diffAbs != null && diffAbs > 25){
      evidencia.push(`"${res.descripcion}" (${res.clave}) representa ${res.pctDelDirecto}% del costo directo y tiene ${res.nRefsAlto} referencia(s) técnica(s) ALTO (marca/modelo verificado) respaldando su precio -- la evidencia confirma el precio buscado para ESTA especificación, por lo que la diferencia de ${diffAbs.toFixed(1)}% probablemente viene de que el catálogo original especifica una variante distinta (marca/modelo/presentación) o un precio de lista, no de una búsqueda deficiente.`);
      return { categoria: DEVIATION_CATEGORY.ESPECIFICACION, evidencia };
    }
    // Hay referencias pero ninguna califico ALTO (se intento, no se confirmo):
    // la causa mas probable es la fuente misma (calidad/pertinencia de lo
    // encontrado), no el precio en abstracto.
    if(res?.kind === 'materials' && res.nRefs > 0 && !res.evidenciaAlto){
      evidencia.push(`"${res.descripcion}" (${res.clave}) representa ${res.pctDelDirecto}% del costo directo; se encontraron ${res.nRefs} referencia(s) de mercado pero ninguna calificó ALTO (coincidencia técnica insuficiente) -- la causa más probable es la calidad/pertinencia de las fuentes encontradas, no el precio en sí.`);
      return { categoria: DEVIATION_CATEGORY.FUENTE, evidencia };
    }
    evidencia.push(`Materiales domina el costo directo (${dom.pctDelDirecto}%)${res ? `, principalmente "${res.descripcion}" (${res.clave}, ${res.pctDelDirecto}% del directo)` : ''} y solo ${Math.round(cobertura)}% del costo tiene algún intento de evidencia de mercado -- sin evidencia no se puede saber si el precio es correcto.`);
    return { categoria: DEVIATION_CATEGORY.PRECIO, evidencia };
  }
  if(dom.componente === 'manoObra'){
    const peorRendimiento = labor.filter(r => num(r.rendimiento) > 0 && num(r.cuadrilla) > 0)
      .map(r => ({ r, jornadaCuadrillaPorUnidad: num(r.cuadrilla) / num(r.rendimiento) }))
      .sort((a, b) => b.jornadaCuadrillaPorUnidad - a.jornadaCuadrillaPorUnidad)[0];
    if(peorRendimiento && peorRendimiento.jornadaCuadrillaPorUnidad > 0.3){
      const { r, jornadaCuadrillaPorUnidad } = peorRendimiento;
      evidencia.push(`Mano de obra domina el costo directo (${dom.pctDelDirecto}%): "${r.descripcion}" (${r.clave}) asume cuadrilla de ${num(r.cuadrilla)} rindiendo ${num(r.rendimiento)} ${apu.unit || 'unidad(es)'}/jornada -- eso es ${jornadaCuadrillaPorUnidad.toFixed(2)} jornada-cuadrilla por cada unidad del concepto, un rendimiento bajo para este tipo de trabajo.`);
      return { categoria: DEVIATION_CATEGORY.RENDIMIENTO, evidencia };
    }
    const cuadrillaGrande = labor.filter(r => num(r.cuadrilla) >= 2);
    if(cuadrillaGrande.length >= 2){
      evidencia.push(`Mano de obra domina el costo directo (${dom.pctDelDirecto}%) con ${cuadrillaGrande.length} renglones de cuadrilla ≥2 (${cuadrillaGrande.map(r => `"${r.descripcion}": ${num(r.cuadrilla)}`).join('; ')}) -- revisar si hay doble conteo de personal para una sola tarea.`);
      return { categoria: DEVIATION_CATEGORY.CUADRILLA, evidencia };
    }
    evidencia.push(`Mano de obra domina el costo directo (${dom.pctDelDirecto}%) sin una causa de rendimiento/cuadrilla claramente identificable en los renglones actuales -- revisión manual recomendada.`);
    return { categoria: DEVIATION_CATEGORY.RENDIMIENTO, evidencia };
  }
  if(dom.componente === 'equipo'){
    evidencia.push(`Equipo y maquinaria domina el costo directo (${dom.pctDelDirecto}%)${res?.kind === 'equipment' ? `, principalmente "${res.descripcion}" (${res.clave})` : ''}.`);
    return { categoria: DEVIATION_CATEGORY.EQUIPO, evidencia };
  }
  if(dom.componente === 'seguridad'){
    evidencia.push(`Seguridad y EPP domina el costo directo (${dom.pctDelDirecto}%)${res?.kind === 'seguridad' ? `, principalmente "${res.descripcion}" (${res.clave})` : ''} -- revisar si el EPP reutilizable está amortizado (integracion:'AMORTIZABLE') en vez de cargado completo por unidad.`);
    return { categoria: DEVIATION_CATEGORY.EPP, evidencia };
  }
  evidencia.push(`Componente dominante: ${dom.label} (${dom.pctDelDirecto}% del costo directo), sin heurística específica -- revisión manual.`);
  return { categoria: DEVIATION_CATEGORY.OTRO, evidencia };
}

/* ---------- 5. Base Historica ZOEMEC (Fase 8 requisito 4) ----------
   Referencias validadas por un humano (cuadrilla, rendimiento, precio,
   consumo, equipo, EPP), guardadas para que FUTURAS generaciones las
   consulten antes de depender de la IA. Misma convencion que
   readMarketPrices/saveMarketPrice en apuGeneration.js: localStorage con
   scopedKey (namespacing por usuario), cache local -- no hay backend propio
   todavia, es aditivo y no rompe nada existente. */
const HISTORICAL_BASE_KEY = 'zoemec-base-historica';

function readHistoricalBase(){
  try{ return JSON.parse(localStorage.getItem(scopedKey(HISTORICAL_BASE_KEY))) || []; }catch{ return []; }
}
function writeHistoricalBase(list){
  try{ localStorage.setItem(scopedKey(HISTORICAL_BASE_KEY), JSON.stringify(list)); }catch{ /* almacenamiento no disponible */ }
}

/* tipoConcepto/especialidad/unidad/region/fecha son la clave de consulta
   (Fase 8 requisito 4, textual: "tipo de concepto, especialidad, unidad,
   region, fecha"). campo identifica QUE se valido (ej. 'rendimiento',
   'precio', 'cuadrilla', 'consumo', 'equipo', 'epp'); valor es el dato
   validado; clave/descripcion identifican el renglon dentro del APU. */
export function saveValidatedReference({ tipoConcepto, especialidad = '', unidad, region = '', campo, clave = '', descripcion = '', valor, usuario = '', motivo = '' }){
  if(!tipoConcepto || !unidad || !campo || valor == null) throw new Error('saveValidatedReference requiere tipoConcepto, unidad, campo y valor.');
  const entry = {
    id: `HIST-${Date.now().toString(36).toUpperCase()}`,
    tipoConcepto: String(tipoConcepto).trim().toLowerCase(),
    especialidad: String(especialidad).trim().toLowerCase(),
    unidad: String(unidad).trim().toLowerCase(),
    region: String(region).trim().toLowerCase(),
    campo, clave: String(clave), descripcion: String(descripcion),
    valor, usuario: String(usuario), motivo: String(motivo),
    fecha: new Date().toISOString()
  };
  const all = readHistoricalBase();
  all.unshift(entry);
  writeHistoricalBase(all);
  return entry;
}

/* Consulta por coincidencia (tipoConcepto+unidad obligatorios; especialidad/
   region opcionales y solo filtran si se piden), ordenada de mas reciente a
   mas antigua -- "futuras generaciones deben consultar la BASE VALIDADA
   ZOEMEC primero" (Fase 8 requisito 4). Pura lectura: no decide nada por su
   cuenta, quien la use decide si aplica el valor encontrado. */
export function queryValidatedReferences({ tipoConcepto, especialidad, unidad, region, campo } = {}){
  const norm = v => String(v || '').trim().toLowerCase();
  return readHistoricalBase().filter(e =>
    (!tipoConcepto || e.tipoConcepto === norm(tipoConcepto)) &&
    (!unidad || e.unidad === norm(unidad)) &&
    (!especialidad || e.especialidad === norm(especialidad)) &&
    (!region || e.region === norm(region)) &&
    (!campo || e.campo === campo)
  );
}

/* ---------- 6. Calibracion de rendimiento (Fase 8 requisito 3) ----------
   Un humano confirma o modifica el rendimiento de UN renglon de mano de obra
   dentro de un APU ya generado: marca ese renglon como RENDIMIENTO_FUENTE.VALIDADO
   (o .USUARIO si solo lo edito sin confirmar explicitamente que es correcto)
   y opcionalmente lo guarda en la Base Historica ZOEMEC para que futuras
   generaciones lo consulten. No recalcula el APU aqui -- el llamador debe
   pasar el resultado por finalizeProfessionalAPU para que el Motor APU v2
   vuelva a calcular el precio unitario con el nuevo rendimiento. */
export function applyRendimientoDecision(apu = {}, { laborIndex, rendimiento, cuadrilla, confirmado = true, usuario = '', guardarEnHistorico = true, region = '' } = {}){
  const labor = Array.isArray(apu.labor) ? [...apu.labor] : [];
  const row = labor[laborIndex];
  if(!row) throw new Error(`No existe el renglon de mano de obra #${laborIndex}.`);
  const next = { ...row };
  if(rendimiento != null) next.rendimiento = num(rendimiento);
  if(cuadrilla != null) next.cuadrilla = num(cuadrilla);
  next.rendimientoFuente = confirmado ? RENDIMIENTO_FUENTE.VALIDADO : RENDIMIENTO_FUENTE.USUARIO;
  labor[laborIndex] = next;
  if(confirmado && guardarEnHistorico){
    saveValidatedReference({
      tipoConcepto: apu.family || apu.concept?.slice(0, 60) || 'general',
      unidad: apu.unit, region, campo: 'rendimiento',
      clave: next.clave, descripcion: next.descripcion,
      valor: { rendimiento: next.rendimiento, cuadrilla: next.cuadrilla },
      usuario
    });
  }
  return { ...apu, labor };
}

/* ---------- 7. Bandeja de Revision Tecnica (Fase 8 requisito 1) ----------
   Convierte una lista de APUs (ya finalizados, ver finalizeProfessionalAPU)
   en filas listas para tabla + filtros. No muta los APUs. */
export const REVIEW_FILTER = Object.freeze({
  TODOS: 'TODOS',
  VALIDADOS: 'VALIDADOS',
  DIFERENCIA_25: 'DIFERENCIA_25',
  BAJA_EVIDENCIA: 'BAJA_EVIDENCIA',
  RENDIMIENTO_SIN_VALIDAR: 'RENDIMIENTO_SIN_VALIDAR',
  PRECIOS_PENDIENTES: 'PRECIOS_PENDIENTES'
});

export function buildReviewRow(apu = {}){
  const explain = explainApuDifference(apu);
  const cobertura = coberturaFuentes(apu);
  const statusInfo = deriveRevisionStatus(apu);
  const status = typeof statusInfo === 'string' ? statusInfo : statusInfo.status;
  const reasons = typeof statusInfo === 'string' ? [] : statusInfo.reasons;
  const labor = Array.isArray(apu.labor) ? apu.labor : [];
  const rendimientoValidado = labor.length > 0 && labor.every(r => r.rendimientoFuente === RENDIMIENTO_FUENTE.VALIDADO);
  const rendimientoSinValidar = labor.some(r => !r.rendimientoFuente || r.rendimientoFuente === RENDIMIENTO_FUENTE.IA);
  return {
    id: apu.id, clave: apu.clave, concept: apu.concept, unit: apu.unit,
    puOriginal: explain.puOriginal, puCalculado: explain.puCalculado,
    diferenciaAbsoluta: explain.diferencia, diferenciaPct: explain.diferenciaPct,
    confianza: apu.confidence?.score ?? null, confianzaNivel: apu.confidence?.level ?? null,
    confianzaTecnica: apu.confidence?.presentation?.confianzaTecnica ?? null,
    confianzaPrecios: apu.confidence?.presentation?.confianzaPrecios ?? null,
    evidenciaMercado: Math.round(cobertura),
    pendingValidation: num(apu.confidence?.pendingValidation),
    rendimientoValidado, rendimientoSinValidar,
    estado: status, motivos: reasons, explain
  };
}

export function filterReviewRows(rows = [], filter = REVIEW_FILTER.TODOS){
  switch(filter){
    case REVIEW_FILTER.VALIDADOS:
      return rows.filter(r => r.estado === REVISION_STATUS.VALIDADO_POR_USUARIO);
    case REVIEW_FILTER.DIFERENCIA_25:
      return rows.filter(r => r.diferenciaPct != null && Math.abs(r.diferenciaPct) > 25);
    case REVIEW_FILTER.BAJA_EVIDENCIA:
      return rows.filter(r => r.evidenciaMercado < 50);
    case REVIEW_FILTER.RENDIMIENTO_SIN_VALIDAR:
      return rows.filter(r => r.rendimientoSinValidar);
    case REVIEW_FILTER.PRECIOS_PENDIENTES:
      return rows.filter(r => r.pendingValidation > 0);
    default:
      return rows;
  }
}
