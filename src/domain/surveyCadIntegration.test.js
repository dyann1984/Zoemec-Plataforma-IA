/* Pruebas de integracion Fase 1 -- flujo Levantamiento -> CAD -> concepto ->
   APU -> impacto economico y persistencia. Cubre puntos 8 y 11 del encargo:
     - origenElementoId estable
     - dedupe al sincronizar dos veces
     - recarga conserva cadModel
     - cantidad anterior disponible para calcular delta
     - opening permanece asociado al muro
     - cotas se recalculan
   Usa TODO lo real (cadModel + cadTakeoff + quantificationCostBridge)
   excepto la red -- syncQuantificationToCatalog recibe un `request` mock. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEmptySpace, makeEmptyElement, ELEMENT_TYPE, makeEmptySurvey } from './levantamientoSchema.js';
import { computeWallMetrics, updateWall, setElementAssignment, resolveDimension } from './cadModel.js';
import { buildElementTakeoff, isAssignmentStale, markConceptSynced, conceptQuantityFromModel } from './cadTakeoff.js';
import { toCatalogConceptInput, syncQuantificationToCatalog } from './quantificationCostBridge.js';
import { surveyToCadModel, surveyPlanoKey } from './surveyToCadModel.js';
import { computeGeometryImpact } from './economicImpact.js';

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

test('origenElementoId estable: el mismo (survey, space, muro) produce siempre el mismo origenElementoId', () => {
  const { survey, space } = makeCase();
  const planoId = surveyPlanoKey(survey.id, space.id);
  const input = toCatalogConceptInput({
    projectId: survey.projectId, concept: 'Muro de tabique 12', unit: 'm²', qty: 11.295,
    sourceType: 'takeoff', sourceRecordId: planoId, sourceElementId: 'M-01', planId: planoId
  });
  assert.equal(input.origenElementoId, 'survey:LEV-1:SPC-brief:M-01');
  // Volver a generar debe dar exactamente lo mismo (dedupe server-side).
  const input2 = toCatalogConceptInput({
    projectId: survey.projectId, concept: 'Muro de tabique 12', unit: 'm²', qty: 11.295,
    sourceType: 'takeoff', sourceRecordId: planoId, sourceElementId: 'M-01', planId: planoId
  });
  assert.equal(input.origenElementoId, input2.origenElementoId);
});

test('sincronizar dos veces al mismo servidor produce el mismo origenElementoId (no duplica concepto)', async () => {
  const { survey, space } = makeCase();
  const { model } = surveyToCadModel(space);
  const takeoff = buildElementTakeoff(model, 'M-01');
  const planoId = surveyPlanoKey(survey.id, space.id);
  let received = [];
  const mockRequest = async (_path, payload) => {
    received.push(payload);
    return { conceptos: [{ id: 'CAT-1', clave: 'M-01', concept: payload.conceptos[0].concept, unit: payload.conceptos[0].unit, apuId: null }] };
  };
  const entry = {
    projectId: survey.projectId, concept: 'Muro de tabique 12',
    unit: takeoff.primary.unit, qty: takeoff.primary.value,
    sourceType: 'takeoff', sourceRecordId: planoId, sourceElementId: 'M-01', planId: planoId
  };
  await syncQuantificationToCatalog([entry], { request: mockRequest });
  await syncQuantificationToCatalog([entry], { request: mockRequest });
  assert.equal(received.length, 2);
  assert.equal(received[0].conceptos[0].origenElementoId, received[1].conceptos[0].origenElementoId);
  assert.equal(received[0].conceptos[0].origenElementoId, 'survey:LEV-1:SPC-brief:M-01');
});

test('recarga (round-trip JSON) conserva cadModel + assignment con syncedQty y apuPu', () => {
  const { space } = makeCase();
  const { model } = surveyToCadModel(space);
  const withAssign = setElementAssignment(model, 'M-01', {
    conceptId: 'CAT-1', clave: 'M-01', concept: 'Muro de tabique 12', unit: 'm²',
    quantityField: 'netArea', apuId: 'APU-1', apuLabel: 'APU-1', apuPu: 748.15
  });
  const synced = markConceptSynced(withAssign, 'CAT-1');
  const stored = JSON.parse(JSON.stringify(synced));
  assert.equal(stored.walls[0].assignment.conceptId, 'CAT-1');
  assert.equal(stored.walls[0].assignment.apuPu, 748.15);
  assert.equal(stored.walls[0].assignment.syncedQty, 11.295);
});

test('cantidad anterior sigue disponible para calcular delta despues de editar geometria', () => {
  const { space } = makeCase();
  const { model } = surveyToCadModel(space);
  const withAssign = setElementAssignment(model, 'M-01', {
    conceptId: 'CAT-1', clave: 'M-01', concept: 'Muro', unit: 'm²',
    quantityField: 'netArea', apuId: 'APU-1', apuLabel: 'APU-1', apuPu: 748.15
  });
  const synced = markConceptSynced(withAssign, 'CAT-1');
  const prevSynced = synced.walls[0].assignment.syncedQty;
  assert.equal(prevSynced, 11.295);
  const edited = updateWall(synced, 'M-01', { length: 5.30 });
  // La cantidad anterior (11.295) sigue viva en assignment.syncedQty, aunque
  // el takeoff vigente ahora sea 12.51.
  assert.equal(edited.walls[0].assignment.syncedQty, 11.295);
  const current = buildElementTakeoff(edited, 'M-01').primary.value;
  assert.equal(current, 12.51);
  const impact = computeGeometryImpact({
    previousQty: edited.walls[0].assignment.syncedQty,
    currentQty: current,
    pu: edited.walls[0].assignment.apuPu
  });
  assert.equal(impact.deltaQty, 1.215);
  assert.equal(impact.deltaAmount, 909.00);
});

test('isAssignmentStale detecta cambio de geometria despues de sincronizar', () => {
  const { space } = makeCase();
  const { model } = surveyToCadModel(space);
  const withAssign = setElementAssignment(model, 'M-01', {
    conceptId: 'CAT-1', clave: 'M-01', concept: 'Muro', unit: 'm²',
    quantityField: 'netArea', apuId: 'APU-1', apuLabel: 'APU-1', apuPu: 748.15
  });
  const synced = markConceptSynced(withAssign, 'CAT-1');
  assert.equal(isAssignmentStale(synced, synced.walls[0]), false);
  const edited = updateWall(synced, 'M-01', { length: 5.30 });
  assert.equal(isAssignmentStale(edited, edited.walls[0]), true);
});

test('opening permanece asociado al mismo muro tras cambiar longitud del muro', () => {
  const { space } = makeCase();
  const { model } = surveyToCadModel(space);
  const opBefore = model.openings[0];
  assert.equal(opBefore.wallId, 'M-01');
  const edited = updateWall(model, 'M-01', { length: 6.00 });
  const opAfter = edited.openings[0];
  assert.equal(opAfter.id, opBefore.id);
  assert.equal(opAfter.wallId, 'M-01');
  assert.equal(opAfter.width, 1.5);
  assert.equal(opAfter.height, 1.2);
  // El offset original NUNCA se toca al cambiar la longitud del muro
  // (cadModel.updateWall mantiene inicio y direccion, solo mueve el final).
  assert.equal(opAfter.offset, opBefore.offset);
});

test('cotas ligadas al muro se recalculan al editar longitud (regla 6 del CAD)', () => {
  const { space } = makeCase();
  const { model } = surveyToCadModel(space);
  const dimM01Before = model.dimensions.find(d => d.ref?.id === 'M-01');
  const resolvedBefore = resolveDimension(model, dimM01Before);
  assert.equal(resolvedBefore.value, 4.85);
  const edited = updateWall(model, 'M-01', { length: 5.30 });
  const dimM01After = edited.dimensions.find(d => d.ref?.id === 'M-01');
  // MISMA cota (mismo id), valor recalculado desde la geometria nueva.
  assert.equal(dimM01After.id, dimM01Before.id);
  const resolvedAfter = resolveDimension(edited, dimM01After);
  assert.equal(resolvedAfter.value, 5.30);
});

test('sin APU asignado, el impacto de cantidad se calcula pero deltaAmount queda null', () => {
  const { space } = makeCase();
  const { model } = surveyToCadModel(space);
  const withAssign = setElementAssignment(model, 'M-01', {
    conceptId: 'CAT-1', clave: 'M-01', concept: 'Muro', unit: 'm²',
    quantityField: 'netArea', apuId: null, apuLabel: null, apuPu: null
  });
  const synced = markConceptSynced(withAssign, 'CAT-1');
  const edited = updateWall(synced, 'M-01', { length: 5.30 });
  const current = buildElementTakeoff(edited, 'M-01').primary.value;
  const impact = computeGeometryImpact({
    previousQty: edited.walls[0].assignment.syncedQty,
    currentQty: current,
    pu: edited.walls[0].assignment.apuPu
  });
  assert.equal(impact.deltaQty, 1.215);
  assert.equal(impact.deltaAmount, null);
});

test('conceptQuantityFromModel suma cantidad vigente de todos los muros ligados (no la syncedQty)', () => {
  const { space } = makeCase();
  const { model } = surveyToCadModel(space);
  const withAssign = setElementAssignment(model, 'M-01', {
    conceptId: 'CAT-1', clave: 'M-01', concept: 'Muro', unit: 'm²',
    quantityField: 'netArea', apuId: 'APU-1', apuLabel: 'APU-1', apuPu: 748.15
  });
  const synced = markConceptSynced(withAssign, 'CAT-1');
  const edited = updateWall(synced, 'M-01', { length: 5.30 });
  const q = conceptQuantityFromModel(edited, 'CAT-1', 'm²');
  // Cantidad vigente segun geometria actual, no la syncedQty.
  assert.equal(q.qty, 12.51);
  assert.deepEqual(q.elementIds, ['M-01']);
});
