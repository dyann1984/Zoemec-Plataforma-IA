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
import { detectMaterialQuality } from './three3dVisualizationModes.js';
import { diagnoseModel3D } from '../domain/model3dDiagnostics.js';

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

/* INCIDENTE 3 (visor 3D) -- causa raiz "oscuros": muchos exportadores OBJ (y
   algunos GLB mal formados) no escriben normales de vertice, o las escriben
   invertidas. THREE.MeshStandardMaterial/MeshPhongMaterial dependen POR
   COMPLETO de la normal para calcular la luz que le llega a cada cara -- sin
   normal (o con una normal en la direccion contraria a la luz), la cara se
   ve negra, sin importar cuantas luces tenga la escena. Se recalculan SIEMPRE
   (nunca hace dano recalcular una normal ya correcta) y se fuerza
   `side:THREE.DoubleSide` en cada material -- la causa raiz relacionada "caras
   invisibles/negras por winding invertido": con el `side` por defecto
   (FrontSide), una cara cuyo orden de vertices quedo invertido durante la
   exportacion/conversion de ejes es literalmente CULLED (ni se dibuja) desde
   el lado "de adentro", lo que en un modelo con normales mixtas se percibe
   como huecos negros o piezas "que faltan". */
/* Devuelve si ALGUNA malla llego sin normales -- lo consume diagnoseModel3D
   para reportar "Normales: corregidas" vs "Normales: originales del
   archivo" en vez de recalcular en silencio como si el archivo siempre
   hubiera venido bien. */
function fixMaterialsAndNormals(object3D){
  let anyNormalsWereMissing = false;
  object3D.traverse(node => {
    if(!node.isMesh || !node.geometry) return;
    const geom = node.geometry;
    if(!geom.attributes?.normal){ anyNormalsWereMissing = true; geom.computeVertexNormals(); }
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach(mat => { if(mat) mat.side = THREE.DoubleSide; });
  });
  return anyNormalsWereMissing;
}

/* Bounding box MUNDIAL de cada malla de primer nivel (no del objeto
   completo) -- es la evidencia real que consume detectUpAxis/
   detectGeometryAtypical en model3dDiagnostics.js: para saber si "los
   pisos se apilan" hace falta comparar mallas entre si, no solo la caja
   total del modelo completo. */
function collectMeshGroups(object3D){
  const groups = [];
  object3D.traverse(node => {
    if(!node.isMesh || !node.geometry) return;
    const box = new THREE.Box3().setFromObject(node);
    groups.push({
      name: node.name || '(sin nombre)',
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z]
    });
  });
  return groups;
}

/* Aplica la correccion de orientacion que model3dDiagnostics.js detecto
   con evidencia real (nunca a ciegas por formato, ver comentario extenso
   en ese modulo) -- mismas rotaciones que ya usa
   applyDefaultUpAxisCorrection para Z-up, mas el caso simetrico para
   X-up. */
function applyDetectedUpAxisCorrection(object3D, detectedAxis){
  if(detectedAxis === 'z') object3D.rotateX(-Math.PI / 2);
  else if(detectedAxis === 'x') object3D.rotateZ(Math.PI / 2);
  object3D.updateMatrixWorld(true);
}

/* INCIDENTE 3 -- causa raiz "rotados/invertidos/deformados" en archivos OBJ:
   a diferencia de glTF/GLB (la especificacion OBLIGA Y-up, GLTFLoader ya
   entrega el modelo correctamente orientado), el formato OBJ NO tiene NINGUN
   campo que declare cual eje es "arriba" -- es ambiguedad real del formato,
   no un bug de esta app. La convencion abrumadoramente mas comun en software
   de arquitectura/BIM que exporta OBJ (Revit, ArchiCAD, Rhino, SketchUp con
   ejes por defecto, etc.) es Z-up. Se aplica esa correccion por defecto
   (rotar -90 grados en X: Z-up -> Y-up) SOLO para OBJ -- nunca para GLB/GLTF,
   que ya vienen correctos. Esto es una CONVENCION, no una certeza -- por eso
   Model3DPreview.jsx tambien expone botones de rotacion manual (90 grados por
   eje) para el caso real en que el archivo de origen si era Y-up y esta
   correccion lo dejo mal: el usuario corrige visualmente con un click, sin
   tener que adivinar en un editor externo. */
function applyDefaultUpAxisCorrection(object3D, formatId){
  if(formatId !== 'obj') return;
  object3D.rotateX(-Math.PI / 2);
  object3D.updateMatrixWorld(true);
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

    applyDefaultUpAxisCorrection(object3D, formatId);
    const materialQuality = detectMaterialQuality(object3D);
    const anyNormalsWereMissing = fixMaterialsAndNormals(object3D);

    // INCIDENTE 3 (cierre real, "no fingir que esta bien"): la correccion
    // de eje por formato de arriba (Z-up->Y-up SOLO para OBJ) confia en la
    // convencion del formato, no en los datos reales -- un GLB/GLTF real
    // diagnosticado en produccion (casa_toledo_desde_plano.glb) demostro
    // que un exportador puede escribir datos Z-up dentro de un contenedor
    // glTF sin convertir ejes, violando la especificacion en silencio. Esta
    // segunda pasada usa EVIDENCIA real (como se apilan las mallas entre
    // si, ver model3dDiagnostics.js) en vez de confiar ciegamente en el
    // formato, y solo corrige cuando la evidencia es clara -- nunca "porque
    // el formato dice que deberia estar bien".
    const diagnostics = diagnoseModel3D({
      formatId, groups: collectMeshGroups(object3D),
      hasRealMaterials: materialQuality.hasRealMaterials, anyNormalsWereMissing
    });
    if(diagnostics.rotationCorrection) applyDetectedUpAxisCorrection(object3D, diagnostics.rotationCorrection);

    const { meshCount, triangleCount } = countMeshesAndTriangles(object3D);
    // Bounding box SIEMPRE calculado DESPUES de la correccion de ejes -- si
    // se calculara antes, el ancho/alto/profundidad reportados (y el Space
    // que deriveSpaceFromImportedModel arma a partir de ellos, ver
    // levantamientoImportConversion.js) quedarian intercambiados para
    // cualquier OBJ Z-up (la "altura" real terminaria reportada como
    // "profundidad"), el mismo bug de fondo detras de "deformados".
    const boundingBox = computeBoundingBox(object3D);

    if(!(boundingBox.size.x > 0) && !(boundingBox.size.y > 0) && !(boundingBox.size.z > 0)){
      return { ok: false, reason: 'modelo_vacio', message: 'El archivo no contiene geometria visible.' };
    }

    return { ok: true, object3D, meshCount, triangleCount, boundingBox, diagnostics };
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
