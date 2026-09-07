/* Visor 3D de Levantamiento IA (Fase 1.5) -- HERMANO de
   src/features/visual3d/Technical3DViewer.jsx, no una variante acoplada a
   el: recibe un `space` de Levantamiento IA directamente (largo/ancho/alto
   reales + puertas/ventanas), nunca lo convierte a la forma de un `apu`.
   Comparte las piezas GENERICAS de three.js (renderer/camara/OrbitControls/
   iluminacion/grid/fabrica de cajas) via src/lib/three3dSceneKit.js -- la
   misma base que usa Technical3DViewer.jsx -- pero cada uno arma su propia
   geometria especifica (esta usa src/domain/levantamientoGeometry3d.js).

   Geometria tecnica, no fotorrealista (punto 6 del pedido de Fase 1.5):
   piso, 4 muros (como segmentos reales alrededor de cada hueco, sin CSG --
   ver levantamientoGeometry3d.js), puerta y ventana como relleno del hueco.
   Botones de vista: Reset/Superior/Frontal/Isometrica, ademas de rotar/zoom/
   pan que OrbitControls ya trae. */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { deriveGeometryFromSpace } from '../../domain/levantamientoGeometry3d.js';
import {
  createRenderer, createScene, createPerspectiveCamera, createOrbitControls,
  addStandardLighting, createGridHelper, createBoxMesh, disposeMesh,
  raycastFirstHit, CAMERA_VIEW_PRESETS, applyCameraView
} from '../../lib/three3dSceneKit.js';

const COLOR_BY_TYPE = { floor: 0xd9c8a8, ceiling: 0xe8e8ec, wall: 0xb7a98f, door: 0x8a5a34, window: 0x9fd3e8 };
const PLACEHOLDER_THICKNESS = 0.06;

function buildMesh(element){
  const d = element.dimensions;
  const isWindow = element.type === 'window';
  const mesh = createBoxMesh({
    width: d.width || 0.01,
    height: d.height || 0.01,
    depth: d.thickness || PLACEHOLDER_THICKNESS,
    color: COLOR_BY_TYPE[element.type] || 0xaaaaaa,
    transparent: isWindow,
    opacity: isWindow ? 0.55 : 1
  });
  mesh.userData = { id: element.id, label: element.label, type: element.type, wallId: element.wallId || null };
  mesh.position.set(element.position.x, element.position.y, element.position.z);
  mesh.rotation.y = element.rotationY || 0;
  return mesh;
}

export function Survey3DViewer({ space, onSelectElement }){
  const { t: tr } = useI18n();
  const mountRef = useRef(null);
  const meshesRef = useRef([]);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const onSelectElementRef = useRef(onSelectElement);
  onSelectElementRef.current = onSelectElement;
  const [selectedElementId, setSelectedElementId] = useState(null);

  // Sincrona y pura -- a diferencia de Technical3DViewer.jsx no hace falta
  // ningun "provider" async: levantamientoGeometry3d.js ya recibe el Space
  // completo (largo/ancho/alto siempre presentes una vez capturados en la
  // pestana Datos), no hay una llamada externa que esperar.
  const geometryResult = useMemo(() => deriveGeometryFromSpace(space), [space]);
  const elements = geometryResult.ok ? geometryResult.elements : [];

  // El Space NO esta centrado en el origen de la escena -- sus coordenadas
  // van de (0,0) a (length,width) (ver levantamientoGeometry3d.js#toScenePosition),
  // asi que el centro real del volumen es (length/2, height/2, width/2), no
  // (0,0,0). Los presets de camara/OrbitControls deben apuntar SIEMPRE a este
  // punto -- de lo contrario "Vista superior"/"Vista frontal" apuntan al
  // origen del mundo y el espacio queda fuera de cuadro (bug real encontrado
  // en QA: con un Space de 8x8, el centro es (4,*,4), no (0,*,0)).
  const roomCenter = useMemo(() => ({
    x: (Number(space?.length) || 0) / 2,
    y: (Number(space?.height) || 0) / 2,
    z: (Number(space?.width) || 0) / 2
  }), [space]);

  useEffect(() => {
    const mount = mountRef.current;
    if(!mount || !elements.length) return;
    const width = mount.clientWidth || 480, height = 360;
    const scene = createScene();
    const camera = createPerspectiveCamera(width, height, {
      x: roomCenter.x + CAMERA_VIEW_PRESETS.isometric.x,
      y: CAMERA_VIEW_PRESETS.isometric.y,
      z: roomCenter.z + CAMERA_VIEW_PRESETS.isometric.z
    });
    const renderer = createRenderer(width, height);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);

    const controls = createOrbitControls(camera, renderer.domElement);
    controls.target.set(roomCenter.x, roomCenter.y, roomCenter.z);
    addStandardLighting(scene);
    scene.add(createGridHelper());

    const meshes = elements.map(buildMesh);
    meshes.forEach(m => scene.add(m));
    meshesRef.current = meshes;

    const raycaster = new THREE.Raycaster();
    const onClick = (event) => {
      const hit = raycastFirstHit(raycaster, camera, event, renderer.domElement, meshes);
      if(hit){
        const data = hit.object.userData;
        setSelectedElementId(data.id);
        onSelectElementRef.current?.(data);
      }
    };
    renderer.domElement.addEventListener('click', onClick);

    let frameId;
    const animate = () => { controls.update(); renderer.render(scene, camera); frameId = requestAnimationFrame(animate); };
    animate();

    cameraRef.current = camera;
    controlsRef.current = controls;
    return () => {
      cancelAnimationFrame(frameId);
      renderer.domElement.removeEventListener('click', onClick);
      controls.dispose();
      meshes.forEach(disposeMesh);
      renderer.dispose();
      meshesRef.current = [];
      cameraRef.current = null;
      controlsRef.current = null;
      if(mount) mount.innerHTML = '';
    };
  }, [elements]);

  useEffect(() => {
    meshesRef.current.forEach(m => {
      const isSelected = !!selectedElementId && m.userData.id === selectedElementId;
      m.material.emissive?.setHex(isSelected ? 0x9146ff : 0x000000);
      m.material.emissiveIntensity = isSelected ? 0.55 : 0;
    });
  }, [selectedElementId]);

  const setView = (preset) => {
    if(!cameraRef.current || !controlsRef.current) return;
    applyCameraView(cameraRef.current, controlsRef.current, {
      x: roomCenter.x + preset.x,
      y: preset.y,
      z: roomCenter.z + preset.z
    }, roomCenter);
  };

  if(!geometryResult.ok){
    return <div className="panel"><p className="muted">{geometryResult.message}</p></div>;
  }

  const openingWarnings = elements.filter(e => (e.warnings || []).length > 0);
  const selectedElement = selectedElementId ? elements.find(e => e.id === selectedElementId) : null;

  return <div className="survey-3d-viewer">
    {openingWarnings.length > 0 && <div className="panel survey-3d-warning">
      <b>{tr('levantamiento.wallWarningTitle')}</b>
      <p className="muted" style={{fontSize:'.82rem', margin:'4px 0 0'}}>{tr('levantamiento.wallWarningHint')}</p>
    </div>}
    <div className="visual-actions" style={{marginBottom:6}}>
      <button type="button" className="soft" onClick={()=>setView(CAMERA_VIEW_PRESETS.isometric)}>{tr('levantamiento.view3dReset')}</button>
      <button type="button" className="soft" onClick={()=>setView(CAMERA_VIEW_PRESETS.top)}>{tr('levantamiento.view3dTop')}</button>
      <button type="button" className="soft" onClick={()=>setView(CAMERA_VIEW_PRESETS.front)}>{tr('levantamiento.view3dFront')}</button>
      <button type="button" className="soft" onClick={()=>setView(CAMERA_VIEW_PRESETS.isometric)}>{tr('levantamiento.view3dIso')}</button>
    </div>
    <div ref={mountRef} style={{width:'100%',minHeight:360}}/>
    {selectedElement && <div className="panel" style={{marginTop:8}}>
      <b>{tr('levantamiento.view3dSelected')}</b>
      <p className="muted" style={{fontSize:'.82rem',margin:'4px 0 0'}}>
        {selectedElement.label || selectedElement.type}
        {selectedElement.wallId ? ` · ${selectedElement.wallId}` : ''}
      </p>
    </div>}
  </div>;
}
