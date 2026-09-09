import { getAdminDb, getAdminStorage, hasAdminCredentials } from '../server/api-lib/_firebaseAdmin.mjs';
import { hasGoogleDriveCredentials } from '../server/api-lib/_googleDrive.mjs';
import { getOpenAIOperationalState, interpretReachabilityCheck } from '../server/api-lib/_aiHealthSignal.mjs';

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

/* AUD-018: antes, "openai" salia 'ok' con solo confirmar que GET /v1/models
   respondiera -- eso prueba CONFIGURADO y ALCANZABLE, nunca si una generacion
   real puede completarse (lo unico que de verdad usa el producto). El
   8-sep-2026 la cuenta se quedo sin credito y este endpoint siguio diciendo
   "ok" durante una caida total de /api/generate-apu.

   checkOpenAIDetailed() distingue los 5 estados pedidos sin gastar credito
   nunca: ALCANZABLE sigue siendo el mismo GET /v1/models gratuito de siempre;
   OPERACIONAL/DEGRADADO/CAIDO salen de la señal que _aiHealthSignal.mjs ya
   registra como efecto secundario de las llamadas reales que el producto hace
   por uso normal (nunca de una llamada de prueba pagada aqui). */
async function checkOpenAIDetailed(){
  if(!process.env.OPENAI_API_KEY){
    // Estado propio (no "down"): falta de configuracion es una categoria
    // distinta a "esta configurado pero fallando" -- nunca debe poder
    // confundirse con operational tampoco.
    return { configured:false, reachable:false, operational:false, state:'not_configured', reason:'no_configurada' };
  }
  let threwNetworkError = false;
  let httpStatus = null;
  try{
    const res = await fetch('https://api.openai.com/v1/models', {
      headers:{ Authorization:`Bearer ${process.env.OPENAI_API_KEY}` }
    });
    httpStatus = res.status;
  }catch{
    threwNetworkError = true;
  }
  const { reachable, immediateErrorClass } = interpretReachabilityCheck({ threwNetworkError, httpStatus });
  if(!reachable){
    return { configured:true, reachable:false, operational:false, state:'down', reason:'no_alcanzable' };
  }
  if(immediateErrorClass){
    return { configured:true, reachable:true, operational:false, state:'down', reason:immediateErrorClass };
  }
  const op = await getOpenAIOperationalState();
  return { configured:true, reachable:true, operational:op.operational, state:op.state, reason:op.reason };
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
  const [firebase, openaiState, storage, announcement] = await Promise.all([
    checkFirebase(), checkOpenAIDetailed(), checkStorage(), readAnnouncement()
  ]);
  /* Campo "openai" (string) se mantiene por compatibilidad con el frontend
     actual (main.jsx, AdminPanel.jsx hacen remote.openai === 'ok'). Cuando de
     verdad no hay evidencia reciente de ninguna forma (state:'unknown': nadie
     ha generado un APU todavia, o hace mas de 6h), no inventamos ok NI error:
     caemos al viejo criterio de alcanzabilidad para no regresar un falso
     "caido" en un despliegue nuevo sin uso todavia. "openaiState" (objeto) es
     el campo nuevo, aditivo, con el detalle real de los estados
     (not_configured/operational/degraded/down/unknown), nunca 'operational'
     cuando openaiState.configured es false. */
  const openai = openaiState.state === 'operational' ? 'ok'
    : openaiState.state === 'unknown' ? (openaiState.reachable ? 'ok' : 'error')
    : 'error';
  res.status(200).json({ firebase, openai, openaiState, storage, announcement, googleDriveConfigured: hasGoogleDriveCredentials() });
}
