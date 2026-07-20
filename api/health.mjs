import { requireAdmin } from './_authGuard.mjs';
import { getAdminDb } from './_firebaseAdmin.mjs';

/* Diagnostico real de las dependencias de produccion, solo para administradores.
   Cada verificacion es una prueba real (no un valor inventado). Si algo no se
   puede medir de verdad (costo/uso de OpenAI en $), se reporta explicitamente
   como no disponible en vez de simularlo. */
async function checkFirebase(){
  try{
    const db = getAdminDb();
    const started = Date.now();
    await db.collection('users').limit(1).get();
    return { status:'ok', label:'Firebase / Firestore', detail:`Conectado (${Date.now()-started} ms de latencia).` };
  }catch(err){
    return { status:'error', label:'Firebase / Firestore', detail: err?.message || 'No se pudo conectar.' };
  }
}

async function checkOpenAI(){
  if(!process.env.OPENAI_API_KEY){
    return { status:'error', label:'OpenAI', detail:'No configurada en este entorno.' };
  }
  try{
    const started = Date.now();
    const res = await fetch('https://api.openai.com/v1/models', {
      headers:{ Authorization:`Bearer ${process.env.OPENAI_API_KEY}` }
    });
    if(!res.ok) return { status:'error', label:'OpenAI', detail:`Configurada, pero respondio con error ${res.status}.` };
    return { status:'ok', label:'OpenAI', detail:`Configurada y responde (${Date.now()-started} ms).` };
  }catch{
    return { status:'error', label:'OpenAI', detail:'Configurada, pero no se pudo contactar el servicio.' };
  }
}

async function checkStorage(){
  try{
    const db = getAdminDb();
    await db.collection('library').limit(1).get();
    return { status:'ok', label:'Firebase Storage (metadata)', detail:'Coleccion de biblioteca accesible desde el servidor.' };
  }catch(err){
    return { status:'error', label:'Firebase Storage (metadata)', detail: err?.message || 'No se pudo verificar.' };
  }
}

export default async function handler(req, res){
  if(req.method !== 'GET'){
    res.status(405).json({ error:'Metodo no permitido.' });
    return;
  }
  try{
    await requireAdmin(req);
    const [firebase, openai, storage] = await Promise.all([checkFirebase(), checkOpenAI(), checkStorage()]);
    res.status(200).json({
      checks: {
        firebase,
        openai,
        storage,
        openaiUsage: { status:'not_available', label:'Consumo de OpenAI ($)', detail:'Requiere integracion con la API de facturacion de OpenAI (no conectada).' }
      },
      checkedAt: new Date().toISOString()
    });
  }catch(err){
    res.status(err.status || 400).json({ error:err.message || 'No se pudo consultar el estado del sistema.' });
  }
}
