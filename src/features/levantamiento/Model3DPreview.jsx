/* Vista previa del modelo 3D crudo importado (Fase 2A, paso "visualizar" /
   "definir/verificar escala" del wizard de importacion). HERMANO de
   Survey3DViewer.jsx, no una variante: ese componente solo sabe montar la
   geometria DERIVADA de un Space (deriveGeometryFromSpace) -- este monta el
   THREE.Object3D crudo que devuelve src/lib/levantamientoModelLoader.js,
   antes de que exista ningun Space. Comparte las mismas piezas genericas de
   three.js via src/lib/three3dSceneKit.js (renderer/camara/OrbitControls/
   iluminacion/grid/presets de vista) -- la misma base que ya usan
   Survey3DViewer.jsx y Technical3DViewer.jsx.

   Camara centrada en el centro REAL del bounding box (no en el origen) desde
   el inicio -- Survey3DViewer.jsx documenta este mismo bug (un Space de 8x8
   queda fuera de cuadro si la camara apunta a (0,0,0)) como algo encontrado
   en QA; aqui se evita repetirlo. */
import { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n/I18nContext.jsx';
import {
  createRenderer, createScene, createPerspectiveCamera, createOrbitControls,
  addStandardLighting, createGridHelper, CAMERA_VIEW_PRESETS, applyCameraView
} from '../../lib/three3dSceneKit.js';

export function Model3DPreview({ object3D, boundingBox }){
  const { t: tr } = useI18n();
  const mountRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);

  const center = boundingBox ? {
    x: (boundingBox.min.x + boundingBox.max.x) / 2,
    y: (boundingBox.min.y + boundingBox.max.y) / 2,
    z: (boundingBox.min.z + boundingBox.max.z) / 2
  } : { x: 0, y: 0, z: 0 };

  // Radio del encuadre inicial proporcional al tamano real del modelo -- un
  // modelo de 1m y uno de 40m no pueden usar el mismo offset fijo de camara
  // (CAMERA_VIEW_PRESETS.isometric asume una escala "tipica" de Space, no
  // sirve tal cual para un archivo importado de tamano arbitrario).
  const maxDimension = boundingBox
    ? Math.max(boundingBox.size.x, boundingBox.size.y, boundingBox.size.z, 0.5)
    : 6;
  const frameScale = maxDimension / 6;

  useEffect(() => {
    const mount = mountRef.current;
    if(!mount || !object3D) return;
    const width = mount.clientWidth || 480, height = 360;
    const scene = createScene();
    const camera = createPerspectiveCamera(width, height, {
      x: center.x + CAMERA_VIEW_PRESETS.isometric.x * frameScale,
      y: center.y + CAMERA_VIEW_PRESETS.isometric.y * frameScale,
      z: center.z + CAMERA_VIEW_PRESETS.isometric.z * frameScale
    });
    const renderer = createRenderer(width, height);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);

    const controls = createOrbitControls(camera, renderer.domElement);
    controls.target.set(center.x, center.y, center.z);
    controls.minDistance = Math.max(0.1, maxDimension * 0.1);
    controls.maxDistance = maxDimension * 10;
    addStandardLighting(scene);
    scene.add(createGridHelper(Math.max(20, maxDimension * 2), 20));
    scene.add(object3D);

    let frameId;
    const animate = () => { controls.update(); renderer.render(scene, camera); frameId = requestAnimationFrame(animate); };
    animate();

    cameraRef.current = camera;
    controlsRef.current = controls;
    return () => {
      cancelAnimationFrame(frameId);
      controls.dispose();
      scene.remove(object3D);
      renderer.dispose();
      cameraRef.current = null;
      controlsRef.current = null;
      if(mount) mount.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [object3D]);

  const setView = (preset) => {
    if(!cameraRef.current || !controlsRef.current) return;
    applyCameraView(cameraRef.current, controlsRef.current, {
      x: center.x + preset.x * frameScale,
      y: center.y + preset.y * frameScale,
      z: center.z + preset.z * frameScale
    }, center);
  };

  return <div className="model3d-preview">
    <div className="visual-actions" style={{ marginBottom: 6 }}>
      <button type="button" className="soft" onClick={() => setView(CAMERA_VIEW_PRESETS.isometric)}>{tr('levantamiento.view3dReset')}</button>
      <button type="button" className="soft" onClick={() => setView(CAMERA_VIEW_PRESETS.top)}>{tr('levantamiento.view3dTop')}</button>
      <button type="button" className="soft" onClick={() => setView(CAMERA_VIEW_PRESETS.front)}>{tr('levantamiento.view3dFront')}</button>
      <button type="button" className="soft" onClick={() => setView(CAMERA_VIEW_PRESETS.isometric)}>{tr('levantamiento.view3dIso')}</button>
    </div>
    <div ref={mountRef} style={{ width: '100%', minHeight: 360 }} />
  </div>;
}
