import { requireFeature } from './_authGuard.mjs';
import { driveFetch, defaultFolderId, hasGoogleDriveCredentials } from './_googleDrive.mjs';

const FIELDS = 'nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink, parents)';

export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.status(405).json({ ok:false, error:'Metodo no permitido.' });
    return;
  }
  try{
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
    // q se arma aparte: URLSearchParams ya encodea las comillas correctamente si se agrega asi
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
  }catch(err){
    res.status(err.status || 400).json({ ok:false, error: err.message || 'No se pudo listar Google Drive.' });
  }
}
