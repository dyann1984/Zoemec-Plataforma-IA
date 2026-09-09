/* Diagnostico real de produccion (solo administradores). Reubicado fuera de
   api/ en el parche de compatibilidad con Vercel Hobby (consolidacion de
   funciones serverless) -- ver api/gateway.mjs y VERCEL_HOBBY_COMPAT.md.
   Contenido/logica identicos a la version original en api/health.mjs, solo
   cambio la ruta relativa de import. */
import { requireAdmin } from './_authGuard.mjs';
import { getAdminDb } from './_firebaseAdmin.mjs';
import { getOpenAIOperationalState, interpretReachabilityCheck, ErrorClass } from './_aiHealthSignal.mjs';

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

/* AUD-018: distingue CONFIGURADO / ALCANZABLE / OPERACIONAL / DEGRADADO /
   CAIDO en vez del binario ok/error de antes (que solo probaba GET /v1/models
   -- gratuito, y por eso decia "ok" el 8-sep-2026 mientras /api/generate-apu
   fallaba 15/15 veces por falta de credito). ALCANZABLE sigue siendo el mismo
   GET /v1/models gratuito de siempre. OPERACIONAL/DEGRADADO/CAIDO salen de
   _aiHealthSignal.mjs, que se llena con las llamadas reales que el producto
   ya hace por uso normal -- este endpoint nunca paga por una llamada de
   prueba solo para revisar salud. */
const REASON_LABEL = {
  no_configurada: 'OPENAI_API_KEY no esta configurada en este entorno.',
  no_alcanzable: 'Configurada, pero no se pudo contactar el servicio (red o autenticacion).',
  sin_intentos_reales_registrados: 'Alcanzable, pero sin ninguna generacion real registrada todavia para confirmar si funciona.',
  sin_evidencia_dentro_del_ttl: 'Alcanzable, pero sin una generacion real en las ultimas 6 horas para confirmar si funciona.',
  ultimo_intento_real_exitoso: 'La ultima generacion real se completo correctamente.',
  exito_reciente_con_error_reciente_previo: 'Intermitente: hay una generacion real exitosa reciente, pero tambien un error real reciente antes de esa.',
  no_se_pudo_consultar_firestore: 'No se pudo leer el historial de generaciones reales.',
  [ErrorClass.AUTH_ERROR]: 'La API key fue rechazada en la ultima generacion real (401/403). Revisa OPENAI_API_KEY en Vercel.',
  [ErrorClass.QUOTA_EXHAUSTED]: 'Sin credito/cuota disponible en la ultima generacion real (429). Recarga en OpenAI Billing.',
  [ErrorClass.RATE_LIMITED]: 'Limite de solicitudes alcanzado en la ultima generacion real (429).',
  [ErrorClass.UPSTREAM_ERROR]: 'OpenAI respondio con error de servidor (5xx) en la ultima generacion real.',
  [ErrorClass.UPSTREAM_TIMEOUT]: 'Timeout o error de red en la ultima generacion real.',
  [ErrorClass.UNKNOWN_ERROR]: 'La ultima generacion real fallo por un motivo no clasificado.'
};

function stateToStatus(state){
  if(state === 'operational') return 'ok';
  if(state === 'degraded') return 'degraded';
  if(state === 'down') return 'down';
  return 'unknown';
}

async function checkOpenAI(){
  // "configured" (booleano explicito, no derivado de "status") es SOLO
  // "existe OPENAI_API_KEY" -- independiente de si el servicio esta
  // operativo ahora mismo. AdminPanel.jsx lo usa para la fila de
  // Diagnostico "OpenAI (OPENAI_API_KEY)", que pregunta por configuracion,
  // no por salud operacional -- antes usaba status==='ok', que con los
  // nuevos estados (operational/degraded/down/unknown) daba falso-negativo
  // con la key bien configurada pero sin una generacion real reciente.
  if(!process.env.OPENAI_API_KEY){
    // Estado propio, nunca "down": falta de configuracion es distinto de
    // "esta configurado pero fallando".
    return { status:'not_configured', label:'OpenAI', detail:REASON_LABEL.no_configurada, state:'not_configured', configured:false };
  }
  let threwNetworkError = false;
  let httpStatus = null;
  const started = Date.now();
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
    return { status:'down', label:'OpenAI', detail:REASON_LABEL.no_alcanzable, state:'down', configured:true };
  }
  if(immediateErrorClass){
    return { status:'down', label:'OpenAI', detail:REASON_LABEL[immediateErrorClass], state:'down', configured:true };
  }
  const op = await getOpenAIOperationalState();
  const detail = REASON_LABEL[op.reason] || 'Estado desconocido.';
  return {
    status:stateToStatus(op.state),
    label:'OpenAI',
    detail:`Alcanzable (${Date.now()-started} ms). ${detail}`,
    state:op.state,
    configured:true
  };
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
