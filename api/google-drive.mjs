import { FieldValue, getAdminDb, getAdminStorage } from './_firebaseAdmin.mjs';
import { requireFeature } from './_authGuard.mjs';
import { driveFetch, defaultFolderId, getGoogleDriveAccessToken, hasGoogleDriveCredentials, isGoogleNativeDoc, GOOGLE_EXPORT_MIME } from './_googleDrive.mjs';
import { assertAllowedFile, classifyLibraryFile, sanitizeFileName, extOf, MAX_UPLOAD_BYTES } from './_libraryClassify.mjs';

/* list + import en un solo archivo (accion en el body, mismo patron que
   api/onedrive.mjs) para no sumar funciones serverless de mas: cada archivo en
   api/*.mjs cuenta como una funcion aparte para el plan de Vercel, y separar
   esto en 2 archivos empujo el conteo total por encima del limite del plan,
   lo cual rompio el deploy (build ok, "Deploying outputs..." fallaba). */
const FIELDS = 'nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink, parents)';

async function listFolder(req, res){
  await requireFeature(req, 'library');
  if(!hasGoogleDriveCredentials()){
    const error = new Error('Google Drive no esta configurado en este servidor.');
    error.status = 501;
    throw error;
  }
  const { folderId, pageToken, pageSize } = req.body || {};
  const targetFolder = folderId || defaultFolderId();
  if(!targetFolder){
    const error = new Error('Falta el folderId y no hay GOOGLE_DRIVE_FOLDER_ID configurado.');
    error.status = 400;
    throw error;
  }
  const size = Math.min(Number(pageSize) || 100, 200);
  const params = new URLSearchParams({
    fields: FIELDS,
    pageSize: String(size),
    orderBy: 'folder,name'
  });
  if(pageToken) params.set('pageToken', pageToken);
  params.set('q', `'${targetFolder}' in parents and trashed = false`);
  const path = `?${params.toString()}`;

  const driveRes = await driveFetch(path);
  const data = await driveRes.json().catch(() => null);
  if(!driveRes.ok){
    const error = new Error(data?.error?.message || 'Google Drive no pudo listar la carpeta.');
    error.status = driveRes.status === 404 ? 404 : 502;
    throw error;
  }

  const items = (data?.files || []).map(f => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: Number(f.size || 0),
    modifiedTime: f.modifiedTime || '',
    webViewLink: f.webViewLink || '',
    parent: targetFolder,
    isFolder: f.mimeType === 'application/vnd.google-apps.folder'
  }));

  res.status(200).json({ ok: true, folderId: targetFolder, items, nextPageToken: data?.nextPageToken || null });
}

async function importFile(req, res){
  const authz = await requireFeature(req, 'library');
  if(!hasGoogleDriveCredentials()){
    const error = new Error('Google Drive no esta configurado en este servidor.');
    error.status = 501;
    throw error;
  }
  const { fileId } = req.body || {};
  if(!fileId){
    const error = new Error('Falta el fileId de Google Drive a importar.');
    error.status = 400;
    throw error;
  }

  const db = getAdminDb();

  const dupSnap = await db.collection('library').where('driveFileId', '==', fileId).limit(1).get();
  if(!dupSnap.empty){
    const existing = dupSnap.docs[0];
    res.status(200).json({ ok: true, alreadyImported: true, id: existing.id, ...existing.data() });
    return;
  }

  const accessToken = await getGoogleDriveAccessToken();
  const metaRes = await driveFetch(`/${fileId}?fields=id,name,mimeType,size,md5Checksum`, { accessToken });
  const meta = await metaRes.json().catch(() => null);
  if(!metaRes.ok || !meta){
    const error = new Error(meta?.error?.message || 'No se pudo leer la metadata del archivo en Drive.');
    error.status = 404;
    throw error;
  }

  let downloadUrl;
  let finalName = meta.name;
  if(isGoogleNativeDoc(meta.mimeType)){
    const exportInfo = GOOGLE_EXPORT_MIME[meta.mimeType];
    if(!exportInfo){
      const error = new Error('Este archivo de Google (' + meta.mimeType + ') no tiene un formato de exportacion soportado.');
      error.status = 415;
      throw error;
    }
    downloadUrl = `/${fileId}/export?mimeType=${encodeURIComponent(exportInfo.mime)}`;
    finalName = finalName.replace(/\.[^.]+$/, '') + '.' + exportInfo.ext;
  }else{
    downloadUrl = `/${fileId}?alt=media`;
  }

  const safeName = sanitizeFileName(finalName);
  assertAllowedFile({ name: safeName, mimeType: meta.mimeType, size: meta.size });

  const fileRes = await driveFetch(downloadUrl, { accessToken });
  if(!fileRes.ok){
    const error = new Error('No se pudo descargar el archivo desde Google Drive.');
    error.status = 502;
    throw error;
  }
  const arrayBuffer = await fileRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if(buffer.length > MAX_UPLOAD_BYTES){
    const error = new Error('El archivo pesa ' + (buffer.length / 1048576).toFixed(1) + ' MB; supera el maximo de ' + (MAX_UPLOAD_BYTES / 1048576).toFixed(0) + ' MB para importar directo. Descargalo y compartelo en partes, o usa un enlace manual.');
    error.status = 413;
    throw error;
  }

  const bucket = getAdminStorage();
  const storagePath = `library/${authz.uid}/gdrive-${fileId}/${safeName}`;
  const file = bucket.file(storagePath);
  await file.save(buffer, { metadata: { contentType: meta.mimeType || 'application/octet-stream' } });
  const [downloadURL] = await file.getSignedUrl({ action: 'read', expires: '01-01-2500' });

  const libMeta = classifyLibraryFile(safeName);
  const docRef = await db.collection('library').add({
    name: safeName,
    size: (buffer.length / 1048576).toFixed(2) + ' MB',
    ext: extOf(safeName).toUpperCase(),
    when: new Date().toLocaleDateString('es-MX'),
    cat: libMeta.cat,
    family: libMeta.family,
    tags: ['google-drive'],
    status: 'Subido e indexado',
    uses: 0,
    ownerUid: authz.uid,
    visibility: authz.role === 'admin' ? 'global' : 'private',
    storagePath,
    downloadURL,
    indexed: false,
    source: 'google-drive',
    driveFileId: fileId,
    driveChecksum: meta.md5Checksum || '',
    createdAt: FieldValue.serverTimestamp()
  });

  res.status(200).json({
    ok: true,
    id: docRef.id,
    name: safeName,
    cat: libMeta.cat,
    family: libMeta.family,
    size: (buffer.length / 1048576).toFixed(2) + ' MB',
    url: downloadURL,
    source: 'google-drive'
  });
}

export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.status(405).json({ ok:false, error:'Metodo no permitido.' });
    return;
  }
  try{
    const { action } = req.body || {};
    if(action === 'import') return await importFile(req, res);
    return await listFolder(req, res);
  }catch(err){
    res.status(err.status || 400).json({ ok:false, error: err.message || 'No se pudo completar la operacion con Google Drive.' });
  }
}
