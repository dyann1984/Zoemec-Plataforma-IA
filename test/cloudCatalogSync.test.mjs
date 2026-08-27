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
});
