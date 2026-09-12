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
import * as THREE from 'three';
import { useI18n } from '../../i18n/I18nContext.jsx';
import {
  createRenderer, createScene, createPerspectiveCamera, createOrbitControls,
  addImportedModelLighting, createGridHelper, CAMERA_VIEW_PRESETS, applyCameraView
} from '../../lib/three3dSceneKit.js';

/* INCIDENTE 3 (visor 3D) -- "rotados/invertidos": el formato OBJ no declara
   cual eje es "arriba" (ver applyDefaultUpAxisCorrection en
   levantamientoModelLoader.js, que ya aplica la convencion Z-up->Y-up mas
   comun por defecto). Cuando esa convencion no aplica al archivo real, el
   usuario necesita una forma de corregirlo el mismo, sin editor externo --
   estos botones rotan el modelo 90 grados por eje. `onBoundingBoxChange`
   (opcional) permite que el wizard que lo use recalcule dimensiones/escala
   con el bounding box YA rotado -- sin esto, confirmar escala contra una
   caja que ya no corresponde a la orientacion visible seria el mismo bug
   "deformados" con otro disfraz. */
function recomputeBoundingBox(object3D){
  const box = new THREE.Box3().setFromObject(object3D);
  const size = new THREE.Vector3();
  box.getSize(size);
  return {
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
    size: { x: size.x, y: size.y, z: size.z }
  };
}

export function Model3DPreview({ object3D, boundingBox, onBoundingBoxChange = null }){
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
    addImportedModelLighting(scene, maxDimension);
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
      z: center.z + preset.z * frameScale,
      up: preset.up
    }, center);
  };

  /* rotateModel: correccion MANUAL de orientacion (ver comentario arriba de
     este archivo) -- rota el Object3D real 90 grados sobre el eje elegido,
     recalcula su bounding box (rotar cambia cual dimension es "ancho" y
     cual es "alto") y RECENTRA la camara/OrbitControls al nuevo centro --
     sin esto, tras rotar el modelo podria quedar fuera de cuadro (el pivote
     de rotacion es el origen local del objeto, no necesariamente el centro
     visual). onBoundingBoxChange informa al wizard que lo use (Import3DSurveyForm)
     para que la escala/Space que se derive despues use las dimensiones
     REALES ya corregidas, nunca las de antes de rotar. */
  const rotateModel = (axis) => {
    if(!object3D) return;
    if(axis === 'x') object3D.rotateX(Math.PI / 2);
    else if(axis === 'y') object3D.rotateY(Math.PI / 2);
    else object3D.rotateZ(Math.PI / 2);
    object3D.updateMatrixWorld(true);
    const nextBox = recomputeBoundingBox(object3D);
    const nextCenter = {
      x: (nextBox.min.x + nextBox.max.x) / 2, y: (nextBox.min.y + nextBox.max.y) / 2, z: (nextBox.min.z + nextBox.max.z) / 2
    };
    if(controlsRef.current) controlsRef.current.target.set(nextCenter.x, nextCenter.y, nextCenter.z);
    onBoundingBoxChange?.(nextBox);
  };

  return <div className="model3d-preview">
    <div className="visual-actions" style={{ marginBottom: 6 }}>
      <button type="button" className="soft" onClick={() => setView(CAMERA_VIEW_PRESETS.isometric)}>{tr('levantamiento.view3dReset')}</button>
      <button type="button" className="soft" onClick={() => setView(CAMERA_VIEW_PRESETS.top)}>{tr('levantamiento.view3dTop')}</button>
      <button type="button" className="soft" onClick={() => setView(CAMERA_VIEW_PRESETS.front)}>{tr('levantamiento.view3dFront')}</button>
      <button type="button" className="soft" onClick={() => setView(CAMERA_VIEW_PRESETS.isometric)}>{tr('levantamiento.view3dIso')}</button>
    </div>
    {onBoundingBoxChange && <div className="visual-actions" style={{ marginBottom: 6 }}>
      <span className="muted" style={{ fontSize: '.72rem', alignSelf: 'center' }}>{tr('levantamiento.view3dRotateHint')}</span>
      <button type="button" className="soft" onClick={() => rotateModel('x')}>{tr('levantamiento.view3dRotateX')}</button>
      <button type="button" className="soft" onClick={() => rotateModel('y')}>{tr('levantamiento.view3dRotateY')}</button>
      <button type="button" className="soft" onClick={() => rotateModel('z')}>{tr('levantamiento.view3dRotateZ')}</button>
    </div>}
    <div ref={mountRef} style={{ width: '100%', minHeight: 360 }} />
  </div>;
}
