/* Fase 3 (evolucion integral Levantamiento IA): endpoint de "Propuesta
   constructiva con IA" -- reubicado bajo server/api-lib/ y despachado por
   api/gateway.mjs (limite de 12 funciones serverless del plan Hobby de
   Vercel, ver VERCEL_HOBBY_COMPAT.md) desde el primer commit, NUNCA existio
   como su propio archivo en api/ -- no consume un slot nuevo.

   Gate de plan igual que generate-apu.mjs (feature:'ai', mismo criterio que
   Visual IA/Asistente: Gratis no incluye IA de este tipo) -- markFeatureUsed
   cuenta el uso igual que el resto de funciones de IA. */
import { requireFeature, markFeatureUsed } from './_authGuard.mjs';
import { generateConstructionProposal } from './_openaiApuCore.mjs';
import { deriveApuConceptsFromProposal } from '../../src/domain/constructionProposal.js';

function httpError(status, message){ const e = new Error(message); e.status = status; return e; }

async function handleGenerate(req, res){
  const authz = await requireFeature(req, 'ai');
  const { imageUrls, userPrompt, knownDimensions, stylePreferences, referenceBudget, levels, specialNeeds } = req.body || {};
  const proposal = await generateConstructionProposal({ imageUrls, userPrompt, knownDimensions, stylePreferences, referenceBudget, levels, specialNeeds });
  await markFeatureUsed(authz);
  res.status(200).json({ ok: true, proposal });
}

/* apuConcepts (regla 5 del brief de Fase 3, "generar APU automaticamente"):
   NO genera ningun APU aqui -- solo devuelve la lista de conceptos de texto
   (uno por elemento real del sistema constructivo aprobado) para que el
   cliente los mande, UNO POR UNO, al pipeline de generacion de APU YA
   EXISTENTE (POST /api/generate-apu, sin cambios) -- nunca se duplica esa
   logica ni se salta el gate de plan/precio real que ese endpoint ya aplica. */
async function handleApuConcepts(req, res){
  await requireFeature(req, 'ai');
  const { proposal } = req.body || {};
  if(!proposal || typeof proposal !== 'object') throw httpError(400, 'Falta la propuesta a convertir en conceptos de APU.');
  const concepts = deriveApuConceptsFromProposal(proposal);
  res.status(200).json({ ok: true, concepts });
}

const ACTIONS = { generate: handleGenerate, apuConcepts: handleApuConcepts };

export default async function handler(req, res){
  try{
    if(req.method !== 'POST'){ res.status(405).json({ ok: false, error: 'Metodo no permitido.' }); return; }
    const action = req.body?.action;
    const run = ACTIONS[action];
    if(!run) throw httpError(400, `Accion no reconocida: "${action}".`);
    await run(req, res);
  }catch(err){
    const message = err.message || 'No se pudo generar la propuesta con IA.';
    res.status(err.status || 400).json({ ok: false, error: message, errorCode: String(err.status || 400) });
  }
}
