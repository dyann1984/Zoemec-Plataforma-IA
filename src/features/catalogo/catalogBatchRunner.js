/* F1/P0 -- Orquestacion del lote de generacion del Catalogo, extraida de
   CatalogoModule.jsx para poder probarla sin React (T7). Sin cambiar el
   motor: `generate` es generateApuForConcepto y `setStatus` es el set-status
   durable de /api/catalogo-conceptos.

   Tres resultados claramente distintos por concepto:
     GENERADO / REQUIERE_REVISION  -> hay APU real
     PENDIENTE_LIMITE              -> 429: sin APU, reintentable (retryAfterSeconds)
     ERROR                         -> fallo real
   Un 429 NUNCA se convierte en ERROR definitivo. Tras el primer 429 el lote
   deja de lanzar llamadas nuevas (la ventana dura minutos: seguir llamando
   solo consumiria cupo) y marca los conceptos restantes PENDIENTE_LIMITE. */
import { isRateLimitError, retryAfterSecondsOf } from '../../domain/rateLimitStatus.js';

export async function runCatalogBatch({ targets = [], generate, setStatus, concurrency = 3, batchId = null, onItemDone = null } = {}){
  const summary = { total: targets.length, ok: 0, review: 0, rateLimited: 0, failed: 0, retryAfterSeconds: null, apuIds: [] };
  let rateLimit = null; // { message, retryAfterSeconds } tras el primer 429
  let cursor = 0;

  const markRateLimited = async (concepto, message, retryAfterSeconds) => {
    await setStatus(concepto.id, 'PENDIENTE_LIMITE', { error: message, retryAfterSeconds, batchId }).catch(() => {});
    summary.rateLimited++;
  };

  const worker = async (concepto) => {
    if(rateLimit){
      await markRateLimited(concepto, rateLimit.message, rateLimit.retryAfterSeconds);
      return;
    }
    try{
      await setStatus(concepto.id, 'GENERANDO', { batchId });
      const { apuId, requiresReview } = await generate(concepto);
      await setStatus(concepto.id, requiresReview ? 'REQUIERE_REVISION' : 'GENERADO', { apuId, batchId });
      if(requiresReview) summary.review++; else summary.ok++;
      summary.apuIds.push(apuId);
    }catch(err){
      if(isRateLimitError(err)){
        const retryAfterSeconds = retryAfterSecondsOf(err);
        rateLimit = rateLimit || { message: err.message, retryAfterSeconds };
        summary.retryAfterSeconds = Math.max(summary.retryAfterSeconds || 0, retryAfterSeconds || 0) || null;
        await markRateLimited(concepto, err.message, retryAfterSeconds);
      }else{
        await setStatus(concepto.id, 'ERROR', { error: err.message, batchId }).catch(() => {});
        summary.failed++;
      }
    }finally{
      onItemDone?.(concepto);
    }
  };

  const lanes = Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
    while(cursor < targets.length){
      const item = targets[cursor++];
      await worker(item);
    }
  });
  await Promise.all(lanes);
  if(rateLimit && !summary.retryAfterSeconds) summary.retryAfterSeconds = rateLimit.retryAfterSeconds;
  return summary;
}

/* Conceptos elegibles para el boton "Generar pendientes": PENDIENTE siempre;
   PENDIENTE_LIMITE solo cuando su ventana ya paso (retryAt <= ahora). */
export function selectBatchTargets(conceptos = [], { onlyFailed = false, now = Date.now() } = {}){
  if(onlyFailed) return conceptos.filter(c => c.status === 'ERROR');
  return conceptos.filter(c => c.status === 'PENDIENTE'
    || (c.status === 'PENDIENTE_LIMITE' && (!c.retryAt || new Date(c.retryAt).getTime() <= now)));
}
