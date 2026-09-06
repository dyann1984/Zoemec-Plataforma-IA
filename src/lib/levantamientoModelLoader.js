/* Carga de modelos 3D importados (GLB/GLTF/OBJ) para Levantamiento IA (Fase
   2A). Acoplado a Three.js y a File/URL.createObjectURL del navegador -- por
   eso, siguiendo la misma convencion que el resto de archivos con Three.js
   de este proyecto (Survey3DViewer.jsx, Technical3DViewer.jsx), no tiene
   test unitario con node --test: se verifica en Preview cargando archivos
   reales, no con mocks de DOM/Three.

   Responsabilidad UNICA: convertir un File en un THREE.Object3D + metadatos
   (mallas, triangulos, bounding box). NUNCA decide si el formato/tamano son
   validos (eso es src/domain/levantamientoImporters.js#validateImportFile,
   pure y probado) ni convierte el bounding box en un Space (eso es
   src/domain/levantamientoImportConversion.js, pure y probado). */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

/* DRACOLoader necesita los decoders WASM/JS servidos desde algun lado --
   usamos el CDN oficial de Google (mismo que la documentacion de three.js
   recomienda) para no tener que empaquetar los binarios de Draco en este
   repo. Si un GLB no viene comprimido con Draco, este decoder simplemente
   nunca se usa (GLTFLoader solo lo invoca si el archivo trae la extension
   KHR_draco_mesh_compression). */
const DRACO_DECODER_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';

function countMeshesAndTriangles(object3D){
  let meshCount = 0, triangleCount = 0;
  object3D.traverse(node => {
    if(node.isMesh && node.geometry){
      meshCount++;
      const geom = node.geometry;
      if(geom.index) triangleCount += geom.index.count / 3;
      else if(geom.attributes?.position) triangleCount += geom.attributes.position.count / 3;
    }
  });
  return { meshCount, triangleCount: Math.round(triangleCount) };
}

function computeBoundingBox(object3D){
  const box = new THREE.Box3().setFromObject(object3D);
  const size = new THREE.Vector3();
  box.getSize(size);
  return {
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
    size: { x: size.x, y: size.y, z: size.z }
  };
}

function loadGLTFOrGLB(url, onProgress){
  return new Promise((resolve, reject) => {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);
    loader.load(
      url,
      gltf => { dracoLoader.dispose(); resolve(gltf.scene); },
      onProgress,
      err => { dracoLoader.dispose(); reject(err); }
    );
  });
}

function loadOBJ(url, onProgress){
  return new Promise((resolve, reject) => {
    new OBJLoader().load(url, resolve, onProgress, reject);
  });
}

/* Carga un archivo 3D y regresa su geometria + metadatos. Nunca lanza: toda
   falla (formato interno corrupto, error de parseo) se captura y regresa
   como {ok:false,...} para que la UI del wizard muestre un mensaje, nunca
   una pantalla rota. `formatId` es uno de SURVEY_IMPORT_FORMATS ('glb'|
   'gltf'|'obj') -- ya validado por validateImportFile antes de llegar aqui. */
export async function loadModel3D(file, formatId, { onProgress } = {}){
  const url = URL.createObjectURL(file);
  try {
    const object3D = formatId === 'obj'
      ? await loadOBJ(url, onProgress)
      : await loadGLTFOrGLB(url, onProgress);

    const { meshCount, triangleCount } = countMeshesAndTriangles(object3D);
    const boundingBox = computeBoundingBox(object3D);

    if(!(boundingBox.size.x > 0) && !(boundingBox.size.y > 0) && !(boundingBox.size.z > 0)){
      return { ok: false, reason: 'modelo_vacio', message: 'El archivo no contiene geometria visible.' };
    }

    return { ok: true, object3D, meshCount, triangleCount, boundingBox };
  } catch(err){
    return { ok: false, reason: 'error_de_carga', message: err?.message || 'No se pudo leer el archivo 3D.' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* Libera memoria de TODO el grafo cargado (geometrias + materiales de cada
   mesh) -- equivalente de disposeMesh en three3dSceneKit.js pero para un
   THREE.Object3D completo en vez de una sola caja. Debe llamarse en el
   cleanup del componente que monto el resultado de loadModel3D. */
export function disposeLoadedModel(object3D){
  if(!object3D) return;
  object3D.traverse(node => {
    if(node.isMesh){
      node.geometry?.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach(mat => {
        if(!mat) return;
        Object.values(mat).forEach(value => { if(value?.isTexture) value.dispose(); });
        mat.dispose?.();
      });
    }
  });
}
