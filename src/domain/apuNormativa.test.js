import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ESTADO_REVISION, ESTADO_REVISION_LABEL, NORMATIVA_VACIA_TEXTO, NORMATIVA_DISCLAIMER,
  ORIGEN_VALIDACION, ORIGEN_VALIDACION_LABEL, REQUIERE_VALIDACION_NORMATIVA_TEXTO,
  tieneFuenteVerificable, makeEmptyNormativaRow
} from './apuNormativa.js';

test('ESTADO_REVISION conserva sus 4 valores historicos sin cambios', () => {
  assert.equal(Object.isFrozen(ESTADO_REVISION), true);
  assert.deepEqual(Object.keys(ESTADO_REVISION), ['PENDIENTE', 'EN_REVISION', 'VALIDADA_PROFESIONAL', 'DESCARTADA']);
  for (const k of Object.keys(ESTADO_REVISION)) assert.ok(ESTADO_REVISION_LABEL[ESTADO_REVISION[k]]);
});

test('NORMATIVA_VACIA_TEXTO y NORMATIVA_DISCLAIMER nunca afirman cumplimiento legal', () => {
  for (const texto of [NORMATIVA_VACIA_TEXTO, NORMATIVA_DISCLAIMER]) {
    assert.doesNotMatch(texto.toLowerCase(), /cumple|aprobad[oa] legalmente/);
  }
});

test('ORIGEN_VALIDACION expone exactamente VERIFICADO/SUGERIDO_IA/PENDIENTE_VALIDAR', () => {
  assert.equal(Object.isFrozen(ORIGEN_VALIDACION), true);
  assert.deepEqual(Object.keys(ORIGEN_VALIDACION), ['VERIFICADO', 'SUGERIDO_IA', 'PENDIENTE_VALIDAR']);
  for (const k of Object.keys(ORIGEN_VALIDACION)) assert.ok(ORIGEN_VALIDACION_LABEL[ORIGEN_VALIDACION[k]]);
});

test('tieneFuenteVerificable es true solo si "fuente" tiene contenido no vacio', () => {
  assert.equal(tieneFuenteVerificable({ fuente: 'DOF 2024-01-01' }), true);
  assert.equal(tieneFuenteVerificable({ fuente: '  ' }), false);
  assert.equal(tieneFuenteVerificable({ fuente: '' }), false);
  assert.equal(tieneFuenteVerificable({}), false);
  assert.equal(tieneFuenteVerificable(undefined), false);
});

test('makeEmptyNormativaRow: nunca inventa datos -- origenValidacion arranca en PENDIENTE_VALIDAR sin fuente', () => {
  const row = makeEmptyNormativaRow();
  assert.equal(row.origenValidacion, ORIGEN_VALIDACION.PENDIENTE_VALIDAR);
  assert.equal(tieneFuenteVerificable(row), false);
  assert.equal(row.estadoRevision, ESTADO_REVISION.PENDIENTE);
});

test('makeEmptyNormativaRow incluye los campos geograficos/clasificacion nuevos (P1 2026-09-07) sin romper los existentes', () => {
  const row = makeEmptyNormativaRow();
  for (const campo of ['pais', 'estadoGeografico', 'municipio', 'tipoObra', 'especialidad', 'descripcion']) {
    assert.ok(Object.prototype.hasOwnProperty.call(row, campo), `falta campo ${campo}`);
    assert.equal(row[campo], '');
  }
  // Campos historicos siguen presentes (jurisdiccion como texto libre, no reemplazada).
  for (const campo of ['nombre', 'clave', 'organismoEmisor', 'jurisdiccion', 'version', 'fuente', 'articulo']) {
    assert.ok(Object.prototype.hasOwnProperty.call(row, campo), `falta campo historico ${campo}`);
  }
});

test('REQUIERE_VALIDACION_NORMATIVA_TEXTO es el fallback cuando no hay fuente verificable', () => {
  const row = makeEmptyNormativaRow();
  const mensaje = tieneFuenteVerificable(row) ? '' : REQUIERE_VALIDACION_NORMATIVA_TEXTO;
  assert.equal(mensaje, 'Requiere validación normativa.');
});
