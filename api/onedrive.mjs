import { FieldValue, getAdminDb, getAdminStorage } from '../server/api-lib/_firebaseAdmin.mjs';
import { requireFeature } from '../server/api-lib/_authGuard.mjs';
import { assertAllowedFile, sanitizeFileName } from '../server/api-lib/_libraryClassify.mjs';
import { isConflictStatus, buildUploadHeaders, uploadFileName } from '../server/api-lib/_oneDriveConflict.mjs';

/* Backend real de la conexion con OneDrive (Microsoft Graph). El client secret
   de la app registrada en Azure AD solo puede vivir aqui, nunca en el navegador.
   Sin ONEDRIVE_CLIENT_ID/ONEDRIVE_CLIENT_SECRET configurados en Vercel, cada
   accion regresa un error honesto: "Requiere integracion", nunca una conexion
   simulada. */
const TENANT = process.env.ONEDRIVE_TENANT_ID || 'common';
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

function hasOneDriveCredentials(){
  return Boolean(process.env.ONEDRIVE_CLIENT_ID && process.env.ONEDRIVE_CLIENT_SECRET);
}

async function exchangeCodeForTokens({ code, verifier, redirectUri }){
  const body = new URLSearchParams({
    client_id: process.env.ONEDRIVE_CLIENT_ID,
    client_secret: process.env.ONEDRIVE_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier
  });
  const res = await fetch(TOKEN_URL, { method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body });
  const data = await res.json();
  if(!res.ok) throw new Error(data.error_description || 'Microsoft rechazo el intercambio de tokens.');
  return data;
}

async function refreshTokens(refreshToken){
  const body = new URLSearchParams({
    client_id: process.env.ONEDRIVE_CLIENT_ID,
    client_secret: process.env.ONEDRIVE_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });
  const res = await fetch(TOKEN_URL, { method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body });
  const data = await res.json();
  if(!res.ok) throw new Error(data.error_description || 'No se pudo renovar la sesion de OneDrive.');
  return data;
}

async function graphMe(accessToken){
  const res = await fetch(`${GRAPH_BASE}/me`, { headers:{ Authorization:`Bearer ${accessToken}` } });
  if(!res.ok) throw new Error('No se pudo consultar la cuenta de Microsoft.');
  return res.json();
}

// Carpeta por defecto de la Biblioteca ZOEMEC dentro del OneDrive del
// usuario (Prioridad 5, fase de correccion: "carpeta configurable"). Puede
// sobreescribirse por usuario (users/{uid}.oneDrive.folderPath); nunca
// hardcodeada mas alla de este default.
const DEFAULT_FOLDER_PATH = '/ZOEMEC/Biblioteca';

function normalizeFolderPath(path){
  const clean = String(path || DEFAULT_FOLDER_PATH).trim().replace(/^\/+|\/+$/g, '');
  return clean || DEFAULT_FOLDER_PATH.replace(/^\/+/, '');
}

/* Crea (si falta) cada segmento de la ruta bajo la raiz del drive, uno por
   uno -- Microsoft Graph no crea rutas anidadas completas de un solo golpe.
   "@microsoft.graph.conflictBehavior":"fail" evita duplicar la carpeta si
   ya existe (se detecta el 409 y se reutiliza, nunca se crea una segunda
   carpeta con el mismo nombre). */
async function ensureFolderPath(accessToken, path){
  const segments = normalizeFolderPath(path).split('/').filter(Boolean);
  let parentId = null; // null = raiz del drive
  for(const name of segments){
    const listUrl = parentId
      ? `${GRAPH_BASE}/me/drive/items/${parentId}/children?$select=id,name,folder`
      : `${GRAPH_BASE}/me/drive/root/children?$select=id,name,folder`;
    const listRes = await fetch(listUrl, { headers:{ Authorization:`Bearer ${accessToken}` } });
    const listData = await listRes.json().catch(() => null);
    if(!listRes.ok) throw new Error(listData?.error?.message || 'No se pudo revisar la carpeta de OneDrive.');
    const existing = (listData.value || []).find(it => it.folder && it.name === name);
    if(existing){ parentId = existing.id; continue; }
    const createUrl = parentId ? `${GRAPH_BASE}/me/drive/items/${parentId}/children` : `${GRAPH_BASE}/me/drive/root/children`;
    const createRes = await fetch(createUrl, {
      method:'POST',
      headers:{ Authorization:`Bearer ${accessToken}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ name, folder:{}, '@microsoft.graph.conflictBehavior':'fail' })
    });
    const createData = await createRes.json().catch(() => null);
    if(!createRes.ok){
      // 409 = ya existe (carrera con otra pestaña/usuario) -- reutilizar, no fallar.
      if(createRes.status === 409){
        const retryRes = await fetch(listUrl, { headers:{ Authorization:`Bearer ${accessToken}` } });
        const retryData = await retryRes.json().catch(() => null);
        const retryFound = (retryData?.value || []).find(it => it.folder && it.name === name);
        if(retryFound){ parentId = retryFound.id; continue; }
      }
      throw new Error(createData?.error?.message || `No se pudo crear la carpeta "${name}" en OneDrive.`);
    }
    parentId = createData.id;
  }
  return parentId;
}

/* Token de acceso valido para el usuario, refrescando y persistiendo el
   refresh_token rotado cuando Microsoft lo reemplaza -- mismo comportamiento
   que ya tenian listRoot/importFile por separado, factorizado aqui para las
   acciones nuevas (listFolder/ensureFolder/uploadFile) sin repetirlo otra
   vez mas. */
async function getValidAccessToken(userRef){
  if(!hasOneDriveCredentials()){
    const error = new Error('OneDrive no esta configurado en este servidor.');
    error.status = 501;
    throw error;
  }
  const snap = await userRef.get();
  const refreshToken = snap.data()?.oneDrive?.refreshToken;
  if(!refreshToken){
    const error = new Error('Esta cuenta todavia no conecto OneDrive.');
    error.status = 409;
    throw error;
  }
  const tokens = await refreshTokens(refreshToken);
  if(tokens.refresh_token && tokens.refresh_token !== refreshToken){
    await userRef.set({ oneDrive:{ refreshToken: tokens.refresh_token } }, { merge:true });
  }
  return tokens.access_token;
}

export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.status(405).json({ error:'Metodo no permitido.' });
    return;
  }
  try{
    const authz = await requireFeature(req, 'library');
    const { action } = req.body || {};
    const db = getAdminDb();
    const userRef = db.collection('users').doc(authz.uid);

    if(action === 'status'){
      const snap = await userRef.get();
      const oneDrive = snap.data()?.oneDrive || null;
      res.status(200).json({
        configured: hasOneDriveCredentials(),
        connected: Boolean(oneDrive?.refreshToken),
        account: oneDrive?.account || '',
        connectedAt: oneDrive?.connectedAt || null,
        folderPath: oneDrive?.folderPath || DEFAULT_FOLDER_PATH,
        lastSyncedAt: oneDrive?.lastSyncedAt || null,
        /* Solo booleanos de presencia (nunca el valor real): sirven para el
           diagnostico del Panel Admin sin exponer secretos. */
        env: {
          ONEDRIVE_CLIENT_ID: Boolean(process.env.ONEDRIVE_CLIENT_ID),
          ONEDRIVE_CLIENT_SECRET: Boolean(process.env.ONEDRIVE_CLIENT_SECRET),
          ONEDRIVE_TENANT_ID: Boolean(process.env.ONEDRIVE_TENANT_ID)
        }
      });
      return;
    }

    if(action === 'setFolderPath'){
      const { folderPath } = req.body || {};
      const clean = '/' + normalizeFolderPath(folderPath);
      await userRef.set({ oneDrive: { folderPath: clean } }, { merge:true });
      res.status(200).json({ ok:true, folderPath: clean });
      return;
    }

    if(action === 'disconnect'){
      await userRef.set({ oneDrive: FieldValue.delete() }, { merge:true });
      res.status(200).json({ ok:true });
      return;
    }

    if(action === 'token'){
      if(!hasOneDriveCredentials()){
        const error = new Error('OneDrive no esta configurado en este servidor: faltan ONEDRIVE_CLIENT_ID/ONEDRIVE_CLIENT_SECRET en Vercel.');
        error.status = 501;
        throw error;
      }
      const { code, verifier, redirectUri } = req.body || {};
      if(!code || !verifier || !redirectUri) throw new Error('Falta el codigo de autorizacion de Microsoft.');
      const tokens = await exchangeCodeForTokens({ code, verifier, redirectUri });
      const me = await graphMe(tokens.access_token).catch(() => null);
      await userRef.set({
        oneDrive: {
          refreshToken: tokens.refresh_token || '',
          account: me?.mail || me?.userPrincipalName || '',
          connectedAt: FieldValue.serverTimestamp()
        }
      }, { merge:true });
      res.status(200).json({ ok:true, account: me?.mail || me?.userPrincipalName || '' });
      return;
    }

    if(action === 'listRoot'){
      if(!hasOneDriveCredentials()){
        const error = new Error('OneDrive no esta configurado en este servidor.');
        error.status = 501;
        throw error;
      }
      const snap = await userRef.get();
      const refreshToken = snap.data()?.oneDrive?.refreshToken;
      if(!refreshToken){
        const error = new Error('Esta cuenta todavia no conecto OneDrive.');
        error.status = 409;
        throw error;
      }
      const tokens = await refreshTokens(refreshToken);
      if(tokens.refresh_token && tokens.refresh_token !== refreshToken){
        await userRef.set({ oneDrive:{ refreshToken: tokens.refresh_token } }, { merge:true });
      }
      const listRes = await fetch(`${GRAPH_BASE}/me/drive/root/children`, { headers:{ Authorization:`Bearer ${tokens.access_token}` } });
      const listData = await listRes.json();
      if(!listRes.ok) throw new Error(listData.error?.message || 'No se pudo listar OneDrive.');
      res.status(200).json({ items: (listData.value || []).map(it => ({ id:it.id, name:it.name, folder:Boolean(it.folder), size:it.size || 0 })) });
      return;
    }

    /* Navegacion de subcarpetas (Prioridad 5, fase de correccion): lista el
       contenido de una RUTA (por defecto la carpeta configurada de
       Biblioteca ZOEMEC, ver DEFAULT_FOLDER_PATH), no solo la raiz. Si la
       carpeta no existe todavia, regresa notFound:true en vez de fallar --
       el cliente puede ofrecer crearla (accion ensureFolder). */
    if(action === 'listFolder'){
      const accessToken = await getValidAccessToken(userRef);
      const snap = await userRef.get();
      const path = normalizeFolderPath(req.body?.folderPath || snap.data()?.oneDrive?.folderPath);
      const listRes = await fetch(`${GRAPH_BASE}/me/drive/root:/${encodeURI(path)}:/children?$select=id,name,folder,size,eTag,lastModifiedDateTime`, {
        headers:{ Authorization:`Bearer ${accessToken}` }
      });
      if(listRes.status === 404){ res.status(200).json({ notFound:true, folderPath:'/'+path, items:[] }); return; }
      const listData = await listRes.json();
      if(!listRes.ok) throw new Error(listData.error?.message || 'No se pudo listar la carpeta de OneDrive.');
      res.status(200).json({
        notFound:false, folderPath:'/'+path,
        items:(listData.value||[]).map(it=>({ id:it.id, name:it.name, folder:Boolean(it.folder), size:it.size||0, eTag:it.eTag||null, lastModifiedDateTime:it.lastModifiedDateTime||null }))
      });
      return;
    }

    /* Crea (si falta) la carpeta configurada -- ver ensureFolderPath arriba.
       Nunca duplica: si ya existe, la reutiliza. */
    if(action === 'ensureFolder'){
      const accessToken = await getValidAccessToken(userRef);
      const snap = await userRef.get();
      const path = req.body?.folderPath || snap.data()?.oneDrive?.folderPath || DEFAULT_FOLDER_PATH;
      const folderId = await ensureFolderPath(accessToken, path);
      res.status(200).json({ ok:true, folderId, folderPath:'/'+normalizeFolderPath(path) });
      return;
    }

    /* ESCRITURA real hacia OneDrive (Prioridad 5): requiere el scope
       Files.ReadWrite (ver src/lib/onedrive.js) -- una cuenta conectada ANTES
       de este cambio de scope debe reconectar (el refresh_token viejo no
       incluye el permiso nuevo, Microsoft lo rechazara con 403 hasta que el
       usuario vuelva a autorizar). Subida simple (PUT :/content): valida
       para archivos <4MB, limite real de la API de Graph para este metodo
       -- un archivo mas grande requeriria una sesion de carga por partes,
       no implementada en esta fase. NUNCA se sube nada sin que el llamador
       pase el contenido explicitamente (nunca se inventa un archivo). */
    if(action === 'uploadFile'){
      const accessToken = await getValidAccessToken(userRef);
      const { name, contentBase64, folderPath, remoteEtag, resolution } = req.body || {};
      if(!name || !contentBase64) throw new Error('Falta el nombre o el contenido del archivo a subir.');
      const safeName = sanitizeFileName(name);
      const buffer = Buffer.from(contentBase64, 'base64');
      if(buffer.length > 4 * 1024 * 1024){
        const error = new Error('Archivo mayor a 4MB: la subida simple de Microsoft Graph no lo soporta en esta fase (requeriria una sesion de carga por partes, no implementada).');
        error.status = 413;
        throw error;
      }
      const path = normalizeFolderPath(folderPath || (await userRef.get()).data()?.oneDrive?.folderPath);
      const itemUrl = `${GRAPH_BASE}/me/drive/root:/${encodeURI(path)}/${encodeURIComponent(safeName)}`;

      /* resolucion EXPLICITA 'remote' (el humano ya eligio conservar lo que
         hay en OneDrive): no se escribe absolutamente nada, solo se
         reporta la metadata remota real -- ver _oneDriveConflict.mjs. */
      if(resolution === 'remote'){
        const metaRes = await fetch(`${itemUrl}:?$select=id,name,eTag,lastModifiedDateTime`, { headers:{ Authorization:`Bearer ${accessToken}` } });
        const meta = await metaRes.json().catch(() => null);
        if(!metaRes.ok || !meta) throw new Error(meta?.error?.message || 'No se pudo leer el archivo remoto para conservarlo tal cual.');
        await userRef.set({ oneDrive:{ lastSyncedAt: FieldValue.serverTimestamp() } }, { merge:true });
        res.status(200).json({ ok:true, conflict:false, resolution:'remote', id:meta.id, name:meta.name, eTag:meta.eTag||null, lastModifiedDateTime:meta.lastModifiedDateTime||null });
        return;
      }

      // Control optimista de concurrencia (gap real corregido, ver reporte
      // de QA de OneDrive): con eTag remoto conocido y sin una resolucion
      // explicita 'local'/'version', se envia If-Match -- Graph rechaza
      // (409/412) si alguien mas cambio el archivo desde entonces. Nunca se
      // asume "el mas reciente gana".
      const headers = buildUploadHeaders({ accessToken, remoteEtag, resolution });
      const uploadName = uploadFileName(safeName, resolution);
      const uploadRes = await fetch(`${GRAPH_BASE}/me/drive/root:/${encodeURI(path)}/${encodeURIComponent(uploadName)}:/content`, {
        method:'PUT', headers, body: buffer
      });
      if(isConflictStatus(uploadRes.status)){
        // CONFLICTO real: el eTag que el llamador conocia ya no es el
        // actual. NUNCA se sobrescribe -- se lee la metadata remota REAL
        // para que quien llama decida (conservar local/conservar
        // remoto/versionar); lastSyncedAt NO se toca, la sincronizacion no
        // termino correctamente.
        const currentMetaRes = await fetch(`${itemUrl}:?$select=id,name,eTag,lastModifiedDateTime`, { headers:{ Authorization:`Bearer ${accessToken}` } });
        const currentMeta = await currentMetaRes.json().catch(() => null);
        res.status(409).json({
          ok:false,
          conflict:true,
          conflictReason:'ETAG_MISMATCH',
          remote: currentMetaRes.ok && currentMeta ? { id:currentMeta.id, name:currentMeta.name, eTag:currentMeta.eTag||null, lastModifiedDateTime:currentMeta.lastModifiedDateTime||null } : null,
          local: { name: safeName, expectedEtag: remoteEtag || null }
        });
        return;
      }
      const uploadData = await uploadRes.json().catch(() => null);
      if(!uploadRes.ok){
        const error = new Error(uploadData?.error?.message || 'No se pudo subir el archivo a OneDrive (revisa que la cuenta haya autorizado escritura).');
        error.status = uploadRes.status;
        throw error;
      }
      await userRef.set({ oneDrive:{ lastSyncedAt: FieldValue.serverTimestamp() } }, { merge:true });
      res.status(200).json({ ok:true, conflict:false, resolution: resolution || null, id:uploadData.id, name:uploadData.name, eTag:uploadData.eTag||null, lastModifiedDateTime:uploadData.lastModifiedDateTime||null, webUrl:uploadData.webUrl||null });
      return;
    }

    if(action === 'importFile'){
      const accessToken = await getValidAccessToken(userRef);
      const { id, name } = req.body || {};
      if(!id) throw new Error('Falta el id del archivo de OneDrive a importar.');

      /* Mismo control que ya aplican upload-library.mjs y google-drive.mjs
         (assertAllowedFile + sanitizeFileName): antes importFile de OneDrive
         era el unico de los 3 caminos de la Biblioteca sin allowlist de
         extension ni tope de tamano, y el nombre de archivo llegaba tal cual
         del cliente hasta formar parte literal de la ruta de Storage. Primero
         se valida con la metadata (rapido, sin bajar el archivo completo si
         va a rechazarse) y luego otra vez con el tamano real descargado. */
      const metaRes = await fetch(`${GRAPH_BASE}/me/drive/items/${encodeURIComponent(id)}?select=id,name,size,file,eTag,lastModifiedDateTime`, {
        headers:{ Authorization:`Bearer ${accessToken}` }
      });
      const meta = await metaRes.json().catch(() => null);
      if(!metaRes.ok || !meta) throw new Error('No se pudo leer la metadata del archivo en OneDrive.');
      const safeName = sanitizeFileName(name || meta.name || `onedrive-${id}`);
      assertAllowedFile({ name: safeName, mimeType: meta.file?.mimeType, size: meta.size });

      /* Evitar duplicados (Prioridad 5): si este MISMO archivo de OneDrive
         (por id) ya se importo antes para este usuario, se actualiza ese
         documento en vez de crear uno nuevo -- mismo criterio que
         driveFileId en google-drive.mjs, aplicado aqui a oneDriveItemId. Si
         el eTag remoto no cambio desde la ultima sincronizacion, no se
         vuelve a descargar/subir nada (deteccion de cambios real, no solo
         de nombre). */
      const existingSnap = await db.collection('library')
        .where('ownerUid', '==', authz.uid)
        .where('oneDriveItemId', '==', id)
        .limit(1)
        .get();
      const existingDoc = existingSnap.empty ? null : existingSnap.docs[0];
      if(existingDoc && existingDoc.data().oneDriveETag && existingDoc.data().oneDriveETag === meta.eTag){
        res.status(200).json({ ok:true, docId: existingDoc.id, downloadURL: existingDoc.data().downloadURL, name: existingDoc.data().name, sinCambios:true, eTag: meta.eTag||null, lastModifiedDateTime: meta.lastModifiedDateTime||null });
        return;
      }

      const fileRes = await fetch(`${GRAPH_BASE}/me/drive/items/${encodeURIComponent(id)}/content`, {
        headers:{ Authorization:`Bearer ${accessToken}` }
      });
      if(!fileRes.ok) throw new Error('No se pudo descargar el archivo desde OneDrive.');
      const buffer = Buffer.from(await fileRes.arrayBuffer());
      assertAllowedFile({ name: safeName, mimeType: fileRes.headers.get('content-type'), size: buffer.length });
      const storagePath = `library/${authz.uid}/onedrive-${id}/${safeName}`;
      const bucket = getAdminStorage();
      const file = bucket.file(storagePath);
      await file.save(buffer, { metadata:{ contentType: fileRes.headers.get('content-type') || 'application/octet-stream' } });
      const [downloadURL] = await file.getSignedUrl({ action:'read', expires:'01-01-2500' });
      const ext = (safeName.split('.').pop() || 'DOC').toUpperCase();
      const docData = {
        name: safeName,
        size: `${(buffer.length / 1048576).toFixed(2)} MB`,
        ext,
        when: new Date().toLocaleDateString('es-MX'),
        cat: 'Documentos',
        family: 'OneDrive',
        tags: ['onedrive'],
        status: 'Subido e indexado',
        uses: 0,
        ownerUid: authz.uid,
        visibility: authz.role === 'admin' ? 'global' : 'private',
        storagePath,
        downloadURL,
        indexed: false,
        source: 'onedrive',
        // Version/fecha remota (Prioridad 5, "fecha/version" + "deteccion de
        // cambios"): permite saber si el archivo de OneDrive cambio desde la
        // ultima importacion sin tener que descargarlo de nuevo.
        oneDriveItemId: id,
        oneDriveETag: meta.eTag || null,
        oneDriveModifiedAt: meta.lastModifiedDateTime || null,
        lastSyncedAt: FieldValue.serverTimestamp()
      };
      let docId;
      if(existingDoc){
        await existingDoc.ref.set(docData, { merge:true });
        docId = existingDoc.id;
      } else {
        docData.createdAt = FieldValue.serverTimestamp();
        const docRef = await db.collection('library').add(docData);
        docId = docRef.id;
      }
      await userRef.set({ oneDrive:{ lastSyncedAt: FieldValue.serverTimestamp() } }, { merge:true });
      res.status(200).json({ ok:true, docId, downloadURL, name: safeName, actualizado: Boolean(existingDoc), eTag: meta.eTag||null, lastModifiedDateTime: meta.lastModifiedDateTime||null });
      return;
    }

    res.status(400).json({ error:'Accion no reconocida.' });
  }catch(err){
    res.status(err.status || 400).json({ error:err.message || 'No se pudo completar la operacion con OneDrive.' });
  }
}
