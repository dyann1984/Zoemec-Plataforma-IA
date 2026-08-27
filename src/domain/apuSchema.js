/* Esquema v2 del APU: cedula profesional de analisis de precio unitario con
   encabezado tecnico, renglones-objeto (materiales/mano de obra/equipo con
   clave, fuente y estado de verificacion), herramienta menor por % o por
   detalle, seguridad, procedimiento constructivo, control de calidad,
   criterio de medicion, supuestos explicitos y confianza desglosada por
   dimension. Modulo puro (sin React/DOM); el calculo real vive en
   src/lib/apuCalc.js (calcAPUv2 y las funciones calc*Row), este archivo solo
   define la forma de los datos y como migrar un APU v1 (renglones
   posicionales, ver src/domain/apuGeneration.js) a este esquema.

   Fase 1: este esquema es aditivo. Nada en main.jsx, apuExport.js ni los
   prompts de IA lo usa todavia; se conecta en fases posteriores. */
import { APU_DEFAULT_FACTORS } from '../lib/apuCalc.js';
import { uid } from '../utils/id.js';
import { RENDIMIENTO_FUENTE } from './apuReview.js';

/* Estado de verificacion de un dato (precio, rendimiento, renglon completo).
   Ningun dato generado por plantilla o IA puede etiquetarse VERIFICADO por
   defecto: solo pasa a VERIFICADO cuando el usuario confirma la fuente o
   proviene de un catalogo de precios importado con proveedor real. */
export const APU_DATA_STATE = Object.freeze({
  VERIFICADO: 'VERIFICADO',
  IMPORTADO: 'IMPORTADO',
  ESTIMADO_IA: 'ESTIMADO_IA',
  ASUMIDO: 'ASUMIDO',
  REQUIERE_VALIDACION: 'REQUIERE_VALIDACION'
});

/* Etiqueta visible (UI + Excel/PDF) para cada estado de procedencia de precio.
   Un precio ESTIMADO_IA o ASUMIDO nunca debe mostrarse como si estuviera
   comprobado: el texto en pantalla es tan importante como el dato interno. */
export const APU_DATA_STATE_LABEL = Object.freeze({
  [APU_DATA_STATE.VERIFICADO]: 'FUENTE EXTERNA VALIDADA',
  [APU_DATA_STATE.IMPORTADO]: 'IMPORTADO',
  [APU_DATA_STATE.ESTIMADO_IA]: 'ESTIMADO IA',
  [APU_DATA_STATE.ASUMIDO]: 'BASE ZOEMEC',
  [APU_DATA_STATE.REQUIERE_VALIDACION]: 'REQUIERE VALIDACIÓN'
});
export function apuDataStateLabel(estado){
  return APU_DATA_STATE_LABEL[estado] || 'REQUIERE VALIDACIÓN';
}

/* Semantica de integracion de un recurso (material/equipo/EPP) al precio
   unitario. Un costo de cuadrilla (EPP, equipo rentado por jornada, herramienta
   comprada por lote) NUNCA es directamente "cantidad x precio" por unidad de
   obra -- eso solo es correcto para consumo verdaderamente proporcional
   (POR_UNIDAD_OBRA). El motor (src/lib/apuCalc.js) exige esta clave por
   renglon y nunca la infiere: si falta, calcula con el valor por defecto
   POR_UNIDAD_OBRA pero el renglon queda marcado como pendiente de revision en
   findApuNumericIssuesV2, nunca se acepta en silencio como correcto. */
export const RESOURCE_INTEGRATION = Object.freeze({
  POR_UNIDAD_OBRA: 'POR_UNIDAD_OBRA', // consumo directamente proporcional a 1 unidad del concepto
  POR_JORNADA: 'POR_JORNADA',         // costo de uso diario / rendimiento diario de la cuadrilla
  POR_LOTE: 'POR_LOTE',               // costo fijo repartido entre la cantidad contractual total
  AMORTIZABLE: 'AMORTIZABLE',         // precio de adquisicion x factor de uso / vida util / rendimiento diario
  PORCENTAJE_MO: 'PORCENTAJE_MO'      // herramienta menor como % de mano de obra
});
export const RESOURCE_INTEGRATION_LABEL = Object.freeze({
  [RESOURCE_INTEGRATION.POR_UNIDAD_OBRA]: 'Por unidad de obra',
  [RESOURCE_INTEGRATION.POR_JORNADA]: 'Por jornada (prorrateado)',
  [RESOURCE_INTEGRATION.POR_LOTE]: 'Por lote (repartido en la cantidad contractual)',
  [RESOURCE_INTEGRATION.AMORTIZABLE]: 'Amortizable (vida util)',
  [RESOURCE_INTEGRATION.PORCENTAJE_MO]: '% de mano de obra'
});

/* Nivel de evidencia de un precio de mercado (Price Intelligence). Distinto
   de APU_DATA_STATE: ese describe el estado del renglon del APU; este
   describe la solidez de la referencia de precio en si (cuantas fuentes
   coincidieron, si vino de busqueda web real o quedo sin evidencia externa). */
export const PRICE_EVIDENCE_LEVEL = Object.freeze({
  VALIDADO: 'VALIDADO',       // fuente directa (catalogo/proveedor cargado por el usuario) y especificacion coincidente
  MERCADO: 'MERCADO',         // varias fuentes de busqueda web concordantes
  REFERENCIAL: 'REFERENCIAL', // evidencia parcial (una sola fuente, o dispersion alta entre fuentes)
  ESTIMADO_IA: 'ESTIMADO_IA'  // sin evidencia externa suficiente
});

function makeEmptyFuente(estado = APU_DATA_STATE.REQUIERE_VALIDACION){
  return { proveedor: null, fecha: null, region: null, estado };
}

/* APU completo en esquema v2. Todas las secciones nuevas nacen vacias (no se
   inventa contenido): la UI/IA de fases posteriores es quien las llena, y
   siempre con un estado explicito, nunca en silencio. */
export function makeEmptyAPUv2(){
  return {
    schemaVersion: 2,
    id: 'APU-' + uid(),
    // Encabezado tecnico
    proyecto: '',
    cliente: '',
    ubicacion: '',
    fechaBase: new Date().toLocaleDateString('es-MX'),
    moneda: 'MXN',
    partida: '',
    clave: 'APU-' + uid(),
    concept: '',
    unit: 'm²',
    cantidadObra: 0,
    // Modelo semantico del concepto (motor universal, ver
    // src/domain/constructionSystems.js): familia/disciplina, sistema
    // constructivo detectado como actividad principal, actividades
    // incluidas declaradas en el propio texto, y como se llego a la
    // clasificacion (exact/score/generico). Vacios por defecto -- solo el
    // generador (plantilla o IA) los llena, nunca se inventan en un APU
    // vacio ni se recalculan en exportacion.
    family: '',
    primaryActivity: null,
    secondaryActivities: [],
    classificationMatch: null,
    // Recursos
    materials: [],
    labor: [],
    equipment: [],
    herramientaMenor: { modo: 'porcentaje', porcentaje: APU_DEFAULT_FACTORS.herramienta, detalle: [] },
    // Consumibles y auxiliares (categoria E): insumos que se consumen durante
    // el procedimiento pero no son "materiales" que quedan integrados en la
    // obra (discos de corte, brocas, lijas, electrodos, cinta, combustible,
    // lubricantes...). Misma forma de renglon que materials (ver
    // migrateMaterialRow/normalizeAIApuToV2 mas abajo), nunca se sintetiza
    // con un % generico: si el concepto no requiere ninguno, queda [] y
    // technicalJustifications.consumables explica por que (ver mas abajo).
    consumables: [],
    seguridad: [],
    // Ingenieria del APU
    procedimientoConstructivo: [],
    controlCalidad: [],
    criterioMedicion: { incluye: [], excluye: [], unidadMedicion: '' },
    // Justificacion tecnica por categoria (A-F): por que esos recursos,
    // cantidades, cuadrilla, rendimiento, equipo o EPP son apropiados para
    // ESTE concepto especifico. Nace vacia -- SOLO la genera el motor de
    // desarrollo tecnico (IA o plantilla), nunca se fabrica en exportacion.
    technicalJustifications: { materials: '', labor: '', equipment: '', smallTools: '', consumables: '', safety: '' },
    // Factores configurables (misma fuente de verdad que v1: APU_DEFAULT_FACTORS)
    factores: {
      indCampo: APU_DEFAULT_FACTORS.indCampo,
      indOficina: APU_DEFAULT_FACTORS.indOficina,
      finance: APU_DEFAULT_FACTORS.finance,
      utility: APU_DEFAULT_FACTORS.utility,
      cargos: APU_DEFAULT_FACTORS.cargos,
      iva: APU_DEFAULT_FACTORS.iva
    },
    // Trazabilidad
    supuestos: [],
    confidence: { precios: 0, rendimientos: 0, cantidades: 0, composicion: 0 }
  };
}

function migrateRowsToObjects(rows, mapRow){
  return (Array.isArray(rows) ? rows : []).map((row, index) => mapRow(row, index));
}

/* Convierte un renglon legacy [desc, cantidad, unidad, precio, merma|FSR] en
   el objeto v2 correspondiente. No inventa clave/fuente/proveedor: genera una
   clave legible por indice y deja la fuente como "requiere validacion" salvo
   que se pueda inferir el estado del APU completo (ver migrateLegacyApuToV2). */
/* `source` (opcional): entrada de materialSources/equipmentSources producida
   por apuGeneration.js#makeAPUFromConcept cuando el renglon vino de un match
   de catalogo real (Biblioteca Inteligente) -- {estado, proveedor, fecha,
   clave, categoria, confidence, matchType}. Cuando existe, sustituye el
   `estado` uniforme del APU completo SOLO para este renglon (un APU puede
   tener unos renglones de catalogo real y otros de plantilla al mismo
   tiempo). Sin `source`, comportamiento identico a antes. */
function migrateMaterialRow(row, index, estado, source){
  return {
    clave: source?.clave || `MAT-${String(index + 1).padStart(3, '0')}`,
    descripcion: String(row?.[0] || ''),
    unidad: String(row?.[2] || ''),
    consumo: Number(row?.[1]) || 0,
    desperdicioPct: Number(row?.[4]) || 0,
    precioUnitario: Number(row?.[3]) || 0,
    fuente: source
      ? { proveedor: source.proveedor || null, fecha: source.fecha || null, region: null, estado: source.estado }
      : makeEmptyFuente(estado),
    origen: null
  };
}
/* `detail` (opcional): {cuadrilla,rendimiento,jornada,rendimientoFuente,
   yieldConfidence} -- mismo contrato que normalizeAIApuToV2 ya usa para
   raw.laborDetails (ver mas abajo), ahora tambien producido por la ruta
   determinista (ver src/domain/crewModel.js#deriveCrewFromLaborRows /
   apuGeneration.js#makeAPUFromConcept). Sin `detail`, se comporta
   exactamente igual que antes (cuadrilla/rendimiento/jornada en null).
   `source` (opcional): entrada de laborSources (ver makeAPUFromConcept) --
   mismo contrato que materialSources/equipmentSources, acotado al SALARIO
   (nunca cuadrilla/rendimiento, ver la nota en apuGeneration.js#useCat). */
function migrateLaborRow(row, index, estado, detail, source){
  return {
    clave: source?.clave || `MO-${String(index + 1).padStart(3, '0')}`,
    descripcion: String(row?.[0] || ''),
    unidad: String(row?.[2] || ''),
    cuadrilla: detail?.cuadrilla ?? null,
    rendimiento: detail?.rendimiento ?? null,
    jornada: detail?.jornada ?? null,
    cantidad: Number(row?.[1]) || 0,
    salarioBase: Number(row?.[3]) || 0,
    fsr: Number(row?.[4]) || 1,
    fuente: source
      ? { proveedor: source.proveedor || null, fecha: source.fecha || null, region: null, estado: source.estado }
      : makeEmptyFuente(estado),
    estado: source?.estado || estado,
    rendimientoFuente: detail?.rendimientoFuente ?? null,
    yieldConfidence: detail?.yieldConfidence ?? null,
    // Trazabilidad del rendimiento (fase de correccion "Rendimientos
    // reales", punto explicito del spec del usuario): fuente/fecha/valor
    // original/valor adoptado/confianza/metodo -- solo presente cuando el
    // renglon SI adopto un rendimiento real de Biblioteca (source.rendimiento).
    // null para el resto (plantilla/IA/sin catalogo), nunca se fabrica.
    rendimientoTrazabilidad: source?.rendimiento ? {
      fuente: source.proveedor || null,
      fecha: source.fecha || null,
      valorOriginal: source.rendimientoOriginal ?? null,
      valorAdoptado: source.rendimientoAdoptado ?? null,
      confianza: source.rendimientoConfidence ?? null,
      metodo: source.rendimientoMetodo || null
    } : null
  };
}
function migrateEquipmentRow(row, index, estado, source){
  return {
    clave: source?.clave || `EQ-${String(index + 1).padStart(3, '0')}`,
    descripcion: String(row?.[0] || ''),
    unidad: String(row?.[2] || ''),
    cantidad: Number(row?.[1]) || 0,
    tarifa: Number(row?.[3]) || 0,
    rendimiento: null,
    fuente: source
      ? { proveedor: source.proveedor || null, fecha: source.fecha || null, region: null, estado: source.estado }
      : makeEmptyFuente(estado)
  };
}

/* Migra un APU v1 (arrays posicionales de src/domain/apuGeneration.js) al
   esquema v2, sin mutar el original. Es una aproximacion, no una
   reconstruccion perfecta: el APU v1 no tiene cuadrilla/rendimiento/clave/
   fuente estructurada/seguridad/procedimiento/calidad/criterio de medicion,
   asi que esas secciones nacen vacias y el confidence global legacy (un solo
   numero) se replica en las 4 dimensiones nuevas hasta que el APU se
   regenere o el usuario lo valide con el motor v2. */
export function migrateLegacyApuToV2(apuV1 = {}){
  const estado = apuV1.aiGenerated
    ? APU_DATA_STATE.ESTIMADO_IA
    : (apuV1.templateGenerated && apuV1.sourceFile)
      ? APU_DATA_STATE.IMPORTADO
      : APU_DATA_STATE.ASUMIDO;
  const confidenceValue = Number(apuV1.confidence) || 0;
  return {
    schemaVersion: 2,
    id: apuV1.id || ('APU-' + uid()),
    legacyId: apuV1.id || null,
    proyecto: '',
    cliente: '',
    ubicacion: '',
    fechaBase: apuV1.date || new Date().toLocaleDateString('es-MX'),
    moneda: 'MXN',
    partida: '',
    clave: apuV1.clave || 'APU-' + uid(),
    concept: apuV1.concept || '',
    unit: apuV1.unit || 'm²',
    cantidadObra: 0,
    // Modelo semantico (ver makeEmptyAPUv2): se preserva tal cual si el v1
    // ya lo trae (makeAPUFromConcept en apuGeneration.js lo genera); nunca
    // se infiere de nuevo aqui.
    family: apuV1.family || '',
    primaryActivity: apuV1.primaryActivity || null,
    secondaryActivities: Array.isArray(apuV1.secondaryActivities) ? apuV1.secondaryActivities : [],
    classificationMatch: apuV1.classificationMatch || null,
    materials: migrateRowsToObjects(apuV1.materials, (r, i) => migrateMaterialRow(r, i, estado, apuV1.materialSources?.[i])),
    labor: migrateRowsToObjects(apuV1.labor, (r, i) => migrateLaborRow(r, i, estado, apuV1.laborDetails?.[i], apuV1.laborSources?.[i])),
    equipment: migrateRowsToObjects(apuV1.equipment, (r, i) => migrateEquipmentRow(r, i, estado, apuV1.equipmentSources?.[i])),
    herramientaMenor: {
      modo: 'porcentaje',
      porcentaje: Number(apuV1.herramienta ?? APU_DEFAULT_FACTORS.herramienta),
      detalle: []
    },
    // Un APU v1 nunca tuvo consumibles como categoria propia: nace vacio,
    // nunca se reparte una porcion de materials hacia aqui en la migracion.
    consumables: Array.isArray(apuV1.consumables) ? migrateRowsToObjects(apuV1.consumables, (r, i) => migrateMaterialRow(r, i, estado)) : [],
    // EPP dinamico (Prioridad 2, fase de correccion): a diferencia de
    // materials/labor/equipment, seguridad NUNCA tuvo un formato v1 de
    // arreglo posicional -- src/domain/eppResolver.js ya construye los
    // renglones directamente en forma de objeto v2, asi que se preservan
    // TAL CUAL (nunca se reconstruyen retroactivamente para un v1 historico
    // que no los traiga -- por eso el fallback es [], igual que consumables).
    seguridad: Array.isArray(apuV1.seguridad) ? apuV1.seguridad : [],
    procedimientoConstructivo: [],
    controlCalidad: [],
    criterioMedicion: { incluye: [], excluye: [], unidadMedicion: apuV1.unit || '' },
    // technicalJustifications: un APU v1/historico NUNCA tuvo esta
    // informacion -- nace vacia, nunca se inventa retroactivamente como si
    // hubiera formado parte del analisis original. Si el v1 ya trae el campo
    // (ej. templateFallbackAPU en apuGeneration.js compuso un texto mecanico
    // real a partir de la plantilla usada), se preserva tal cual.
    technicalJustifications: apuV1.technicalJustifications && typeof apuV1.technicalJustifications === 'object'
      ? { materials: '', labor: '', equipment: '', smallTools: '', consumables: '', safety: '', ...apuV1.technicalJustifications }
      : { materials: '', labor: '', equipment: '', smallTools: '', consumables: '', safety: '' },
    factores: {
      indCampo: Number(apuV1.indCampo ?? APU_DEFAULT_FACTORS.indCampo),
      indOficina: Number(apuV1.indOficina ?? APU_DEFAULT_FACTORS.indOficina),
      finance: Number(apuV1.finance ?? APU_DEFAULT_FACTORS.finance),
      utility: Number(apuV1.utility ?? APU_DEFAULT_FACTORS.utility),
      cargos: Number(apuV1.cargos ?? APU_DEFAULT_FACTORS.cargos),
      iva: Number(apuV1.iva ?? APU_DEFAULT_FACTORS.iva)
    },
    supuestos: (Array.isArray(apuV1.aiNotes) ? apuV1.aiNotes : []).map(texto => ({ texto: String(texto), categoria: 'migrado_v1' })),
    confidence: { precios: confidenceValue, rendimientos: confidenceValue, cantidades: confidenceValue, composicion: confidenceValue },
    // Variables estructuradas del concepto (RC5, ver conceptVariablesFromParsed
    // en src/lib/excelImport.js): opcional, se conserva tal cual si el v1 ya
    // la traia (makeAPUFromConcept / applyConceptMetadata la agregan).
    variables: apuV1.variables || null
  };
}

/* Validaciones minimas de integridad del esquema v2: complementan a
   findApuNumericIssuesV2 (numeros negativos/NaN) con reglas de negocio que no
   dependen de la aritmetica, como "no se puede marcar VERIFICADO sin
   proveedor". Pura y testeable, no bloquea nada por si sola. */
export function validateApuSchemaV2(apu = {}){
  const issues = [];
  if(Number(apu.cantidadObra) < 0){
    issues.push({ code: 'negative_cantidad_obra', message: 'La cantidad de obra no puede ser negativa.' });
  }
  const rowsWithFuente = [
    ...(Array.isArray(apu.materials) ? apu.materials.map(r => ['materials', r]) : []),
    ...(Array.isArray(apu.labor) ? apu.labor.map(r => ['labor', r]) : []),
    ...(Array.isArray(apu.equipment) ? apu.equipment.map(r => ['equipment', r]) : []),
    ...(Array.isArray(apu.consumables) ? apu.consumables.map(r => ['consumables', r]) : [])
  ];
  rowsWithFuente.forEach(([kind, row], index) => {
    if(row?.fuente?.estado === APU_DATA_STATE.VERIFICADO && !row?.fuente?.proveedor){
      issues.push({ code: 'verified_without_source', kind, index, message: `Renglon ${index + 1} de ${kind} esta marcado VERIFICADO sin proveedor/fuente registrada.` });
    }
  });
  if(apu.herramientaMenor?.modo === 'detalle' && !(apu.herramientaMenor.detalle || []).length){
    issues.push({ code: 'empty_herramienta_detalle', message: 'Herramienta menor esta en modo "detalle" pero no tiene renglones.' });
  }
  return issues;
}

function coerceText(value, fallback = ''){
  return String(value ?? fallback).trim();
}
function coerceNumber(value, fallback = 0){
  const n = Number(String(value ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}
function clampConfidence(value, fallback){
  // coerceNumber(undefined) da 0, no el fallback (Number('') === 0 en JS): un
  // campo de confianza AUSENTE debe caer al valor de respaldo, no a "0% de
  // confianza", que seria un dato peor que simplemente no declarado.
  if(value === undefined || value === null) return Math.max(0, Math.min(100, fallback));
  return Math.max(0, Math.min(100, coerceNumber(value, fallback)));
}

/* Convierte el JSON crudo devuelto por generateAPUv2 (api/_openaiApuCore.mjs)
   al esquema v2. A diferencia de migrateLegacyApuToV2 (que parte de un APU ya
   validado por un usuario/plantilla), esta funcion parte de contenido de IA
   sin confirmar: por eso CADA fuente/renglon nace con
   estado: APU_DATA_STATE.ESTIMADO_IA de forma incondicional -- ignorando
   cualquier "estado"/"VERIFICADO" que el JSON de la IA intente declarar. Solo
   un usuario puede promover un dato a VERIFICADO despues, nunca la IA misma. */
export function normalizeAIApuToV2(raw = {}, fallbackConcept = ''){
  const original = coerceText(fallbackConcept);
  const generated = coerceText(raw.concept, original);
  const concept = generated.length < 18 && original ? original : generated;
  const unit = coerceText(raw.unit || 'pza').replace('m2', 'm²').replace('m3', 'm³');

  const materialsRaw = Array.isArray(raw.materials) ? raw.materials : [];
  const sourcesRaw = Array.isArray(raw.materialSources) ? raw.materialSources : [];
  const materials = materialsRaw.map((row, index) => ({
    clave: `MAT-${String(index + 1).padStart(3, '0')}`,
    descripcion: coerceText(row?.[0], 'Material'),
    unidad: coerceText(row?.[2], 'pza'),
    consumo: coerceNumber(row?.[1], 0),
    desperdicioPct: coerceNumber(row?.[4], 0),
    precioUnitario: coerceNumber(row?.[3], 0),
    // Semantica de integracion (RESOURCE_INTEGRATION): la IA la propone
    // explicitamente; si no viene, queda null (nunca se inventa aqui -- el
    // motor de calculo la trata como POR_UNIDAD_OBRA por defecto pero la
    // marca pendiente de revision, ver findApuNumericIssuesV2 en apuCalc.js).
    integracion: coerceText(sourcesRaw[index]?.integracion, '') || null,
    fuente: {
      proveedor: coerceText(sourcesRaw[index]?.proveedor, '') || null,
      fecha: null,
      region: coerceText(sourcesRaw[index]?.region, '') || null,
      estado: APU_DATA_STATE.ESTIMADO_IA
    },
    origen: null
  }));

  // Consumibles y auxiliares (categoria E, ver makeEmptyAPUv2): misma forma
  // de renglon que materials, con especificacion y motivo tecnico propios.
  // Nunca se sintetiza uno para "llenar" la seccion: si la IA no propone
  // ninguno, consumables queda [] (el llamador debe explicar por que en
  // technicalJustifications.consumables, tipicamente "NO APLICA...").
  const consumablesRaw = Array.isArray(raw.consumables) ? raw.consumables : [];
  const consumableSourcesRaw = Array.isArray(raw.consumableSources) ? raw.consumableSources : [];
  const consumables = consumablesRaw.map((row, index) => {
    const source = consumableSourcesRaw[index] || {};
    return {
      clave: `CON-${String(index + 1).padStart(3, '0')}`,
      descripcion: coerceText(row?.[0], 'Consumible'),
      especificacion: coerceText(source.especificacion, ''),
      unidad: coerceText(row?.[2], 'pza'),
      consumo: coerceNumber(row?.[1], 0),
      desperdicioPct: coerceNumber(row?.[4], 0),
      precioUnitario: coerceNumber(row?.[3], 0),
      integracion: coerceText(source.integracion, '') || null,
      fuente: {
        proveedor: coerceText(source.proveedor, '') || null,
        fecha: null,
        region: coerceText(source.region, '') || null,
        estado: APU_DATA_STATE.ESTIMADO_IA
      },
      technicalReason: coerceText(source.technicalReason, ''),
      origen: null
    };
  });

  const laborRaw = Array.isArray(raw.labor) ? raw.labor : [];
  const detailsRaw = Array.isArray(raw.laborDetails) ? raw.laborDetails : [];
  const labor = laborRaw.map((row, index) => {
    const detail = detailsRaw[index] || {};
    return {
      clave: `MO-${String(index + 1).padStart(3, '0')}`,
      descripcion: coerceText(row?.[0], 'Mano de obra'),
      unidad: coerceText(row?.[2], 'jor'),
      cuadrilla: detail.cuadrilla != null ? coerceNumber(detail.cuadrilla, 1) : null,
      rendimiento: detail.rendimiento != null ? coerceNumber(detail.rendimiento, 0) || null : null,
      jornada: detail.jornada != null ? coerceNumber(detail.jornada, 8) : null,
      // "cantidad" (jornadas por unidad) siempre queda explicita: calcLaborRow
      // usa cuadrilla/rendimiento cuando rendimiento>0, y cae a esta cantidad
      // en cualquier otro caso -- nunca se pierde el numero por falta de detalle.
      cantidad: coerceNumber(row?.[1], 0),
      salarioBase: coerceNumber(row?.[3], 0),
      fsr: coerceNumber(row?.[4], 1),
      fuente: { proveedor: null, fecha: null, region: null, estado: APU_DATA_STATE.ESTIMADO_IA },
      estado: APU_DATA_STATE.ESTIMADO_IA,
      // rendimientoFuente/yieldConfidence (mismo contrato que la ruta
      // determinista, ver crewModel.js): la IA propuso cuadrilla+rendimiento
      // explicitos, asi que su procedencia queda declarada como IA -- nunca
      // VALIDADO (eso solo lo pone un humano, ver applyRendimientoDecision).
      rendimientoFuente: detail.cuadrilla != null && detail.rendimiento != null ? RENDIMIENTO_FUENTE.IA : null,
      yieldConfidence: detail.cuadrilla != null && detail.rendimiento != null ? 50 : null
    };
  });

  const equipmentRaw = Array.isArray(raw.equipment) ? raw.equipment : [];
  const equipmentDetailsRaw = Array.isArray(raw.equipmentDetails) ? raw.equipmentDetails : [];
  const equipment = equipmentRaw.map((row, index) => {
    const detail = equipmentDetailsRaw[index] || {};
    return {
    clave: `EQ-${String(index + 1).padStart(3, '0')}`,
    descripcion: coerceText(row?.[0], 'Equipo'),
    unidad: coerceText(row?.[2], 'hr'),
    cantidad: coerceNumber(row?.[1], 0),
    tarifa: coerceNumber(row?.[3], 0),
    rendimiento: null,
    // Semantica de integracion (RESOURCE_INTEGRATION), propuesta por la IA,
    // NUNCA inferida aqui. rendimientoDiario/vidaUtilDias/factorUso solo
    // aplican segun integracion (ver calcEquipmentRow en apuCalc.js).
    integracion: coerceText(detail.integracion, '') || null,
    rendimientoDiario: detail.rendimientoDiario != null ? coerceNumber(detail.rendimientoDiario, 0) || null : null,
    vidaUtilDias: detail.vidaUtilDias != null ? coerceNumber(detail.vidaUtilDias, 0) || null : null,
    factorUso: detail.factorUso != null ? coerceNumber(detail.factorUso, 1) : null,
    modalidad: coerceText(detail.modalidad, '') || null,
    fuente: { proveedor: null, fecha: null, region: null, estado: APU_DATA_STATE.ESTIMADO_IA }
    };
  });

  const seguridadRaw = Array.isArray(raw.seguridad) ? raw.seguridad : [];
  const seguridadDetailsRaw = Array.isArray(raw.seguridadDetails) ? raw.seguridadDetails : [];
  const seguridad = seguridadRaw.map((row, index) => {
    const detail = seguridadDetailsRaw[index] || {};
    return {
    clave: `SEG-${String(index + 1).padStart(3, '0')}`,
    descripcion: coerceText(row?.[0], 'EPP'),
    unidad: coerceText(row?.[2], 'pza'),
    cantidad: coerceNumber(row?.[1], 0),
    precioUnitario: coerceNumber(row?.[3], 0),
    // EPP reutilizable (integracion:'AMORTIZABLE'): ver calcSeguridadRow en
    // apuCalc.js. Nunca se infiere: si la IA no la propone, queda null.
    integracion: coerceText(detail.integracion, '') || null,
    rendimientoDiario: detail.rendimientoDiario != null ? coerceNumber(detail.rendimientoDiario, 0) || null : null,
    vidaUtilDias: detail.vidaUtilDias != null ? coerceNumber(detail.vidaUtilDias, 0) || null : null,
    factorReposicion: detail.factorReposicion != null ? coerceNumber(detail.factorReposicion, 1) : null,
    // A diferencia de materials/labor/equipment, seguridad no traia "fuente"
    // por defecto: sin ella, apuDataStateLabel(undefined) cae al generico
    // "REQUIERE VALIDACION" incluso cuando en realidad es un simple estimado
    // de IA sin evidencia externa (etiqueta imprecisa, no un calculo erroneo,
    // pero debe decir lo que es).
    fuente: { proveedor: null, fecha: null, region: null, estado: APU_DATA_STATE.ESTIMADO_IA },
    observaciones: ''
    };
  });

  const procedimientoConstructivo = Array.isArray(raw.procedimientoConstructivo)
    ? raw.procedimientoConstructivo.map(step => coerceText(step)).filter(Boolean).slice(0, 10)
    : [];
  const controlCalidad = Array.isArray(raw.controlCalidad)
    ? raw.controlCalidad
        .map(item => ({ especificacion: coerceText(item?.especificacion), criterio: coerceText(item?.criterio) }))
        .filter(item => item.especificacion || item.criterio)
        .slice(0, 8)
    : [];
  const criterioMedicion = {
    incluye: Array.isArray(raw.criterioMedicion?.incluye) ? raw.criterioMedicion.incluye.map(v => coerceText(v)).filter(Boolean) : [],
    excluye: Array.isArray(raw.criterioMedicion?.excluye) ? raw.criterioMedicion.excluye.map(v => coerceText(v)).filter(Boolean) : [],
    unidadMedicion: unit
  };

  const fallbackConfidence = clampConfidence(raw.confidence, 70);
  const breakdown = raw.confidenceBreakdown || {};

  return {
    schemaVersion: 2,
    id: 'APU-' + uid(),
    proyecto: '',
    cliente: '',
    ubicacion: '',
    fechaBase: new Date().toLocaleDateString('es-MX'),
    moneda: 'MXN',
    partida: '',
    clave: 'APU-' + uid(),
    concept,
    unit,
    cantidadObra: 0,
    materials,
    labor,
    equipment,
    herramientaMenor: {
      modo: 'porcentaje',
      porcentaje: coerceNumber(raw.herramienta, APU_DEFAULT_FACTORS.herramienta),
      detalle: []
    },
    consumables,
    seguridad,
    procedimientoConstructivo,
    controlCalidad,
    criterioMedicion,
    // technicalJustifications: la IA la propone explicitamente por
    // categoria (ver prompt en _openaiApuCore.mjs); si el JSON no trae el
    // campo (respuesta vieja/incompleta), queda vacio -- nunca se rellena
    // con un texto generico que aparente ser justificacion real.
    technicalJustifications: {
      materials: coerceText(raw.technicalJustifications?.materials, ''),
      labor: coerceText(raw.technicalJustifications?.labor, ''),
      equipment: coerceText(raw.technicalJustifications?.equipment, ''),
      smallTools: coerceText(raw.technicalJustifications?.smallTools, ''),
      consumables: coerceText(raw.technicalJustifications?.consumables, ''),
      safety: coerceText(raw.technicalJustifications?.safety, '')
    },
    factores: {
      indCampo: coerceNumber(raw.indCampo, APU_DEFAULT_FACTORS.indCampo),
      indOficina: coerceNumber(raw.indOficina, APU_DEFAULT_FACTORS.indOficina),
      finance: coerceNumber(raw.finance, APU_DEFAULT_FACTORS.finance),
      utility: coerceNumber(raw.utility, APU_DEFAULT_FACTORS.utility),
      cargos: coerceNumber(raw.cargos, APU_DEFAULT_FACTORS.cargos),
      iva: coerceNumber(raw.iva, APU_DEFAULT_FACTORS.iva)
    },
    supuestos: (Array.isArray(raw.notes) ? raw.notes : [])
      .map(note => ({ texto: coerceText(note), categoria: 'ia' }))
      .filter(item => item.texto),
    confidence: {
      precios: clampConfidence(breakdown.precios, fallbackConfidence),
      rendimientos: clampConfidence(breakdown.rendimientos, fallbackConfidence),
      cantidades: clampConfidence(breakdown.cantidades, fallbackConfidence),
      composicion: clampConfidence(breakdown.composicion, fallbackConfidence)
    }
  };
}
