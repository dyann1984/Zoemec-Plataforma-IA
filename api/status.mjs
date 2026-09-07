import { getAdminDb, getAdminStorage, hasAdminCredentials } from '../server/api-lib/_firebaseAdmin.mjs';
import { hasGoogleDriveCredentials } from '../server/api-lib/_googleDrive.mjs';

/* Estado publico y minimo (sin datos sensibles) para que cualquier usuario logueado
   -no solo un admin- pueda ver en la topbar si Firebase y OpenAI responden de verdad.
   No expone latencias, mensajes de error internos ni nada mas alla de ok/error. */
async function checkFirebase(){
  if(!hasAdminCredentials()) return 'error';
  try{
    const db = getAdminDb();
    await db.collection('users').limit(1).get();
    return 'ok';
  }catch{
    return 'error';
  }
}

/* Diagnostico de auditoria (Fase 2B, punto P0): confirma si el bucket real de
   Storage existe y responde, sin exponer nombre de bucket, rutas ni archivos.
   Mismo patron try/exists que checkFirebase -- nunca lanza, nunca expone el
   mensaje de error interno (que si podria incluir el nombre del bucket). */
async function checkStorage(){
  if(!hasAdminCredentials()) return 'error';
  try{
    const [exists] = await getAdminStorage().exists();
    return exists ? 'ok' : 'error';
  }catch{
    return 'error';
  }
}

async function checkOpenAI(){
  if(!process.env.OPENAI_API_KEY) return 'error';
  try{
    const res = await fetch('https://api.openai.com/v1/models', {
      headers:{ Authorization:`Bearer ${process.env.OPENAI_API_KEY}` }
    });
    return res.ok ? 'ok' : 'error';
  }catch{
    return 'error';
  }
}

/* El aviso de plataforma (config/platform.announcement) ya lo edita un admin real
   en el Panel Admin; se expone aqui de solo lectura para el login/landing (paginas
   sin sesion) sin abrir esa coleccion a lectura publica en firestore.rules. */
async function readAnnouncement(){
  if(!hasAdminCredentials()) return '';
  try{
    const db = getAdminDb();
    const snap = await db.collection('config').doc('platform').get();
    return snap.exists ? String(snap.data()?.announcement || '') : '';
  }catch{
    return '';
  }
}

export default async function handler(req, res){
  if(req.method !== 'GET'){
    res.status(405).json({ error:'Metodo no permitido.' });
    return;
  }
  const [firebase, openai, storage, announcement] = await Promise.all([checkFirebase(), checkOpenAI(), checkStorage(), readAnnouncement()]);
  res.status(200).json({ firebase, openai, storage, announcement, googleDriveConfigured: hasGoogleDriveCredentials() });
}
