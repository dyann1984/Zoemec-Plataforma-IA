/* Orquestador puro de la Explosion completa (Fase A): calcula las 4 pestañas
   (Materiales/Mano de obra/Maquinaria y Equipo/Auxiliares) a partir de los
   APUs ya cargados de un proyecto -- SIN efectos secundarios de red/escritura,
   para que la UI interactiva (src/features/explosions/ExplosionsPanel.jsx) y
   los exportadores (explosionXlsx.js/explosionPdf.js) compartan exactamente
   el mismo calculo, un solo motor, nunca dos. */
import { buildMaterialExplosion, buildAuxiliariesExplosion } from './materialExplosion.js';
import { buildLaborExplosion } from './laborExplosion.js';
import { buildMachineryExplosion } from './machineryExplosion.js';

export function computeExplosionData(apuDocs){
  return {
    materials: buildMaterialExplosion(apuDocs),
    auxiliares: buildAuxiliariesExplosion(apuDocs),
    labor: buildLaborExplosion(apuDocs),
    machinery: buildMachineryExplosion(apuDocs)
  };
}
