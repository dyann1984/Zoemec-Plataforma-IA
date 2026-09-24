/* Nucleo de /api/generate-apu (P0 paridad ADMIN vs COLLABORATOR). Separado
   del handler para poder probarlo con un Firestore en memoria y un generador
   falso, sin OpenAI ni credenciales.

   Regla central: cuando el cliente manda `projectId` o `contextMode`, el
   catalogo que ve la IA lo arma el SERVIDOR (loadApuGenerationContext) con
   los datos de la empresa del usuario -- el `catalog` del body deja de ser
   la fuente en modo empresa (antes era el blob personal de cada usuario:
   300 renglones para el admin, 0 para un colaborador nuevo). Sin esos
   campos (cliente antiguo) se conserva exactamente el comportamiento
   historico. */
import { loadApuGenerationContext } from './_apuContextResolver.mjs';
import { annotateApuPriceSources, toContextDiagnostics } from '../../src/domain/apuContextResolution.js';

export function wantsServerContext(body = {}){
  return Boolean(body?.contextMode || body?.projectId);
}

/* generate(payload, { wantsV2 }) -> apu. payload contiene SOLO campos
   tecnicos: { concept, catalog, preserveOriginal, mode, referencePU }. */
export async function runApuGeneration({ body = {}, authz, orgContext = null, db = null, generate }){
  const wantsV2 = body.schema === 'v2';
  let ctx = null;
  let catalog = Array.isArray(body.catalog) ? body.catalog : [];
  if(wantsServerContext(body)){
    ctx = await loadApuGenerationContext({
      db, authz, orgContext,
      projectId: body.projectId || null,
      requestedMode: body.contextMode || null,
      includePersonal: body.includePersonal === true,
      clientPersonalCatalog: Array.isArray(body.catalog) ? body.catalog : [],
      concept: body.concept || ''
    });
    catalog = ctx.catalogForModel;
  }
  const payload = {
    concept: body.concept,
    catalog,
    preserveOriginal: body.preserveOriginal === true,
    mode: body.mode || '',
    referencePU: Number(body.referencePU) || 0
  };
  let apu = await generate(payload, { wantsV2 });
  let context = null;
  if(ctx){
    apu = annotateApuPriceSources(apu, ctx.catalogForModel);
    context = toContextDiagnostics(ctx);
    apu = { ...apu, contextDiagnostics: context };
  }
  return { apu, wantsV2, context, modelCatalog: catalog };
}
