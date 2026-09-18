/* Orquestador de "Generar APU con IA" para un concepto del Catalogo (Fase D).
   NO es un motor nuevo: reproduce, en un solo lugar reutilizable, la MISMA
   secuencia de motores reales que ya usa src/main.jsx (funcion `generateAI`
   dentro del componente APU, ~linea 2567) para el flujo individual:

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
   REQUIERE_REVISION (visible, con el APU YA guardado) en vez de silencioso. */
import { apiPost, authHeaders } from '../../services/apiClient.js';
import { uid } from '../../utils/id.js';
import { buildProjectLocationSnapshot } from '../../domain/geography.js';
import { finalizeProfessionalAPU } from '../../domain/apuProfessional.js';
import { enrichApuWithIntelligence2 } from '../../domain/materialPriceIntelligence2.js';
import { createIntelligence2RunContext } from '../../domain/intelligence2Runtime.js';

async function callGenerateApu({ concept, catalog, referencePU, timeoutMs = 45000 }){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try{
    const res = await fetch('/api/generate-apu', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ concept, catalog, schema: 'v2', referencePU: referencePU || 0 }),
      signal: controller.signal
    });
    const data = await res.json().catch(() => ({}));
    if(!res.ok){ const err = new Error(data?.error || 'No se pudo generar con IA.'); err.status = res.status; throw err; }
    return data;
  }finally{
    clearTimeout(timer);
  }
}

/* Hasta 3 intentos (mismo criterio que main.jsx): un fallo de red/timeout de
   la IA en un concepto de un lote de 30 nunca debe tumbar el lote completo
   -- reintenta aqui mismo antes de que el llamador lo reporte como ERROR. */
async function callGenerateApuWithRetry(args){
  let lastError = null;
  for(let attempt = 0; attempt < 3; attempt++){
    if(attempt > 0) await new Promise(r => setTimeout(r, lastError?.status === 429 ? 6000 * attempt : 2000 * attempt));
    try{ return await callGenerateApu(args); }
    catch(err){ lastError = err; }
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
   distintas de guardar "lo mismo". */
export async function persistGeneratedApu({ apuDraft, concepto, project = null, reason }){
  const v2 = finalizeProfessionalAPU(apuDraft);
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

/* concepto: documento de catalogConceptos (concept/unit/qty/referencePU/
   projectId). project: documento de projects (para la ubicacion). catalog:
   catalogo de precios del proyecto (mismo `catalog` que ya usa toda la app,
   ver src/domain/catalogLookup.js). Retorna {apuId, apu, requiresReview} o
   lanza -- el llamador (single-click o worker de lote) decide como reportar
   el estado (GENERADO/REQUIERE_REVISION/ERROR) al concepto. */
export async function generateApuForConcepto({ concepto, catalog = [], project = null }){
  const data = await callGenerateApuWithRetry({ concept: concepto.concept, catalog, referencePU: concepto.referencePU });
  const draft = {
    ...data.apu,
    cantidadObra: Number(concepto.qty || 1) || 1,
    referencePU: Number(concepto.referencePU || 0) || 0,
    projectId: concepto.projectId
  };

  let enrichedDraft = draft;
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
  }catch{ /* Price Intelligence caida por completo: se sigue con el borrador de la IA, igual que main.jsx */ }

  return persistGeneratedApu({ apuDraft: enrichedDraft, concepto, project, reason: `Generado con IA desde Catalogo (concepto ${concepto.id})` });
}
