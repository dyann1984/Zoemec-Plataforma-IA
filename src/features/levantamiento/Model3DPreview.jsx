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
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useI18n } from '../../i18n/I18nContext.jsx';
import {
  createRenderer, createScene, createPerspectiveCamera, createOrbitControls,
  addImportedModelLighting, createGridHelper, CAMERA_VIEW_PRESETS, applyCameraView
} from '../../lib/three3dSceneKit.js';
import {
  VISUALIZATION_MODE, MATERIAL_COLOR_PRESETS, DEFAULT_TECHNICAL_COLOR_HEX,
  detectMaterialQuality, detectAvailablePartCategories, applyVisualizationMode, disposeVisualizationOverrides
} from '../../lib/three3dVisualizationModes.js';

const VISUALIZATION_MODE_ORDER = [
  VISUALIZATION_MODE.REALISTIC, VISUALIZATION_MODE.SOLID, VISUALIZATION_MODE.TECHNICAL,
  VISUALIZATION_MODE.EDGES, VISUALIZATION_MODE.TRANSPARENT, VISUALIZATION_MODE.WIREFRAME
];
const MODE_LABEL_KEY = {
  [VISUALIZATION_MODE.REALISTIC]: 'viz3dModeRealistic', [VISUALIZATION_MODE.SOLID]: 'viz3dModeSolid',
  [VISUALIZATION_MODE.TECHNICAL]: 'viz3dModeTechnical', [VISUALIZATION_MODE.EDGES]: 'viz3dModeEdges',
  [VISUALIZATION_MODE.TRANSPARENT]: 'viz3dModeTransparent', [VISUALIZATION_MODE.WIREFRAME]: 'viz3dModeWireframe'
};
function partLabelKey(category){ return 'viz3dPart' + category.charAt(0).toUpperCase() + category.slice(1); }
function colorLabelKey(presetId){ return 'viz3dColor' + presetId.charAt(0).toUpperCase() + presetId.slice(1); }
function hexToCss(hex){ return '#' + hex.toString(16).padStart(6, '0'); }

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

/* "Estado del modelo" (Incidente 3, cierre real): nunca declarar un
   archivo "bien" sin evidencia -- diagnostics viene de
   src/lib/levantamientoModelLoader.js#loadModel3D (que a su vez usa
   src/domain/model3dDiagnostics.js, la logica real de deteccion). Ausente
   (undefined) para llamadores viejos que todavia no pasan boundingBox
   propio -- no revienta, simplemente no se muestra el panel. */
function ModelStatusPanel({ diagnostics, tr }){
  if(!diagnostics) return null;
  const orientationLabelKey = {
    valida: 'model3dStatusOrientationValid', corregida: 'model3dStatusOrientationCorrected', dudosa: 'model3dStatusOrientationUncertain'
  }[diagnostics.orientation.status];
  const materialsLabelKey = diagnostics.materials.status === 'validos' ? 'model3dStatusMaterialsValid' : 'model3dStatusMaterialsMissing';
  const normalsLabelKey = diagnostics.normals.status === 'validas' ? 'model3dStatusNormalsValid' : 'model3dStatusNormalsCorrected';
  const scaleLabelKey = diagnostics.scale.status === 'confirmada' ? 'model3dStatusScaleConfirmed' : 'model3dStatusScaleUnknown';
  const geometryLabelKey = diagnostics.geometry.status === 'valida' ? 'model3dStatusGeometryValid' : 'model3dStatusGeometryAtypical';
  const isWarning = (status) => status === 'dudosa' || status === 'atipica' || status === 'ausentes' || status === 'corregidas' || status === 'corregida';
  const row = (labelKey, valueLabelKey, status, detail) => <div className="model3d-status-row" key={labelKey}>
    <span className="muted" style={{ fontSize: '.72rem' }}>{tr(`levantamiento.${labelKey}`)}:</span>
    <span style={{ fontSize: '.78rem', fontWeight: 600, color: isWarning(status) ? 'var(--warning, #b45309)' : 'var(--success, #15803d)' }}>{tr(`levantamiento.${valueLabelKey}`)}</span>
    {detail && <span className="muted" style={{ fontSize: '.68rem', flexBasis: '100%' }}>{detail}</span>}
  </div>;
  return <div className="model3d-status-panel panel" style={{ padding: 10, marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
    <b style={{ fontSize: '.78rem' }}>{tr('levantamiento.model3dStatusTitle')}</b>
    {row('model3dStatusOrientationLabel', orientationLabelKey, diagnostics.orientation.status,
      diagnostics.orientation.status === 'corregida' ? tr('levantamiento.model3dStatusOrientationCorrectedDetail', { axis: diagnostics.orientation.detectedAxis.toUpperCase() })
        : diagnostics.orientation.status === 'dudosa' ? tr('levantamiento.model3dStatusOrientationUncertainDetail') : null)}
    {row('model3dStatusGeometryLabel', geometryLabelKey, diagnostics.geometry.status,
      diagnostics.geometry.status === 'atipica' ? tr('levantamiento.model3dStatusGeometryAtypicalDetail', { groupA: diagnostics.geometry.detail?.groupA || '?', groupB: diagnostics.geometry.detail?.groupB || '?' }) : null)}
    {row('model3dStatusMaterialsLabel', materialsLabelKey, diagnostics.materials.status)}
    {row('model3dStatusNormalsLabel', normalsLabelKey, diagnostics.normals.status)}
    {row('model3dStatusScaleLabel', scaleLabelKey, diagnostics.scale.status)}
  </div>;
}

export function Model3DPreview({ object3D, boundingBox, diagnostics = null, onBoundingBoxChange = null }){
  const { t: tr } = useI18n();
  const mountRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);

  // Fase 1 (visor 3D profesional): "interpretar antes que preguntar" -- el
  // modo inicial NO es siempre "realista": si el archivo no trae materiales
  // reales detectables (heuristica en three3dVisualizationModes.js), arranca
  // directo en "tecnico" (material ZOEMEC), nunca en un gris por defecto sin
  // explicacion. Se recalcula solo cuando cambia el objeto cargado.
  const materialQuality = useMemo(() => object3D ? detectMaterialQuality(object3D) : null, [object3D]);
  const availableParts = useMemo(() => object3D ? detectAvailablePartCategories(object3D) : [], [object3D]);
  const [mode, setMode] = useState(VISUALIZATION_MODE.REALISTIC);
  const [colorHex, setColorHex] = useState(DEFAULT_TECHNICAL_COLOR_HEX);
  const [showEdges, setShowEdges] = useState(false);
  const [partColorOverrides, setPartColorOverrides] = useState({});

  useEffect(() => {
    if(!materialQuality) return;
    setMode(materialQuality.hasRealMaterials ? VISUALIZATION_MODE.REALISTIC : VISUALIZATION_MODE.TECHNICAL);
    setPartColorOverrides({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [object3D]);

  // Aplica el modo/color/aristas activos cada vez que cambian -- separado
  // del efecto de montaje (mas abajo): cambiar de "Solido" a "Alambre" no
  // necesita recrear el renderer/camara/controles, solo mutar materiales,
  // que ya se ven en el siguiente frame del loop de animacion existente.
  useEffect(() => {
    if(!object3D) return;
    applyVisualizationMode(object3D, { mode, colorHex, showEdges, partColorOverrides });
  }, [object3D, mode, colorHex, showEdges, partColorOverrides]);

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
      disposeVisualizationOverrides(object3D);
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
    <ModelStatusPanel diagnostics={diagnostics} tr={tr} />
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

    {/* Fase 1 (visor 3D profesional): modos de visualizacion -- nunca mutan
        el archivo original, solo el material en memoria (ver
        three3dVisualizationModes.js#applyVisualizationMode). */}
    <div className="visual-actions" style={{ marginBottom: 6, flexWrap: 'wrap' }}>
      {VISUALIZATION_MODE_ORDER.map(m => (
        <button key={m} type="button" className={mode === m ? '' : 'soft'} onClick={() => setMode(m)}>
          {tr(`levantamiento.${MODE_LABEL_KEY[m]}`)}
        </button>
      ))}
    </div>

    {materialQuality && !materialQuality.hasRealMaterials && mode !== VISUALIZATION_MODE.REALISTIC &&
      <p className="muted" style={{ fontSize: '.72rem', marginBottom: 6 }}>{tr('levantamiento.viz3dTechnicalAutoHint')}</p>}

    {mode !== VISUALIZATION_MODE.REALISTIC && <div className="visual-actions" style={{ marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <span className="muted" style={{ fontSize: '.72rem' }}>{tr('levantamiento.viz3dColorLabel')}:</span>
      {MATERIAL_COLOR_PRESETS.map(preset => (
        <button
          key={preset.id} type="button" title={tr(`levantamiento.${colorLabelKey(preset.id)}`)}
          onClick={() => setColorHex(preset.hex)}
          style={{
            width: 22, height: 22, borderRadius: '50%', padding: 0, cursor: 'pointer',
            background: hexToCss(preset.hex), border: colorHex === preset.hex ? '2px solid var(--accent, #7c3aed)' : '1px solid #0002'
          }}
        />
      ))}
      <input
        type="color" value={hexToCss(colorHex)} onChange={e => setColorHex(parseInt(e.target.value.slice(1), 16))}
        title={tr('levantamiento.viz3dColorCustomLabel')} style={{ width: 26, height: 26, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
      />
      {mode !== VISUALIZATION_MODE.EDGES && <label style={{ fontSize: '.72rem', display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
        <input type="checkbox" checked={showEdges} onChange={e => setShowEdges(e.target.checked)} />
        {tr('levantamiento.viz3dShowEdgesToggle')}
      </label>}
    </div>}

    {mode !== VISUALIZATION_MODE.REALISTIC && availableParts.length > 0 && <div className="visual-actions" style={{ marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <span className="muted" style={{ fontSize: '.72rem' }}>{tr('levantamiento.viz3dPartsLabel')}:</span>
      {availableParts.map(category => (
        <span key={category} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: '.72rem' }}>{tr(`levantamiento.${partLabelKey(category)}`)}</span>
          <input
            type="color"
            value={hexToCss(partColorOverrides[category] ?? colorHex)}
            onChange={e => setPartColorOverrides(prev => ({ ...prev, [category]: parseInt(e.target.value.slice(1), 16) }))}
            style={{ width: 22, height: 22, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
          />
        </span>
      ))}
    </div>}

    <div ref={mountRef} style={{ width: '100%', minHeight: 360 }} />
  </div>;
}
