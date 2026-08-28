import test from 'node:test';
import assert from 'node:assert/strict';
import { NullCloudCatalogProvider, CLOUD_CATALOG_PROVIDERS, getCloudCatalogProvider, SYNC_STATE, resolveSyncState, oneDriveDedupeKey, createOneDriveCatalogProvider } from '../src/lib/cloudCatalogSync.js';

test('NullCloudCatalogProvider: nunca reporta disponibilidad ni inventa registros remotos', async () => {
  assert.equal(NullCloudCatalogProvider.available, false);
  assert.deepEqual(await NullCloudCatalogProvider.listRemoteCatalogItems(), []);
  const pushed = await NullCloudCatalogProvider.pushCatalogItem({ desc: 'x' });
  assert.equal(pushed.estado, SYNC_STATE.NO_CONFIGURADO);
  assert.equal(await NullCloudCatalogProvider.pullCatalogItem('id'), null);
});

test('CLOUD_CATALOG_PROVIDERS: onedrive YA es una implementacion real (Prioridad 5), registrada por nombre', () => {
  assert.deepEqual(Object.keys(CLOUD_CATALOG_PROVIDERS), ['onedrive']);
  assert.equal(typeof CLOUD_CATALOG_PROVIDERS.onedrive, 'function');
});

test('getCloudCatalogProvider: sin `apiPost` inyectado, cae a NullCloudCatalogProvider (nunca finge estar conectado)', () => {
  assert.equal(getCloudCatalogProvider(), NullCloudCatalogProvider);
  assert.equal(getCloudCatalogProvider('onedrive'), NullCloudCatalogProvider);
  assert.equal(getCloudCatalogProvider('proveedor-inexistente', { apiPost: async () => ({}) }), NullCloudCatalogProvider);
});

test('getCloudCatalogProvider: con `apiPost` inyectado, "onedrive" resuelve a un proveedor real', () => {
  const provider = getCloudCatalogProvider('onedrive', { apiPost: async () => ({}) });
  assert.equal(provider.name, 'onedrive');
  assert.equal(provider.available, false); // hasta no llamar status/init, nunca se asume disponible
});

// --- resolveSyncState: logica pura de conflicto, sin red ---
test('resolveSyncState: sin fecha remota, NO_CONFIGURADO', () => {
  assert.equal(resolveSyncState({}), SYNC_STATE.NO_CONFIGURADO);
});

test('resolveSyncState: primera sincronizacion (sin lastSyncedAt), PENDIENTE -- nada que comparar todavia', () => {
  assert.equal(resolveSyncState({ remoteUpdatedAt: '2026-08-20T10:00:00Z' }), SYNC_STATE.PENDIENTE);
});

test('resolveSyncState: nada cambio desde la ultima sincronizacion, SINCRONIZADO', () => {
  const lastSyncedAt = '2026-08-20T10:00:00Z';
  assert.equal(resolveSyncState({ remoteUpdatedAt: '2026-08-19T10:00:00Z', localUpdatedAt: '2026-08-19T09:00:00Z', lastSyncedAt }), SYNC_STATE.SINCRONIZADO);
});

test('resolveSyncState: solo el remoto cambio, PENDIENTE (se puede sincronizar sin intervencion)', () => {
  const lastSyncedAt = '2026-08-20T10:00:00Z';
  assert.equal(resolveSyncState({ remoteUpdatedAt: '2026-08-21T10:00:00Z', localUpdatedAt: '2026-08-19T09:00:00Z', lastSyncedAt }), SYNC_STATE.PENDIENTE);
});

test('resolveSyncState: solo el local cambio, PENDIENTE', () => {
  const lastSyncedAt = '2026-08-20T10:00:00Z';
  assert.equal(resolveSyncState({ remoteUpdatedAt: '2026-08-19T09:00:00Z', localUpdatedAt: '2026-08-21T10:00:00Z', lastSyncedAt }), SYNC_STATE.PENDIENTE);
});

test('resolveSyncState: AMBOS lados cambiaron desde la ultima sincronizacion -- CONFLICTO explicito, nunca "el mas reciente gana" en silencio', () => {
  const lastSyncedAt = '2026-08-20T10:00:00Z';
  assert.equal(resolveSyncState({ remoteUpdatedAt: '2026-08-21T10:00:00Z', localUpdatedAt: '2026-08-21T11:00:00Z', lastSyncedAt }), SYNC_STATE.CONFLICTO);
});

test('oneDriveDedupeKey: forma estable de la clave, null sin id', () => {
  assert.equal(oneDriveDedupeKey('ABC123'), 'onedrive:ABC123');
  assert.equal(oneDriveDedupeKey(null), null);
});

// --- createOneDriveCatalogProvider: comportamiento con apiPost simulado
// (nunca contra Microsoft Graph real -- no hay credenciales en este
// entorno). Esto prueba la LOGICA del adaptador, no conectividad real. ---
test('createOneDriveCatalogProvider: sin configurar/conectar (status real del servidor), listRemoteCatalogItems regresa vacio, nunca inventa archivos', async () => {
  const calls = [];
  const apiPost = async (url, body) => { calls.push({ url, body }); return { configured: false, connected: false }; };
  const provider = createOneDriveCatalogProvider({ apiPost });
  const items = await provider.listRemoteCatalogItems();
  assert.deepEqual(items, []);
  assert.equal(calls[0].body.action, 'status');
});

test('createOneDriveCatalogProvider: conectado, listRemoteCatalogItems mapea items reales del servidor con su estado de sincronizacion', async () => {
  const apiPost = async (url, body) => {
    if(body.action === 'status') return { configured: true, connected: true, folderPath: '/ZOEMEC/Biblioteca', lastSyncedAt: '2026-08-20T10:00:00Z' };
    if(body.action === 'listFolder') return { notFound: false, items: [{ id: '1', name: 'a.xlsx', folder: false, eTag: 'e1', lastModifiedDateTime: '2026-08-19T00:00:00Z' }] };
    throw new Error('accion inesperada: ' + body.action);
  };
  const provider = createOneDriveCatalogProvider({ apiPost });
  const items = await provider.listRemoteCatalogItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].item.name, 'a.xlsx');
  assert.equal(items[0].version, 'e1');
  assert.equal(items[0].estado, SYNC_STATE.SINCRONIZADO);
});

test('createOneDriveCatalogProvider: pushCatalogItem sin conexion regresa NO_CONFIGURADO, nunca finge un push exitoso', async () => {
  const apiPost = async () => ({ configured: false, connected: false });
  const provider = createOneDriveCatalogProvider({ apiPost });
  const result = await provider.pushCatalogItem({ name: 'x.xlsx', contentBase64: 'AAAA' });
  assert.equal(result.estado, SYNC_STATE.NO_CONFIGURADO);
  assert.equal(result.syncStatus, SYNC_STATE.NO_CONFIGURADO);
  assert.equal(result.remoteEtag, null);
  assert.equal(result.conflictReason, null);
});

// --- Gap real corregido (QA de OneDrive): control optimista de
// concurrencia por eTag/If-Match. Estos tests simulan la respuesta REAL que
// api/onedrive.mjs#uploadFile ya produce (ver ese archivo) inyectando
// apiPost -- no hay credenciales de OneDrive en este entorno para probar
// contra Microsoft Graph real, pero la logica de propagacion/decision del
// adaptador SI es 100% real y se prueba aqui sin red. ---
function fakeServerFolder(){
  // Simula el "estado real" del archivo en OneDrive dentro de la prueba:
  // un solo eTag vigente que cambia cuando alguien mas escribe el archivo
  // (equivalente a lo que Microsoft Graph resolveria con If-Match).
  return { currentEtag: '"e1"', currentModifiedAt: '2026-08-20T10:00:00Z', name: 'catalogo.xlsx' };
}

test('pushCatalogItem: escritura SIN conflicto (primera vez, sin remoteEtag conocido) -- sube directo y reporta SINCRONIZADO', async () => {
  const server = fakeServerFolder();
  const calls = [];
  const apiPost = async (url, body) => {
    calls.push(body);
    if(body.action === 'status') return { configured: true, connected: true, folderPath: '/ZOEMEC/Biblioteca' };
    if(body.action === 'ensureFolder') return { ok: true };
    if(body.action === 'uploadFile'){
      server.currentEtag = '"e2"';
      server.currentModifiedAt = '2026-08-21T10:00:00Z';
      return { ok: true, conflict: false, id: 'item1', name: server.name, eTag: server.currentEtag, lastModifiedDateTime: server.currentModifiedAt };
    }
    throw new Error('accion inesperada: ' + body.action);
  };
  const provider = createOneDriveCatalogProvider({ apiPost });
  const result = await provider.pushCatalogItem({ name: 'catalogo.xlsx', contentBase64: 'AAAA' });
  assert.equal(result.conflicto, false);
  assert.equal(result.estado, SYNC_STATE.SINCRONIZADO);
  assert.equal(result.syncStatus, SYNC_STATE.SINCRONIZADO);
  assert.equal(result.remoteEtag, '"e2"');
  assert.equal(result.remoteModifiedAt, '2026-08-21T10:00:00Z');
  assert.equal(result.conflictReason, null);
  const uploadCall = calls.find(c => c.action === 'uploadFile');
  assert.equal(uploadCall.remoteEtag, null, 'sin eTag conocido, el adaptador no inventa uno');
});

test('pushCatalogItem: escritura CON el eTag remoto correcto -- se declara If-Match (server lo acepta) y sincroniza sin conflicto', async () => {
  const server = fakeServerFolder();
  const apiPost = async (url, body) => {
    if(body.action === 'status') return { configured: true, connected: true, folderPath: '/ZOEMEC/Biblioteca' };
    if(body.action === 'ensureFolder') return { ok: true };
    if(body.action === 'uploadFile'){
      // Mismo comportamiento que Microsoft Graph con If-Match correcto: el
      // eTag que el llamador declara SI coincide con el vigente -> escribe.
      assert.equal(body.remoteEtag, server.currentEtag);
      server.currentEtag = '"e2"';
      server.currentModifiedAt = '2026-08-21T10:00:00Z';
      return { ok: true, conflict: false, id: 'item1', name: server.name, eTag: server.currentEtag, lastModifiedDateTime: server.currentModifiedAt };
    }
    throw new Error('accion inesperada: ' + body.action);
  };
  const provider = createOneDriveCatalogProvider({ apiPost });
  const result = await provider.pushCatalogItem({ name: 'catalogo.xlsx', contentBase64: 'BBBB', remoteEtag: server.currentEtag, localModifiedAt: '2026-08-21T09:00:00Z' });
  assert.equal(result.conflicto, false);
  assert.equal(result.estado, SYNC_STATE.SINCRONIZADO);
  assert.equal(result.remoteEtag, '"e2"');
  assert.equal(result.localModifiedAt, '2026-08-21T09:00:00Z', 'localModifiedAt declarado por el llamador se propaga tal cual');
});

test('pushCatalogItem: el eTag remoto CAMBIO desde la ultima vez que el llamador lo vio -- CONFLICTO explicito, nunca sobrescribe', async () => {
  const server = fakeServerFolder();
  // Alguien mas ya escribio el archivo: el eTag vigente ya no es el que el
  // llamador conoce.
  server.currentEtag = '"e2-otro-usuario"';
  server.currentModifiedAt = '2026-08-22T08:00:00Z';
  const contentWritten = { value: false };
  const apiPost = async (url, body) => {
    if(body.action === 'status') return { configured: true, connected: true, folderPath: '/ZOEMEC/Biblioteca' };
    if(body.action === 'ensureFolder') return { ok: true };
    if(body.action === 'uploadFile'){
      // El llamador declara el eTag VIEJO (el que el conocia) -- no coincide
      // con el vigente -> Microsoft Graph (simulado) rechaza con conflicto,
      // exactamente como responde la version real de api/onedrive.mjs.
      if(body.remoteEtag !== server.currentEtag){
        return { ok: false, conflict: true, conflictReason: 'ETAG_MISMATCH', remote: { id: 'item1', name: server.name, eTag: server.currentEtag, lastModifiedDateTime: server.currentModifiedAt }, local: { name: body.name, expectedEtag: body.remoteEtag } };
      }
      contentWritten.value = true; // nunca deberia llegar aqui en este test
      return { ok: true, conflict: false, id: 'item1', name: server.name, eTag: '"e3"' };
    }
    throw new Error('accion inesperada: ' + body.action);
  };
  const provider = createOneDriveCatalogProvider({ apiPost });
  const result = await provider.pushCatalogItem({ name: 'catalogo.xlsx', contentBase64: 'CCCC', remoteEtag: '"e1"', localModifiedAt: '2026-08-22T09:00:00Z' });
  assert.equal(result.conflicto, true);
  assert.equal(result.estado, SYNC_STATE.CONFLICTO);
  assert.equal(result.syncStatus, SYNC_STATE.CONFLICTO);
  assert.equal(result.conflictReason, 'ETAG_MISMATCH');
  // Metadata de AMBOS lados conservada para resolucion humana posterior:
  assert.equal(result.remoteEtag, '"e2-otro-usuario"', 'debe traer el eTag remoto REAL, no el que el llamador esperaba');
  assert.equal(result.remoteModifiedAt, '2026-08-22T08:00:00Z');
  assert.equal(result.localModifiedAt, '2026-08-22T09:00:00Z');
  // NUNCA se marca como sincronizado ni se reporta una version nueva:
  assert.equal(result.version, null);
  assert.equal(result.ultimaActualizacion, null);
  assert.equal(contentWritten.value, false, 'el contenido remoto NUNCA debe sobrescribirse cuando hay conflicto');
});

test('pushCatalogItem: resolucion EXPLICITA "usar local" -- fuerza la escritura tras un conflicto ya reportado, nunca automatico', async () => {
  const server = fakeServerFolder();
  server.currentEtag = '"e2-otro-usuario"';
  const apiPost = async (url, body) => {
    if(body.action === 'status') return { configured: true, connected: true, folderPath: '/ZOEMEC/Biblioteca' };
    if(body.action === 'ensureFolder') return { ok: true };
    if(body.action === 'uploadFile'){
      assert.equal(body.resolution, 'local', 'la resolucion debe declararse explicitamente, nunca asumirse');
      // resolucion 'local': el servidor (real) omite If-Match y escribe sin
      // condicion -- aqui se simula ese resultado.
      server.currentEtag = '"e3-forzado-local"';
      server.currentModifiedAt = '2026-08-22T10:00:00Z';
      return { ok: true, conflict: false, resolution: 'local', id: 'item1', name: server.name, eTag: server.currentEtag, lastModifiedDateTime: server.currentModifiedAt };
    }
    throw new Error('accion inesperada: ' + body.action);
  };
  const provider = createOneDriveCatalogProvider({ apiPost });
  const result = await provider.pushCatalogItem({ name: 'catalogo.xlsx', contentBase64: 'DDDD', remoteEtag: '"e1"', resolution: 'local' });
  assert.equal(result.conflicto, false);
  assert.equal(result.estado, SYNC_STATE.SINCRONIZADO);
  assert.equal(result.remoteEtag, '"e3-forzado-local"');
});

test('pushCatalogItem: resolucion EXPLICITA "usar remoto" -- no escribe nada, solo reporta la metadata remota real', async () => {
  const server = fakeServerFolder();
  server.currentEtag = '"e2-otro-usuario"';
  server.currentModifiedAt = '2026-08-22T08:00:00Z';
  let uploadFileCalled = false;
  const apiPost = async (url, body) => {
    if(body.action === 'status') return { configured: true, connected: true, folderPath: '/ZOEMEC/Biblioteca' };
    if(body.action === 'ensureFolder') return { ok: true };
    if(body.action === 'uploadFile'){
      uploadFileCalled = true;
      assert.equal(body.resolution, 'remote');
      // resolucion 'remote' (real, ver api/onedrive.mjs): nunca escribe, solo
      // regresa la metadata remota vigente tal cual.
      return { ok: true, conflict: false, resolution: 'remote', id: 'item1', name: server.name, eTag: server.currentEtag, lastModifiedDateTime: server.currentModifiedAt };
    }
    throw new Error('accion inesperada: ' + body.action);
  };
  const provider = createOneDriveCatalogProvider({ apiPost });
  const result = await provider.pushCatalogItem({ name: 'catalogo.xlsx', contentBase64: 'EEEE', remoteEtag: '"e1"', resolution: 'remote' });
  assert.equal(uploadFileCalled, true);
  assert.equal(result.conflicto, false);
  assert.equal(result.estado, SYNC_STATE.SINCRONIZADO);
  assert.equal(result.remoteEtag, '"e2-otro-usuario"', 'se conserva el eTag REMOTO tal cual, el local se descarta');
  assert.equal(result.remoteModifiedAt, '2026-08-22T08:00:00Z');
});

test('pullCatalogItem: deduplicacion por oneDriveItemId -- el servidor reporta sinCambios y el adaptador lo refleja como SINCRONIZADO (nunca como una importacion nueva)', async () => {
  const apiPost = async (url, body) => {
    if(body.action === 'status') return { configured: true, connected: true, folderPath: '/ZOEMEC/Biblioteca' };
    if(body.action === 'importFile'){
      // Mismo archivo (oneDriveItemId) ya importado antes con el MISMO eTag
      // -- api/onedrive.mjs#importFile ya deduplica por oneDriveItemId+eTag
      // y regresa sinCambios:true sin descargar ni crear un documento nuevo.
      return { ok: true, docId: 'doc-existente-1', downloadURL: 'https://x/y', name: 'catalogo.xlsx', sinCambios: true, eTag: '"e1"', lastModifiedDateTime: '2026-08-20T10:00:00Z' };
    }
    throw new Error('accion inesperada: ' + body.action);
  };
  const provider = createOneDriveCatalogProvider({ apiPost });
  const result = await provider.pullCatalogItem('remote-item-1');
  assert.equal(result.item.docId, 'doc-existente-1');
  assert.equal(result.estado, SYNC_STATE.SINCRONIZADO);
  assert.equal(result.syncStatus, SYNC_STATE.SINCRONIZADO);
  assert.equal(result.remoteEtag, '"e1"');
});

test('pullCatalogItem: archivo NUEVO (sin dedup posible) queda PENDIENTE, con su eTag/fecha remota propagados', async () => {
  const apiPost = async (url, body) => {
    if(body.action === 'status') return { configured: true, connected: true, folderPath: '/ZOEMEC/Biblioteca' };
    if(body.action === 'importFile') return { ok: true, docId: 'doc-nuevo-1', downloadURL: 'https://x/y', name: 'nuevo.xlsx', actualizado: false, eTag: '"n1"', lastModifiedDateTime: '2026-08-23T10:00:00Z' };
    throw new Error('accion inesperada: ' + body.action);
  };
  const provider = createOneDriveCatalogProvider({ apiPost });
  const result = await provider.pullCatalogItem('remote-item-2');
  assert.equal(result.estado, SYNC_STATE.PENDIENTE);
  assert.equal(result.remoteEtag, '"n1"');
  assert.equal(result.remoteModifiedAt, '2026-08-23T10:00:00Z');
});
