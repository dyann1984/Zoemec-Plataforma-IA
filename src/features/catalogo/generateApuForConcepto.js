/* Orquestador de "Generar APU con IA" para un concepto del Catalogo (Fase D).
   NO es un motor nuevo: reproduce, en un solo lugar reutilizable, la MISMA
   secuencia de motores reales que ya usa src/main.jsx (funcion `generateAI`
   dentro del componente APU) para el flujo individual:

     POST /api/generate-apu (reintentos con backoff)
       -> enrichApuWithIntelligence2 (precios de mercado reales, Material Origin)
       -> finalizeProfessionalAPU (validacion + calculo profesional v2)
       -> ubicacion ESTRUCTURADA del proyecto activo (buildProjectLocationSnapshot,
          jamas un enlace vivo, jamas un default silencioso de ciudad)
       -> POST /api/apus action=create (persistencia autoritativa)

   Diferencia deliberada con el flujo de main.jsx: ese produce un BORRADOR
   para revision manual en el editor antes de guardar; este, pensado para
   generacion masiva sin que el usuario permanezca en pantalla (regla del
   producto), persiste directamente -- si `finalizeProfessionalAPU` marca
   `validationStatus:'REQUIERE REVISION'`, el concepto queda en
   REQUIERE_REVISION (visible, con el APU YA guardado) en vez de silencioso.

   P0 paridad ADMIN vs COLLABORATOR: la peticion declara projectId +
   contextMode:'organization'. El SERVIDOR arma el catalogo que ve la IA con
   la biblioteca de la empresa (identica para cualquier miembro) -- el
   `catalog` personal que se sigue enviando solo se usa en modo personal
   (usuario sin empresa), comportamiento historico intacto. */
import { apiPost, authHeaders } from '../../services/apiClient.js';
import { uid } from '../../utils/id.js';
import { buildProjectLocationSnapshot } from '../../domain/geography.js';
import { finalizeProfessionalAPU } from '../../domain/apuProfessional.js';
import { enrichApuWithIntelligence2 } from '../../domain/materialPriceIntelligence2.js';
import { createIntelligence2RunContext } from '../../domain/intelligence2Runtime.js';
import { summarizeGenerationContext } from '../../domain/apuGenerationContext.js';
import { mergeClientDiagnostics, applyContextConfidencePenalty, enrichmentPartialWarning, normalizeEnrichmentPartial } from '../../domain/apuContextResolution.js';
import { isRateLimitError, makeRateLimitError } from '../../domain/rateLimitStatus.js';

async function callGenerateApu({ concept, catalog, referencePU, projectId, timeoutMs = 45000 }){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try{
    const res = await fetch('/api/generate-apu', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ concept, catalog, schema: 'v2', referencePU: referencePU || 0, projectId: projectId || null, contextMode: 'organization' }),
      signal: controller.signal
    });
    const data = await res.json().catch(() => ({}));
    if(!res.ok){
      // F1/P0: un 429 viaja tipado (status/code/retryAfterSeconds) para que el
      // lote lo marque PENDIENTE POR LIMITE, nunca ERROR definitivo.
      if(res.status === 429) throw makeRateLimitError(data?.error, data?.retryAfterSeconds ?? null);
      const err = new Error(data?.error || 'No se pudo generar con IA.'); err.status = res.status; throw err;
    }
    return data;
  }finally{
    clearTimeout(timer);
  }
}

/* Hasta 3 intentos (mismo criterio que main.jsx): un fallo de red/timeout de
   la IA en un concepto de un lote de 30 nunca debe tumbar el lote completo
   -- reintenta aqui mismo antes de que el llamador lo reporte como ERROR.
   Un 403/401 (permisos) NO se reintenta: no es transitorio.
   F1/P0: un 429 tampoco se reintenta aqui -- la ventana del limite dura
   minutos, no segundos; reintentar a ciegas solo consumia mas cupo. Se
   propaga con retryAfterSeconds al llamador (lote -> PENDIENTE POR LIMITE). */
async function callGenerateApuWithRetry(args){
  let lastError = null;
  for(let attempt = 0; attempt < 3; attempt++){
    if(attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
    try{ return await callGenerateApu(args); }
    catch(err){
      lastError = err;
      if(err?.status === 401 || err?.status === 403 || isRateLimitError(err)) break;
    }
  }
  throw lastError || new Error('No se pudo generar con IA.');
}

/* Cola final compartida por AMBOS caminos de generacion (IA y parametrico):
   finaliza (validacion + calculo profesional v2), congela la ubicacion
   ESTRUCTURADA del proyecto (nunca un default silencioso de ciudad, nunca
   un enlace vivo -- mismo criterio que main.jsx y que la defensa en
   profundidad server-side de _route-apus.mjs#ensureApuLocationSnapshot) y
   persiste via POST /api/apus action=create. Un solo lugar para esta cola
   evita que el camino de IA y el paramétrico terminen con dos formas
   distintas de guardar "lo mismo".

   La penalizacion de contexto se aplica DESPUES de finalizeProfessionalAPU
   (que recalcula la confianza con el Confidence Engine): aplicarla antes,
   como hacia la Fase 3.5, se perdia en ese recalculo. */
export async function persistGeneratedApu({ apuDraft, concepto, project = null, reason }){
  const v2 = finalizeProfessionalAPU(apuDraft);
  const penalty = Number(v2.contextDiagnostics?.confidencePenalty) || 0;
  if(penalty > 0) v2.confidence = applyContextConfidencePenalty(v2.confidence, penalty);
  const locationSnapshot = project ? buildProjectLocationSnapshot(project) : { ubicacion: '', ubicacionEstructurada: null };
  v2.ubicacionEstructurada = locationSnapshot.ubicacionEstructurada;
  v2.ubicacion = locationSnapshot.ubicacion;
  v2.clave = v2.clave || concepto.clave || ('APU-' + uid().slice(0, 4));
  v2.projectId = concepto.projectId;

  const apuId = 'APU-' + uid();
  await apiPost('/api/apus', {
    action: 'create', id: apuId, projectId: concepto.projectId, apu: { ...v2, id: apuId }, reason
  });
  return { apuId, apu: v2, requiresReview: v2.validationStatus === 'REQUIERE REVISION' };
}

/* F1/P0: respaldo (servidor sin `context`): mismo aviso ENRICHMENT_PARTIAL
   que mergeClientDiagnostics, para que ningun camino lo pierda. */
function withPartialWarning(diag, enrichmentPartial){
  const warning = enrichmentPartialWarning(enrichmentPartial);
  if(!diag || !warning) return diag;
  const warnings = [...(diag.warnings || []), warning];
  return {
    ...diag, warnings, enrichmentPartial,
    confidencePenalty: warnings.filter(w => w.severity === 'ALTA' || w.severity === 'CRITICA').length * 5
  };
}

/* concepto: documento de catalogConceptos (concept/unit/qty/referencePU/
   projectId). project: documento de projects (para la ubicacion). catalog:
   catalogo PERSONAL del usuario (solo participa en modo personal). Retorna
   {apuId, apu, requiresReview, contextDiagnostics} o lanza. */
export async function generateApuForConcepto({ concepto, catalog = [], project = null, userScope = null, historicalApuCount = 0, libraryCount = 0 }){
  const data = await callGenerateApuWithRetry({ concept: concepto.concept, catalog, referencePU: concepto.referencePU, projectId: concepto.projectId });
  const draft = {
    ...data.apu,
    cantidadObra: Number(concepto.qty || 1) || 1,
    referencePU: Number(concepto.referencePU || 0) || 0,
    projectId: concepto.projectId
  };

  // Enriquecimiento de precios (Price Intelligence 2). El error NO se traga
  // en silencio -- queda en contextDiagnostics y degrada la confianza.
  let enrichedDraft = draft;
  let enrichmentFailed = false;
  let enrichmentError = null;
  let enrichmentPartial = null;
  try{
    const runContext = createIntelligence2RunContext({
      location: project?.ubicacion || '', dateBase: draft.fechaBase,
      country: project?.locationCountry || '', state: project?.locationState || '', city: project?.locationCity || ''
    });
    const result = await enrichApuWithIntelligence2({
      aiApu: draft, userInput: { concept: concepto.concept, unit: concepto.unit, qty: concepto.qty },
      concept: concepto.concept, ...runContext
    });
    enrichedDraft = result.apu;
    // F1/P0: fallo PARCIAL (algunos insumos con 429/red) -- antes invisible.
    enrichmentPartial = normalizeEnrichmentPartial(result);
  }catch(err){
    enrichmentFailed = true;
    enrichmentError = err?.message || String(err);
    try{ console.warn('[apu-gen] Price Intelligence fallo para concepto', concepto?.id, enrichmentError); }catch{ /* ignore */ }
  }

  // Diagnostico: el del SERVIDOR (contexto empresarial real) cuando existe;
  // el calculo local de Fase 3.5 solo como respaldo si el servidor es de una
  // version anterior que no devuelve `context`.
  const serverContext = data.context || data.apu?.contextDiagnostics || null;
  const contextDiagnostics = serverContext
    ? mergeClientDiagnostics(serverContext, { enrichmentFailed, enrichmentError, enrichmentPartial })
    : withPartialWarning(summarizeGenerationContext({
      concept: concepto.concept, unit: concepto.unit, referencePU: concepto.referencePU,
      catalogSize: (Array.isArray(catalog) ? catalog : []).length,
      project, historicalApuCount, libraryCount,
      enrichmentFailed, enrichmentError, userScope
    }), enrichmentPartial);

  // Estampa el diagnostico en el APU antes de persistir -- SIEMPRE, aunque
  // no haya warnings, para que el historial de un APU tenga trazabilidad
  // completa del contexto de su generacion.
  enrichedDraft.contextDiagnostics = contextDiagnostics;

  const persisted = await persistGeneratedApu({ apuDraft: enrichedDraft, concepto, project, reason: `Generado con IA desde Catalogo (concepto ${concepto.id})` });
  return { ...persisted, contextDiagnostics };
}
