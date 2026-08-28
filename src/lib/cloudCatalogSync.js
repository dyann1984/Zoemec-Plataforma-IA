/* Interfaz + implementacion de sincronizacion de catalogo estructurado
   (punto 14 del spec del usuario; Prioridad 5 de la fase de correccion).
   ESTADO REAL, sin fingir mas de lo que hay:

   - La arquitectura es: Biblioteca ZOEMEC (Firestore `library` +
     src/domain/libraryReview.js) <-> CloudCatalogSync (este archivo,
     resuelve conflicto/dedup/estado, agnostico de proveedor) <->
     OneDriveAdapter (createOneDriveCatalogProvider abajo, envuelve las
     acciones REST reales de api/onedrive.mjs: listFolder/ensureFolder/
     uploadFile/importFile, ya extendidas en esta misma fase con carpeta
     configurable, navegacion de subcarpetas, escritura y deteccion de
     cambios por eTag).
   - OneDrive NUNCA es la base de datos principal: sigue siendo Firestore
     (`library`) la fuente operacional; OneDrive es fuente/sincronizacion/
     documentacion -- createOneDriveCatalogProvider solo lee/escribe
     ARCHIVOS hacia/desde esa carpeta, la promocion a catalogo real sigue
     pasando por la revision humana existente (libraryReview.js).
   - La logica de conflicto/dedup/estado (resolveSyncState/
     oneDriveDedupeKey) es PURA y esta probada sin red. El adaptador de
     OneDrive en si (llamadas fetch reales a /api/onedrive) NO se probo
     contra Microsoft Graph real -- no hay credenciales en este entorno de
     desarrollo (ONEDRIVE_CLIENT_ID/SECRET no configuradas). Se deja
     preparado, no se simula una prueba en vivo que no ocurrio. */

export const SYNC_STATE = Object.freeze({
  SINCRONIZADO: 'SINCRONIZADO',
  PENDIENTE: 'PENDIENTE',
  CONFLICTO: 'CONFLICTO',
  ERROR: 'ERROR',
  NO_CONFIGURADO: 'NO_CONFIGURADO'
});

/* Resuelve el estado de sincronizacion de UN registro comparando la fecha
   local conocida contra los metadatos remotos reales (eTag/fecha de
   OneDrive) y la fecha de la ULTIMA sincronizacion exitosa. Puro, sin red.

   Regla explicita del spec (punto 14, "resolucion EXPLICITA de conflictos"):
   si AMBOS lados cambiaron desde la ultima sincronizacion conocida, es
   CONFLICTO -- nunca se asume "el mas reciente gana" automaticamente. Solo
   cuando UN lado cambio se puede sincronizar sin intervencion. */
export function resolveSyncState({ localUpdatedAt, remoteUpdatedAt, lastSyncedAt } = {}){
  if(!remoteUpdatedAt) return SYNC_STATE.NO_CONFIGURADO;
  const remote = new Date(remoteUpdatedAt).getTime();
  const local = localUpdatedAt ? new Date(localUpdatedAt).getTime() : null;
  const lastSync = lastSyncedAt ? new Date(lastSyncedAt).getTime() : null;
  if(lastSync == null) return SYNC_STATE.PENDIENTE; // primera sincronizacion: nada que comparar todavia
  const remoteChanged = remote > lastSync;
  const localChanged = local != null && local > lastSync;
  if(remoteChanged && localChanged) return SYNC_STATE.CONFLICTO;
  if(remoteChanged || localChanged) return SYNC_STATE.PENDIENTE;
  return SYNC_STATE.SINCRONIZADO;
}

/* Clave de deduplicacion por archivo remoto de OneDrive -- evita crear un
   documento de Biblioteca duplicado para el MISMO archivo (mismo criterio
   que driveFileId en google-drive.mjs, aplicado a OneDrive). La aplicacion
   real de esta clave (consulta a Firestore por oneDriveItemId antes de
   crear) vive en api/onedrive.mjs#importFile -- aqui solo se expone la
   forma de la clave para quien necesite comparar en el cliente. */
export function oneDriveDedupeKey(itemId){
  return itemId ? `onedrive:${itemId}` : null;
}

/* Forma que debe implementar cualquier proveedor real:
   {
     name: string,
     available: boolean,
     async listRemoteCatalogItems(): CatalogSyncRecord[],
     async pushCatalogItem(item): CatalogSyncRecord,
     async pullCatalogItem(remoteId): CatalogSyncRecord
   }
   CatalogSyncRecord: { item, origen, fechaSincronizacion, version,
   ultimaActualizacion, conflicto: boolean, estado: SYNC_STATE }. */
export const NullCloudCatalogProvider = Object.freeze({
  name: 'none',
  available: false,
  async listRemoteCatalogItems(){ return []; },
  async pushCatalogItem(item){ return wrapUnavailable(item); },
  async pullCatalogItem(){ return null; }
});

function wrapUnavailable(item){
  return {
    item, origen: null, fechaSincronizacion: null, version: null, ultimaActualizacion: null, conflicto: false, estado: SYNC_STATE.NO_CONFIGURADO,
    // Forma completa siempre presente (nunca `undefined`) para que quien
    // consuma un CatalogSyncRecord no tenga que distinguir por caso -- ver
    // los mismos 6 campos en pushCatalogItem/pullCatalogItem abajo.
    remoteEtag: null, localVersion: item?.localVersion ?? null, remoteModifiedAt: null, localModifiedAt: item?.localModifiedAt ?? null,
    syncStatus: SYNC_STATE.NO_CONFIGURADO, conflictReason: null
  };
}

/* Adaptador real de OneDrive (Prioridad 5): envuelve las acciones REST ya
   extendidas de api/onedrive.mjs. `apiPost` se inyecta (mismo helper que ya
   usa main.jsx para llamar /api/onedrive) para no acoplar este modulo a
   React ni duplicar el cliente HTTP. `available` refleja el estado REAL
   reportado por el servidor (configured && connected), nunca se asume. */
export function createOneDriveCatalogProvider({ apiPost, folderPath } = {}){
  let cachedStatus = null;
  const ensureStatus = async () => {
    if(!cachedStatus) cachedStatus = await apiPost('/api/onedrive', { action: 'status' });
    return cachedStatus;
  };
  return {
    name: 'onedrive',
    get available(){ return Boolean(cachedStatus?.configured && cachedStatus?.connected); },
    async init(){ cachedStatus = await ensureStatus(); return cachedStatus; },
    async listRemoteCatalogItems(){
      const status = await ensureStatus();
      if(!status.configured || !status.connected) return [];
      const path = folderPath || status.folderPath;
      const data = await apiPost('/api/onedrive', { action: 'listFolder', folderPath: path });
      if(data.notFound) return [];
      return data.items.filter(it => !it.folder).map(it => ({
        item: { name: it.name, remoteId: it.id },
        origen: 'onedrive',
        fechaSincronizacion: new Date().toISOString(),
        version: it.eTag || null,
        ultimaActualizacion: it.lastModifiedDateTime || null,
        conflicto: false,
        estado: resolveSyncState({ remoteUpdatedAt: it.lastModifiedDateTime, lastSyncedAt: status.lastSyncedAt })
      }));
    },
    /* item puede declarar remoteEtag (el ultimo que el llamador SI vio) y,
       tras un CONFLICTO ya reportado, `resolution: 'local'|'remote'|
       'version'` -- la eleccion EXPLICITA de un humano, nunca automatica
       (ver api/onedrive.mjs#uploadFile y _oneDriveConflict.mjs). Sin
       remoteEtag (primera vez que se sincroniza este archivo), la subida
       procede sin condicion, igual que antes de esta correccion. */
    async pushCatalogItem(item){
      const status = await ensureStatus();
      if(!status.configured || !status.connected) return wrapUnavailable(item);
      await apiPost('/api/onedrive', { action: 'ensureFolder', folderPath: folderPath || status.folderPath });
      const result = await apiPost('/api/onedrive', {
        action: 'uploadFile',
        name: item.name,
        contentBase64: item.contentBase64,
        folderPath: folderPath || status.folderPath,
        remoteEtag: item.remoteEtag || null,
        resolution: item.resolution || undefined
      });
      if(result.conflict){
        // CONFLICTO real reportado por el servidor: NUNCA se sobrescribio
        // nada. Se conserva la metadata de ambos lados (remota REAL, local
        // tal como el llamador la declaro) para que la resolucion quede en
        // manos de un humano despues -- nunca "el mas reciente gana" en
        // silencio.
        return {
          item, origen: 'onedrive', fechaSincronizacion: new Date().toISOString(),
          version: null, ultimaActualizacion: null, conflicto: true, estado: SYNC_STATE.CONFLICTO,
          remoteEtag: result.remote?.eTag || null,
          localVersion: item.localVersion ?? item.remoteEtag ?? null,
          remoteModifiedAt: result.remote?.lastModifiedDateTime || null,
          localModifiedAt: item.localModifiedAt ?? null,
          syncStatus: SYNC_STATE.CONFLICTO,
          conflictReason: result.conflictReason || 'ETAG_MISMATCH'
        };
      }
      return {
        item, origen: 'onedrive', fechaSincronizacion: new Date().toISOString(),
        version: result.eTag || null, ultimaActualizacion: result.lastModifiedDateTime || null,
        conflicto: false, estado: SYNC_STATE.SINCRONIZADO,
        remoteEtag: result.eTag || null,
        localVersion: item.localVersion ?? null,
        remoteModifiedAt: result.lastModifiedDateTime || null,
        localModifiedAt: item.localModifiedAt ?? null,
        syncStatus: SYNC_STATE.SINCRONIZADO,
        conflictReason: null
      };
    },
    async pullCatalogItem(remoteId){
      const status = await ensureStatus();
      if(!status.configured || !status.connected) return null;
      const data = await apiPost('/api/onedrive', { action: 'importFile', id: remoteId });
      return {
        item: { docId: data.docId, name: data.name },
        origen: 'onedrive', fechaSincronizacion: new Date().toISOString(),
        version: data.eTag || null, ultimaActualizacion: data.lastModifiedDateTime || null,
        conflicto: false, estado: data.sinCambios ? SYNC_STATE.SINCRONIZADO : SYNC_STATE.PENDIENTE,
        remoteEtag: data.eTag || null, localVersion: null,
        remoteModifiedAt: data.lastModifiedDateTime || null, localModifiedAt: null,
        syncStatus: data.sinCambios ? SYNC_STATE.SINCRONIZADO : SYNC_STATE.PENDIENTE,
        conflictReason: null
      };
    }
  };
}

/* Registro de proveedores reales. `onedrive` YA es una implementacion real
   (no un stub) pero requiere inyectar `apiPost` -- ver
   getCloudCatalogProvider. Sin esa inyeccion (uso por defecto), se comporta
   como NullCloudCatalogProvider. */
export const CLOUD_CATALOG_PROVIDERS = Object.freeze({
  onedrive: createOneDriveCatalogProvider
});

export function getCloudCatalogProvider(name, options){
  const factory = name && CLOUD_CATALOG_PROVIDERS[name];
  if(!factory) return NullCloudCatalogProvider;
  if(!options?.apiPost) return NullCloudCatalogProvider; // sin transporte inyectado, no hay proveedor real posible
  return factory(options);
}
