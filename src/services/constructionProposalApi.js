/* Cliente HTTP hacia /api/construction-proposal (Fase 3: Propuesta
   constructiva con IA). Capa de infraestructura delgada, mismo patron que
   el resto de src/services/*.js -- reusa apiPost de apiClient.js, nunca
   reimplementa el manejo de errores/token. */
import { apiPost } from './apiClient.js';

export function generateConstructionProposal({ imageUrls, userPrompt, knownDimensions, stylePreferences, referenceBudget }){
  return apiPost('/api/construction-proposal', {
    action: 'generate', imageUrls, userPrompt, knownDimensions, stylePreferences, referenceBudget
  });
}

export function deriveApuConceptsFromProposal(proposal){
  return apiPost('/api/construction-proposal', { action: 'apuConcepts', proposal });
}
