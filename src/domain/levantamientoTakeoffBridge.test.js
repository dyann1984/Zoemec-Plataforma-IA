import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanoElementFromConcept } from './levantamientoTakeoffBridge.js';
import { buildSpaceGeometryModel } from './surveyGeometryModel.js';
import { ELEMENT_TYPE, makeEmptySpace, makeEmptyElement } from './levantamientoSchema.js';

const survey = { name: 'Levantamiento Local Ecatepec' };
const space = { name: 'Local comercial' };

test('buildPlanoElementFromConcept produce una semilla de APU valida (forma exacta que ya consume apuGeneration.js)', () => {
  const seed = buildPlanoElementFromConcept({
    tipo: 'muro', descripcion: 'Muros netos', cantidad: 91.71, unidad: 'm2', survey, space, validatedBy: 'user@zoemec.com'
  });
  assert.ok(seed);
  assert.equal(seed.concept, 'Muros netos');
  assert.equal(seed.unit, 'm2');
  assert.equal(seed.qty, 91.71);
  assert.equal(seed.referencePU, 0);
  assert.equal(seed.sourceMeta.origen, 'plano-takeoff');
  assert.equal(seed.sourceMeta.fuenteEscala, 'referencia_usuario');
  assert.equal(seed.sourceMeta.validatedBy, 'user@zoemec.com');
});

test('buildPlanoElementFromConcept regresa null si la cantidad no es utilizable (0, negativa o no numerica) -- mismo guard que toApuSeed', () => {
  assert.equal(buildPlanoElementFromConcept({ tipo: 'piso', descripcion: 'Piso', cantidad: 0, unidad: 'm2', survey, space }), null);
  assert.equal(buildPlanoElementFromConcept({ tipo: 'piso', descripcion: 'Piso', cantidad: -5, unidad: 'm2', survey, space }), null);
  assert.equal(buildPlanoElementFromConcept({ tipo: 'piso', descripcion: 'Piso', cantidad: NaN, unidad: 'm2', survey, space }), null);
});

test('buildPlanoElementFromConcept siempre marca origenMedicion levantamiento_ia en la evidencia (trazabilidad)', () => {
  const seed = buildPlanoElementFromConcept({
    tipo: 'puerta', descripcion: 'Puertas', cantidad: 1, unidad: 'pza', survey, space, validatedBy: 'user@zoemec.com'
  });
  assert.match(seed.sourceMeta.evidencia, /Levantamiento IA/);
  assert.match(seed.sourceMeta.evidencia, /Local comercial/);
});

test('adaptacion correcta hacia Plano/Takeoff: la cantidad enviada es EXACTAMENTE el area neta que produce el modelo geometrico (91.71 m2), sin recalcularla aparte', () => {
  const door = makeEmptyElement({ type: ELEMENT_TYPE.DOOR, width: 0.9, height: 2.1, wallId: 'M-01', offset: 1 });
  const win = makeEmptyElement({ type: ELEMENT_TYPE.WINDOW, width: 2, height: 1.2, wallId: 'M-03', offset: 2, sillHeight: 1 });
  const fullSpace = { ...makeEmptySpace({ name: 'Local comercial', length: 8, width: 8, height: 3 }), elements: [door, win] };
  const model = buildSpaceGeometryModel(fullSpace);
  const seed = buildPlanoElementFromConcept({
    tipo: 'muro', descripcion: 'Muros netos', cantidad: model.geometry.wallNetArea, unidad: 'm2',
    survey, space: fullSpace, validatedBy: 'user@zoemec.com'
  });
  assert.equal(seed.qty, 91.71);
});
