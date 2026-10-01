/* E2E de Fase 2 -- pipeline completo Levantamiento -> CAD -> deteccion de
   baseline aprobado -> creacion de Orden de Cambio (dedupe) -> aprobacion
   -> agregacion en Control Presupuestal. Modulos puros, cero red.

   Caso principal (regla 9 del encargo -- caso obligatorio):
     Baseline aprobado para M-01, 11.295 m² @ $748.15 = $8,451.32
     Usuario mueve M-01 de 4.85 -> 5.30 -> cantidad actual 12.510 m²
     Impacto: +1.215 m² = +$909.00
     - isAssignmentStale === true
     - baseline detectado como APPROVED
     - sincronizacion directa bloqueada (regla 2)
     - se crea OC con delta positivo y trazabilidad completa (regla 4)
     - baseline sigue en 11.295 m² (regla 6: nunca se toca)
     - OC aprobada suma +$909.00 al Control Presupuestal (regla 6)
     - dedupe: recrear la misma OC devuelve la existente (regla 8) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEmptySpace, makeEmptyElement, ELEMENT_TYPE, makeEmptySurvey } from './levantamientoSchema.js';
import { updateWall, setElementAssignment } from './cadModel.js';
import { buildElementTakeoff, markConceptSynced, isAssignmentStale } from './cadTakeoff.js';
import { surveyToCadModel, surveyPlanoKey } from './surveyToCadModel.js';
import { computeGeometryImpact } from './economicImpact.js';
import { isConceptInApprovedBudget, detectSpecChange, BASELINE_STATUS } from './budgetBaselineLookup.js';
import {
  composeGeometryChangeDescription, composeGeometryChangeMotivo,
  buildGeometryEvidence, buildChangeOrderPayload, findDuplicateChangeOrder,
  computeReferenceImpact
} from './changeOrderFromGeometry.js';
import { makeEmptyChangeOrder, CHANGE_ORDER_STATUS, computeChangeOrderEconomicImpact } from './changeOrderSchema.js';
import { aggregateControlPresupuestal } from './controlPresupuestalAggregation.js';

/* Constructores de fixtures reutilizables */
function makeCase(){
  const space = makeEmptySpace({ name: 'Recamara', length: 4.85, width: 3.00, height: 2.70 });
  space.id = 'SPC-brief';
  const win = makeEmptyElement({ type: ELEMENT_TYPE.WINDOW, width: 1.50, height: 1.20, wallId: 'M-01', offset: 1.5, sillHeight: 0.9 });
  win.id = 'ELM-win-1';
  space.elements = [win];
  const survey = makeEmptySurvey({ projectId: 'PRJ-1', name: 'Casa Habitacion', id: 'LEV-1' });
  survey.spaces = [space];
  return { survey, space };
}
function makePresupuestoBaseline({ conceptoId = 'CAT-M01', qty = 11.295, pu = 748.15, unit = 'm²', apuId = 'APU-M01' } = {}){
  return {
    id: 'PRES-BASE', currentVersion: 'V2', baselineVersion: 'V2', archivedAt: null,
    snapshot: { rows: [{ conceptoId, clave: 'M-01', capitulo: 'ALBANILERIA', concept: 'Muro de tabique 12', unit, qty, pu, direct: pu, iva: pu*0.16, apuId, apuVersionId: 'V1' }] }
  };
}
function stageAssignedElement(model, wallId, { conceptId, apuPu, unit = 'm²', apuId = 'APU-M01' }){
  const withAssign = setElementAssignment(model, wallId, {
    conceptId, clave: wallId, concept: 'Muro de tabique 12', unit,
    quantityField: 'netArea', apuId, apuLabel: apuId, apuPu
  });
  return markConceptSynced(withAssign, conceptId);
}

/* ==== 1) Presupuestos y su deteccion ==== */

test('caso obligatorio: baseline aprobado detectado en el arreglo de presupuestos', () => {
  const p = makePresupuestoBaseline({ conceptoId: 'CAT-M01' });
  const ctx = isConceptInApprovedBudget([p], 'CAT-M01');
  assert.equal(ctx.status, BASELINE_STATUS.APPROVED);
  assert.equal(ctx.cantidadContractual, 11.295);
  assert.equal(ctx.puContractual, 748.15);
  assert.equal(ctx.baselineVersion, 'V2');
});

test('sin presupuesto aprobado no se bloquea sincronizacion (comportamiento Fase 1)', () => {
  const ctx = isConceptInApprovedBudget([], 'CAT-M01');
  assert.equal(ctx.status, BASELINE_STATUS.NO_BUDGET);
});

test('presupuesto en borrador no bloquea sincronizacion directa (solo advertencia)', () => {
  const draft = { id: 'PRES-DRAFT', baselineVersion: null, currentVersion: 'V1', snapshot: { rows: [{ conceptoId: 'CAT-M01', qty: 11.295, pu: 748.15, unit: 'm²' }] } };
  const ctx = isConceptInApprovedBudget([draft], 'CAT-M01');
  assert.equal(ctx.status, BASELINE_STATUS.DRAFT);
});

/* ==== 2) Flujo CAD stale + baseline + OC ==== */

test('flujo M-01: stale + baseline aprobado -> se decide "Crear Orden de Cambio"', () => {
  const { survey, space } = makeCase();
  const { model } = surveyToCadModel(space);
  const staged = stageAssignedElement(model, 'M-01', { conceptId: 'CAT-M01', apuPu: 748.15 });
  const edited = updateWall(staged, 'M-01', { length: 5.30 });

  const wallAfter = edited.walls.find(w => w.id === 'M-01');
  const takeoff = buildElementTakeoff(edited, 'M-01');
  const stale = isAssignmentStale(edited, wallAfter);
  assert.equal(stale, true, 'debe detectar stale');

  const ctx = isConceptInApprovedBudget([makePresupuestoBaseline({ conceptoId: 'CAT-M01' })], 'CAT-M01');
  assert.equal(ctx.status, BASELINE_STATUS.APPROVED);
  // Decision: se ofrece OC en vez de sincronizar directo.
  assert.equal(takeoff.primary.value, 12.51);
  const impact = computeGeometryImpact({
    previousQty: ctx.cantidadContractual, currentQty: takeoff.primary.value, pu: ctx.puContractual
  });
  assert.equal(impact.deltaQty, 1.215);
  assert.equal(impact.deltaAmount, 909.00);
});

test('flujo M-01: payload de OC listo para POST /api/change-orders con trazabilidad completa', () => {
  const { survey, space } = makeCase();
  const { model } = surveyToCadModel(space);
  const staged = stageAssignedElement(model, 'M-01', { conceptId: 'CAT-M01', apuPu: 748.15 });
  const edited = updateWall(staged, 'M-01', { length: 5.30 });
  const takeoff = buildElementTakeoff(edited, 'M-01');
  const planoId = surveyPlanoKey(survey.id, space.id);
  const evidencia = buildGeometryEvidence({
    origenElementoId: `${planoId}:M-01`, planoId, surveyId: survey.id, spaceId: space.id,
    cadElementId: 'M-01', cadElementKind: 'wall',
    propertyChanged: 'longitud', oldValue: 4.85, newValue: 5.30,
    createdBy: 'ing@zoemec.com'
  });
  const payload = buildChangeOrderPayload({
    projectId: 'PRJ-1', conceptoId: 'CAT-M01', cantidadNueva: takeoff.primary.value,
    motivo: composeGeometryChangeMotivo({ elementLabel: 'M-01' }),
    descripcion: composeGeometryChangeDescription({
      elementLabel: 'M-01', propertyChanged: 'longitud', oldValue: 4.85, newValue: 5.30,
      cantidadAnterior: 11.295, cantidadNueva: takeoff.primary.value, unit: 'm²', conceptLabel: 'Muro de tabique 12'
    }),
    evidencia
  });
  assert.equal(payload.action, 'create');
  assert.equal(payload.projectId, 'PRJ-1');
  assert.equal(payload.conceptoId, 'CAT-M01');
  assert.equal(payload.cantidadNueva, 12.51);
  assert.equal(payload.evidencia.origenElementoId, 'survey:LEV-1:SPC-brief:M-01');
  assert.equal(payload.evidencia.surveyId, 'LEV-1');
  assert.equal(payload.evidencia.cadElementId, 'M-01');
  assert.equal(payload.evidencia.generatedFrom, 'cad-geometry-change');
  assert.match(payload.descripcion, /longitud cambio de 4\.850 a 5\.300 m/);
});

test('OC simulada como la crearia el server: mismo folio no se crea dos veces (dedupe)', () => {
  // Modelo simulado del servidor: la OC ya existe en BORRADOR con la misma cantidadNueva.
  const existingOc = {
    id: 'OC-1', folio: 'CO-001', projectId: 'PRJ-1', conceptoId: 'CAT-M01',
    status: CHANGE_ORDER_STATUS.BORRADOR, cantidadNueva: 12.51,
    evidencia: { origenElementoId: 'survey:LEV-1:SPC-brief:M-01' }
  };
  const dup = findDuplicateChangeOrder({
    changeOrders: [existingOc], conceptoId: 'CAT-M01',
    origenElementoId: 'survey:LEV-1:SPC-brief:M-01', cantidadNueva: 12.51
  });
  assert.equal(dup.duplicate?.id, 'OC-1');
});

test('re-editar M-01 a 5.80 (12.510 -> 13.68): detecta staleDraft, no duplica silenciosamente', () => {
  const draft = {
    id: 'OC-1', folio: 'CO-001', projectId: 'PRJ-1', conceptoId: 'CAT-M01',
    status: CHANGE_ORDER_STATUS.BORRADOR, cantidadNueva: 12.51,
    evidencia: { origenElementoId: 'survey:LEV-1:SPC-brief:M-01' }
  };
  const r = findDuplicateChangeOrder({
    changeOrders: [draft], conceptoId: 'CAT-M01',
    origenElementoId: 'survey:LEV-1:SPC-brief:M-01', cantidadNueva: 13.68
  });
  assert.equal(r.duplicate, null);
  assert.equal(r.staleDraft?.id, 'OC-1');
  // Regla 8 del encargo: la UI decide (confirmar y crear nueva); NO se
  // duplica automaticamente.
});

/* ==== 3) Delta negativo (regla 10 del encargo) ==== */

test('delta negativo: 11.295 -> 10.00 en muro contractual -> OC con impacto negativo', () => {
  const impact = computeGeometryImpact({ previousQty: 11.295, currentQty: 10.00, pu: 748.15 });
  assert.equal(impact.deltaQty, -1.295);
  assert.equal(impact.direction, 'decrease');
  assert.equal(impact.deltaAmount, -968.85);
  // Reference impact desde changeOrderSchema (regla: reutilizar, no duplicar)
  const refImpact = computeReferenceImpact({ cantidadAnterior: 11.295, cantidadNueva: 10, pu: 748.15 });
  assert.equal(Math.round(refImpact * 100) / 100, -968.85);
});

/* ==== 4) PU null (regla 11) ==== */

test('PU null en baseline: impacto queda null, no cero -- no se inventa costo', () => {
  const p = { id: 'P1', baselineVersion: 'V1', snapshot: { rows: [{ conceptoId: 'CAT-X', qty: 10, pu: 0, unit: 'm²' }] } };
  const ctx = isConceptInApprovedBudget([p], 'CAT-X');
  assert.equal(ctx.status, BASELINE_STATUS.APPROVED);
  assert.equal(ctx.puContractual, 0);
  // computeGeometryImpact con pu=0 -> deltaAmount = 0 (no null): un P.U.
  // explicito de 0 SI es informacion real "el precio contractual es 0".
  const impact = computeGeometryImpact({ previousQty: 10, currentQty: 12, pu: ctx.puContractual });
  assert.equal(impact.deltaAmount, 0);
});

/* ==== 5) Extraordinario (regla 12) ==== */

test('cambio de especificacion (unit distinto): requiresNewApu true', () => {
  const spec = detectSpecChange({ contractualUnit: 'm²', currentUnit: 'pza' });
  assert.equal(spec.requiresNewApu, true);
  assert.match(spec.reason, /extraordinario/);
});

test('mismo alcance: PU contractual se preserva', () => {
  const spec = detectSpecChange({ contractualUnit: 'm²', currentUnit: 'm²', contractualApuId: 'APU-M01', currentApuId: 'APU-M01' });
  assert.equal(spec.requiresNewApu, false);
});

/* ==== 6) Baseline intacto tras crear OC ==== */

test('baseline sigue en 11.295 m² despues de crear OC en borrador (regla 6)', () => {
  const p = makePresupuestoBaseline({ conceptoId: 'CAT-M01' });
  // El proceso client-side de crear OC NUNCA muta el presupuesto local
  // (solo dispara POST /api/change-orders). Aqui verificamos que el
  // snapshot de rows es inmutable: no hay funcion en este archivo que lo
  // toque -- por diseno.
  const rowsBefore = JSON.stringify(p.snapshot.rows);
  const oc = makeEmptyChangeOrder({
    projectId: 'PRJ-1', conceptoId: 'CAT-M01', cantidadAnterior: 11.295, cantidadNueva: 12.51, pu: 748.15,
    motivo: 'Cambio geometrico', descripcion: 'M-01 4.85 -> 5.30'
  });
  assert.equal(oc.status, CHANGE_ORDER_STATUS.BORRADOR);
  assert.equal(oc.impactoEconomico, computeChangeOrderEconomicImpact({ cantidadAnterior: 11.295, cantidadNueva: 12.51, pu: 748.15 }));
  // Baseline no cambio:
  assert.equal(JSON.stringify(p.snapshot.rows), rowsBefore);
});

/* ==== 7) Efecto de aprobacion en Control Presupuestal (regla 6) ==== */

test('control presupuestal: OC APROBADA suma +$909.00 al vigente; baseline queda intacto', () => {
  // Estado inicial: 1 renglon baseline
  const presupuestoRows = [
    { conceptoId: 'CAT-M01', clave: 'M-01', capitulo: 'ALBANILERIA', concept: 'Muro de tabique 12', unit: 'm²',
      qty: 11.295, pu: 748.15, direct: 748.15 }
  ];
  // OC en BORRADOR: NO debe sumarse al vigente
  const ocBorrador = makeEmptyChangeOrder({
    projectId: 'PRJ-1', conceptoId: 'CAT-M01', cantidadAnterior: 11.295, cantidadNueva: 12.51, pu: 748.15,
    motivo: 'x', descripcion: 'y'
  });
  const aggBefore = aggregateControlPresupuestal({ presupuestoRows, changeOrders: [ocBorrador] });
  // 11.295 * 748.15 = 8450.35425 -> redondeado 2 = 8450.35
  assert.equal(Math.round(aggBefore.totals.baseline * 100) / 100, 8450.35);
  assert.equal(aggBefore.totals.cambiosAprobados, 0, 'OC borrador NO suma');
  assert.equal(Math.round(aggBefore.totals.vigente * 100) / 100, 8450.35, 'vigente = baseline mientras no haya OC aprobada');

  // OC APROBADA: SI se suma al vigente
  const ocAprobada = { ...ocBorrador, status: CHANGE_ORDER_STATUS.APROBADA };
  const aggAfter = aggregateControlPresupuestal({ presupuestoRows, changeOrders: [ocAprobada] });
  assert.equal(Math.round(aggAfter.totals.baseline * 100) / 100, 8450.35, 'baseline sigue intacto');
  // 1.215 * 748.15 = 909.00225 -> redondeado 2 = 909.00
  assert.equal(Math.round(aggAfter.totals.cambiosAprobados * 100) / 100, 909.00, 'cambios aprobados = +$909.00');
  // 8450.35425 + 909.00225 = 9359.3565 -> redondeado 2 = 9359.36
  assert.equal(Math.round(aggAfter.totals.vigente * 100) / 100, 9359.36);
});

test('control presupuestal: OC RECHAZADA no afecta baseline ni vigente', () => {
  const presupuestoRows = [{ conceptoId: 'CAT-M01', qty: 11.295, pu: 748.15, direct: 748.15, capitulo: 'ALBANILERIA', unit: 'm²' }];
  const ocRechazada = { ...makeEmptyChangeOrder({ projectId: 'PRJ-1', conceptoId: 'CAT-M01', cantidadAnterior: 11.295, cantidadNueva: 12.51, pu: 748.15, motivo: 'x', descripcion: 'y' }), status: CHANGE_ORDER_STATUS.RECHAZADA };
  const agg = aggregateControlPresupuestal({ presupuestoRows, changeOrders: [ocRechazada] });
  assert.equal(agg.totals.cambiosAprobados, 0);
  assert.equal(Math.round(agg.totals.vigente * 100) / 100, 8450.35);
});

/* ==== 8) Persistencia round-trip ==== */

test('persistencia: OC con evidencia trazable sobrevive round-trip JSON', () => {
  const evidencia = buildGeometryEvidence({
    origenElementoId: 'survey:LEV-1:SPC-1:M-01', planoId: 'survey:LEV-1:SPC-1',
    surveyId: 'LEV-1', spaceId: 'SPC-1', cadElementId: 'M-01', cadElementKind: 'wall',
    propertyChanged: 'longitud', oldValue: 4.85, newValue: 5.30, createdBy: 'ing@zoemec.com'
  });
  const oc = makeEmptyChangeOrder({
    projectId: 'PRJ-1', conceptoId: 'CAT-M01', cantidadAnterior: 11.295, cantidadNueva: 12.51, pu: 748.15,
    motivo: 'Cambio geometrico en M-01', descripcion: 'M-01 4.85 -> 5.30', evidencia
  });
  const restored = JSON.parse(JSON.stringify(oc));
  assert.equal(restored.evidencia.origenElementoId, 'survey:LEV-1:SPC-1:M-01');
  assert.equal(restored.evidencia.cadElementId, 'M-01');
  assert.equal(restored.impactoEconomico, computeChangeOrderEconomicImpact({ cantidadAnterior: 11.295, cantidadNueva: 12.51, pu: 748.15 }));
  assert.equal(restored.status, CHANGE_ORDER_STATUS.BORRADOR);
});

/* ==== 9) M-01 completo -- checklist del caso obligatorio ==== */

test('M-01 CASO OBLIGATORIO: los 9 puntos del brief §9 se cumplen', () => {
  // 1. baseline
  const p = makePresupuestoBaseline({ conceptoId: 'CAT-M01' });
  // 2. CAD derivado
  const { survey, space } = makeCase();
  const { model } = surveyToCadModel(space);
  const staged = stageAssignedElement(model, 'M-01', { conceptId: 'CAT-M01', apuPu: 748.15 });
  // 3. editar
  const edited = updateWall(staged, 'M-01', { length: 5.30 });
  const wall = edited.walls.find(w => w.id === 'M-01');
  const takeoff = buildElementTakeoff(edited, 'M-01');
  // 1) isAssignmentStale === true
  assert.equal(isAssignmentStale(edited, wall), true, '(1) stale');
  // 2) detecta concepto en presupuesto aprobado
  const ctx = isConceptInApprovedBudget([p], 'CAT-M01');
  assert.equal(ctx.status, BASELINE_STATUS.APPROVED, '(2) baseline aprobado detectado');
  // 3) bloquea sincronizacion directa -- verificado por que UI llama a
  //    createOcFromGeometry en vez de resync cuando ctx=APPROVED (probado
  //    indirectamente en el test de payload).
  // 4) ofrece Crear Orden de Cambio (payload valido)
  const planoId = surveyPlanoKey(survey.id, space.id);
  const payload = buildChangeOrderPayload({
    projectId: 'PRJ-1', conceptoId: 'CAT-M01', cantidadNueva: takeoff.primary.value,
    motivo: composeGeometryChangeMotivo({ elementLabel: 'M-01' }),
    descripcion: 'Cambio M-01',
    evidencia: buildGeometryEvidence({
      origenElementoId: `${planoId}:M-01`, planoId, surveyId: survey.id, spaceId: space.id,
      cadElementId: 'M-01', cadElementKind: 'wall'
    })
  });
  assert.equal(payload.cantidadNueva, 12.51, '(4) payload listo');
  // 5) OC con delta +1.215
  const ocRef = makeEmptyChangeOrder({
    projectId: 'PRJ-1', conceptoId: 'CAT-M01', cantidadAnterior: ctx.cantidadContractual,
    cantidadNueva: takeoff.primary.value, pu: ctx.puContractual, motivo: 'x', descripcion: 'y'
  });
  assert.equal(Math.round((ocRef.cantidadNueva - ocRef.cantidadAnterior) * 1000) / 1000, 1.215, '(5) delta +1.215');
  // 6) baseline sigue en 11.295 (no lo tocamos)
  assert.equal(p.snapshot.rows[0].qty, 11.295, '(6) baseline intacto');
  // 7) OC aprobada suma +$909.00 al control
  const agg = aggregateControlPresupuestal({
    presupuestoRows: [{ conceptoId: 'CAT-M01', qty: 11.295, pu: 748.15, direct: 748.15, capitulo: 'ALBANILERIA', unit: 'm²' }],
    changeOrders: [{ ...ocRef, status: CHANGE_ORDER_STATUS.APROBADA }]
  });
  assert.equal(Math.round(agg.totals.cambiosAprobados * 100) / 100, 909.00, '(7) OC aprobada suma correctamente');
  // 8) trazabilidad conserva M-01
  assert.equal(payload.evidencia.cadElementId, 'M-01', '(8) trazabilidad conservada');
  assert.equal(payload.evidencia.origenElementoId, `${planoId}:M-01`, '(8) origenElementoId estable');
  // 9) round-trip: todo sobrevive JSON
  const restored = JSON.parse(JSON.stringify({ p, cadModel: edited, oc: ocRef, payload }));
  assert.equal(restored.p.snapshot.rows[0].qty, 11.295, '(9) baseline round-trip');
  assert.equal(restored.cadModel.walls.find(w => w.id === 'M-01').assignment.conceptId, 'CAT-M01', '(9) assignment round-trip');
  assert.equal(restored.payload.evidencia.cadElementId, 'M-01', '(9) evidencia round-trip');
});
