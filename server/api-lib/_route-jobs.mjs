/* POST /api/jobs (enrutado via api/gateway.mjs -- ver VERCEL_HOBBY_COMPAT.md,
   limite real de 12 Serverless Functions en el plan Hobby, ya al tope).

   Arquitectura de jobs real, server-side (Fase 2 de la auditoria): el
   cliente ya NO llama directo a OpenAI via fetch desde el navegador (ese
   fetch moria si el usuario cerraba la pestana a la mitad). Ahora:

   1. El cliente hace POST /api/jobs con {type, payload, idempotencyKey} y
      recibe {jobId} de inmediato (esta funcion responde en cuanto el
      documento del job existe en Firestore, no espera a OpenAI).
   2. waitUntil() (paquete oficial @vercel/functions) deja que el trabajo
      real (llamar a OpenAI, escribir el resultado) siga corriendo DESPUES
      de que la respuesta ya se envio -- documentado por Vercel como el
      mecanismo soportado para esto, funciona en funciones Node.js planas
      (no requiere Next.js). Sigue acotado al mismo maxDuration de la
      funcion (vercel.json: 60s en el plan actual) -- ver limitaciones en
      PRE_RELEASE_AUDIT o el informe de esta fase.
   3. El cliente escucha el documento users/{uid}/jobs/{jobId} con
      onSnapshot (src/lib/serverJobsCloud.js) -- nunca hace polling. */
import { markFeatureUsed, requireFeature } from './_authGuard.mjs';
import { getAdminDb } from './_firebaseAdmin.mjs';
import { generateAPU, generateAPUv2 } from './_openaiApuCore.mjs';
import { createJob, findRecentJobByIdempotencyKey, updateJob } from './_jobsStore.mjs';
import { waitUntil } from '@vercel/functions';

// Mapea cada tipo de job soportado a la feature de plan que lo protege
// (mismo gate que ya existia para /api/generate-apu -- ningun cambio de
// negocio, solo se reutiliza requireFeature).
const JOB_TYPE_FEATURE = { 'apu-generate': 'apu' };

// 2 intentos server-side (no 3, como hacia el cliente): el retry con
// backoff completo del cliente (hasta 45s + esperas entre intentos) podia
// sumar mas de 2 minutos -- muy por encima del maxDuration real de la
// funcion. 2 intentos cortos dejan margen real para completar dentro de los
// 60s configurados hoy; si mas adelante se activa Fluid Compute (ver
// informe), MAX_SERVER_ATTEMPTS puede subirse con mas margen disponible.
const MAX_SERVER_ATTEMPTS = 2;

async function processApuGenerateJob(db, authz, jobId, payload){
  const { uid } = authz;
  try{
    await updateJob(db, uid, jobId, { status: 'processing', startedAt: Date.now(), progressCode: 'JOB_PROCESSING' });
    let lastError = null;
    for(let attempt = 1; attempt <= MAX_SERVER_ATTEMPTS; attempt++){
      try{
        await updateJob(db, uid, jobId, { attempts: attempt, progressCode: attempt === 1 ? 'JOB_GENERATING' : 'JOB_RETRYING' });
        const wantsV2 = payload?.schema === 'v2';
        const apu = wantsV2
          ? await generateAPUv2({ concept: payload?.concept, catalog: payload?.catalog, referencePU: payload?.referencePU })
          : await generateAPU({ concept: payload?.concept, catalog: payload?.catalog });
        const result = wantsV2 ? { ok: true, apu, schemaVersion: 2 } : { ok: true, apu };
        await updateJob(db, uid, jobId, { status: 'completed', completedAt: Date.now(), progressCode: 'JOB_DONE', result });
        // Solo se cuenta uso real de cuota cuando el job SI produjo un APU
        // (mismo criterio que /api/generate-apu, que llamaba markFeatureUsed
        // solo tras un generateAPU exitoso) -- un intento fallido nunca debe
        // consumir el limite mensual del plan del usuario.
        await markFeatureUsed(authz);
        return;
      }catch(err){
        lastError = err;
      }
    }
    await updateJob(db, uid, jobId, {
      status: 'failed',
      completedAt: Date.now(),
      progressCode: 'JOB_FAILED',
      error: lastError?.message || 'No se pudo generar el APU con IA.',
      errorCode: String(lastError?.status || 'GENERATION_ERROR'),
    });
  }catch(fatalErr){
    // Defensivo: si algo revienta fuera del try interno (ej. el propio
    // updateJob fallando), el job NUNCA debe quedar "processing" para
    // siempre -- eso congelaria el indicador de "Procesos" del cliente.
    await updateJob(db, uid, jobId, {
      status: 'failed', completedAt: Date.now(), progressCode: 'JOB_FAILED',
      error: fatalErr?.message || 'Error inesperado al procesar el job.',
    }).catch(() => {});
  }
}

export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.status(405).json({ error: 'Metodo no permitido.' });
    return;
  }
  try{
    const { type, payload, idempotencyKey, projectId } = req.body || {};
    const feature = JOB_TYPE_FEATURE[type];
    if(!feature){
      res.status(400).json({ error: `Tipo de job no soportado: ${type}` });
      return;
    }
    const authz = await requireFeature(req, feature);
    const db = getAdminDb();

    const existing = await findRecentJobByIdempotencyKey(db, authz.uid, idempotencyKey);
    if(existing){
      res.status(200).json({ ok: true, jobId: existing.id, reused: true });
      return;
    }

    const job = await createJob(db, { uid: authz.uid, type, projectId: projectId || null, payload, idempotencyKey });

    if(type === 'apu-generate'){
      waitUntil(processApuGenerateJob(db, authz, job.id, payload));
    }

    res.status(200).json({ ok: true, jobId: job.id });
  }catch(err){
    res.status(err.status || 400).json({ error: err.message || 'No se pudo crear el job.' });
  }
}
