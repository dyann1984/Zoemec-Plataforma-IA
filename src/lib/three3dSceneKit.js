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
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/* `preserveDrawingBuffer` (opcional, default false -- CERO cambio de
   comportamiento para Technical3DViewer.jsx/Survey3DViewer.jsx, que nunca
   lo pasan): sin esto, el navegador puede limpiar el framebuffer despues de
   componer cada frame, y `canvas.toDataURL()`/`readPixels()` llamados
   DESDE FUERA del loop de render (ej. un boton "capturar imagen", o QA)
   leen buffer vacio. Costo real pero pequeno en GPUs modernas -- solo se
   activa donde de verdad se necesita capturar el canvas. */
export function createRenderer(width, height, { preserveDrawingBuffer = false } = {}){
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer });
  renderer.setSize(width, height);
  // Evita que el navegador interprete el gesto de rueda/arrastre sobre el
  // canvas como scroll/gesto de la pagina antes de que OrbitControls reciba
  // el evento -- el resto de la pagina conserva su scroll normal.
  renderer.domElement.style.touchAction = 'none';
  return renderer;
}

/* Visor 3D profesional (Model3DPreview) -- SOLO estas piezas nuevas, nunca
   los defaults de createRenderer/addStandardLighting de arriba: Technical3DViewer.jsx
   (visor de APU) y Survey3DViewer.jsx siguen llamando exactamente las mismas
   funciones de siempre, sin tocar una sola linea de este archivo que ya
   usaban -- lo de aqui abajo es PURAMENTE aditivo, nadie mas lo importa
   todavia. */

/* Tone mapping/exposicion/sombras -- se llama UNA vez tras crear el
   renderer, nunca dentro del loop de animacion. `shadows=false` dejw
   shadowMap.enabled en false (costo cero, ver PERFORMANCE_PRESET en
   three3dRenderModes.js) sin tener que acordarse de desactivarlo aparte. */
export function configureRendererQuality(renderer, {
  toneMapping = THREE.NoToneMapping, exposure = 1, shadows = false, pixelRatio = null
} = {}){
  renderer.toneMapping = toneMapping;
  renderer.toneMappingExposure = exposure;
  renderer.shadowMap.enabled = shadows;
  if(shadows) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if(pixelRatio) renderer.setPixelRatio(Math.min(pixelRatio, 2));
}

/* Entorno neutro procedural (RoomEnvironment de three.js, NUNCA un HDRI
   externo descargado -- "no inventar texturas especificas del edificio"
   tambien aplica a no depender de un asset de iluminacion que no viene con
   el proyecto). PMREMGenerator es costoso (compila un mapa de convolucion)
   -- se calcula UNA sola vez por renderer/vida del componente, nunca por
   frame; el llamador debe guardar el resultado y llamar dispose() en su
   cleanup. Devuelve null si algo falla (WebGL viejo, contexto perdido) en
   vez de lanzar -- el modo realista debe seguir viendose bien (solo sin
   reflejos de entorno) aunque esto no este disponible. */
export function createStudioEnvironment(renderer){
  try{
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envRenderTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    pmrem.dispose();
    return envRenderTarget.texture;
  }catch{
    return null;
  }
}

/* Piso de contacto: SOLO recibe sombra (ShadowMaterial, transparente donde
   no hay sombra) -- nunca compite visualmente con el modelo ni con el
   ground plane "real" que el archivo pudiera traer. Se posiciona en el
   Y minimo real del bounding box (nunca en Y=0 fijo -- un modelo importado
   puede empezar en cualquier altura). */
export function createContactShadowGround(size, groundY){
  const geometry = new THREE.PlaneGeometry(size, size);
  const material = new THREE.ShadowMaterial({ opacity: 0.28 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = groundY;
  mesh.receiveShadow = true;
  return mesh;
}

/* Piso arquitectonico "solido" para modo tecnico (opcional, ver
   three3dRenderModes.js) -- una superficie clara simple, nunca una textura
   de material real (evita "inventar" un piso que el archivo no trae). */
export function createArchitecturalFloor(size, groundY, colorHex = 0xf4f2ee){
  const geometry = new THREE.PlaneGeometry(size, size);
  const material = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = groundY;
  mesh.receiveShadow = true;
  return mesh;
}

export function createAxesHelper(size){
  return new THREE.AxesHelper(size);
}

/* Habilita sombra suave en una luz direccional ya creada -- frustum del
   shadow camera dimensionado a maxDimension (mismo criterio que
   addImportedModelLighting: un numero fijo funcionaria "por casualidad"
   para un tamano de modelo y mal para el resto). mapSize mas chico en
   dispositivos de gama baja (ver PERFORMANCE_PRESET), nunca 4K fijo. */
export function configureShadowLight(light, { maxDimension = 6, mapSize = 1024 } = {}){
  light.castShadow = true;
  light.shadow.mapSize.set(mapSize, mapSize);
  const half = maxDimension * 1.5;
  light.shadow.camera.left = -half;
  light.shadow.camera.right = half;
  light.shadow.camera.top = half;
  light.shadow.camera.bottom = -half;
  light.shadow.camera.near = 0.1;
  light.shadow.camera.far = maxDimension * 6;
  light.shadow.bias = -0.0005;
  light.shadow.normalBias = 0.02;
  light.shadow.camera.updateProjectionMatrix();
}

/* Heuristica de capacidad del dispositivo -- nunca una certeza (no hay forma
   de medir FPS real de antemano sin renderizar), solo senales baratas de
   consultar antes del primer frame: nucleos logicos de CPU (proxy comun de
   "equipo modesto"), pixelRatio (una pantalla 3x cuesta 9x los fragmentos
   de una 1x al mismo tamano CSS) y si es un dispositivo tactil/movil (menor
   presupuesto termico/GPU que una laptop). Resuelve a favor de 'equilibrado'
   cuando la señal es ambigua -- nunca 'alto' por defecto (efectos caros
   indiscriminados es exactamente lo que el brief pide evitar). */
export function detectRenderQualityPreset(){
  if(typeof navigator === 'undefined') return 'equilibrado';
  const cores = navigator.hardwareConcurrency || 4;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const isMobile = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent || '');
  if(isMobile || cores <= 4) return 'bajo';
  if(cores >= 8 && dpr <= 2) return 'alto';
  return 'equilibrado';
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
/* `ambientIntensity`/`keyIntensity`/`fillIntensity` (opcionales, ver
   three3dRenderModes.js#RENDER_MODE_CONFIG): mismos defaults 0.7/0.9/0.4 de
   siempre cuando el llamador no los pasa -- comportamiento identico al
   historico para cualquier codigo que ya llamaba esta funcion sin el nuevo
   parametro. Devuelve { ambient, key, fill } para que el llamador pueda
   activar sombra en `key` (ver configureShadowLight) sin que esta funcion
   tenga que saber de sombras. */
export function addImportedModelLighting(scene, maxDimension = 6, {
  ambientIntensity = 0.7, keyIntensity = 0.9, fillIntensity = 0.4
} = {}){
  const ambient = new THREE.AmbientLight(0xffffff, ambientIntensity);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, keyIntensity);
  key.position.set(maxDimension, maxDimension * 1.5, maxDimension);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, fillIntensity);
  fill.position.set(-maxDimension, maxDimension * 0.5, -maxDimension);
  scene.add(fill);
  return { ambient, key, fill };
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
