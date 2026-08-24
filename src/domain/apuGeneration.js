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
import { cleanText, matchPrice, normalizeUnitLabel, parseConceptText, conceptVariablesFromParsed } from '../lib/excelImport.js';
import { APU_DEFAULT_FACTORS } from '../lib/apuCalc.js';
import { uid } from '../utils/id.js';
import { scopedKey } from '../utils/scopedStorage.js';

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

/* Mapa tipo interno del motor APU -> familia compartida con la Biblioteca.
   No cambia la clasificacion tecnica (tipo), solo la etiqueta que se muestra.
   Las familias de texto usadas abajo coinciden con las de
   src/domain/taxonomy.js (LIBRARY_DISCIPLINES), para que Biblioteca y APU
   usen el mismo vocabulario de familias. */
const APU_FAMILY_LABELS = {
  concreto:'Cimentacion', acero:'Estructura metalica', estructura_metalica:'Estructura metalica',
  block:'Albanileria', tablaroca:'Tablaroca y Durock', lavabo_ptr:'Tablaroca y Durock', plafon_suspendido:'Tablaroca y Durock',
  pintura:'Acabados', aplanado:'Acabados', piso:'Acabados', marmol_granito:'Acabados', sello:'Acabados', registro:'Acabados', imper:'Acabados', adhesivo:'Acabados',
  excavacion:'Terracerias', excavacion_mecanica:'Terracerias', desmonte_mecanico:'Terracerias', acarreo_camion:'Terracerias', acarreo_manual:'Terracerias',
  limpieza_trazo:'Limpieza y preliminares', demolicion:'Limpieza y preliminares',
  movimiento_mobiliario:'Equipamiento',
  tuberia:'Hidrosanitaria', bomba:'Hidrosanitaria', generico:'General'
};

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
  // Plafon / tablaroca manda: menciones como "pintura anticorrosiva" dentro de las
  // inclusiones de un falso plafon NO deben clasificar el concepto como pintura.
  const isSuspendedCeiling = /falso\s*plaf|plaf[oó]n(d)?\s+de\s+(tablaroca|yeso|tablacemento)|suspensi[oó]n\s*oculta|colganter[ií]a|canal\s*list[oó]n|perfacinta|redimix/.test(t);
  const isDrywallConcept = isSuspendedCeiling || /tablaroca|durock|tablacemento|trasdosado|cajillo|panel.*yeso/.test(t);
  const isPaintingConcept = !isDrywallConcept && (
    /pua\s*501|pua501|mapla|suministro y aplicaci[oó]n de pintura|pintar|repint|esmalte|vin[ií]lic|acr[ií]l|ep[oó]x|sellador vin/.test(t)
    || (/(muro|muros|plaf[oó]n|plafones)/.test(t) && /(pintura|recubrimiento|preparaci[oó]n de la superficie|lija|lavado)/.test(t))
  );
  // Estos 4 verbos de actividad mandan sobre cualquier sustantivo de material
  // que aparezca despues (loseta, azulejo, tablaroca...): "Demolicion de
  // loseta" es una demolicion, nunca una colocacion, aunque contenga la
  // palabra "loseta" -- sin este chequeo primero, esos 4 casos caian en la
  // plantilla del material (ej. "piso") y arrastraban insumos que no
  // corresponden al alcance real (loseta nueva en una demolicion, boquilla
  // en un acarreo, etc.). isAdhesiveOnlyConcept exige que el concepto NO
  // mencione el material ceramico: si lo menciona, es la partida de
  // colocacion completa (que ya incluye su propio adhesivo en la plantilla
  // "piso"), no una aplicacion de adhesivo aislada.
  const isDemolitionConcept = /demolic|demoler|desmontar|retiro\s+de\s+(loseta|piso|azulejo|cer[aá]mic|porcelanato)/.test(t);
  const isFurnitureMoveConcept = /movimiento\s+de\s+(mueble|mobiliario)|reacomodo\s+de\s+mobiliario|protecci[oó]n\s+y\s+movimiento\s+de\s+mobiliario/.test(t);
  const isAdhesiveOnlyConcept = /(aplicaci[oó]n|colocaci[oó]n|instalaci[oó]n)\s+de\s+adhesivo|pegazulejo|cemento\s+cola/.test(t) && !/loseta|azulejo|porcelanato|cer[aá]mic|\bpiso\b/.test(t);
  const isManualHaulingConcept = /acarreo|acarrear/.test(t) && !/cami[oó]n|volteo|for[aá]neo/.test(t);
  let tipo;
  if(isDemolitionConcept) tipo='demolicion';
  else if(isFurnitureMoveConcept) tipo='movimiento_mobiliario';
  else if(isAdhesiveOnlyConcept) tipo='adhesivo';
  else if(isManualHaulingConcept) tipo='acarreo_manual';
  else if(isSuspendedCeiling) tipo='plafon_suspendido';
  else if(isDrywallConcept) tipo='tablaroca';
  else if(isPaintingConcept) tipo='pintura';
  else if(/escalera|barandal|herrer|ptr|perfil tubular|estructura metal|soldadur|acero.*calibre|bastidor.*acero/.test(t)) tipo='estructura_metalica';
  else if(/plaf|fald|tablaroca|durock|tablacemento|trasdosado|cajillo|enchape|panel.*yeso|yeso|antimoho|anti moho/.test(t)) tipo='tablaroca';
  else if(/marmol|granito|cubierta|barra lavamanos/.test(t)) tipo='marmol_granito';
  else if(/registro|tapa de acceso|tapa registro|paso de instalaciones/.test(t)) tipo='registro';
  else if(/aplanado|repellado|enjarre|plaster|uniblock|resane|emboquillado|chukum/.test(t)) tipo='aplanado';
  else if(/pintura|pintar|esmalte|vinil|acril|epox|primario|sellador vin/.test(t)) tipo='pintura';
  else if(/plaf|fald|tablaroca|durock|tablacemento|trasdosado|cajillo|enchape|panel.*yeso|yeso|antimoho|anti moho/.test(t)) tipo='tablaroca';
  else if(/porcelanato|loseta|azulejo|cer[aá]mic|lambr|piso|zoclo|boquilla|sardinel/.test(t)) tipo='piso';
  else if(/marmol|m[aá]rmol|granito|cubierta|barra lavamanos/.test(t)) tipo='marmol_granito';
  else if(/aplanado|repellado|enjarre|plaster|uniblock|resane|emboquillado|chukum/.test(t)) tipo='aplanado';
  else if(/sellado|sello|silicon|silic[oó]n|calafate|junta|espuma/.test(t)) tipo='sello';
  if(!tipo){
  if(/bomba|electrobomba|equipo de bombeo|bombeo hidr[aá]ulico|motobomba/.test(t)) tipo='bomba';
  else if(/tuber[ií]a|tubo\s|tubos\s|conducci[oó]n hidr[aá]ulica|red hidr[aá]ulica|l[ií]nea hidr[aá]ulica|bajada pluvial|drenaje sanitario/.test(t)) tipo='tuberia';
  else if(/lavabo|durock|ptr|mueble.*bañ|mueble.*ban|base.*lavabo|cer[aá]mico/.test(t)) tipo='lavabo_ptr';
  else if(/estructura met[aá]lica|astm|a500|fy\s*=?\s*46|soldadur|perfil de acero|placa.*acero|grout|primario anticorrosivo|montaje.*estructura|fabricaci[oó]n.*estructura/.test(t)) tipo='estructura_metalica';
  else if(/acero|varilla|castillo|cadena|armad|fierro|malla/.test(t)) tipo='acero';
  else if(/concreto|losa|zapata|firme|cimentaci|colado|columna de conc/.test(t)) tipo='concreto';
  else if(isPaintingConcept) tipo='pintura';
  else if(/block|tabique|tabic[oó]n|muro|partici[oó]n|mamposter|junteo/.test(t)) tipo='block';
  else if(/pintura|pintar|esmalte|vinil/.test(t)) tipo='pintura';
  else if(/impermeabiliz/.test(t)) tipo='imper';
  else if(/aplanado|repellado|enjarre|yeso|resane/.test(t)) tipo='aplanado';
  else if(/piso|cer[aá]mic|loseta|porcelanato|azulejo/.test(t)) tipo='piso';
  else if(/limpieza\s*(y|,)?\s*trazo|trazo\s*y\s*nivelaci[oó]n|trazo\s+topogr[aá]fico|desyerbe|chapeo|limpieza\s+(inicial|del\s+terreno|del\s+predio|del\s+solar)/.test(t)) tipo='limpieza_trazo';
  else if(/desmonte|desenra[ií]ce|destronque/.test(t)) tipo='desmonte_mecanico';
  else if(/acarreo/.test(t) && /cami[oó]n|volteo|for[aá]neo/.test(t)) tipo='acarreo_camion';
  else if(/excavaci[oó]n?.*(m[aá]quina|mec[aá]nica|retroexcavadora|excavadora)|retroexcavadora|excavadora/.test(t)) tipo='excavacion_mecanica';
  else if(/excavaci|zanja|despalme/.test(t)) tipo='excavacion';
  else tipo='generico';

  }
  const unmatched = tipo === 'generico';
  const TPL = {
    lavabo_ptr:{ unit:'m',
      materials:[['Perfil PTR de acero de 2" x 2" cal. 14',1.15,'m',92,0],['Tablero de cemento Durock 12.7 mm',0.65,'m²',210,0],['Anclajes, fijaciones, tornillería y soldadura',1,'lote',25,0],['Pasta, cinta y malla para juntas',0.18,'jgo',85,3],['Pintura anticorrosiva / primario',0.08,'L',98,3],['Materiales misceláneos de ajuste y protección',0.04,'jgo',120,0]],
      labor:[['Cuadrilla de herrero + ayudante',0.035,'jor',1400,1],['Trazo, nivelación y presentación',0.015,'jor',700,1],['Resanes, cortes y adecuaciones',0.02,'jor',700,1],['Limpieza, retiro y protección del área',0.02,'jor',470,1]],
      equipment:[['Equipo de protección y andamios (5% de M.O.)',0.05,'(%MO)',49],['Soldadora y herramienta de corte',0.03,'día',120]] },
    tablaroca:{ unit:'m²',
      materials:[['Panel de yeso / tablacemento 12.7 mm segun especificacion',1.05,'m²',210,5],['Poste o canal metalico galvanizado',1.25,'m',38,5],['Canal de amarre y refuerzos',0.55,'m',32,5],['Tornilleria, taquetes y fijaciones',0.18,'jgo',85,3],['Cinta y compuesto para juntas',0.22,'kg',42,5],['Pasta / sellador de acabado',0.12,'L',70,5],['Materiales miscelaneos y proteccion',0.04,'jgo',120,0]],
      labor:[['Instalador de panel (oficial)',0.12,'jor',420,1.85],['Ayudante instalador',0.12,'jor',285,1.82],['Trazo, plomeo y nivelacion',0.025,'jor',420,1.85],['Tratamiento de juntas y resanes',0.05,'jor',380,1.85],['Limpieza y retiro de desperdicio',0.035,'jor',258,1.82]],
      equipment:[['Andamio / escalera de trabajo',0.04,'día',120],['Herramienta electrica de corte y fijacion',0.03,'día',150],['Equipo de seguridad personal',0.02,'día',90]] },
    plafon_suspendido:{ unit:'m²',
      materials:[
        ['Panel de yeso (tablaroca) 12.7 mm segun especificacion',1.05,'m²',95,8],
        ['Canaleta de carga 38 mm cal. 22 con pintura anticorrosiva',0.95,'m',38,5],
        ['Canal liston para suspension oculta',2.3,'m',30,5],
        ['Colganteria de alambre galvanizado No. 14',0.12,'kg',48,5],
        ['Alambre recocido No. 16 para amarres',0.05,'kg',38,3],
        ['Ancla de agujero tipo Ramset con fulminante',1.5,'pza',9,3],
        ['Tornilleria S-1" y fijaciones para panel',0.18,'jgo',85,3],
        ['Perfacinta para tratamiento de juntas',1.5,'m',3,5],
        ['Compuesto Redimix para juntas y resanes',0.9,'kg',22,5]
      ],
      labor:[
        ['Tablaroquero oficial (suspension oculta hasta 4.00 m)',0.1,'jor',420,1.85],
        ['Ayudante instalador',0.1,'jor',285,1.82],
        ['Trazo, nivelacion y balanceado de colganteria',0.03,'jor',420,1.85],
        ['Tratamiento de juntas: perfacinta y Redimix',0.05,'jor',380,1.85],
        ['Limpieza y retiro de desperdicio',0.03,'jor',258,1.82]
      ],
      equipment:[
        ['Andamio de trabajo hasta 4.00 m de altura',0.06,'día',120],
        ['Herramienta electrica: rotomartillo y atornillador',0.04,'día',150],
        ['Equipo de seguridad personal',0.02,'día',90]
      ] },
    sello:{ unit:'ml',
      materials:[['Sellador elastomerico / silicon anti hongos',0.12,'cartucho',95,5],['Primer o limpiador de superficie',0.03,'L',85,3],['Cinta de respaldo o espuma de poliuretano',0.08,'m',18,5],['Material de limpieza y proteccion',0.03,'jgo',60,0]],
      labor:[['Oficial aplicador de sellos',0.035,'jor',380,1.85],['Ayudante',0.025,'jor',258,1.82],['Preparacion, limpieza y retiro',0.02,'jor',258,1.82]],
      equipment:[['Pistola calafateadora y herramienta menor',0.02,'día',60],['Escalera / andamio proporcional',0.02,'día',120]] },
    marmol_granito:{ unit:'m²',
      materials:[['Adhesivo flexible para piedra natural',0.22,'bulto',220,5],['Boquilla / resina de junta',0.28,'kg',85,5],['Anclajes, separadores y niveladores',0.12,'jgo',120,3],['Material de limpieza y proteccion',0.05,'jgo',90,0]],
      labor:[['Colocador especializado en marmol/granito',0.16,'jor',520,1.85],['Ayudante colocador',0.16,'jor',285,1.82],['Trazo, cortes y ajuste de piezas',0.06,'jor',520,1.85],['Limpieza final y proteccion',0.04,'jor',258,1.82]],
      equipment:[['Cortadora con disco diamantado',0.05,'día',180],['Pulidora / herramienta menor',0.04,'día',150],['Equipo de izaje o apoyo proporcional',0.02,'día',200]] },
    registro:{ unit:'pza',
      materials:[['Marco y tapa de registro segun medida especificada',1,'pza',480,3],['Canal / perfil galvanizado para soporte',1.2,'m',38,5],['Tornilleria, taquetes y fijaciones',0.12,'jgo',85,3],['Panel de cierre o placa de ajuste',0.35,'m²',210,5],['Pasta, cinta y resane perimetral',0.15,'kg',42,5],['Material de limpieza y proteccion',0.03,'jgo',60,0]],
      labor:[['Oficial instalador',0.18,'jor',420,1.85],['Ayudante instalador',0.18,'jor',285,1.82],['Trazo, nivelacion y ajuste de vano',0.04,'jor',420,1.85],['Resane y limpieza final',0.04,'jor',258,1.82]],
      equipment:[['Herramienta electrica de corte y fijacion',0.05,'día',150],['Escalera / andamio proporcional',0.03,'día',120],['Equipo de seguridad personal',0.02,'día',90]] },
    estructura_metalica:{ unit:'kg',
      materials:[['Acero estructural ASTM A500 Fy=46 KSI (incl. desperdicio)',1.05,'kg',46.5,0],['Soldadura E-7018 y consumibles de taller',0.03,'kg',120,0],['Primario anticorrosivo alquidálico de alta resistencia',0.02,'L',110,0],['Grout, anclajes y placas base proporcionales',0.015,'jgo',180,0]],
      labor:[['Cuadrilla de montadores y soldadores calificados',0.012,'jor',1650,1],['Trazo, plomeo y verificación de montaje',0.004,'jor',900,1],['Habilitado, limpieza y protección de soldadura',0.004,'jor',780,1]],
      equipment:[['Grúa / equipo de izaje proporcional',0.015,'hr',550],['Soldadora, extensiones y herramienta de montaje',0.018,'hr',180],['Herramienta menor y equipo de protección (EPP)',0.08,'(%MO)',19.8]] },
    concreto:{ unit:'m³',
      materials:[['Cemento gris CPC 30R',7,'bulto',225,3],['Arena',0.55,'m³',480,5],['Grava 19 mm',0.75,'m³',520,5],['Agua',0.18,'m³',65,0],['Curacreto / membrana de curado',0.12,'L',68,3],['Clavo y madera auxiliar para niveles',0.015,'jgo',180,5]],
      labor:[['Oficial albañil',0.22,'jor',380,1.85],['Ayudante / peón',0.22,'jor',258,1.82],['Cabo de obra',0.03,'jor',520,1.85],['Limpieza y curado',0.08,'jor',258,1.82]],
      equipment:[['Revolvedora 1 saco',0.25,'hr',95],['Vibrador de concreto',0.2,'hr',110],['Herramienta de nivelación',0.05,'día',90]] },
    acero:{ unit:'kg',
      materials:[['Acero de refuerzo fy=4200',1.05,'kg',26.5,2],['Alambre recocido cal. 18',0.03,'kg',32,3]],
      labor:[['Fierrero (oficial)',0.018,'jor',400,1.85],['Ayudante',0.018,'jor',258,1.82]],
      equipment:[['Cizalla / dobladora',0.01,'día',180]] },
    pintura:{ unit:'m²',
      materials:[['Pintura vinílica / acrílica según especificación',0.18,'L',85,5],['Sellador vinílico 5x1 / primario según sustrato',0.06,'L',70,5],['Diluyente / agua limpia para aplicación',0.02,'L',28,0],['Lija fina para preparación de superficie',0.08,'pza',18,0],['Cinta masking para cortes y remates',0.05,'rollo',42,0],['Plástico, cartón y protección de áreas',0.08,'m²',12,0],['Rodillo, brocha y charola proporcional',0.035,'jgo',145,0]],
      labor:[['Pintor oficial',0.055,'jor',360,1.85],['Ayudante de pintor',0.045,'jor',258,1.82],['Preparación, lavado ligero, lijado y limpieza de superficie',0.025,'jor',258,1.82],['Protección de áreas, cortes y limpieza final',0.02,'jor',258,1.82]],
      equipment:[['Andamio / escalera de trabajo',0.04,'día',120],['Herramienta de aplicación: extensiones, rodillos y brochas',0.025,'día',75],['Equipo de seguridad personal',0.015,'día',90]] },
    imper:{ unit:'m²',
      materials:[['Impermeabilizante acrílico',1.6,'L',78,5],['Membrana de refuerzo',0.3,'m²',22,5],['Sellador / primario',0.15,'L',60,5]],
      labor:[['Aplicador (oficial)',0.05,'jor',360,1.85],['Ayudante',0.05,'jor',258,1.82]],
      equipment:[['Equipo de aplicación',0.03,'día',90]] },
    aplanado:{ unit:'m²',
      materials:[['Cemento gris CPC 30R',0.09,'bulto',225,3],['Cal hidratada',0.04,'bulto',95,3],['Arena cernida',0.025,'m³',480,5],['Agua',0.012,'m³',65,0],['Sellador / aditivo de adherencia',0.04,'L',85,3],['Materiales misceláneos',0.03,'jgo',120,0],['Plástico y protección de áreas',0.04,'m²',12,5]],
      labor:[['Albañil (oficial)',0.18,'jor',380,1.85],['Peón',0.18,'jor',258,1.82],['Resanes, cortes y adecuaciones',0.08,'jor',380,1.85],['Limpieza, acarreos y retiro al término',0.06,'jor',258,1.82]],
      equipment:[['Andamio / regla',0.04,'día',120],['Herramienta menor especializada',0.03,'día',85],['Carretilla y equipo de acarreo',0.02,'día',75]] },
    piso:{ unit:'m²',
      materials:[['Loseta cerámica 30x30',1.05,'m²',135,8],['Adhesivo / pegazulejo',0.18,'bulto',135,5],['Boquilla / junteador',0.3,'kg',28,5]],
      labor:[['Colocador (oficial)',0.12,'jor',400,1.85],['Ayudante',0.12,'jor',258,1.82]],
      equipment:[['Cortadora de loseta',0.03,'día',150]] },
    // Nunca incluye loseta/piso nuevo: el alcance de una demolicion es retirar
    // lo existente, no suministrar material de acabado.
    demolicion:{ unit:'m²',
      materials:[['Costales para retiro de escombro',0.4,'pza',12,0]],
      labor:[['Oficial de demolición',0.1,'jor',380,1.85],['Ayudante',0.1,'jor',258,1.82]],
      equipment:[['Rotomartillo / equipo de demolición',0.04,'día',180],['Herramienta menor (marro, cincel, pala)',0.04,'día',80],['Equipo de seguridad personal (EPP: careta, guantes, botas)',0.03,'día',90]] },
    // Manejo interno de material (costales, piezas, sacos) sin camion de
    // volteo -- ver acarreo_camion para el caso con transporte foraneo.
    // Nunca incluye el material acarreado como insumo, solo la mano de obra
    // y el equipo de manejo.
    acarreo_manual:{ unit:'viaje',
      materials:[],
      labor:[['Peón de acarreo',0.05,'jor',258,1.82]],
      equipment:[['Carretilla / diablito de carga',0.03,'día',70],['Herramienta menor',0.02,'día',50],['Equipo de seguridad personal (EPP: guantes, faja, botas)',0.02,'día',90]] },
    // Aplicacion de adhesivo/cemento cola como partida independiente: nunca
    // incluye loseta ni boquilla (ver isAdhesiveOnlyConcept -- si el concepto
    // menciona el material ceramico, clasifica como "piso" en vez de esto).
    adhesivo:{ unit:'m²',
      materials:[['Adhesivo / cemento cola según especificación',0.2,'bulto',135,8],['Agua para mezcla',0.02,'m³',65,0],['Material de limpieza y protección',0.03,'jgo',60,0]],
      labor:[['Aplicador oficial (llana dentada)',0.06,'jor',400,1.85],['Ayudante',0.06,'jor',258,1.82]],
      equipment:[['Llana dentada y herramienta de aplicación',0.02,'día',80],['Mezclador / taladro con batidor',0.02,'día',100],['Cubetas graduadas',0.02,'día',40],['Equipo de seguridad personal (EPP: guantes, lentes)',0.02,'día',70]] },
    // Reacomodo/proteccion de mobiliario existente: nunca incluye materiales
    // de piso/adhesivo, solo cuadrilla, proteccion y herramienta de maniobra.
    movimiento_mobiliario:{ unit:'lote',
      materials:[['Material de protección (cartón, plástico, cinta)',1,'lote',180,0]],
      labor:[['Cuadrilla de maniobras (oficial + ayudante)',0.15,'jor',700,1.85]],
      equipment:[['Herramienta menor de maniobra',0.05,'día',60],['Equipo de seguridad personal (EPP: guantes, faja)',0.03,'día',70]] },
    excavacion:{ unit:'m³',
      materials:[],
      labor:[['Peón (excavación manual)',0.6,'jor',258,1.82],['Cabo de obra',0.03,'jor',380,1.85]],
      equipment:[['Herramienta de excavación (pala, pico, barreta)',0.05,'día',60]] },
    limpieza_trazo:{ unit:'m²',
      materials:[['Cal para trazo',0.05,'kg',12,0],['Estacas de madera',0.08,'pza',8,5],['Hilo nylon para trazo',0.02,'rollo',35,0],['Pintura en aerosol para referencias',0.01,'pza',55,0]],
      labor:[['Cuadrilla de trazo y nivelación (topógrafo/albañil oficial)',0.02,'jor',480,1.85],['Ayudante de trazo',0.02,'jor',258,1.82]],
      equipment:[['Equipo topográfico básico (nivel, estadal, cinta)',0.015,'día',180],['Herramienta menor',0.02,'día',60]] },
    desmonte_mecanico:{ unit:'m²',
      materials:[],
      labor:[['Operador de maquinaria pesada',0.015,'jor',650,1.85],['Peón de apoyo',0.02,'jor',258,1.82]],
      equipment:[['Tractor / retroexcavadora para desmonte',0.04,'hr',850],['Combustible y consumibles de equipo (costo horario)',0.04,'hr',180]] },
    excavacion_mecanica:{ unit:'m³',
      materials:[],
      labor:[['Operador de excavadora / retroexcavadora',0.025,'jor',650,1.85],['Peón de apoyo',0.03,'jor',258,1.82]],
      equipment:[['Excavadora / retroexcavadora',0.06,'hr',950],['Combustible y consumibles de equipo (costo horario)',0.06,'hr',150]] },
    acarreo_camion:{ unit:'m³',
      materials:[],
      labor:[['Operador de camión de volteo',0.02,'jor',480,1.85],['Ayudante de maniobras',0.01,'jor',258,1.82]],
      equipment:[['Camión de volteo 7 m³ (costo por hora/ciclo, editable segun distancia)',0.08,'hr',680],['Cargador frontal (carga de material, si aplica)',0.015,'hr',780]] },
    block:{ unit:'m²',
      materials:[['Block hueco 15x20x40',12.5,'pza',16.5,3],['Cemento gris CPC 30R',0.16,'bulto',225,3],['Arena cernida',0.035,'m³',480,5],['Agua',0.012,'m³',65,0],['Alambre / plomeo / nivelación',0.015,'jgo',90,0],['Materiales misceláneos',0.02,'jgo',120,0]],
      labor:[['Albañil (oficial)',0.35,'jor',380,1.85],['Peón',0.35,'jor',258,1.82],['Trazo, plomeo y nivelación',0.04,'jor',380,1.85],['Acarreos internos y limpieza',0.05,'jor',258,1.82]],
      equipment:[['Andamio / equipo básico',0.05,'día',280],['Revolvedora 1 saco',0.04,'hr',95],['Herramienta de corte y ajuste',0.02,'día',90]] },
    bomba:{ unit:'pza',
      materials:[['Bomba centrifuga / sumergible segun especificacion',1,'pza',8500,0],['Base o soporte antivibratorio',1,'jgo',420,0],['Valvulas de conexion (check y compuerta)',2,'pza',380,0],['Conexiones electricas, cable y proteccion termica',1,'lote',650,0],['Accesorios de acople e instalacion',1,'jgo',280,3]],
      labor:[['Instalador electromecanico (oficial)',0.8,'jor',520,1.85],['Ayudante instalador',0.8,'jor',285,1.82],['Pruebas, arranque y ajuste de equipo',0.2,'jor',520,1.85]],
      equipment:[['Polipasto / equipo de izaje proporcional',0.15,'día',220],['Herramienta electrica y de conexion',0.1,'día',150],['Equipo de seguridad personal',0.05,'día',90]] },
    tuberia:{ unit:'m',
      materials:[['Tubo segun diametro y material especificado',1.05,'m',95,3],['Coples y conexiones proporcionales',0.3,'pza',45,3],['Pegamento / soldadura segun material de tuberia',0.06,'lote',85,0],['Soporteria y abrazaderas',0.25,'pza',38,3]],
      labor:[['Tubero / plomero (oficial)',0.09,'jor',400,1.85],['Ayudante',0.09,'jor',258,1.82],['Pruebas hidrostaticas y ajuste de juntas',0.02,'jor',400,1.85]],
      equipment:[['Herramienta de corte y union de tuberia',0.03,'día',110],['Equipo de prueba de presion',0.02,'día',150]] },
    generico:{ unit:'pza',
      materials:[['Pendiente de cotización: insumo principal no identificado automáticamente',1,'pza',0,0],['Pendiente de cotización: materiales complementarios y de fijación',1,'lote',0,0]],
      labor:[['Oficial (revisar cuadrilla segun concepto)',0.1,'jor',380,1.85],['Ayudante',0.1,'jor',258,1.82]],
      equipment:[['Herramienta menor y equipo de apoyo (revisar segun concepto)',0.05,'día',100]] }
  };
  const tpl = TPL[tipo];
  // El rendimiento de acarreo manual consume la distancia real detectada en
  // el concepto (Fase 3/RC5: "el motor APU debe consumir distancia", no solo
  // almacenarla) -- 10 m, 25 m y 50 m producen coeficientes de mano de obra
  // y equipo distintos, nunca el mismo rendimiento "por defecto". Capacidad
  // por viaje segun si la unidad detectada es volumetrica (m³) o de conteo
  // de piezas/costales (ver HAUL_MODEL arriba).
  let haulDistanceUsed = null;
  if(tipo === 'acarreo_manual'){
    const capacidadPorViaje = variables.volumeUnit === 'm³' ? HAUL_MODEL.capacidadPorViajeM3 : HAUL_MODEL.capacidadPorViajePieza;
    haulDistanceUsed = Number.isFinite(variables.distance) && variables.distance > 0 ? variables.distance : HAUL_MODEL.distanciaPorDefectoM;
    const coef = haulLaborCoefficientPerUnit(variables.distance, capacidadPorViaje);
    tpl.labor = tpl.labor.map((r,i) => i===0 ? [r[0], coef, r[2], r[3], r[4]] : r);
    tpl.equipment = tpl.equipment.map((r,i) => i===0 ? [r[0], coef, r[2], r[3]] : r);
  }
  const normalizeApuRow = (r) => {
    const nr = [...r];
    nr[0] = cleanText(nr[0]);
    nr[2] = normalizeUnitLabel(nr[2]);
    return nr;
  };
  const useCat = (arr) => arr.map(r=>{
    const m = matchPrice(r[0],catalog);
    const nr = normalizeApuRow(r);
    if(m){
      nr[3]=m.precio;
      if(m.unidad) nr[2]=normalizeUnitLabel(m.unidad);
    }
    return nr;
  });
  const materials = useCat(tpl.materials);
  const labor = tpl.labor.map(normalizeApuRow);
  const equipment = tpl.equipment.map(normalizeApuRow);
  if(/calafate|sellado|junta/.test(t)) materials.push(normalizeApuRow(['Calafateo / sellador de juntas',0.08,'L',95,5]));
  if(/resane|adecuacion|adecuaci[oó]n|corte|elevaci[oó]n/.test(t)) labor.push(['Cortes, elevaciones, resanes y adecuaciones',0.07,'jor',380,1.85]);
  if(/retiro|limpieza|termino|t[eé]rmino/.test(t)) labor.push(['Retiro al término, limpieza fina y carga manual',0.06,'jor',258,1.82]);
  if(/acarreo|acarreos/.test(t)) equipment.push(['Equipo menor para acarreos internos',0.04,'día',110]);
  const standardClave = 'APU-' + stableHash(c);
  const TPL_META = {
    plafon_suspendido:{ confidence:88, sat:'72152400' },
    pintura:{ confidence:88, sat:'72151300' },
    lavabo_ptr:{ confidence:98, sat:'72101500' },
    estructura_metalica:{ confidence:97, sat:'72101700' },
    bomba:{ confidence:90, sat:'40101700' },
    tuberia:{ confidence:88, sat:'72101507' },
    limpieza_trazo:{ confidence:85, sat:'72101505' },
    desmonte_mecanico:{ confidence:83, sat:'72101503' },
    excavacion_mecanica:{ confidence:85, sat:'72101503' },
    acarreo_camion:{ confidence:82, sat:'78101800' },
    demolicion:{ confidence:82, sat:'72101504' },
    acarreo_manual:{ confidence:80, sat:'78101800' },
    adhesivo:{ confidence:85, sat:'72151600' },
    movimiento_mobiliario:{ confidence:78, sat:'78102200' },
    generico:{ confidence:45, sat:'72100000' }
  };
  const meta = { family: APU_FAMILY_LABELS[tipo] || tipo, confidence: TPL_META[tipo]?.confidence ?? 88, sat: TPL_META[tipo]?.sat ?? '72100000' };
  const aiNotes = [];
  if(unmatched) aiNotes.push('APU INCOMPLETO: no se identifico con precision la familia tecnica del concepto. Los materiales marcados "Pendiente de cotización" tienen precio $0.00 y no deben tomarse como precio final; captura precios reales antes de exportar.');
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
    materials, labor, equipment,
    herramienta:APU_STANDARD_FACTORS.herramienta, indCampo:APU_STANDARD_FACTORS.indCampo, indOficina:APU_STANDARD_FACTORS.indOficina, finance:APU_STANDARD_FACTORS.finance, utility:APU_STANDARD_FACTORS.utility, cargos:APU_STANDARD_FACTORS.cargos, iva:APU_STANDARD_FACTORS.iva,
    family: meta.family,
    confidence: meta.confidence,
    sat: meta.sat,
    incomplete: unmatched,
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
