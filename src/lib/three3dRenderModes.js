/* Visor 3D profesional -- separa el toggle de alto nivel REALISTA/TECNICO
   (pedido explicito del brief) de los VISUALIZATION_MODE ya existentes en
   three3dVisualizationModes.js (Solido/Aristas/Alambre/Transparente), que
   siguen existiendo tal cual PERO ahora viven anidados dentro de TECNICO
   como herramientas secundarias -- nunca se borraron ni se reescribieron,
   solo se les dio un nivel superior mas claro.

   REALISTA usa el material ORIGINAL del archivo (o un fallback PBR
   profesional si detectMaterialQuality dijo que no hay materiales reales,
   ver buildProfessionalFallbackMaterial) + iluminacion fisica + entorno +
   tone mapping ACES + sombras suaves + piso de contacto.
   TECNICO usa el material plano ya existente (VISUALIZATION_MODE) + fondo
   claro + aristas + grid/ejes opcionales -- nunca el gris oscuro casi plano
   original (luz mas alta, piso claro opcional, sin tone mapping que oscurezca).

   Acoplado a Three.js, mismo criterio de test que three3dSceneKit.js/
   three3dVisualizationModes.js: sin node --test (no hay WebGL ahi), se
   verifica en dev-qa/qa-model3d.jsx. */
import * as THREE from 'three';

export const RENDER_MODE = Object.freeze({ REALISTIC: 'realista', TECHNICAL: 'tecnico' });

export const PERFORMANCE_PRESET = Object.freeze({ LOW: 'bajo', BALANCED: 'equilibrado', HIGH: 'alto' });

/* Cuanto le cuesta a cada preset: mapa de sombra mas chico y sin
   entorno/postproceso en 'bajo' (equipos modestos/moviles), GTAO SOLO en
   'alto' -- nunca se activa un efecto caro sin que el preset lo pida
   explicitamente (regla de rendimiento del brief). */
export const PERFORMANCE_CONFIG = Object.freeze({
  [PERFORMANCE_PRESET.LOW]: { shadowMapSize: 512, environment: false, ao: false, pixelRatioCap: 1.5 },
  [PERFORMANCE_PRESET.BALANCED]: { shadowMapSize: 1024, environment: true, ao: false, pixelRatioCap: 2 },
  [PERFORMANCE_PRESET.HIGH]: { shadowMapSize: 2048, environment: true, ao: true, pixelRatioCap: 2 }
});

/* Paleta arquitectonica neutra para el fallback PBR de modo REALISTA
   (archivo sin materiales reales) -- deliberadamente distinta de
   DEFAULT_TECHNICAL_COLOR_HEX (gris tecnico plano de
   three3dVisualizationModes.js): esta es la que se ve bien BAJO luz fisica/
   entorno/sombras, no un color piano para modo tecnico. Nunca inventa una
   textura -- solo color/roughness/metalness base, coherentes entre si
   (concreto/piedra clara realista: no brillante, no metalico). */
export const REALISTIC_FALLBACK_MATERIAL_PARAMS = Object.freeze({
  color: 0xe6e1d6, roughness: 0.62, metalness: 0.03, envMapIntensity: 0.9
});

export function buildProfessionalFallbackMaterial(envMap = null){
  return new THREE.MeshPhysicalMaterial({
    ...REALISTIC_FALLBACK_MATERIAL_PARAMS,
    envMap,
    side: THREE.DoubleSide,
    clearcoat: 0,
    sheen: 0
  });
}

/* Fondo/ambiente de cada modo -- REALISTA usa un gris azulado neutro tipo
   "estudio fotografico" (nunca negro puro, que aplanaria las sombras;
   nunca blanco puro, que quema el tone mapping ACES); TECNICO usa un claro
   neutro tipo hoja de plano, el que el brief pide explicitamente ("no
   quiero el modelo gris oscuro casi plano"). */
export const RENDER_MODE_BACKGROUND = Object.freeze({
  [RENDER_MODE.REALISTIC]: 0x2b2f36,
  [RENDER_MODE.TECHNICAL]: 0xf4f2ee
});

export const RENDER_MODE_CONFIG = Object.freeze({
  [RENDER_MODE.REALISTIC]: {
    toneMapping: THREE.ACESFilmicToneMapping,
    exposure: 1.05,
    ambientIntensity: 0.35,
    keyIntensity: 2.2,
    fillIntensity: 0.5,
    shadows: true,
    groundPlane: 'contact'
  },
  [RENDER_MODE.TECHNICAL]: {
    toneMapping: THREE.NoToneMapping,
    exposure: 1,
    ambientIntensity: 1.05,
    keyIntensity: 0.55,
    fillIntensity: 0.45,
    shadows: false,
    groundPlane: 'none'
  }
});
