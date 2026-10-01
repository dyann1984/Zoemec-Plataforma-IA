/* F2 -- Carga UNICA de las entradas de la Explosion (APUs + conceptos del
   catalogo del proyecto) y calculo con alcance explicito. La usan el panel
   de Explosiones y los exportadores PDF/XLSX: los tres consumen el MISMO
   objeto calculado (computeScopedExplosion), nunca tres calculos. */
import { apiGetSafe } from '../services/apiClient.js';
import { loadProjectApus } from './apuProjectDossierData.js';
import { computeScopedExplosion, EXPLOSION_SCOPE } from '../domain/explosionData.js';

export async function loadProjectConceptos(projectId){
  const data = await apiGetSafe(`/api/catalogo-conceptos?projectId=${encodeURIComponent(projectId)}`);
  return Array.isArray(data?.conceptos) ? data.conceptos : [];
}

export async function loadScopedExplosion({ projectId, scope = EXPLOSION_SCOPE.PROYECTO } = {}){
  if(!projectId) throw new Error('Falta projectId para generar la Explosion.');
  const [apuDocs, conceptos] = await Promise.all([loadProjectApus(projectId), loadProjectConceptos(projectId)]);
  return { ...computeScopedExplosion({ conceptos, apuDocs, scope }), apuDocCount: apuDocs.length };
}

/* Nunca una Explosion vacia en silencio: mismo mensaje historico cuando el
   proyecto no tiene APUs; mensaje propio cuando el presupuesto no tiene
   conceptos con APU. */
export function assertExplosionHasLines(explosion){
  if(explosion?.apuDocCount === 0 || (!explosion?.lines?.length && explosion?.scope !== EXPLOSION_SCOPE.PRESUPUESTO)){
    throw new Error('El proyecto no tiene ningun APU guardado (server-side) para generar la Explosion.');
  }
  if(!explosion?.lines?.length){
    throw new Error('El presupuesto no tiene conceptos con APU asociado: no hay nada que explotar.');
  }
}

export { EXPLOSION_SCOPE };
