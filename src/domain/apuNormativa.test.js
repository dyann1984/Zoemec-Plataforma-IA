import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ESTADO_REVISION, ESTADO_REVISION_LABEL, NORMATIVA_VACIA_TEXTO, NORMATIVA_DISCLAIMER,
  ESTADO_VALIDACION, ESTADO_VALIDACION_LABEL, REQUIERE_VALIDACION_NORMATIVA_TEXTO,
  tieneFuenteVerificable, normalizeEstadoValidacion, makeEmptyNormativaRow
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

test('ESTADO_VALIDACION expone exactamente VERIFICADO/SUGERIDO_POR_IA/PENDIENTE_VALIDAR (regla 7 del mensaje de la sesion)', () => {
  assert.equal(Object.isFrozen(ESTADO_VALIDACION), true);
  assert.deepEqual(Object.keys(ESTADO_VALIDACION), ['VERIFICADO', 'SUGERIDO_POR_IA', 'PENDIENTE_VALIDAR']);
  for (const k of Object.keys(ESTADO_VALIDACION)) assert.ok(ESTADO_VALIDACION_LABEL[ESTADO_VALIDACION[k]]);
});

test('tieneFuenteVerificable es true solo si "fuente" tiene contenido no vacio', () => {
  assert.equal(tieneFuenteVerificable({ fuente: 'DOF 2024-01-01' }), true);
  assert.equal(tieneFuenteVerificable({ fuente: '  ' }), false);
  assert.equal(tieneFuenteVerificable({ fuente: '' }), false);
  assert.equal(tieneFuenteVerificable({}), false);
  assert.equal(tieneFuenteVerificable(undefined), false);
});

test('normalizeEstadoValidacion: nadie (ni la IA, ni un formulario) puede fijar VERIFICADO sin una fuente ya presente -- se degrada a PENDIENTE_VALIDAR', () => {
  assert.equal(normalizeEstadoValidacion({ estadoValidacion: 'VERIFICADO', fuente: '' }), ESTADO_VALIDACION.PENDIENTE_VALIDAR);
  assert.equal(normalizeEstadoValidacion({ estadoValidacion: 'VERIFICADO' }), ESTADO_VALIDACION.PENDIENTE_VALIDAR);
  assert.equal(normalizeEstadoValidacion({ estadoValidacion: 'VERIFICADO', fuente: 'DOF 2024-01-01' }), ESTADO_VALIDACION.VERIFICADO);
});

test('normalizeEstadoValidacion: SUGERIDO_POR_IA y PENDIENTE_VALIDAR no requieren fuente; un valor invalido o ausente cae a PENDIENTE_VALIDAR', () => {
  assert.equal(normalizeEstadoValidacion({ estadoValidacion: 'SUGERIDO_POR_IA' }), ESTADO_VALIDACION.SUGERIDO_POR_IA);
  assert.equal(normalizeEstadoValidacion({ estadoValidacion: 'PENDIENTE_VALIDAR' }), ESTADO_VALIDACION.PENDIENTE_VALIDAR);
  assert.equal(normalizeEstadoValidacion({ estadoValidacion: 'ALGO_INVENTADO' }), ESTADO_VALIDACION.PENDIENTE_VALIDAR);
  assert.equal(normalizeEstadoValidacion({}), ESTADO_VALIDACION.PENDIENTE_VALIDAR);
});

test('makeEmptyNormativaRow: nunca inventa datos -- estadoValidacion arranca en PENDIENTE_VALIDAR sin fuente', () => {
  const row = makeEmptyNormativaRow();
  assert.equal(row.estadoValidacion, ESTADO_VALIDACION.PENDIENTE_VALIDAR);
  assert.equal(tieneFuenteVerificable(row), false);
  assert.equal(row.estadoRevision, ESTADO_REVISION.PENDIENTE);
});

test('makeEmptyNormativaRow incluye los campos geograficos/clasificacion nuevos (P1 2026-09-07) sin romper los existentes', () => {
  const row = makeEmptyNormativaRow();
  for (const campo of ['pais', 'estadoGeografico', 'municipio', 'tipoObra', 'especialidad', 'descripcion']) {
    assert.ok(Object.prototype.hasOwnProperty.call(row, campo), `falta campo ${campo}`);
    assert.equal(row[campo], '');
  }
  // Campos historicos (produccion desde 2026-09-03) siguen presentes intactos:
  // nombre/clave cubren "norma", articulo cubre "articuloApartado",
  // version+fechaPublicacion cubren "versionFecha" -- ver comentario del
  // commit para no duplicar campos con otro nombre para el mismo dato.
  for (const campo of ['nombre', 'clave', 'organismoEmisor', 'jurisdiccion', 'version', 'fechaPublicacion', 'fuente', 'articulo', 'requisito', 'estadoRevision', 'observaciones']) {
    assert.ok(Object.prototype.hasOwnProperty.call(row, campo), `falta campo historico ${campo}`);
  }
});

test('REQUIERE_VALIDACION_NORMATIVA_TEXTO es el fallback cuando no hay fuente verificable', () => {
  const row = makeEmptyNormativaRow();
  const mensaje = tieneFuenteVerificable(row) ? '' : REQUIERE_VALIDACION_NORMATIVA_TEXTO;
  assert.equal(mensaje, 'Requiere validación normativa.');
});
