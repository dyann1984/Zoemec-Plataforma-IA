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
    // Recursos
    materials: [],
    labor: [],
    equipment: [],
    herramientaMenor: { modo: 'porcentaje', porcentaje: APU_DEFAULT_FACTORS.herramienta, detalle: [] },
    seguridad: [],
    // Ingenieria del APU
    procedimientoConstructivo: [],
    controlCalidad: [],
    criterioMedicion: { incluye: [], excluye: [], unidadMedicion: '' },
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
function migrateMaterialRow(row, index, estado){
  return {
    clave: `MAT-${String(index + 1).padStart(3, '0')}`,
    descripcion: String(row?.[0] || ''),
    unidad: String(row?.[2] || ''),
    consumo: Number(row?.[1]) || 0,
    desperdicioPct: Number(row?.[4]) || 0,
    precioUnitario: Number(row?.[3]) || 0,
    fuente: makeEmptyFuente(estado),
    origen: null
  };
}
function migrateLaborRow(row, index, estado){
  return {
    clave: `MO-${String(index + 1).padStart(3, '0')}`,
    descripcion: String(row?.[0] || ''),
    unidad: String(row?.[2] || ''),
    cuadrilla: null,
    rendimiento: null,
    jornada: null,
    cantidad: Number(row?.[1]) || 0,
    salarioBase: Number(row?.[3]) || 0,
    fsr: Number(row?.[4]) || 1,
    fuente: makeEmptyFuente(estado),
    estado
  };
}
function migrateEquipmentRow(row, index, estado){
  return {
    clave: `EQ-${String(index + 1).padStart(3, '0')}`,
    descripcion: String(row?.[0] || ''),
    unidad: String(row?.[2] || ''),
    cantidad: Number(row?.[1]) || 0,
    tarifa: Number(row?.[3]) || 0,
    rendimiento: null,
    fuente: makeEmptyFuente(estado)
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
    materials: migrateRowsToObjects(apuV1.materials, (r, i) => migrateMaterialRow(r, i, estado)),
    labor: migrateRowsToObjects(apuV1.labor, (r, i) => migrateLaborRow(r, i, estado)),
    equipment: migrateRowsToObjects(apuV1.equipment, (r, i) => migrateEquipmentRow(r, i, estado)),
    herramientaMenor: {
      modo: 'porcentaje',
      porcentaje: Number(apuV1.herramienta ?? APU_DEFAULT_FACTORS.herramienta),
      detalle: []
    },
    seguridad: [],
    procedimientoConstructivo: [],
    controlCalidad: [],
    criterioMedicion: { incluye: [], excluye: [], unidadMedicion: apuV1.unit || '' },
    factores: {
      indCampo: Number(apuV1.indCampo ?? APU_DEFAULT_FACTORS.indCampo),
      indOficina: Number(apuV1.indOficina ?? APU_DEFAULT_FACTORS.indOficina),
      finance: Number(apuV1.finance ?? APU_DEFAULT_FACTORS.finance),
      utility: Number(apuV1.utility ?? APU_DEFAULT_FACTORS.utility),
      cargos: Number(apuV1.cargos ?? APU_DEFAULT_FACTORS.cargos),
      iva: Number(apuV1.iva ?? APU_DEFAULT_FACTORS.iva)
    },
    supuestos: (Array.isArray(apuV1.aiNotes) ? apuV1.aiNotes : []).map(texto => ({ texto: String(texto), categoria: 'migrado_v1' })),
    confidence: { precios: confidenceValue, rendimientos: confidenceValue, cantidades: confidenceValue, composicion: confidenceValue }
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
    ...(Array.isArray(apu.equipment) ? apu.equipment.map(r => ['equipment', r]) : [])
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
      estado: APU_DATA_STATE.ESTIMADO_IA
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
    seguridad,
    procedimientoConstructivo,
    controlCalidad,
    criterioMedicion,
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
