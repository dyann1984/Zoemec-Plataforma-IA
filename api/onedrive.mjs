import { FieldValue, getAdminDb, getAdminStorage } from './_firebaseAdmin.mjs';
import { requireFeature } from './_authGuard.mjs';

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

    if(action === 'importFile'){
      if(!hasOneDriveCredentials()){
        const error = new Error('OneDrive no esta configurado en este servidor.');
        error.status = 501;
        throw error;
      }
      const { id, name } = req.body || {};
      if(!id) throw new Error('Falta el id del archivo de OneDrive a importar.');
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
      const fileRes = await fetch(`${GRAPH_BASE}/me/drive/items/${encodeURIComponent(id)}/content`, {
        headers:{ Authorization:`Bearer ${tokens.access_token}` }
      });
      if(!fileRes.ok) throw new Error('No se pudo descargar el archivo desde OneDrive.');
      const buffer = Buffer.from(await fileRes.arrayBuffer());
      const safeName = (name || `onedrive-${id}`).toString();
      const storagePath = `library/${authz.uid}/onedrive-${id}/${safeName}`;
      const bucket = getAdminStorage();
      const file = bucket.file(storagePath);
      await file.save(buffer, { metadata:{ contentType: fileRes.headers.get('content-type') || 'application/octet-stream' } });
      const [downloadURL] = await file.getSignedUrl({ action:'read', expires:'01-01-2500' });
      const ext = (safeName.split('.').pop() || 'DOC').toUpperCase();
      const docRef = await db.collection('library').add({
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
        createdAt: FieldValue.serverTimestamp()
      });
      res.status(200).json({ ok:true, docId: docRef.id, downloadURL, name: safeName });
      return;
    }

    res.status(400).json({ error:'Accion no reconocida.' });
  }catch(err){
    res.status(err.status || 400).json({ error:err.message || 'No se pudo completar la operacion con OneDrive.' });
  }
}
