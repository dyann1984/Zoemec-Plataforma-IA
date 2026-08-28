import test from 'node:test';
import assert from 'node:assert/strict';
import { createTakeoffRecord, applyManualCorrection, upsertTakeoffRecord, findLatestTakeoffForFile, hashFileContent } from './planoTakeoffStore.js';

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

// --- Aislamiento entre archivos (bug reportado 2026-08-27): dos planos
// distintos con el MISMO nombre no deben compartir escala/trazo/medicion.
// hashFileContent + fileHash en origen son la identidad real; el nombre
// solo. es la referencia legible. ---
test('hashFileContent: mismo contenido -> mismo hash; contenido distinto -> hash distinto', () => {
  const h1 = hashFileContent('data:image/png;base64,AAAA');
  const h2 = hashFileContent('data:image/png;base64,AAAA');
  const h3 = hashFileContent('data:image/png;base64,BBBB');
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
});

test('createTakeoffRecord: calcula fileHash real a partir del contenido, aunque la imagen sea demasiado grande para persistirse completa', () => {
  const bigDataUrl = 'data:image/jpeg;base64,' + 'A'.repeat(2_000_000);
  const record = createTakeoffRecord({ fileName: 'foto-grande.jpg', fileDataUrl: bigDataUrl, elemento: sampleElemento() });
  assert.equal(record.origen.fileDataUrl, null, 'la imagen completa no se persiste (guardia de tamaño)');
  assert.equal(record.origen.fileHash, hashFileContent(bigDataUrl), 'el hash SI sobrevive aunque el contenido completo no se guarde');
});

test('findLatestTakeoffForFile: dos archivos con el MISMO nombre pero contenido distinto son estados independientes (bug reportado)', () => {
  const contentA = 'data:image/png;base64,PLANO_A_CONTENIDO_REAL';
  const contentB = 'data:image/png;base64,PLANO_B_CONTENIDO_DISTINTO';
  const recordA = createTakeoffRecord({ fileName: 'plano.jpg', fileDataUrl: contentA, elemento: sampleElemento({ descripcion: 'Medicion de A' }) });
  const recordB = createTakeoffRecord({ fileName: 'plano.jpg', fileDataUrl: contentB, elemento: sampleElemento({ descripcion: 'Medicion de B' }) });
  const records = upsertTakeoffRecord(upsertTakeoffRecord([], recordA), recordB);

  const hashA = hashFileContent(contentA);
  const hashB = hashFileContent(contentB);
  assert.notEqual(hashA, hashB);

  const foundForA = findLatestTakeoffForFile(records, 'plano.jpg', hashA);
  const foundForB = findLatestTakeoffForFile(records, 'plano.jpg', hashB);
  assert.equal(foundForA.id, recordA.id, 'debe encontrar el registro de A, nunca el de B');
  assert.equal(foundForA.medicion.descripcion, 'Medicion de A');
  assert.equal(foundForB.id, recordB.id, 'debe encontrar el registro de B, nunca el de A');
  assert.equal(foundForB.medicion.descripcion, 'Medicion de B');

  // Un hash que no coincide con NINGUN registro de ese nombre (archivo
  // nuevo, nombre reciclado) no debe restaurar nada -- nunca hereda de A o B.
  const foundForC = findLatestTakeoffForFile(records, 'plano.jpg', hashFileContent('contenido-nuevo-sin-relacion'));
  assert.equal(foundForC, null);
});

test('findLatestTakeoffForFile: un registro VIEJO sin fileHash (guardado antes de esta correccion) NUNCA se asume igual a un archivo nuevo solo por compartir nombre', () => {
  // Bug real reproducido durante la verificacion en navegador de esta misma
  // correccion: con un fallback "sin hash en el registro, empareja por
  // nombre de todas formas", un registro legacy (sin fileHash) seguia
  // devolviendose para CUALQUIER archivo nuevo con el mismo nombre --
  // exactamente el caso que se pidio aislar. La regla correcta: si el
  // llamador SI declara un fileHash (el flujo real siempre lo hace, ver
  // PlanoManualMeasure), un registro sin fileHash propio nunca coincide --
  // es mas seguro pedir recalibrar una vez mas que arriesgar heredar datos
  // de un archivo distinto.
  const oldRecord = createTakeoffRecord({ fileName: 'plano-historico.jpg', elemento: sampleElemento() });
  const legacyRecord = { ...oldRecord, origen: { ...oldRecord.origen, fileHash: null } };
  const records = upsertTakeoffRecord([], legacyRecord);
  const foundConHash = findLatestTakeoffForFile(records, 'plano-historico.jpg', hashFileContent('cualquier-contenido-actual'));
  assert.equal(foundConHash, null, 'un registro legacy sin fileHash NO debe emparejar cuando el llamador si tiene un hash real para comparar');
  // Sin que el LLAMADOR declare ningun hash (codigo viejo invocando la
  // funcion con 2 argumentos, ver el test de arriba "reconstruye el ultimo
  // trazo..."), el emparejamiento por nombre se conserva sin cambios.
  const foundSinHash = findLatestTakeoffForFile(records, 'plano-historico.jpg');
  assert.equal(foundSinHash.id, legacyRecord.id, 'sin fileHash declarado por el llamador, el comportamiento historico (solo por nombre) no cambia');
});
