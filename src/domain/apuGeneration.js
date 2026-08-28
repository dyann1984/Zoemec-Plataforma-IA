/* Generacion determinista de un APU a partir de un concepto de texto libre:
   clasificacion por palabras clave, plantilla tecnica por tipo de partida,
   normalizacion de renglones IA/Excel y aplicacion de precios de mercado
   guardados localmente. Logica de dominio pura (sin React, sin Firebase);
   la unica dependencia externa es el motor de calculo (calcAPU se aplica
   despues, en pantalla) y utilidades de texto/unidades de excelImport.js.

   Los porcentajes por defecto (herramienta, indirectos, financiamiento,
   utilidad, cargos, IVA) SIEMPRE vienen de APU_DEFAULT_FACTORS
   (src/lib/apuCalc.js) — la unica fuente de verdad ya unificada en Fase 2.
   No se reintroduce aqui ningun conjunto de porcentajes alterno. */
import { cleanText, normalizeUnitLabel, parseConceptText, conceptVariablesFromParsed } from '../lib/excelImport.js';
import { APU_DEFAULT_FACTORS } from '../lib/apuCalc.js';
import { uid } from '../utils/id.js';
import { scopedKey } from '../utils/scopedStorage.js';
import { SYSTEM_RESOURCES, SYSTEM_META, classifyConstructionSystem, extractSecondaryActivities } from './constructionSystems.js';
import { deriveCrewFromLaborRows } from './crewModel.js';
import { findCatalogMatches } from './catalogLookup.js';
import { APU_DATA_STATE } from './apuSchema.js';
import { RENDIMIENTO_FUENTE } from './apuReview.js';
import { resolveEppRows } from './eppResolver.js';

const APU_STANDARD_FACTORS = APU_DEFAULT_FACTORS;

/* Modelo de rendimiento de acarreo en funcion de la distancia (RC5): un
   ciclo de acarreo = tiempo fijo de carga/descarga + tiempo de caminar la
   distancia ida y vuelta. A mas distancia, mas minutos por viaje, mas
   jornales por unidad transportada -- nunca un rendimiento fijo disfrazado
   de "editable segun distancia" en un comentario que nadie recalcula.
   Constantes declaradas explicitamente (editables, no una tabla verificada
   de ningun fabricante/cotizacion real): valores tipicos de una cuadrilla de
   acarreo manual con carretilla en obra. Quedan documentadas para que un
   estimador las ajuste con su propio dato de campo si difiere. */
const HAUL_MODEL = {
  jornadaMin: 480,          // 8 h por jornada
  velocidadMPorMin: 45,     // desplazamiento cargado + regreso, con carretilla
  tiempoFijoMin: 3,         // carga + descarga por viaje
  capacidadPorViajePieza: 4,   // piezas/costales/sacos por viaje de carretilla
  capacidadPorViajeM3: 0.08,   // m³ por viaje de carretilla (~90-100 L)
  distanciaPorDefectoM: 30     // cuando el concepto no menciona distancia explicita
};
/* jornales necesarios para acarrear UNA unidad (1 pieza/costal o 1 m³) a la
   distancia dada -- NO depende de la cantidad total del concepto (esa se
   aplica despues, multiplicando por cantidadObra en el motor APU), solo de
   cuanto tarda cada viaje. Monotonico en distancia: nunca dos distancias
   distintas producen el mismo rendimiento salvo que caigan en el mismo
   redondeo. */
function haulLaborCoefficientPerUnit(distanceM, capacidadPorViaje){
  const d = Number.isFinite(distanceM) && distanceM > 0 ? distanceM : HAUL_MODEL.distanciaPorDefectoM;
  const tiempoPorViajeMin = HAUL_MODEL.tiempoFijoMin + (2*d/HAUL_MODEL.velocidadMPorMin);
  const viajesPorUnidad = 1/capacidadPorViaje;
  const tiempoPorUnidadMin = viajesPorUnidad*tiempoPorViajeMin;
  return tiempoPorUnidadMin/HAUL_MODEL.jornadaMin;
}

/* La clasificacion por keyword (que antes vivia aqui como un cascade de
   ~40 if/else) y la familia/confianza/SAT por tipo ahora viven en
   src/domain/constructionSystems.js (registro extensible, ver ese archivo
   para el detalle de arquitectura). Este modulo solo lo consume. */

export function canonicalAPUText(value){
  return cleanText(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
}
export function stableHash(value){
  const text = canonicalAPUText(value);
  let hash = 2166136261;
  for(let i=0;i<text.length;i++){
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(6,'0').slice(0,6);
}
export function conceptApuKey(item={}){
  return [
    item.code || item.clave || '',
    item.concept || item.description || '',
    normalizeUnitLabel(item.unit || ''),
    Number(item.referencePU || 0) ? Number(item.referencePU || 0).toFixed(4) : ''
  ].map(canonicalAPUText).join('|');
}
export function cloneApuRows(rows=[]){
  return rows.map(row => Array.isArray(row) ? [...row] : row);
}
export function cloneAPU(apu={}){
  return {
    ...apu,
    materials:cloneApuRows(apu.materials),
    labor:cloneApuRows(apu.labor),
    equipment:cloneApuRows(apu.equipment),
    aiNotes:[...(apu.aiNotes || [])]
  };
}
export function applyConceptMetadata(apu, item={}, index=0, sourceFile='Catalogo de conceptos'){
  const next = cloneAPU(apu);
  // id propio SIEMPRE por renglon del catalogo: el contenido (materiales/mano de
  // obra) puede reutilizarse entre conceptos duplicados via cacheKey, pero cada
  // renglon del Excel original es una entidad distinta en "apus" (guardado,
  // borrado, key de React) y no puede compartir id con otro renglon aunque
  // ambos hayan usado la misma clave tecnica (standardClave = hash del texto).
  next.id = 'APU-' + uid();
  next.clave = String(item.code || item.clave || next.clave || `APU-${index+1}`).slice(0,24);
  next.concept = cleanText(item.concept || item.description || next.concept).replace(/\s+/g,' ').trim();
  next.unit = normalizeUnitLabel(item.unit || next.unit);
  next.sourceQty = Number(item.qty || item.sourceQty || 1) || 1;
  next.referencePU = Number(item.referencePU || 0) || 0;
  next.sourceFile = sourceFile;
  next.sourceSection = item.section || item.sourceSection || '';
  next.rowNumber = item.rowNumber || index + 1;
  next.cacheKey = conceptApuKey({...item, concept:next.concept, unit:next.unit});
  // Variables estructuradas (RC5): si el renglon de origen (parseConceptListText)
  // ya las trae, son la version autoritativa (reflejan cualquier ajuste manual
  // de unidad/cantidad); si no, se conserva lo que makeAPUFromConcept ya
  // derivo del propio texto del concepto.
  next.variables = item.variables || next.variables || null;
  return next;
}
/* Equivalente de applyConceptMetadata para el esquema v2 (renglones-objeto):
   la IA solo propone recursos tecnicos (mano de obra, materiales, equipo,
   seguridad, procedimiento...); la identidad economica del concepto --
   clave, descripcion, unidad y cantidad -- SIEMPRE viene del renglon
   original del catalogo importado, nunca de lo que el modelo devuelva.
   referencePU (P.U. del Excel fuente) se conserva aparte para poder
   compararlo contra el P.U. que calcule el motor v2 (ver
   buildProfessionalSummarySheet en apuExportV2.js). */
export function applyConceptMetadataV2(apuV2, item={}, index=0, sourceFile='Catalogo de conceptos'){
  const next = { ...apuV2 };
  // Ver nota en applyConceptMetadata: id propio por renglon, nunca compartido
  // entre conceptos aunque reutilicen la misma matriz generada.
  next.id = 'APU-' + uid();
  next.clave = String(item.code || item.clave || next.clave || `APU-${index+1}`).slice(0,24);
  next.concept = cleanText(item.concept || item.description || next.concept).replace(/\s+/g,' ').trim();
  next.unit = normalizeUnitLabel(item.unit || next.unit);
  next.cantidadObra = Number(item.qty || item.sourceQty || next.cantidadObra || 1) || 1;
  next.referencePU = Number(item.referencePU || 0) || 0;
  next.sourceFile = sourceFile;
  next.sourceSection = item.section || item.sourceSection || '';
  next.rowNumber = item.rowNumber || index + 1;
  next.cacheKey = conceptApuKey({...item, concept:next.concept, unit:next.unit});
  next.variables = item.variables || next.variables || null;
  return next;
}
export function standardizeAPU(base, item={}, index=0, sourceFile='Catalogo de conceptos'){
  const next = applyConceptMetadata(base, item, index, sourceFile);
  next.herramienta = APU_STANDARD_FACTORS.herramienta;
  next.indCampo = APU_STANDARD_FACTORS.indCampo;
  next.indOficina = APU_STANDARD_FACTORS.indOficina;
  next.finance = APU_STANDARD_FACTORS.finance;
  next.utility = APU_STANDARD_FACTORS.utility;
  next.cargos = APU_STANDARD_FACTORS.cargos;
  next.iva = APU_STANDARD_FACTORS.iva;
  next.materials = cloneApuRows(next.materials).map(r => [cleanText(r[0]), Number(r[1]) || 0, normalizeUnitLabel(r[2]), Number(r[3]) || 0, Number(r[4]) || 0]);
  next.labor = cloneApuRows(next.labor).map(r => [cleanText(r[0]), Number(r[1]) || 0, normalizeUnitLabel(r[2]), Number(r[3]) || 0, Number(r[4]) || 1]);
  next.equipment = cloneApuRows(next.equipment).map(r => [cleanText(r[0]), Number(r[1]) || 0, normalizeUnitLabel(r[2]), Number(r[3]) || 0]);
  next.aiNotes = [
    'APU estandarizado: insumos, rendimientos, precios, FSR e indirectos salen del catalogo base ZOEMEC.',
    ...(next.aiNotes || [])
  ].filter(Boolean);
  return next;
}
/* A diferencia de standardizeAPU (que fuerza la plantilla local), esta funcion
   conserva los materiales/mano de obra/equipo y los % que la IA realmente devolvio,
   solo normaliza texto/unidades/numeros y le aplica la metadata del concepto. */
export function finalizeAIAPU(aiDraft={}, item={}, index=0, sourceFile='OpenAI API'){
  const next = applyConceptMetadata(aiDraft, item, index, sourceFile);
  next.materials = cloneApuRows(next.materials).map(r => [cleanText(r[0]), Number(r[1]) || 0, normalizeUnitLabel(r[2]), Number(r[3]) || 0, Number(r[4]) || 0]);
  next.labor = cloneApuRows(next.labor).map(r => [cleanText(r[0]), Number(r[1]) || 0, normalizeUnitLabel(r[2]), Number(r[3]) || 0, Number(r[4]) || 1]);
  next.equipment = cloneApuRows(next.equipment).map(r => [cleanText(r[0]), Number(r[1]) || 0, normalizeUnitLabel(r[2]), Number(r[3]) || 0]);
  next.herramienta = Number(aiDraft.herramienta ?? APU_STANDARD_FACTORS.herramienta);
  next.indCampo = Number(aiDraft.indCampo ?? APU_STANDARD_FACTORS.indCampo);
  next.indOficina = Number(aiDraft.indOficina ?? APU_STANDARD_FACTORS.indOficina);
  next.finance = Number(aiDraft.finance ?? APU_STANDARD_FACTORS.finance);
  next.utility = Number(aiDraft.utility ?? APU_STANDARD_FACTORS.utility);
  next.cargos = Number(aiDraft.cargos ?? APU_STANDARD_FACTORS.cargos);
  next.iva = Number(aiDraft.iva ?? APU_STANDARD_FACTORS.iva);
  next.family = aiDraft.family || next.family;
  next.sat = aiDraft.sat || next.sat;
  next.confidence = Number(aiDraft.confidence || 92);
  next.templateGenerated = false;
  next.aiGenerated = true;
  next.templateFallback = false;
  next.aiNotes = [
    'Generado por IA (OpenAI) para este concepto exacto. Revisa y ajusta antes de aprobar.',
    ...(aiDraft.aiNotes || [])
  ].filter(Boolean);
  return applyMarketPrices(next);
}
/* Cuando la IA no responde (sin API key, sin conexion, timeout), se usa la matriz
   tecnica real del catalogo base ZOEMEC como respaldo editable, para no romper el
   flujo. No son datos inventados: son valores estandar del catalogo tecnico. */
export function templateFallbackAPU(item={}, catalog, index=0, sourceFile='Plantilla tecnica ZOEMEC', reason=''){
  const next = standardAPUForConcept(item, catalog, index, sourceFile);
  next.templateFallback = true;
  next.aiGenerated = false;
  next.aiNotes = [
    `Plantilla tecnica aplicada: la IA no respondio en este entorno${reason ? ' (' + reason + ')' : ''}. Esta matriz usa el catalogo base ZOEMEC editable.`,
    ...(next.aiNotes || [])
  ].filter(Boolean);
  return next;
}
const MARKET_PRICES_KEY = 'zoemec-market-prices';
export function readMarketPrices(){
  try{ return JSON.parse(localStorage.getItem(scopedKey(MARKET_PRICES_KEY))) || {}; }catch{ return {}; }
}
export function saveMarketPrice(desc, registro){
  try{
    const all = readMarketPrices();
    all[String(desc).trim().toLowerCase()] = registro;
    localStorage.setItem(scopedKey(MARKET_PRICES_KEY), JSON.stringify(all));
  }catch{ /* almacenamiento no disponible */ }
}
export function applyMarketPrices(apu){
  const all = readMarketPrices();
  if(!Object.keys(all).length) return apu;
  const sources = { ...(apu.marketSources || {}) };
  let touched = false;
  const applyRows = (rows) => (rows || []).map(r => {
    const key = String(r?.[0] || '').trim().toLowerCase();
    const m = all[key];
    if(m && Number(m.price) > 0){
      const nr = [...r];
      nr[3] = Number(m.price);
      sources[String(r[0]).trim()] = m;
      touched = true;
      return nr;
    }
    return r;
  });
  const materials = applyRows(apu.materials);
  const labor = applyRows(apu.labor);
  const equipment = applyRows(apu.equipment);
  if(!touched) return apu;
  return { ...apu, materials, labor, equipment, marketSources: sources };
}
/* Justificacion tecnica mecanica para el APU de PLANTILLA (sin IA): compone
   texto a partir de los renglones REALES que la plantilla ya eligio (nunca
   prosa inventada por un modelo, ver decision confirmada con el usuario).
   Se usa solo para APUs NUEVOS generados por plantilla; los APUs
   historicos/migrados nunca reciben este texto retroactivamente (ver
   migrateLegacyApuToV2 -- solo lo preserva si el v1 ya lo trae). */
function describeTemplateRows(rows){
  return (rows || []).map(r => r[0]).filter(Boolean).join(', ');
}
function composeTemplateJustifications({ family, materials, labor, equipment, herramienta, laborDetails }){
  const materialsDesc = describeTemplateRows(materials);
  const laborDesc = describeTemplateRows(labor);
  const equipmentDesc = describeTemplateRows(equipment);
  // Rendimiento de la cuadrilla principal (primer renglon de labor, ya
  // explicito via crewModel.js): se reutiliza para explicar POR QUE el
  // equipo/maquinaria listado tiene sentido a ese ritmo de trabajo -- sin
  // esto, "equipo = 0.04 dia/unidad" no explicaba nada por si solo (motor
  // universal, punto 6: "equipo vinculado al rendimiento"). No cambia
  // ningun calculo: es texto explicativo, la formula sigue siendo la misma
  // (calcEquipmentRow, apuCalc.js).
  const crewRendimiento = laborDetails?.[0]?.rendimiento;
  const crewLabel = labor?.[0]?.[0];
  return {
    materials: materialsDesc
      ? `Materiales según plantilla técnica ZOEMEC para ${family}: ${materialsDesc}.`
      : `Plantilla técnica ZOEMEC para ${family}: no requiere materiales independientes.`,
    labor: laborDesc
      ? `Cuadrilla según plantilla técnica ZOEMEC para ${family}: ${laborDesc}, con jornadas por unidad y salario base de catálogo ZOEMEC.`
      : `Plantilla técnica ZOEMEC para ${family}: no requiere mano de obra independiente.`,
    equipment: equipmentDesc
      ? `Equipo/apoyo según plantilla técnica ZOEMEC para ${family}: ${equipmentDesc}.${crewRendimiento > 0 ? ` Utilización dimensionada para el ritmo de la cuadrilla que lo opera (${crewLabel}, rendimiento de ${crewRendimiento.toFixed(2)} unidades/jornada de 8 h) -- el equipo acompaña esa cuadrilla, no se factura tiempo ocioso.` : ''}`
      : `Plantilla técnica ZOEMEC para ${family}: no requiere equipo o maquinaria independiente.`,
    smallTools: `Herramienta menor calculada como ${Number(herramienta) || 0}% de mano de obra, estándar de la plantilla técnica ZOEMEC.`,
    consumables: 'NO APLICA -- no se identificaron consumibles independientes para este procedimiento (plantilla técnica ZOEMEC; captura consumibles reales si el concepto los requiere).',
    safety: 'Plantilla técnica ZOEMEC: EPP considerado dentro del equipo de apoyo listado arriba cuando aplica; revisar si el concepto requiere un desglose de seguridad independiente.'
  };
}
export function standardAPUForConcept(item, catalog, index=0, sourceFile='Catalogo de conceptos'){
  const base = makeAPUFromConcept(item?.concept || item?.description || String(item || ''), catalog);
  return applyMarketPrices(standardizeAPU(base, item || {}, index, sourceFile));
}
export function makeAPUFromConcept(concept, catalog){
  const c = concept || 'Muro de block hueco de concreto de 15 cm asentado con mortero cemento-arena';
  const t = c.toLowerCase();
  // Variables estructuradas del concepto (RC5): se derivan UNA vez del mismo
  // texto que ya se esta clasificando, para (a) exponerlas en el APU
  // (apu.variables, ver el return al final) y (b) que el rendimiento de
  // acarreo consuma la distancia real detectada en el texto, en vez de un
  // coeficiente fijo. parseConceptText nunca recorta texto (RC5), asi que
  // esto es seguro incluso cuando el concepto ya trae distancia/volumen.
  const parsedVars = parseConceptText(c);
  const variables = conceptVariablesFromParsed(parsedVars);

  // Clasificacion (motor universal, ver constructionSystems.js): primero
  // coincidencia exacta con el registro ordenado (mismo comportamiento
  // documentado que el cascade anterior para los tipos ya conocidos), y si
  // ninguna entrada coincide, un fallback por solape de palabras contra
  // disciplinas conocidas antes de caer al generico. secondaryActivities
  // (ej. "incluye acarreos, cortes y dobleces") se registran aparte y NUNCA
  // cambian la clasificacion principal.
  const classification = classifyConstructionSystem(t);
  const tipo = classification.tipo;
  const primaryActivity = tipo;
  const secondaryActivities = extractSecondaryActivities(c);
  const unmatched = classification.matchType === 'generico';
  const approximateMatch = classification.matchType === 'score';

  const tpl = SYSTEM_RESOURCES[tipo] || SYSTEM_RESOURCES.generico;
  // El rendimiento de acarreo manual consume la distancia real detectada en
  // el concepto (Fase 3/RC5: "el motor APU debe consumir distancia", no solo
  // almacenarla) -- 10 m, 25 m y 50 m producen coeficientes de mano de obra
  // y equipo distintos, nunca el mismo rendimiento "por defecto". Capacidad
  // por viaje segun si la unidad detectada es volumetrica (m³) o de conteo
  // de piezas/costales (ver HAUL_MODEL arriba).
  let haulDistanceUsed = null;
  let tplLabor = tpl.labor, tplEquipment = tpl.equipment;
  if(tipo === 'acarreo_manual'){
    const capacidadPorViaje = variables.volumeUnit === 'm³' ? HAUL_MODEL.capacidadPorViajeM3 : HAUL_MODEL.capacidadPorViajePieza;
    haulDistanceUsed = Number.isFinite(variables.distance) && variables.distance > 0 ? variables.distance : HAUL_MODEL.distanciaPorDefectoM;
    const coef = haulLaborCoefficientPerUnit(variables.distance, capacidadPorViaje);
    tplLabor = tpl.labor.map((r,i) => i===0 ? [r[0], coef, r[2], r[3], r[4]] : r);
    tplEquipment = tpl.equipment.map((r,i) => i===0 ? [r[0], coef, r[2], r[3]] : r);
  }
  const normalizeApuRow = (r) => {
    const nr = [...r];
    nr[0] = cleanText(nr[0]);
    nr[2] = normalizeUnitLabel(nr[2]);
    return nr;
  };
  // Motor de Biblioteca Inteligente: useCat ahora resuelve cada renglon con
  // findCatalogMatches (clave/sinonimo/similitud ponderada por
  // descripcion+categoria+unidad, con `tipo` para no cruzar categorias --
  // ver catalogLookup.js) en vez de matchPrice puro (que solo comparaba
  // descripcion). matchPrice se conserva SIN CAMBIOS para sus otros
  // consumidores (apuFlow.js, Excel de precios de Oficina Tecnica). Sin
  // catalogo o sin match de confianza suficiente, el renglon conserva
  // exactamente el precio de plantilla de siempre -- regresion cero.
  // sources[i] queda null cuando el renglon no tuvo match: se usa para
  // construir materialSources/laborSources/equipmentSources (ver el return
  // al final), que migrateLegacyApuToV2 (apuSchema.js) usa para marcar SOLO
  // esos renglones como IMPORTADO/VERIFICADO en vez de todo el APU por igual.
  const useCat = (arr, tipoFiltro) => {
    const sources = [];
    const rows = arr.map(r=>{
      const nr = normalizeApuRow(r);
      // Se envia todo lo que el renglon de plantilla REALMENTE trae para que
      // findCatalogMatches pueda decidir con su propio orden de prioridad
      // (clave_exacta > alias_sinonimo > descripcion_normalizada >
      // categoria_unidad > fuzzy_token, ver catalogLookup.js) -- no se
      // duplica esa logica aqui. `unidad` (nr[2]) SI existe siempre en el
      // renglon y ahora se envia (antes se ignoraba, dejando la bonificacion
      // de unidad de fuzzy_token y la etapa categoria_unidad sin poder usar
      // ese dato). `clave` y `categoria` NO se envian: los renglones de
      // SYSTEM_RESOURCES (constructionSystems.js) son arreglos planos
      // [desc, coeficiente, unidad, precio, desperdicio] que nunca traen su
      // propio codigo/categoria -- inventar un valor aqui violaria la regla
      // explicita de no fabricar clave/categoria. Esto significa que
      // clave_exacta y categoria_unidad seguiran sin alcanzarse desde este
      // caller hasta que las plantillas (o una fuente distinta de recursos)
      // declaren esos campos por renglon; ambas etapas ya estan probadas y
      // operativas a nivel de findCatalogMatches (catalogLookup.test.js).
      const found = findCatalogMatches(catalog, { desc: r[0], tipo: tipoFiltro, unidad: nr[2] });
      if(found){
        nr[3] = found.match.precio;
        if(found.match.unidad) nr[2] = normalizeUnitLabel(found.match.unidad);
        sources.push({
          matchMethod: found.matchMethod,
          confidence: found.confidence,
          clave: found.match.clave || null,
          categoria: found.match.categoria || null,
          // BIBLIOTECA (gap de trazabilidad reportado): un match real de
          // catalogo/Biblioteca sin validacion humana previa (found.match.
          // estado !== 'VERIFICADO') ya NO se colapsa al mismo IMPORTADO
          // generico que un renglon literalmente importado sin match --
          // sigue exigiendose 'VERIFICADO' explicito en el catalogo de
          // origen para heredar VERIFICADO aqui, nunca se asume.
          estado: found.match.estado === 'VERIFICADO' ? APU_DATA_STATE.VERIFICADO : APU_DATA_STATE.BIBLIOTECA,
          proveedor: found.match.traceability?.sourceDocName || found.match.fuente || null,
          fecha: found.match.traceability?.validatedAt || found.match.fecha || null,
          // Rendimiento/cuadrilla de catalogo (solo relevante para mano de
          // obra -- ver el bloque de re-derivacion mas abajo). null para
          // materiales/equipo, cuyos renglones de catalogo nunca lo traen.
          rendimiento: Number(found.match.rendimiento) > 0 ? Number(found.match.rendimiento) : null,
          cuadrilla: Number(found.match.cuadrilla) > 0 ? Number(found.match.cuadrilla) : null
        });
      } else {
        sources.push(null);
      }
      return nr;
    });
    return { rows, sources };
  };
  const materialsResult = useCat(tpl.materials, 'material');
  const materials = materialsResult.rows;
  const materialSources = materialsResult.sources;
  // Mano de obra tambien se resuelve contra catalogo (brecha real confirmada
  // por auditoria de aceptacion: antes SOLO materiales/equipo lo hacian).
  // useCat sustituye el SALARIO (indice 3) para TODOS los matches; cuando el
  // match ademas trae un rendimiento validado, el bloque de abajo (despues
  // de useCat) recalcula el coeficiente (indice 1) desde ese rendimiento
  // real -- ver el comentario junto a deriveCrewFromLaborRows mas abajo.
  const laborResult = useCat(tplLabor, 'labor');
  const labor = laborResult.rows;
  const laborSources = laborResult.sources;
  // Equipo tambien se resuelve contra catalogo (antes NUNCA consultaba
  // precios reales, solo materiales) -- brecha real confirmada por auditoria.
  const equipmentResult = useCat(tplEquipment, 'equipment');
  const equipment = equipmentResult.rows;
  const equipmentSources = equipmentResult.sources;
  if(/calafate|sellado|junta/.test(t)){ materials.push(normalizeApuRow(['Calafateo / sellador de juntas',0.08,'L',95,5])); materialSources.push(null); }
  if(/resane|adecuacion|adecuaci[oó]n|corte|elevaci[oó]n/.test(t)){ labor.push(['Cortes, elevaciones, resanes y adecuaciones',0.07,'jor',380,1.85]); laborSources.push(null); }
  if(/retiro|limpieza|termino|t[eé]rmino/.test(t)){ labor.push(['Retiro al término, limpieza fina y carga manual',0.06,'jor',258,1.82]); laborSources.push(null); }
  if(/acarreo|acarreos/.test(t)){ equipment.push(['Equipo menor para acarreos internos',0.04,'día',110]); equipmentSources.push(null); }
  // Rendimiento REAL de Biblioteca (fase de correccion "Rendimientos
  // reales"): cuando un renglon de mano de obra tuvo match de catalogo Y ese
  // match trae un rendimiento validado por un humano (ver toCatalogRow,
  // libraryReview.js), el rendimiento se aplica DESDE EL ORIGEN -- se
  // recalcula el COEFICIENTE (jornales/unidad, indice 1 del renglon v1)
  // ANTES de derivar cuadrilla/rendimiento/jornada, nunca se sobreescribe
  // cuadrilla/rendimiento despues dejando un coeficiente viejo sin tocar
  // (eso hubiera sido el "overwrite posterior" que se pidio evitar). El
  // precio SI cambia respecto al de plantilla -- es intencional: un dato
  // real de campo debe pesar mas que un rendimiento generico de catalogo
  // tecnico interno.
  laborSources.forEach((source, i) => {
    if(!source?.rendimiento) return;
    const cuadrillaReal = source.cuadrilla || 1;
    const coefAnterior = Number(labor[i][1]) || 0;
    const rendimientoAnterior = coefAnterior > 0 ? 1 / coefAnterior : 0;
    const nuevoCoef = cuadrillaReal / source.rendimiento;
    labor[i][1] = nuevoCoef;
    source.rendimientoOriginal = rendimientoAnterior;
    source.rendimientoAdoptado = source.rendimiento;
    source.cuadrillaAdoptada = cuadrillaReal;
    source.rendimientoMetodo = source.matchMethod;
    source.rendimientoConfidence = source.confidence;
    // Acarreo manual: equipo[0] comparte HOY el mismo coeficiente que
    // labor[0] (ver HAUL_MODEL/haulLaborCoefficientPerUnit arriba) -- es la
    // UNICA disciplina con una relacion real ya modelada entre rendimiento
    // de mano de obra y cantidad de equipo. Para el resto de las
    // disciplinas el equipo de plantilla es POR_UNIDAD_OBRA, independiente
    // de la cuadrilla -- forzar un acoplamiento ahi seria fabricar una
    // relacion que no existe en los datos, no corregir una real.
    if(tipo === 'acarreo_manual' && i === 0 && equipment[0]){
      equipment[0][1] = nuevoCoef;
    }
  });
  // Cuadrilla + rendimiento explicitos (motor universal, ver crewModel.js):
  // paralelo a `labor` (mismo indice), reconstruido de la incidencia que
  // ya traia cada renglon -- el precio resultante no cambia (ver nota en
  // crewModel.js), lo que cambia es que cuadrilla/rendimiento/jornada
  // quedan explicitos y con una fuente declarada en vez de opacos. Para los
  // renglones con rendimiento real de Biblioteca (arriba), este resultado
  // se REEMPLAZA COMPLETO mas abajo -- crewModel.js asume cuadrilla=1
  // siempre, y aqui la cuadrilla puede ser la real declarada en catalogo.
  const laborDetails = deriveCrewFromLaborRows(labor, tipo);
  laborSources.forEach((source, i) => {
    if(!source?.rendimiento) return;
    laborDetails[i] = {
      cuadrilla: source.cuadrillaAdoptada,
      rendimiento: source.rendimientoAdoptado,
      jornada: 8,
      rendimientoFuente: RENDIMIENTO_FUENTE.BIBLIOTECA,
      yieldConfidence: Math.round(Math.min(0.95, source.rendimientoConfidence) * 100)
    };
  });
  // EPP dinamico (Prioridad 2, fase de correccion): resuelto por riesgo
  // detectado en el concepto, nunca hardcodeado por disciplina -- ver
  // eppResolver.js. Prorrateado con el MISMO rendimiento diario/cuadrilla ya
  // derivados arriba para mano de obra (real de Biblioteca cuando existe,
  // de plantilla si no) -- ninguna cifra nueva. Sin precio real de catalogo
  // o sin rendimiento valido, el renglon queda REQUIERE_VALIDACION (ver
  // eppResolver.js), nunca con un precio fabricado.
  const { rows: seguridad, risks: eppRisks } = resolveEppRows({
    concept: c, tipo, catalog,
    rendimientoDiario: laborDetails[0]?.rendimiento || 0,
    cuadrilla: laborDetails[0]?.cuadrilla || 1
  });
  const standardClave = 'APU-' + stableHash(c);
  const meta = SYSTEM_META[tipo] || SYSTEM_META.generico;
  const aiNotes = [];
  // Concepto desconocido (§8 del motor universal): NUNCA "ERROR" plano --
  // se explica, un renglon por causa, exactamente que falta (sistema no
  // identificado / recursos pendientes / rendimiento pendiente / precios
  // pendientes), para que quede accionable en vez de solo "incompleto".
  if(unmatched){
    aiNotes.push('Sistema constructivo no identificado con suficiente confianza: ningun sistema conocido ni una similitud minima coincidieron con este concepto.');
    aiNotes.push('Recursos pendientes: los materiales marcados "Pendiente de cotización" (precio $0.00) son un marcador, no una propuesta tecnica -- especifica el material/elemento principal del concepto.');
    aiNotes.push('Rendimiento pendiente: la cuadrilla y el rendimiento de este APU son de relleno (plantilla generica, confianza muy baja), no corresponden a ninguna disciplina real -- deben reemplazarse antes de aprobar.');
    aiNotes.push('Precios pendientes: ningun precio de este APU tiene evidencia de mercado ni fuente identificable; captura precios reales antes de exportar.');
  }
  // Concepto desconocido resuelto por similitud (§6 del motor universal):
  // se compuso una matriz de la disciplina MAS CERCANA por solape de
  // palabras, nunca por coincidencia exacta -- se marca explicitamente para
  // que quede claro que es una hipotesis, no una clasificacion certera.
  if(approximateMatch) aiNotes.push(`Clasificacion aproximada por similitud con "${meta.discipline}" (sin coincidencia exacta de ningun sistema constructivo conocido) -- valida manualmente los recursos antes de aprobar.`);
  if(secondaryActivities.length) aiNotes.push(`Actividades incluidas detectadas en el texto del concepto: ${secondaryActivities.join(', ')}. Ya consideradas dentro del alcance de "${meta.discipline}", no se duplican como renglones aparte.`);
  // Alcance ambiguo entre "colocacion" y "suministro y colocacion" (Fase 4,
  // caso 6): en vez de asumir en silencio que el material lo pone el
  // contratista, se deja explicita la hipotesis usada para que quede
  // marcada para revision.
  if(tipo==='piso' && !/suministro/.test(t)) aiNotes.push('Alcance asumido: el concepto no menciona "suministro" de forma explicita -- se incluyó loseta como hipótesis de colocación con material provisto por el contratista. Verifica si el alcance real es solo mano de obra (material del cliente) antes de aprobar.');
  if(haulDistanceUsed != null){
    aiNotes.push(variables.distance != null
      ? `Rendimiento de acarreo estimado para ${haulDistanceUsed} m (distancia detectada en el concepto). Modelo editable segun capacidad real de la cuadrilla -- ver HAUL_MODEL en src/domain/apuGeneration.js.`
      : `El concepto no especifica distancia de acarreo: se uso ${haulDistanceUsed} m por defecto. Precisa la distancia real en el concepto para un rendimiento mas exacto.`);
  }
  return {
    id:standardClave, clave:standardClave, concept:cleanText(c), unit:normalizeUnitLabel(tpl.unit), templateGenerated:true,
    materials, labor, equipment, laborDetails,
    // Procedencia por renglon de catalogo (Biblioteca Inteligente): paralelo
    // a materials/labor/equipment (mismo indice), null cuando el renglon uso
    // el precio de plantilla. Ver migrateLegacyApuToV2 (apuSchema.js) para
    // como se consume al migrar a v2.
    materialSources, laborSources, equipmentSources,
    // EPP dinamico (Prioridad 2): renglones de seguridad ya en forma v2
    // (nunca existio un formato v1 de arreglo para seguridad -- ver
    // eppResolver.js). eppRisks es solo informativo (que riesgos se
    // detectaron), no se usa para calculo.
    seguridad, eppRisks,
    // Plantilla nunca declara consumibles propios (no existian como
    // categoria en el catalogo tecnico ZOEMEC): nace vacio, nunca se
    // reparte una fraccion de materials hacia aqui.
    consumables: [],
    technicalJustifications: composeTemplateJustifications({ family: meta.discipline, materials, labor, equipment, herramienta: APU_STANDARD_FACTORS.herramienta, laborDetails }),
    herramienta:APU_STANDARD_FACTORS.herramienta, indCampo:APU_STANDARD_FACTORS.indCampo, indOficina:APU_STANDARD_FACTORS.indOficina, finance:APU_STANDARD_FACTORS.finance, utility:APU_STANDARD_FACTORS.utility, cargos:APU_STANDARD_FACTORS.cargos, iva:APU_STANDARD_FACTORS.iva,
    family: meta.discipline,
    confidence: approximateMatch ? Math.max(30, Math.round(meta.confidence * 0.6)) : meta.confidence,
    sat: meta.sat,
    incomplete: unmatched,
    // Modelo semantico del concepto (motor universal): actividad principal
    // detectada (mismo `tipo` que ya decidia los recursos), actividades
    // incluidas declaradas explicitamente en el texto, y como se llego a la
    // clasificacion (match exacto / aproximado por similitud / generico).
    primaryActivity,
    secondaryActivities,
    classificationMatch: classification.matchType,
    aiNotes,
    // Variables estructuradas del concepto (RC5, ver conceptVariablesFromParsed
    // en excelImport.js): nunca obligatorias, se preservan tal cual hasta v2
    // (migrateLegacyApuToV2) y hasta la exportacion (apuExportV2.js).
    variables,
    date:new Date().toLocaleDateString('es-MX')
  };
}

// rowImporte y calcAPU vienen de src/lib/apuCalc.js (motor determinista
// compartido con las funciones serverless de IA). auditSource/auditFormula/
// auditRow/buildAuditModel ahora viven en src/lib/apuExport.js junto con el
// resto de la generacion de PDF/Excel, para que sean testeables en Node.
export function normalizeAIAPU(raw, fallbackConcept){
  const text = (v, fallback='') => String(v ?? fallback).trim();
  const numeric = (v, fallback=0) => {
    const n = Number(String(v ?? '').replace(/[^0-9.\-]/g,''));
    return Number.isFinite(n) ? n : fallback;
  };
  const cleanRows = (rows, defaults) => Array.isArray(rows)
    ? rows.map(r => defaults.map((d,i)=> (i===0 || i===2) ? text(r?.[i], d) : numeric(r?.[i], d)))
    : [];
  return {
    id:'APU-'+uid(),
    clave:'APU-'+uid().slice(0,4),
    concept: text(raw.concept, fallbackConcept),
    unit: text(raw.unit || 'pza').replace('m2','m²').replace('m3','m³'),
    materials: cleanRows(raw.materials, ['Material',1,'pza',0,0]),
    labor: cleanRows(raw.labor, ['Mano de obra',0.01,'jor',0,1]),
    equipment: cleanRows(raw.equipment, ['Equipo',0,'hr',0]),
    // Antes este bloque tenia su PROPIO conjunto de defaults, distinto tanto
    // de APU_STANDARD_FACTORS (plantilla/Excel) como de makeEmptyAPU
    // (formulario en blanco): un APU generado por IA sin todos los campos
    // terminaba con indirectos/utilidad distintos a uno de plantilla, solo
    // por el origen. Ahora los tres parten del mismo APU_STANDARD_FACTORS.
    herramienta: Number(raw.herramienta ?? APU_STANDARD_FACTORS.herramienta),
    indCampo: Number(raw.indCampo ?? APU_STANDARD_FACTORS.indCampo),
    indOficina: Number(raw.indOficina ?? APU_STANDARD_FACTORS.indOficina),
    finance: Number(raw.finance ?? APU_STANDARD_FACTORS.finance),
    utility: Number(raw.utility ?? APU_STANDARD_FACTORS.utility),
    cargos: Number(raw.cargos ?? APU_STANDARD_FACTORS.cargos),
    iva: Number(raw.iva ?? APU_STANDARD_FACTORS.iva),
    family: raw.family || 'APU generado con IA',
    confidence: Number(raw.confidence || 92),
    sat: raw.sat || '72100000',
    aiNotes: Array.isArray(raw.notes) ? raw.notes : [],
    date:new Date().toLocaleDateString('es-MX')
  };
}
export function makeEmptyAPU(){
  return {
    id:'APU-'+uid(),
    clave:'APU-'+uid(),
    concept:'',
    unit:'m²',
    materials:[],
    labor:[],
    equipment:[],
    // Antes un APU nuevo en blanco arrancaba en 0% para todo (un tercer
    // conjunto de defaults, distinto del de plantilla/Excel e IA): con
    // indirectos/utilidad en 0%, un usuario que no tocara estos campos podia
    // guardar/exportar un APU regalando la obra sin ninguna advertencia.
    // Ahora arranca con los mismos porcentajes estandar que plantilla/Excel/
    // IA (siguen siendo 100% editables por el usuario).
    herramienta:APU_STANDARD_FACTORS.herramienta,
    indCampo:APU_STANDARD_FACTORS.indCampo,
    indOficina:APU_STANDARD_FACTORS.indOficina,
    finance:APU_STANDARD_FACTORS.finance,
    utility:APU_STANDARD_FACTORS.utility,
    cargos:APU_STANDARD_FACTORS.cargos,
    iva:APU_STANDARD_FACTORS.iva,
    family:'pendiente',
    confidence:0,
    sat:'',
    aiNotes:[]
  };
}
