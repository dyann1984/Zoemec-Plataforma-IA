import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadEvidenceWithCompensation } from './evidenceUploadService.js';
import { buildProjectEvidenceList } from './evidenceAdapter.js';

test('1. Storage falla -> no metadata call, retorna error de storage_upload', async () => {
  let recordMetadataCalled = false;
  let deleteStorageCalled = false;

  const fakeFile = new File(['fake content'], 'test_photo.jpg', { type: 'image/jpeg' });

  const mockUploadFn = async () => {
    return { ok: false, reason: 'network_timeout', message: 'Conexión interrumpida al subir' };
  };

  const mockRecordMetadataFn = async () => {
    recordMetadataCalled = true;
  };

  const mockDeleteStorageFn = async () => {
    deleteStorageCalled = true;
  };

  const result = await uploadEvidenceWithCompensation({
    file: fakeFile,
    kind: 'photo',
    projectId: 'PRJ-100',
    userUid: 'user-abc',
    uploadFn: mockUploadFn,
    recordMetadataFn: mockRecordMetadataFn,
    deleteStorageFn: mockDeleteStorageFn
  });

  assert.equal(result.ok, false);
  assert.equal(result.stage, 'storage_upload');
  assert.equal(result.reason, 'network_timeout');
  assert.equal(recordMetadataCalled, false, 'Firestore NO debe llamarse si Storage falla');
  assert.equal(deleteStorageCalled, false, 'No debe intentarse cleanup si nada subió');
  assert.equal(result.evidenceItem, null);
});

test('2. Storage OK + Firestore OK -> evidencia completada y visible en lista unificada', async () => {
  let recordedItem = null;
  let deleteStorageCalled = false;

  const fakeFile = new File(['fake image bytes'], 'inspeccion_obra.jpg', { type: 'image/jpeg' });

  const mockUploadFn = async (file, ctx) => {
    return {
      ok: true,
      fileId: 'EV-999',
      storagePath: `levantamiento-media/${ctx.userUid}/${ctx.projectId}/photo/EV-999/inspeccion_obra.jpg`,
      downloadUrl: 'https://storage.googleapis.com/test-bucket/inspeccion_obra.jpg',
      fileName: 'inspeccion_obra.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1200
    };
  };

  const mockRecordMetadataFn = async (item) => {
    recordedItem = item;
    return { ok: true };
  };

  const mockDeleteStorageFn = async () => {
    deleteStorageCalled = true;
  };

  const result = await uploadEvidenceWithCompensation({
    file: fakeFile,
    kind: 'photo',
    projectId: 'PRJ-100',
    userUid: 'user-abc',
    metadata: { cameraModel: 'MobileCam' },
    uploadFn: mockUploadFn,
    recordMetadataFn: mockRecordMetadataFn,
    deleteStorageFn: mockDeleteStorageFn
  });

  assert.equal(result.ok, true);
  assert.equal(result.stage, 'completed');
  assert.ok(result.evidenceItem);
  assert.equal(result.evidenceItem.id, 'EV-999');
  assert.equal(result.evidenceItem.projectId, 'PRJ-100');
  assert.equal(result.evidenceItem.metadata.cameraModel, 'MobileCam');
  assert.equal(deleteStorageCalled, false, 'No debe eliminarse de Storage si todo tuvo éxito');
  assert.deepEqual(recordedItem, result.evidenceItem);

  // Verificar que la lista unificada la incorpora inmediatamente
  const list = buildProjectEvidenceList({
    projectId: 'PRJ-100',
    evidenceItems: [result.evidenceItem],
    surveys: [],
    planos: []
  });

  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'ev-EV-999');
  assert.equal(list[0].sourceRecordId, 'EV-999');
  assert.equal(list[0].name, 'inspeccion_obra.jpg');
});

test('3. Storage OK + Firestore FAIL -> reintentos, cleanup solicitado en Storage y evidencia NO visible', async () => {
  let attempts = 0;
  let deletedPath = null;

  const fakeFile = new File(['fake video'], 'recorrido.mp4', { type: 'video/mp4' });

  const mockUploadFn = async (file, ctx) => {
    return {
      ok: true,
      fileId: 'EV-888',
      storagePath: `levantamiento-media/${ctx.userUid}/${ctx.projectId}/video/EV-888/recorrido.mp4`,
      downloadUrl: 'https://storage.googleapis.com/test-bucket/recorrido.mp4',
      fileName: 'recorrido.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 8500
    };
  };

  const mockRecordMetadataFn = async () => {
    attempts++;
    throw new Error('Firestore write timeout error (DEADLINE_EXCEEDED)');
  };

  const mockDeleteStorageFn = async (path) => {
    deletedPath = path;
    return { ok: true };
  };

  const result = await uploadEvidenceWithCompensation({
    file: fakeFile,
    kind: 'video',
    projectId: 'PRJ-100',
    userUid: 'user-abc',
    uploadFn: mockUploadFn,
    recordMetadataFn: mockRecordMetadataFn,
    deleteStorageFn: mockDeleteStorageFn,
    maxRetries: 2
  });

  // Verificaciones de rollback
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'firestore_metadata');
  assert.equal(attempts, 3, 'Debe realizar el intento inicial + 2 reintentos controlados');
  assert.equal(result.cleanupAttempted, true);
  assert.equal(result.cleanupSuccess, true);
  assert.equal(result.isOrphan, false);
  assert.equal(deletedPath, 'levantamiento-media/user-abc/PRJ-100/video/EV-888/recorrido.mp4', 'Debe solicitar borrar el path exacto en Storage');
  assert.equal(result.evidenceItem, null, 'No debe retornar un evidenceItem persistido');

  // Si intentáramos construir la lista sin un evidenceItem válido (o con un arreglo vacío), la lista queda vacía
  const list = buildProjectEvidenceList({
    projectId: 'PRJ-100',
    evidenceItems: [],
    surveys: [],
    planos: []
  });

  assert.equal(list.length, 0, 'La galería no debe mostrar ninguna evidencia');
});

test('4. metadata falla + cleanup falla -> error controlado, se diagnostica huérfano y NO se expone evidencia', async () => {
  let attempts = 0;
  let deleteAttemptedOn = null;

  const fakeFile = new File(['fake 3d'], 'edificio.glb', { type: 'model/gltf-binary' });

  const mockUploadFn = async (file, ctx) => {
    return {
      ok: true,
      fileId: 'EV-777',
      storagePath: `levantamiento-media/${ctx.userUid}/${ctx.projectId}/3d/EV-777/edificio.glb`,
      downloadUrl: 'https://storage.googleapis.com/test-bucket/edificio.glb',
      fileName: 'edificio.glb',
      mimeType: 'model/gltf-binary',
      sizeBytes: 150000
    };
  };

  const mockRecordMetadataFn = async () => {
    attempts++;
    throw new Error('Permiso denegado en Firestore (PERMISSION_DENIED)');
  };

  const mockDeleteStorageFn = async (path) => {
    deleteAttemptedOn = path;
    throw new Error('Error al conectar con Storage para borrado');
  };

  const result = await uploadEvidenceWithCompensation({
    file: fakeFile,
    kind: '3d',
    projectId: 'PRJ-100',
    userUid: 'user-abc',
    uploadFn: mockUploadFn,
    recordMetadataFn: mockRecordMetadataFn,
    deleteStorageFn: mockDeleteStorageFn,
    maxRetries: 1
  });

  assert.equal(result.ok, false);
  assert.equal(result.stage, 'firestore_metadata');
  assert.equal(attempts, 2);
  assert.equal(result.cleanupAttempted, true);
  assert.equal(result.cleanupSuccess, false);
  assert.equal(result.isOrphan, true, 'Debe marcar isOrphan=true para diagnóstico de mantenimiento');
  assert.equal(deleteAttemptedOn, 'levantamiento-media/user-abc/PRJ-100/3d/EV-777/edificio.glb');
  assert.equal(result.evidenceItem, null);
});
