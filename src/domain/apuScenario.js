/* ZOEMEC SCENARIO ENGINE (Fase 3): simulador what-if determinista. Nunca
   modifica el APU base -- trabaja sobre una copia profunda (structuredClone)
   y reusa el motor real en cada paso:
     APU -> clon -> aplicar cambios (con guardrails) -> calcAPUv2 ->
     runApuAudit / runApuChallenge -> runApuConfidence -> runBidRisk
   Cada capa ya existe (Fase 1/2) y se REUSA tal cual, nunca se reimplementa
   aqui. Este modulo solo orquesta la mutacion controlada de una copia y la
   comparacion BASE vs ESCENARIO. */
import { calcAPUv2 } from '../lib/apuCalc.js';
import { runApuConfidence } from './apuConfidence.js';
import { runBidRisk } from './bidRisk.js';

export const CHANGE_TYPE = Object.freeze({
  PRICE_PERCENT_CHANGE: 'PRICE_PERCENT_CHANGE',
  PRICE_ABSOLUTE_CHANGE: 'PRICE_ABSOLUTE_CHANGE',
  RESOURCE_PRICE_OVERRIDE: 'RESOURCE_PRICE_OVERRIDE',
  PRODUCTIVITY_PERCENT_CHANGE: 'PRODUCTIVITY_PERCENT_CHANGE',
  LABOR_COST_PERCENT_CHANGE: 'LABOR_COST_PERCENT_CHANGE',
  WASTE_PERCENT_CHANGE: 'WASTE_PERCENT_CHANGE',
  RESOURCE_QUANTITY_CHANGE: 'RESOURCE_QUANTITY_CHANGE',
  RESOURCE_REPLACEMENT: 'RESOURCE_REPLACEMENT',
  CREW_CHANGE: 'CREW_CHANGE',
  EQUIPMENT_CHANGE: 'EQUIPMENT_CHANGE'
});

export const WARNING_CODE = Object.freeze({
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  UNSUPPORTED_CHANGE_TYPE: 'UNSUPPORTED_CHANGE_TYPE',
  UNSUPPORTED_FIELD_FOR_KIND: 'UNSUPPORTED_FIELD_FOR_KIND',
  INVALID_PRODUCTIVITY: 'INVALID_PRODUCTIVITY',
  NEGATIVE_PRICE_NOT_ALLOWED: 'NEGATIVE_PRICE_NOT_ALLOWED',
  NEGATIVE_QUANTITY_NOT_ALLOWED: 'NEGATIVE_QUANTITY_NOT_ALLOWED',
  NON_FINITE_VALUE: 'NON_FINITE_VALUE',
  INVALID_INTEGRACION: 'INVALID_INTEGRACION'
});

const ALL_KINDS = ['materials', 'labor', 'equipment', 'consumables', 'seguridad'];
// Campo de precio real por tipo de renglon (esquema v2, ver apuCalc.js) --
// nunca se inventa un campo nuevo, son los mismos que ya lee calcAPUv2.
const PRICE_FIELD = { materials: 'precioUnitario', consumables: 'precioUnitario', seguridad: 'precioUnitario', equipment: 'tarifa', labor: 'salarioBase' };
// Campo de "cantidad" real por tipo de renglon.
const QUANTITY_FIELD = { materials: 'consumo', consumables: 'consumo', equipment: 'cantidad', seguridad: 'cantidad', labor: 'cuadrilla' };
const INTEGRACION_VALUES = new Set(['POR_UNIDAD_OBRA', 'POR_JORNADA', 'POR_LOTE', 'AMORTIZABLE']);

const fold = value => String(value ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const num = (v, fb = 0) => (Number.isFinite(Number(v)) ? Number(v) : fb);
const round2 = v => (Number.isFinite(v) ? Number(v.toFixed(2)) : null);

/* Guardrails (regla 11 del spec): ningun cambio puede producir NaN,
   Infinity, precios negativos, cantidades negativas o rendimiento <=0.
   Devuelve el codigo de warning si el valor es invalido, null si es valido. */
function invalidFieldReason(field, value){
  if(!Number.isFinite(value)) return WARNING_CODE.NON_FINITE_VALUE;
  if(field === 'rendimiento' && value <= 0) return WARNING_CODE.INVALID_PRODUCTIVITY;
  if((field === 'precioUnitario' || field === 'tarifa' || field === 'salarioBase') && value < 0) return WARNING_CODE.NEGATIVE_PRICE_NOT_ALLOWED;
  if((field === 'consumo' || field === 'cantidad' || field === 'cuadrilla' || field === 'desperdicioPct' || field === 'rendimientoDiario' || field === 'vidaUtilDias' || field === 'factorUso') && value < 0) return WARNING_CODE.NEGATIVE_QUANTITY_NOT_ALLOWED;
  return null;
}

/* Selector de recursos (regla 4 del spec): por id/clave especifico, por
   descripcion (normalizada, sin acentos -- mismo criterio que apuChallenge.js),
   por kind (categoria: materials/labor/equipment/consumables/seguridad), o
   'all' (concepto completo). Nunca matching semantico/difuso -- solo clave
   exacta o descripcion exacta normalizada (regla 9 del spec: "no inventar
   matching semantico si no existe una clave confiable"). */
function rowsForSelector(scenario, selector = {}){
  const kinds = selector.kind && selector.kind !== 'all' ? [selector.kind] : ALL_KINDS;
  const rows = [];
  kinds.forEach(kind => {
    (Array.isArray(scenario[kind]) ? scenario[kind] : []).forEach((row, index) => {
      if(selector.id != null && row.clave !== selector.id) return;
      if(selector.descripcion != null && fold(row.descripcion) !== fold(selector.descripcion)) return;
      rows.push({ kind, index, row });
    });
  });
  return rows;
}

// IMPORTANTE: usa Number(change.value) crudo, NUNCA num() (que hace fallback
// silencioso a 0 si el valor no es finito) -- un value:NaN/undefined debe
// LLEGAR como NaN hasta invalidFieldReason para que el guardrail lo rechace
// explicitamente, no convertirse de antemano en un "0" valido que se cuela
// como si fuera un cambio real.
function computeTargetValue(current, change){
  const mode = change.mode === 'absolute' ? 'absolute' : 'percent';
  const rawValue = Number(change.value);
  return mode === 'absolute' ? rawValue : current * (1 + rawValue / 100);
}

function priceChangeHandler({ kind, row, change }){
  const field = PRICE_FIELD[kind];
  const current = num(row[field]);
  const newValue = computeTargetValue(current, change);
  const errorCode = invalidFieldReason(field, newValue);
  if(errorCode) return { skip: true, code: errorCode, message: `Valor invalido (${newValue}) para "${field}" en "${row.descripcion}".` };
  return { applied: true, field, previousValue: current, newValue, patch: { [field]: newValue } };
}

// LABOR_COST_PERCENT_CHANGE: identico a PRICE_PERCENT_CHANGE pero
// restringido a mano de obra -- evita que un selector amplio ("all") suba
// por error el precio de materiales al querer subir solo el salario.
function laborCostHandler({ kind, row, change }){
  if(kind !== 'labor') return { skip: true, code: WARNING_CODE.UNSUPPORTED_FIELD_FOR_KIND, message: 'LABOR_COST_PERCENT_CHANGE solo aplica a renglones de mano de obra.' };
  return priceChangeHandler({ kind, row, change });
}

function productivityHandler({ kind, row, change }){
  if(kind !== 'labor') return { skip: true, code: WARNING_CODE.UNSUPPORTED_FIELD_FOR_KIND, message: 'PRODUCTIVITY_PERCENT_CHANGE solo aplica a renglones de mano de obra (campo "rendimiento").' };
  const current = num(row.rendimiento);
  const newValue = computeTargetValue(current, change);
  const errorCode = invalidFieldReason('rendimiento', newValue);
  if(errorCode) return { skip: true, code: errorCode, message: `Rendimiento invalido (${newValue}) en "${row.descripcion}".` };
  return { applied: true, field: 'rendimiento', previousValue: current, newValue, patch: { rendimiento: newValue } };
}

// WASTE_PERCENT_CHANGE: aditivo en PUNTOS porcentuales (desperdicioPct += X),
// no multiplicativo -- "sube el desperdicio 5%" en el lenguaje de un
// presupuestista significa 5 puntos (ej. 3% -> 8%), no 3% x 1.05. Solo
// aplica a materiales/consumibles (calcMaterialRow es el unico que usa
// desperdicioPct; mano de obra/equipo/seguridad no lo leen en absoluto).
function wasteHandler({ kind, row, change }){
  if(kind !== 'materials' && kind !== 'consumables') return { skip: true, code: WARNING_CODE.UNSUPPORTED_FIELD_FOR_KIND, message: 'WASTE_PERCENT_CHANGE solo aplica a materiales/consumibles (campo "desperdicioPct").' };
  const current = num(row.desperdicioPct);
  const newValue = current + Number(change.value); // Number() crudo, ver nota en computeTargetValue
  const errorCode = invalidFieldReason('desperdicioPct', newValue);
  if(errorCode) return { skip: true, code: errorCode, message: `desperdicioPct invalido (${newValue}) en "${row.descripcion}".` };
  return { applied: true, field: 'desperdicioPct', previousValue: current, newValue, patch: { desperdicioPct: newValue } };
}

function quantityHandler({ kind, row, change }){
  const field = QUANTITY_FIELD[kind];
  if(!field) return { skip: true, code: WARNING_CODE.UNSUPPORTED_FIELD_FOR_KIND, message: `Sin campo de cantidad conocido para "${kind}".` };
  const current = num(row[field]);
  const newValue = computeTargetValue(current, change);
  const errorCode = invalidFieldReason(field, newValue);
  if(errorCode) return { skip: true, code: errorCode, message: `Valor invalido (${newValue}) para "${field}" en "${row.descripcion}".` };
  return { applied: true, field, previousValue: current, newValue, patch: { [field]: newValue } };
}

// CREW_CHANGE: igual mecanica que RESOURCE_QUANTITY_CHANGE pero restringido
// a mano de obra (campo "cuadrilla") -- nombre explicito para "cambio de
// cuadrilla" (regla 3 del spec), no obliga al llamador a saber que
// "cuadrilla" es tecnicamente el campo de cantidad de labor.
function crewHandler({ kind, row, change }){
  if(kind !== 'labor') return { skip: true, code: WARNING_CODE.UNSUPPORTED_FIELD_FOR_KIND, message: 'CREW_CHANGE solo aplica a renglones de mano de obra.' };
  const current = num(row.cuadrilla);
  const newValue = computeTargetValue(current, change);
  const errorCode = invalidFieldReason('cuadrilla', newValue);
  if(errorCode) return { skip: true, code: errorCode, message: `Cuadrilla invalida (${newValue}) en "${row.descripcion}".` };
  return { applied: true, field: 'cuadrilla', previousValue: current, newValue, patch: { cuadrilla: newValue } };
}

// EQUIPMENT_CHANGE: cambia UN campo real de equipo (regla 3: "cambio de
// maquinaria") -- tarifa/integracion/rendimientoDiario/vidaUtilDias/
// factorUso/cantidad, los mismos que lee calcEquipmentRow, ninguno nuevo.
const EQUIPMENT_NUMERIC_FIELDS = new Set(['tarifa', 'rendimientoDiario', 'vidaUtilDias', 'factorUso', 'cantidad']);
function equipmentHandler({ kind, row, change }){
  if(kind !== 'equipment') return { skip: true, code: WARNING_CODE.UNSUPPORTED_FIELD_FOR_KIND, message: 'EQUIPMENT_CHANGE solo aplica a renglones de equipo.' };
  const field = change.field;
  if(field === 'integracion'){
    if(!INTEGRACION_VALUES.has(change.value)) return { skip: true, code: WARNING_CODE.INVALID_INTEGRACION, message: `"${change.value}" no es una integracion valida (POR_UNIDAD_OBRA/POR_JORNADA/POR_LOTE/AMORTIZABLE).` };
    return { applied: true, field: 'integracion', previousValue: row.integracion || 'POR_UNIDAD_OBRA', newValue: change.value, patch: { integracion: change.value } };
  }
  if(!EQUIPMENT_NUMERIC_FIELDS.has(field)) return { skip: true, code: WARNING_CODE.UNSUPPORTED_FIELD_FOR_KIND, message: `Campo "${field}" no reconocido para equipo.` };
  const current = num(row[field]);
  const newValue = computeTargetValue(current, change);
  const errorCode = invalidFieldReason(field, newValue);
  if(errorCode) return { skip: true, code: errorCode, message: `Valor invalido (${newValue}) para "${field}" en "${row.descripcion}".` };
  return { applied: true, field, previousValue: current, newValue, patch: { [field]: newValue } };
}

// RESOURCE_REPLACEMENT: reemplaza descripcion/unidad/clave/precio de UN
// recurso ya existente (regla 4: "cambio de proveedor" -- el proveedor no es
// un campo propio del renglon, se modela como reemplazar el recurso por su
// equivalente de otro proveedor: mismo tipo, descripcion/precio distintos).
function replacementHandler({ kind, row, change }){
  const replacement = change.replacement || {};
  const priceField = PRICE_FIELD[kind];
  const patch = {};
  const previousValue = {};
  if(replacement.descripcion != null){ patch.descripcion = String(replacement.descripcion); previousValue.descripcion = row.descripcion; }
  if(replacement.unidad != null){ patch.unidad = String(replacement.unidad); previousValue.unidad = row.unidad; }
  if(replacement.clave != null){ patch.clave = String(replacement.clave); previousValue.clave = row.clave || null; }
  // Cambio de proveedor: el nuevo renglon trae su propia evidencia de precio
  // (o ninguna, si es una cotizacion nueva aun sin confirmar) -- nunca
  // arrastra la `fuente` del proveedor anterior en silencio.
  if(replacement.fuente != null){ patch.fuente = { ...replacement.fuente }; previousValue.fuente = row.fuente || null; }
  if(replacement[priceField] != null){
    const newPrice = Number(replacement[priceField]); // Number() crudo, ver nota en computeTargetValue
    const errorCode = invalidFieldReason(priceField, newPrice);
    if(errorCode) return { skip: true, code: errorCode, message: `Precio de reemplazo invalido (${newPrice}) para "${row.descripcion}".` };
    patch[priceField] = newPrice;
    previousValue[priceField] = row[priceField];
  }
  if(!Object.keys(patch).length) return { skip: true, code: WARNING_CODE.UNSUPPORTED_FIELD_FOR_KIND, message: 'RESOURCE_REPLACEMENT sin ningun campo de reemplazo valido (descripcion/unidad/clave/precio).' };
  return { applied: true, field: 'replacement', previousValue, newValue: patch, patch };
}

const CHANGE_HANDLERS = {
  [CHANGE_TYPE.PRICE_PERCENT_CHANGE]: priceChangeHandler,
  [CHANGE_TYPE.PRICE_ABSOLUTE_CHANGE]: priceChangeHandler,
  [CHANGE_TYPE.RESOURCE_PRICE_OVERRIDE]: priceChangeHandler,
  [CHANGE_TYPE.PRODUCTIVITY_PERCENT_CHANGE]: productivityHandler,
  [CHANGE_TYPE.LABOR_COST_PERCENT_CHANGE]: laborCostHandler,
  [CHANGE_TYPE.WASTE_PERCENT_CHANGE]: wasteHandler,
  [CHANGE_TYPE.RESOURCE_QUANTITY_CHANGE]: quantityHandler,
  [CHANGE_TYPE.RESOURCE_REPLACEMENT]: replacementHandler,
  [CHANGE_TYPE.CREW_CHANGE]: crewHandler,
  [CHANGE_TYPE.EQUIPMENT_CHANGE]: equipmentHandler
};
// PRICE_ABSOLUTE_CHANGE/RESOURCE_PRICE_OVERRIDE usan el mismo handler que
// PRICE_PERCENT_CHANGE (mismo campo real, distinto solo en "mode": absolute
// vs percent) -- change.mode='absolute' ya lo maneja computeTargetValue.
// RESOURCE_PRICE_OVERRIDE se documenta separado porque su uso esperado es
// SIEMPRE con selector.id/descripcion especifico (un recurso), nunca una
// categoria completa -- el motor no lo fuerza, pero el llamador debe pasar
// un selector especifico para que el nombre tenga sentido.

function applyOneChange(scenario, change, index, now){
  const records = [];
  const warnings = [];
  const handler = CHANGE_HANDLERS[change.type];
  if(!handler){
    warnings.push({ code: WARNING_CODE.UNSUPPORTED_CHANGE_TYPE, message: `Tipo de cambio no soportado: "${change.type}".`, changeIndex: index });
    return { records, warnings };
  }
  const matches = rowsForSelector(scenario, change.selector || {});
  if(!matches.length){
    warnings.push({ code: WARNING_CODE.RESOURCE_NOT_FOUND, message: `Ningun recurso coincide con el selector del cambio #${index + 1}.`, changeIndex: index, selector: change.selector || {} });
    return { records, warnings };
  }
  matches.forEach(({ kind, row }) => {
    const outcome = handler({ kind, row, change });
    if(outcome.skip){
      warnings.push({ code: outcome.code, message: outcome.message, changeIndex: index, kind, resourceDescripcion: row.descripcion });
      return;
    }
    Object.assign(row, outcome.patch);
    records.push({
      type: change.type, kind, resourceId: row.clave || null, resourceDescripcion: row.descripcion,
      field: outcome.field, previousValue: outcome.previousValue, newValue: outcome.newValue,
      unit: change.unit || null, reason: change.reason || null, source: change.source || 'usuario', timestamp: now
    });
  });
  return { records, warnings };
}

/* Delta BASE vs ESCENARIO (regla 5 del spec): costo unitario siempre
   calculable (calcAPUv2 nunca falla); costo de proyecto solo si
   cantidadObra > 0 en AMBOS (nunca se inventa una cantidad para el que no
   la tiene). */
function buildDelta(baseTotals, scenarioTotals, baseApu, scenarioApu){
  const baseUnitCost = baseTotals.pu;
  const scenarioUnitCost = scenarioTotals.pu;
  const unitDelta = round2(scenarioUnitCost - baseUnitCost);
  const percentDelta = baseUnitCost > 0 ? round2((scenarioUnitCost - baseUnitCost) / baseUnitCost * 100) : null;
  const hasCantidad = num(baseApu.cantidadObra) > 0 && num(scenarioApu.cantidadObra) > 0;
  return {
    baseUnitCost: round2(baseUnitCost), scenarioUnitCost: round2(scenarioUnitCost), unitDelta, percentDelta,
    baseProjectCost: hasCantidad ? round2(baseTotals.importeTotal) : null,
    scenarioProjectCost: hasCantidad ? round2(scenarioTotals.importeTotal) : null,
    projectDelta: hasCantidad ? round2(scenarioTotals.importeTotal - baseTotals.importeTotal) : null,
    reason: hasCantidad ? null : 'PROJECT_QUANTITY_NOT_CAPTURED'
  };
}

/* Punto de entrada principal. NUNCA muta `apu` (regla 7 del spec): clona
   profundo tanto para `base` como para `scenario` antes de tocar nada.
   `.calculated` (si el APU de entrada ya estaba finalizado) se refresca
   explicitamente con calcAPUv2 en AMBOS clones despues de clonar/mutar --
   dejarlo con el valor viejo haria que reconcileAPU (dentro de
   runApuConfidence) reporte una "inconsistencia matematica" falsa (el
   escenario cambio los renglones pero `.calculated` seguiria mostrando los
   totales de antes). */
export function createScenario({ apu = {}, changes = [], options = {} } = {}){
  const now = options.now ? new Date(options.now).toISOString() : new Date().toISOString();
  const base = structuredClone(apu);
  const scenario = structuredClone(apu);

  const appliedChanges = [];
  const warnings = [];
  changes.forEach((change, index) => {
    const { records, warnings: changeWarnings } = applyOneChange(scenario, change, index, now);
    appliedChanges.push(...records);
    warnings.push(...changeWarnings);
  });

  base.calculated = calcAPUv2(base);
  scenario.calculated = calcAPUv2(scenario);

  const delta = buildDelta(base.calculated, scenario.calculated, base, scenario);

  const baseConfidence = runApuConfidence(base, { now });
  const scenarioConfidence = runApuConfidence(scenario, { now });
  const baseBidRisk = runBidRisk(base, { now, confidence: baseConfidence });
  const scenarioBidRisk = runBidRisk(scenario, { now, confidence: scenarioConfidence });

  return {
    base, scenario, delta,
    confidence: { base: baseConfidence, scenario: scenarioConfidence },
    bidRisk: { base: baseBidRisk, scenario: scenarioBidRisk },
    appliedChanges, warnings
  };
}

const RISK_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

/* Compara N escenarios sobre el MISMO apu base (regla 8 del spec). Cada
   escenario se calcula de forma completamente independiente (createScenario
   siempre clona desde el `apu` original, nunca encadena un escenario sobre
   otro) para que el orden de la lista nunca afecte el resultado. */
export function compareScenarios(apu, scenarioDefs = [], options = {}){
  const scenarios = scenarioDefs.map(def => ({ label: def.label, result: createScenario({ apu, changes: def.changes || [], options }) }));
  const byKey = (keyFn) => [...scenarios].sort((a, b) => keyFn(b) - keyFn(a));
  return {
    scenarios,
    ranking: {
      byCostDesc: byKey(s => s.result.delta.scenarioUnitCost ?? 0),
      byDeltaDesc: byKey(s => Math.abs(s.result.delta.unitDelta ?? 0)),
      byConfidenceAsc: byKey(s => -(s.result.confidence.scenario.score ?? -1)),
      byRiskDesc: byKey(s => RISK_RANK[s.result.bidRisk.scenario.severity] || 0),
      byExposureDesc: byKey(s => s.result.bidRisk.scenario.estimatedExposure || 0)
    }
  };
}

/* Aplica UN cambio a multiples APU de un proyecto (regla 9 del spec).
   Reusa createScenario por cada APU -- nunca reimplementa la logica de
   aplicar/recalcular. El matching de recursos sigue siendo por clave/
   descripcion exacta (rowsForSelector, sin fuzzy matching) -- un APU que no
   tenga ningun recurso que coincida con el selector simplemente no se ve
   afectado (queda en unaffectedApus, no se fuerza nada). */
export function applyChangeAcrossProject(apus = [], change, options = {}){
  const perApu = apus.map((apu, index) => {
    const apuId = apu.id || apu.clave || `APU-${index + 1}`;
    const scenario = createScenario({ apu, changes: [change], options });
    return { apuId, concept: apu.concept || '', affected: scenario.appliedChanges.length > 0, scenario };
  });
  const affected = perApu.filter(p => p.affected);
  const unaffected = perApu.filter(p => !p.affected);
  const totalProjectDelta = affected.reduce((s, p) => s + (Number.isFinite(p.scenario.delta.projectDelta) ? p.scenario.delta.projectDelta : 0), 0);
  const topImpacts = [...affected]
    .sort((a, b) => Math.abs(b.scenario.delta.projectDelta ?? b.scenario.delta.unitDelta ?? 0) - Math.abs(a.scenario.delta.projectDelta ?? a.scenario.delta.unitDelta ?? 0))
    .slice(0, options.topN || 10)
    .map(p => ({ apuId: p.apuId, concept: p.concept, unitDelta: p.scenario.delta.unitDelta, projectDelta: p.scenario.delta.projectDelta }));
  const riskChanges = affected
    .filter(p => p.scenario.bidRisk.base.severity !== p.scenario.bidRisk.scenario.severity)
    .map(p => ({ apuId: p.apuId, concept: p.concept, from: p.scenario.bidRisk.base.severity, to: p.scenario.bidRisk.scenario.severity }));
  return {
    totalAPUs: apus.length,
    affectedApus: affected.map(p => ({ apuId: p.apuId, concept: p.concept })),
    unaffectedApus: unaffected.map(p => ({ apuId: p.apuId, concept: p.concept })),
    // null solo si NINGUN APU afectado tiene cantidadObra capturada (nada
    // que sumar de verdad); si al menos uno si la tiene, se suma lo
    // calculable y se documenta cuales quedaron fuera via delta.reason de
    // cada entrada en topImpacts/scenario individual.
    totalProjectDelta: affected.length && affected.every(p => p.scenario.delta.projectDelta == null) ? null : round2(totalProjectDelta),
    topImpacts, riskChanges
  };
}
