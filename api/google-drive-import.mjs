import { FieldValue, getAdminDb, getAdminStorage } from './_firebaseAdmin.mjs';
import { requireFeature } from './_authGuard.mjs';
import { driveFetch, getGoogleDriveAccessToken, hasGoogleDriveCredentials, isGoogleNativeDoc, GOOGLE_EXPORT_MIME } from './_googleDrive.mjs';
import { assertAllowedFile, classifyLibraryFile, sanitizeFileName, extOf, MAX_UPLOAD_BYTES } from './_libraryClassify.mjs';

export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.status(405).json({ ok:false, error:'Metodo no permitido.' });
    return;
  }
  try{
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

    // Evita duplicados por fileId: si ya se importo antes, se regresa el existente.
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
  }catch(err){
    res.status(err.status || 400).json({ ok:false, error: err.message || 'No se pudo importar desde Google Drive.' });
  }
}
