/* Piezas 3D genericas de Three.js, extraidas de
   src/features/visual3d/Technical3DViewer.jsx (Fase 1.5): renderer/camara/
   OrbitControls/iluminacion/grid/fabrica de cajas/liberacion de memoria --
   nada aqui sabe que es un APU ni un Levantamiento. Technical3DViewer.jsx
   (visor de APU) y Survey3DViewer.jsx (visor de Levantamiento IA, nuevo)
   consumen este mismo kit para no duplicar la configuracion de three.js --
   ninguno de los dos fuerza al otro a compartir forma de datos, solo
   comparten estas primitivas mecanicas. */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export function createRenderer(width, height){
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  // Evita que el navegador interprete el gesto de rueda/arrastre sobre el
  // canvas como scroll/gesto de la pagina antes de que OrbitControls reciba
  // el evento -- el resto de la pagina conserva su scroll normal.
  renderer.domElement.style.touchAction = 'none';
  return renderer;
}

export function createScene(backgroundColor = 0xf2efe9){
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(backgroundColor);
  return scene;
}

export function createPerspectiveCamera(width, height, position){
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
  camera.position.set(position.x, position.y, position.z);
  return camera;
}

/* Configuracion EXPLICITA (mismos valores que Technical3DViewer.jsx ya
   usaba): zoom y pan habilitados, con limites reales para que la camara
   nunca atraviese el modelo ni se aleje al infinito. */
export function createOrbitControls(camera, domElement){
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.enableZoom = true;
  controls.enablePan = true;
  controls.zoomSpeed = 1;
  controls.minDistance = 1.5;
  controls.maxDistance = 50;
  return controls;
}

export function addStandardLighting(scene){
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(5, 10, 5);
  scene.add(dir);
}

/* INCIDENTE 3 (visor 3D) -- variante para modelos IMPORTADOS de tamano
   arbitrario (0.1m a 500m+, ver Model3DPreview.jsx). addStandardLighting
   (arriba) usa una posicion de luz FIJA (5,10,5) -- correcta para el tamano
   "tipico" de un Space dibujado a mano (unos pocos metros, siempre el mismo
   codigo lo genera), pero inutil para un archivo importado: en un modelo de
   200m esa luz practicamente coincide con el origen (ilumina un punto, deja
   el resto en sombra), y en uno de 0.05m queda kilometros de distancia
   relativa (funciona, pero por casualidad). Aqui la posicion/alcance de la
   luz escala con maxDimension (el mismo valor que ya usa Model3DPreview para
   encuadrar la camara), y se agrega una luz de relleno en la direccion
   opuesta (fillLight, menor intensidad) para que ninguna cara quede 100% sin
   luz solo por la orientacion con la que el modelo llego -- reduce el
   sintoma "oscuros" para cualquier orientacion, no solo la que la luz
   principal favorece. NUNCA sustituye a addStandardLighting para los
   visores existentes (Survey3DViewer/Technical3DViewer siguen exactamente
   igual, cero riesgo de regresion ahi). */
export function addImportedModelLighting(scene, maxDimension = 6){
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(maxDimension, maxDimension * 1.5, maxDimension);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.4);
  fill.position.set(-maxDimension, maxDimension * 0.5, -maxDimension);
  scene.add(fill);
}

export function createGridHelper(size = 20, divisions = 20){
  return new THREE.GridHelper(size, divisions, 0xbbbbbb, 0xdddddd);
}

/* Fabrica generica de una caja con material estandar -- no sabe de "muro" ni
   "puerta", solo recibe dimensiones/color/opacidad. Cada consumidor decide
   que representa la caja. */
export function createBoxMesh({ width, height, depth, color = 0xaaaaaa, transparent = false, opacity = 1 }){
  const geometry = new THREE.BoxGeometry(Math.max(width, 0.001), Math.max(height, 0.001), Math.max(depth, 0.001));
  const material = new THREE.MeshStandardMaterial({ color, transparent, opacity });
  return new THREE.Mesh(geometry, material);
}

export function disposeMesh(mesh){
  mesh.geometry?.dispose();
  mesh.material?.dispose();
}

export function raycastFirstHit(raycaster, camera, event, domElement, meshes){
  const rect = domElement.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(meshes)[0] || null;
}

/* Presets de camara reutilizables. "isometric" es el encuadre historico de
   Technical3DViewer.jsx (camera.position.set(6,6,8)) -- se deja aqui para
   que cualquier visor que quiera el mismo punto de partida lo use tal cual,
   sin repetir el numero magico.

   `up` (INCIDENTE 3, hallazgo "vistas poco utiles"): con la camara casi
   exactamente arriba del target (top: x/z~0), la direccion de vista queda
   CASI PARALELA al vector `up` por defecto de three.js (0,1,0) -- un caso
   degenerado donde camera.lookAt()/OrbitControls ya no pueden derivar un
   "arriba de pantalla" consistente y terminan escogiendo un roll arbitrario
   (confirmado en QA: la vista superior salia rotada ~45 grados, un
   rectangulo real se veia como un rombo, inutilizable para leer una planta).
   Cada preset ahora declara su propio `up` explicito -- top usa (0,0,-1)
   (convencion de plano arquitectonico: "arriba" de la pantalla = -Z) en vez
   de depender del default, que es exactamente el eje degenerado en ese caso.
   isometric/front siguen con (0,1,0) (el default de three.js, sin cambios de
   comportamiento ahi) pero declarado explicito para que applyCameraView
   nunca dependa de que sobreviva un `up` que un preset previo haya dejado. */
export const CAMERA_VIEW_PRESETS = Object.freeze({
  isometric: { x: 6, y: 6, z: 8, up: { x: 0, y: 1, z: 0 } },
  top: { x: 0.001, y: 14, z: 0.001, up: { x: 0, y: 0, z: -1 } },
  front: { x: 0, y: 1.6, z: 14, up: { x: 0, y: 1, z: 0 } }
});

export function applyCameraView(camera, controls, preset, target = { x: 0, y: 0, z: 0 }){
  if(preset.up) camera.up.set(preset.up.x, preset.up.y, preset.up.z);
  camera.position.set(preset.x, preset.y, preset.z);
  controls.target.set(target.x, target.y, target.z);
  controls.update();
}
