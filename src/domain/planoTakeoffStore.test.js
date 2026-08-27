import test from 'node:test';
import assert from 'node:assert/strict';
import { createTakeoffRecord, applyManualCorrection, upsertTakeoffRecord, findLatestTakeoffForFile } from './planoTakeoffStore.js';

function sampleElemento(overrides = {}){
  return { tipo: 'piso', descripcion: 'Colocacion de piso, Local 02', unidad: 'm²', cantidadPropuesta: 15.21, fuenteEscala: 'referencia_usuario', origenMedicion: 'trazado_manual', confianzaIA: null, estado: 'PROPUESTO_POR_IA', ...overrides };
}

test('createTakeoffRecord: captura archivo/calibracion/trazo/medicion/concepto vinculado', () => {
  const record = createTakeoffRecord({
    fileName: 'plano-planta-baja.jpg', mimeType: 'image/jpeg', fileDataUrl: 'data:image/jpeg;base64,AAAA',
    mode: 'area', points: [[0, 0], [100, 0], [100, 100]],
    calibration: { pixelDistance: 120, realDistance: 0.9, scale: 0.0075, unit: 'm' },
    elemento: sampleElemento(),
    concepto: { concept: 'Colocacion de piso, Local 02', unit: 'm²', qty: 15.21 }
  });
  assert.equal(record.origen.fileName, 'plano-planta-baja.jpg');
  assert.equal(record.origen.fileDataUrl, 'data:image/jpeg;base64,AAAA');
  assert.equal(record.calibracion.scaleUnitsPerPixel, 0.0075);
  assert.deepEqual(record.trazo.points, [[0, 0], [100, 0], [100, 100]]);
  assert.equal(record.medicion.cantidadPropuesta, 15.21);
  assert.equal(record.medicion.origenMedicion, 'trazado_manual');
  assert.equal(record.conceptoVinculado.concept, 'Colocacion de piso, Local 02');
  assert.equal(record.historial.length, 1);
  assert.equal(record.historial[0].tipo, 'trazo_original');
});

test('createTakeoffRecord: una imagen demasiado grande NO se persiste completa (guardia real de tamaño de localStorage)', () => {
  const bigDataUrl = 'data:image/jpeg;base64,' + 'A'.repeat(2_000_000);
  const record = createTakeoffRecord({ fileName: 'foto-grande.jpg', fileDataUrl: bigDataUrl, elemento: sampleElemento() });
  assert.equal(record.origen.fileDataUrl, null);
  assert.equal(record.origen.fileDemasiadoGrandeParaPersistir, true);
});

test('applyManualCorrection: conserva el valor ORIGINAL en el historial, nunca lo sobrescribe', () => {
  const record = createTakeoffRecord({ fileName: 'x.jpg', elemento: sampleElemento() });
  const corregido = applyManualCorrection(record, { cantidadCorregida: 61.5, descripcionCorregida: 'Piso Local 02 (descontado muro)', validatedBy: 'auditor@zoemec.com', motivo: 'resta muro interior' });
  assert.equal(corregido.medicion.cantidadPropuesta, 15.21, 'la cantidad original nunca se pierde');
  assert.equal(corregido.medicion.cantidadCorregida, 61.5);
  assert.equal(corregido.medicion.estado, 'VALIDADO_POR_USUARIO');
  assert.equal(corregido.validatedBy, 'auditor@zoemec.com');
  assert.ok(corregido.validatedAt);
  assert.equal(corregido.historial.length, 2);
  assert.equal(corregido.historial[0].cantidad, 15.21);
  assert.equal(corregido.historial[1].cantidad, 61.5);
  assert.equal(corregido.historial[1].tipo, 'correccion_manual');
});

test('upsertTakeoffRecord: agrega si es nuevo, reemplaza si ya existe por id (nunca duplica)', () => {
  const r1 = createTakeoffRecord({ fileName: 'a.jpg', elemento: sampleElemento() });
  let records = upsertTakeoffRecord([], r1);
  assert.equal(records.length, 1);
  const r1Updated = { ...r1, medicion: { ...r1.medicion, cantidadCorregida: 99 } };
  records = upsertTakeoffRecord(records, r1Updated);
  assert.equal(records.length, 1);
  assert.equal(records[0].medicion.cantidadCorregida, 99);
});

test('findLatestTakeoffForFile: reconstruye el ultimo trazo de un archivo ya medido -- sin volver a dibujarlo', () => {
  const r1 = createTakeoffRecord({ fileName: 'plano.jpg', elemento: sampleElemento() });
  const records = upsertTakeoffRecord([], r1);
  const found = findLatestTakeoffForFile(records, 'plano.jpg');
  assert.equal(found.id, r1.id);
  assert.equal(findLatestTakeoffForFile(records, 'otro.jpg'), null);
});
