/* Fase 1 (visor 3D profesional, ver plan de evolucion integral): modos de
   visualizacion + paleta de color/material para modelos IMPORTADOS
   (Model3DPreview.jsx). Responsabilidad UNICA: decidir que material/color
   se ve en cada mesh segun el modo elegido, y saber restaurar el material
   ORIGINAL del archivo en cualquier momento -- NUNCA modifica el archivo/
   geometria real, solo el material del objeto tal como esta en memoria
   (si el usuario quiere conservar una visualizacion, eso es una decision
   explicita de guardado en otra capa, no de este modulo).

   Acoplado a Three.js -- misma convencion que three3dSceneKit.js/
   levantamientoModelLoader.js: sin test con node --test (no hay DOM/WebGL
   ahi), se verifica en Preview con dev-qa/qa-model3d.jsx.

   "Interpretar antes que preguntar" (pedido explicito del brief, "no
   resolver orientacion unicamente con botones manuales"): detectMaterialQuality
   decide POR DEFECTO si un modelo recien cargado se ve en modo 'realista'
   (si trae texturas o mas de un color real -- alguien SI lo coloreo/texturizo
   a proposito) o 'tecnico' (si es un solido gris/blanco plano, tipico de un
   OBJ sin .mtl o un exportador CAD que no asigno materiales reales) --
   Model3DPreview solo necesita leer ese resultado, nunca decidirlo a mano. */
import * as THREE from 'three';

export const VISUALIZATION_MODE = Object.freeze({
  REALISTIC: 'realista',   // material tal cual viene del archivo (o tecnico, si detectMaterialQuality dijo que no hay materiales reales)
  SOLID: 'solido',         // un solo color plano por mesh (el de la paleta activa), opaco
  TECHNICAL: 'tecnico',    // igual que SOLID + aristas siempre visibles (vista de plano/CAD)
  EDGES: 'aristas',        // solo las aristas, sin caras (para leer geometria pura)
  TRANSPARENT: 'transparente', // material actual con opacidad reducida
  WIREFRAME: 'alambre'     // triangulacion completa en lineas (three.js material.wireframe)
});

/* Presets pedidos explicitamente en el brief. Los valores son los mismos
   para claro/oscuro (son colores de MATERIAL del modelo, no de UI/tema --
   no deben leer variables CSS del tema de la app). */
export const MATERIAL_COLOR_PRESETS = Object.freeze([
  { id: 'blanco', label: 'Blanco', hex: 0xf5f5f2 },
  { id: 'gris', label: 'Gris', hex: 0x9a9a9a },
  { id: 'concreto', label: 'Concreto', hex: 0xb7b0a6 },
  { id: 'arena', label: 'Arena', hex: 0xd8c39c },
  { id: 'negro', label: 'Negro', hex: 0x2b2b2b },
  { id: 'azul_tecnico', label: 'Azul técnico', hex: 0x3d6b99 }
]);
export const DEFAULT_TECHNICAL_COLOR_HEX = MATERIAL_COLOR_PRESETS[1].hex; // Gris

/* Categorias para pintar "por parte" cuando el modelo trae nombres de mesh
   utiles (Revit/ArchiCAD/Blender bien nombrado) -- best effort, NUNCA se
   inventa una segmentacion que el archivo no trae. Bilingue (ES/EN) porque
   los exportadores BIM mas comunes nombran en ingles. */
export const MESH_PART_CATEGORY = Object.freeze({
  WALL: 'muros', STRUCTURE: 'estructura', SLAB: 'losas', ROOF: 'cubierta', OTHER: 'otros'
});
const PART_KEYWORDS = [
  [MESH_PART_CATEGORY.WALL, /muro|wall|tabique/i],
  [MESH_PART_CATEGORY.STRUCTURE, /estructura|column|columna|beam|viga|structure/i],
  [MESH_PART_CATEGORY.SLAB, /losa|slab|floor|piso|entrepiso/i],
  [MESH_PART_CATEGORY.ROOF, /cubierta|roof|techo/i]
];
/* Devuelve la categoria detectada por el NOMBRE del mesh/objeto padre, o
   OTHER si ninguna palabra clave coincide -- nunca lanza, nunca adivina por
   geometria (eso si seria inventar un dato que el archivo no declara). */
export function classifyMeshPart(mesh){
  const name = String(mesh?.name || mesh?.parent?.name || '');
  for(const [category, pattern] of PART_KEYWORDS){
    if(pattern.test(name)) return category;
  }
  return MESH_PART_CATEGORY.OTHER;
}

/* Recorre el modelo y arma el set de categorias realmente presentes -- si
   el resultado es solo {OTHER}, el modelo no trae segmentacion util y la UI
   debe ocultar el selector "pintar por parte" (mostrar un control que no
   sirve para nada es peor que no mostrarlo). */
export function detectAvailablePartCategories(object3D){
  const found = new Set();
  object3D?.traverse?.(node => { if(node.isMesh) found.add(classifyMeshPart(node)); });
  found.delete(MESH_PART_CATEGORY.OTHER);
  return Array.from(found);
}

const TEXTURE_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap', 'alphaMap', 'displacementMap'];
function materialHasTexture(mat){
  return TEXTURE_KEYS.some(key => Boolean(mat?.[key]));
}

/* Heuristica (nunca una certeza -- se documenta como tal, mismo criterio
   que el resto de la app con datos que no pueden confirmarse al 100%, ver
   PLANO_ELEMENT_STATES/ESCALA_FUENTES): un modelo tiene "materiales reales"
   si trae AL MENOS una textura, o AL MENOS dos colores distintos entre sus
   meshes -- ambas son senales de que alguien realmente los definio, no el
   valor por defecto plano que dejan los exportadores OBJ sin .mtl o un
   material "vacio" de un CAD generico. Con un solo mesh y un solo color no
   hay forma de distinguir "material real intencional" de "gris por
   defecto" -- se resuelve a favor de TECHNICAL (el material ZOEMEC), que es
   la opcion mas segura/interpretable arquitectonicamente cuando hay duda. */
export function detectMaterialQuality(object3D){
  const colors = new Set();
  let hasTexture = false;
  let meshCount = 0;
  object3D?.traverse?.(node => {
    if(!node.isMesh || !node.material) return;
    meshCount++;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach(mat => {
      if(materialHasTexture(mat)) hasTexture = true;
      if(mat?.color?.getHexString) colors.add(mat.color.getHexString());
    });
  });
  const hasRealMaterials = hasTexture || colors.size >= 2;
  return {
    hasRealMaterials,
    reason: hasTexture ? 'texturas_detectadas' : colors.size >= 2 ? 'multiples_colores_detectados' : 'sin_evidencia_de_material_real',
    meshCount, distinctColors: colors.size, hasTexture
  };
}

/* Guarda el material ORIGINAL de cada mesh en userData la PRIMERA vez que se
   toca (idempotente) -- es lo que permite volver a REALISTIC sin recargar
   el archivo. Nunca pisa un original ya guardado. */
function ensureOriginalMaterialStored(mesh){
  if(!mesh.userData.zoemecOriginalMaterial) mesh.userData.zoemecOriginalMaterial = mesh.material;
}

function disposeOverrideMaterial(mesh){
  const override = mesh.userData.zoemecOverrideMaterial;
  if(override && override !== mesh.userData.zoemecOriginalMaterial) override.dispose?.();
  mesh.userData.zoemecOverrideMaterial = null;
}

/* Aristas superpuestas (toggle independiente "Mostrar aristas", separado
   del modo EDGES): un THREE.LineSegments hijo de cada mesh, construido con
   EdgesGeometry (angulo de 20deg -- agrupa caras casi coplanares en una sola
   arista visual, evita "ruido" de triangulacion). thresholdAngle en grados,
   API real de EdgesGeometry. */
const EDGES_THRESHOLD_DEG = 20;
function setMeshEdgesVisible(mesh, visible, colorHex){
  let edges = mesh.userData.zoemecEdges;
  if(visible){
    if(!edges){
      const geometry = new THREE.EdgesGeometry(mesh.geometry, EDGES_THRESHOLD_DEG);
      const material = new THREE.LineBasicMaterial({ color: colorHex ?? 0x1a1a1a });
      edges = new THREE.LineSegments(geometry, material);
      edges.renderOrder = 1;
      mesh.add(edges);
      mesh.userData.zoemecEdges = edges;
    } else {
      edges.visible = true;
      edges.material.color.setHex(colorHex ?? 0x1a1a1a);
    }
  } else if(edges){
    edges.visible = false;
  }
}

/* Punto de entrada UNICO que Model3DPreview.jsx debe llamar cada vez que
   cambia modo/color/aristas -- idempotente (se puede llamar tantas veces
   como cambie la UI, siempre parte del material ORIGINAL guardado, nunca
   acumula overrides uno sobre otro). `partColorOverrides` (opcional):
   { [MESH_PART_CATEGORY]: hexColor } para pintar por parte cuando
   detectAvailablePartCategories no vino vacio -- ausente o {} = un solo
   color para todo el modelo. */
export function applyVisualizationMode(object3D, {
  mode = VISUALIZATION_MODE.REALISTIC,
  colorHex = DEFAULT_TECHNICAL_COLOR_HEX,
  showEdges = false,
  partColorOverrides = null
} = {}){
  if(!object3D) return;
  object3D.traverse(node => {
    if(!node.isMesh || !node.material) return;
    ensureOriginalMaterialStored(node);
    disposeOverrideMaterial(node);

    const partColor = partColorOverrides?.[classifyMeshPart(node)];
    const flatColor = partColor ?? colorHex;

    if(mode === VISUALIZATION_MODE.REALISTIC){
      node.material = node.userData.zoemecOriginalMaterial;
      setMeshEdgesVisible(node, showEdges);
      return;
    }

    if(mode === VISUALIZATION_MODE.EDGES){
      // Solo lineas: node.visible=false ocultaria TAMBIEN las aristas (son
      // hijas del mesh -- WebGLRenderer no recorre los hijos de un objeto
      // invisible). En vez de eso, se deja el mesh visible pero con un
      // material propio invisible (material.visible=false SI respeta a los
      // hijos) -- conserva bounding box/raycasting, las aristas se fuerzan
      // visibles sin importar showEdges.
      const invisible = new THREE.MeshBasicMaterial({ visible: false });
      node.material = invisible;
      node.userData.zoemecOverrideMaterial = invisible;
      setMeshEdgesVisible(node, true, flatColor);
      return;
    }

    const material = new THREE.MeshStandardMaterial({
      color: flatColor,
      side: THREE.DoubleSide,
      wireframe: mode === VISUALIZATION_MODE.WIREFRAME,
      transparent: mode === VISUALIZATION_MODE.TRANSPARENT,
      opacity: mode === VISUALIZATION_MODE.TRANSPARENT ? 0.35 : 1,
      roughness: 0.85,
      metalness: 0.05
    });
    node.material = material;
    node.userData.zoemecOverrideMaterial = material;
    setMeshEdgesVisible(node, showEdges || mode === VISUALIZATION_MODE.TECHNICAL, flatColor === colorHex ? 0x1a1a1a : flatColor);
  });
}

/* Libera TODOS los materiales/geometrias de override creados por este
   modulo (edges + material solido) -- debe llamarse en el cleanup del
   componente, ADEMAS de disposeLoadedModel (que libera el material
   ORIGINAL). Nunca toca zoemecOriginalMaterial: ese lo libera
   disposeLoadedModel como siempre lo hizo. */
export function disposeVisualizationOverrides(object3D){
  object3D?.traverse?.(node => {
    if(!node.isMesh) return;
    disposeOverrideMaterial(node);
    const edges = node.userData.zoemecEdges;
    if(edges){
      edges.geometry?.dispose();
      edges.material?.dispose();
      node.remove(edges);
      node.userData.zoemecEdges = null;
    }
  });
}
