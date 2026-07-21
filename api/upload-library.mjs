import { FieldValue, getAdminDb, getAdminStorage } from './_firebaseAdmin.mjs';
import { requireFeature } from './_authGuard.mjs';
import { assertAllowedFile, classifyLibraryFile, sanitizeFileName, extOf } from './_libraryClassify.mjs';

/* Sube el archivo real de la Biblioteca desde el servidor (Firebase Admin
   Storage), no desde el navegador. Evita por completo el bloqueo de CORS que
   ocurre cuando el SDK de cliente sube directo a Storage y el bucket no tiene
   el origen local/de Vercel autorizado: aqui no hay navegador involucrado en
   la subida real, solo un POST JSON con el archivo en base64. */
export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.status(405).json({ ok:false, error:'Metodo no permitido.' });
    return;
  }
  try{
    const authz = await requireFeature(req, 'library');
    const { fileName, mimeType, dataBase64, visibility } = req.body || {};
    if(!fileName || !dataBase64){
      const error = new Error('Falta el archivo o el nombre.');
      error.status = 400;
      throw error;
    }

    const safeName = sanitizeFileName(fileName);
    const buffer = Buffer.from(String(dataBase64).split(',').pop(), 'base64');
    if(!buffer.length){
      const error = new Error('El archivo llego vacio.');
      error.status = 400;
      throw error;
    }
    assertAllowedFile({ name: safeName, mimeType, size: buffer.length });

    const wantsGlobal = visibility === 'global' && authz.role === 'admin';
    const db = getAdminDb();
    const bucket = getAdminStorage();
    const fileId = 'LIB-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const storagePath = `library/${authz.uid}/${fileId}/${safeName}`;
    const file = bucket.file(storagePath);
    await file.save(buffer, { metadata: { contentType: mimeType || 'application/octet-stream' } });
    const [downloadURL] = await file.getSignedUrl({ action: 'read', expires: '01-01-2500' });

    const meta = classifyLibraryFile(safeName);
    const docRef = await db.collection('library').add({
      name: safeName,
      size: (buffer.length / 1048576).toFixed(2) + ' MB',
      ext: extOf(safeName).toUpperCase(),
      when: new Date().toLocaleDateString('es-MX'),
      cat: meta.cat,
      family: meta.family,
      tags: [],
      status: 'Subido e indexado',
      uses: 0,
      ownerUid: authz.uid,
      visibility: wantsGlobal ? 'global' : 'private',
      storagePath,
      downloadURL,
      indexed: false,
      source: 'upload',
      createdAt: FieldValue.serverTimestamp()
    });

    res.status(200).json({
      ok: true,
      id: docRef.id,
      name: safeName,
      cat: meta.cat,
      family: meta.family,
      size: (buffer.length / 1048576).toFixed(2) + ' MB',
      type: extOf(safeName).toUpperCase(),
      url: downloadURL,
      date: new Date().toLocaleDateString('es-MX'),
      source: 'upload'
    });
  }catch(err){
    res.status(err.status || 400).json({ ok:false, error: err.message || 'No se pudo subir el archivo.' });
  }
}
