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
   en QA; aqui se evita repetirlo.

   Visor 3D profesional (esta fase): el toggle de alto nivel es
   REALISTA/TECNICO (RENDER_MODE, three3dRenderModes.js) -- REALISTA agrega
   tone mapping ACES, entorno de estudio neutro, sombras suaves y piso de
   contacto; TECNICO conserva los VISUALIZATION_MODE ya existentes
   (Solido/Aristas/Transparente/Alambre) como herramientas secundarias, con
   fondo claro (nunca el gris oscuro casi plano anterior). NINGUNO de los
   dos modos escala el modelo de forma no uniforme -- centro/maxDimension/
   frameScale siguen siendo exactamente los mismos calculos de siempre, solo
   deciden encuadre de camara, nunca geometria. */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { useI18n } from '../../i18n/I18nContext.jsx';
import {
  createRenderer, createScene, createPerspectiveCamera, createOrbitControls,
  addImportedModelLighting, createGridHelper, createAxesHelper, CAMERA_VIEW_PRESETS, applyCameraView,
  configureRendererQuality, createStudioEnvironment, createContactShadowGround, configureShadowLight,
  detectRenderQualityPreset
} from '../../lib/three3dSceneKit.js';
import {
  VISUALIZATION_MODE, MATERIAL_COLOR_PRESETS, DEFAULT_TECHNICAL_COLOR_HEX,
  detectMaterialQuality, detectAvailablePartCategories, applyVisualizationMode, applyRealisticMode, disposeVisualizationOverrides
} from '../../lib/three3dVisualizationModes.js';
import {
  RENDER_MODE, PERFORMANCE_PRESET, PERFORMANCE_CONFIG, RENDER_MODE_CONFIG, RENDER_MODE_BACKGROUND,
  buildProfessionalFallbackMaterial
} from '../../lib/three3dRenderModes.js';

// Sub-modos de TECNICO -- REALISTIC/TECHNICAL de VISUALIZATION_MODE ya no
// aparecen aqui (REALISTIC vive un nivel arriba como RENDER_MODE.REALISTIC;
// TECHNICAL -- solido+aristas forzadas -- sigue siendo el sub-modo default
// al entrar a TECNICO, ver el useEffect de reset de modo mas abajo).
const TECHNICAL_SUBMODE_ORDER = [
  VISUALIZATION_MODE.TECHNICAL, VISUALIZATION_MODE.SOLID,
  VISUALIZATION_MODE.EDGES, VISUALIZATION_MODE.TRANSPARENT, VISUALIZATION_MODE.WIREFRAME
];
const MODE_LABEL_KEY = {
  [VISUALIZATION_MODE.REALISTIC]: 'viz3dModeRealistic', [VISUALIZATION_MODE.SOLID]: 'viz3dModeSolid',
  [VISUALIZATION_MODE.TECHNICAL]: 'viz3dModeTechnical', [VISUALIZATION_MODE.EDGES]: 'viz3dModeEdges',
  [VISUALIZATION_MODE.TRANSPARENT]: 'viz3dModeTransparent', [VISUALIZATION_MODE.WIREFRAME]: 'viz3dModeWireframe'
};
const PERF_LABEL_KEY = {
  [PERFORMANCE_PRESET.LOW]: 'render3dPerfLow', [PERFORMANCE_PRESET.BALANCED]: 'render3dPerfBalanced', [PERFORMANCE_PRESET.HIGH]: 'render3dPerfHigh'
};
const PERF_ORDER = [PERFORMANCE_PRESET.LOW, PERFORMANCE_PRESET.BALANCED, PERFORMANCE_PRESET.HIGH];
function partLabelKey(category){ return 'viz3dPart' + category.charAt(0).toUpperCase() + category.slice(1); }
function colorLabelKey(presetId){ return 'viz3dColor' + presetId.charAt(0).toUpperCase() + presetId.slice(1); }
function hexToCss(hex){ return '#' + hex.toString(16).padStart(6, '0'); }
const isMobileUA = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent || '');

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
  const rendererRef = useRef(null);
  const composerRef = useRef(null);
  const sizeRef = useRef({ width: 0, height: 0 });

  const materialQuality = useMemo(() => object3D ? detectMaterialQuality(object3D) : null, [object3D]);
  const availableParts = useMemo(() => object3D ? detectAvailablePartCategories(object3D) : [], [object3D]);

  // "Interpretar antes que preguntar" (igual que antes, ahora a nivel
  // RENDER_MODE): un archivo con materiales reales arranca en REALISTA; sin
  // evidencia de material real arranca en TECNICO -- nunca un gris por
  // defecto sin explicacion.
  const [renderMode, setRenderMode] = useState(RENDER_MODE.REALISTIC);
  const [perfPreset, setPerfPreset] = useState(() => detectRenderQualityPreset());
  const [mode, setMode] = useState(VISUALIZATION_MODE.TECHNICAL);
  const [colorHex, setColorHex] = useState(DEFAULT_TECHNICAL_COLOR_HEX);
  const [showEdges, setShowEdges] = useState(false);
  const [partColorOverrides, setPartColorOverrides] = useState({});
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if(!materialQuality) return;
    setRenderMode(materialQuality.hasRealMaterials ? RENDER_MODE.REALISTIC : RENDER_MODE.TECHNICAL);
    setMode(VISUALIZATION_MODE.TECHNICAL);
    setPartColorOverrides({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [object3D]);

  // Aplica el sub-modo TECNICO (Solido/Aristas/Transparente/Alambre) cada
  // vez que cambia -- SOLO si renderMode es TECNICO; en REALISTA el
  // material lo decide el efecto pesado de mas abajo (applyRealisticMode),
  // nunca este. Separado del montaje del renderer: cambiar de "Solido" a
  // "Alambre" no necesita recrear renderer/camara/luces, solo mutar
  // materiales, visibles en el siguiente frame del loop ya corriendo.
  useEffect(() => {
    if(!object3D || renderMode !== RENDER_MODE.TECHNICAL) return;
    applyVisualizationMode(object3D, { mode, colorHex, showEdges, partColorOverrides });
  }, [object3D, renderMode, mode, colorHex, showEdges, partColorOverrides]);

  const center = boundingBox ? {
    x: (boundingBox.min.x + boundingBox.max.x) / 2,
    y: (boundingBox.min.y + boundingBox.max.y) / 2,
    z: (boundingBox.min.z + boundingBox.max.z) / 2
  } : { x: 0, y: 0, z: 0 };

  // Radio del encuadre inicial proporcional al tamano real del modelo -- un
  // modelo de 1m y uno de 40m no pueden usar el mismo offset fijo de camara
  // (CAMERA_VIEW_PRESETS.isometric asume una escala "tipica" de Space, no
  // sirve tal cual para un archivo importado de tamano arbitrario). NUNCA
  // deforma el modelo -- solo mueve la camara, geometria intacta.
  const maxDimension = boundingBox
    ? Math.max(boundingBox.size.x, boundingBox.size.y, boundingBox.size.z, 0.5)
    : 6;
  const frameScale = maxDimension / 6;
  const groundY = boundingBox ? boundingBox.min.y : 0;

  // Montaje/desmontaje pesado del renderer -- se recrea cuando cambia el
  // objeto O el modo de render O el preset de rendimiento (cualquiera de
  // los tres implica luces/entorno/sombras/tone mapping distintos, no solo
  // un cambio de material). El sub-modo TECNICO (mode/colorHex/etc) NO esta
  // en las dependencias -- eso lo maneja el efecto liviano de arriba sin
  // reconstruir nada.
  useEffect(() => {
    const mount = mountRef.current;
    if(!mount || !object3D) return;
    const width = mount.clientWidth || 480, height = mount.clientHeight || 360;
    sizeRef.current = { width, height };
    const cfg = RENDER_MODE_CONFIG[renderMode];
    const perfCfg = PERFORMANCE_CONFIG[perfPreset];
    const shadowsEnabled = cfg.shadows && renderMode === RENDER_MODE.REALISTIC;

    const scene = createScene(RENDER_MODE_BACKGROUND[renderMode]);
    const camera = createPerspectiveCamera(width, height, {
      x: center.x + CAMERA_VIEW_PRESETS.isometric.x * frameScale,
      y: center.y + CAMERA_VIEW_PRESETS.isometric.y * frameScale,
      z: center.z + CAMERA_VIEW_PRESETS.isometric.z * frameScale
    });
    // preserveDrawingBuffer:true -- costo minimo en GPUs modernas, necesario
    // para que "Capturar imagen" (mas abajo) pueda leer el canvas en
    // cualquier momento, no solo dentro del frame que se esta dibujando.
    const renderer = createRenderer(width, height, { preserveDrawingBuffer: true });
    configureRendererQuality(renderer, {
      toneMapping: cfg.toneMapping, exposure: cfg.exposure, shadows: shadowsEnabled,
      pixelRatio: Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, perfCfg.pixelRatioCap)
    });
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = createOrbitControls(camera, renderer.domElement);
    controls.target.set(center.x, center.y, center.z);
    controls.minDistance = Math.max(0.1, maxDimension * 0.1);
    controls.maxDistance = maxDimension * 10;

    const { key } = addImportedModelLighting(scene, maxDimension, {
      ambientIntensity: cfg.ambientIntensity, keyIntensity: cfg.keyIntensity, fillIntensity: cfg.fillIntensity
    });

    let envTexture = null;
    if(renderMode === RENDER_MODE.REALISTIC){
      if(shadowsEnabled){
        configureShadowLight(key, { maxDimension, mapSize: perfCfg.shadowMapSize });
        object3D.traverse(node => { if(node.isMesh){ node.castShadow = true; node.receiveShadow = true; } });
      }
      if(perfCfg.environment){
        envTexture = createStudioEnvironment(renderer);
        if(envTexture) scene.environment = envTexture;
      }
      if(cfg.groundPlane === 'contact'){
        scene.add(createContactShadowGround(Math.max(20, maxDimension * 4), groundY));
      }
      applyRealisticMode(object3D, {
        hasRealMaterials: materialQuality?.hasRealMaterials ?? true,
        fallbackMaterial: buildProfessionalFallbackMaterial(envTexture)
      });
    } else {
      object3D.traverse(node => { if(node.isMesh){ node.castShadow = false; node.receiveShadow = false; } });
      if(showGrid) scene.add(createGridHelper(Math.max(20, maxDimension * 2), 20));
      if(showAxes) scene.add(createAxesHelper(maxDimension * 1.2));
    }
    scene.add(object3D);

    // GTAO (ambient occlusion de post-proceso): SOLO Alto + Realista +
    // escritorio -- nunca en movil ni en presets bajos/equilibrados (regla
    // de rendimiento del brief). Envuelto en try/catch: si el contexto
    // WebGL no soporta algo que GTAOPass necesita, el visor sigue
    // funcionando con el render directo de siempre, nunca se rompe por
    // esto.
    let composer = null;
    if(perfCfg.ao && renderMode === RENDER_MODE.REALISTIC && !isMobileUA()){
      try{
        composer = new EffectComposer(renderer);
        composer.addPass(new RenderPass(scene, camera));
        const gtao = new GTAOPass(scene, camera, width, height);
        gtao.output = GTAOPass.OUTPUT.Default;
        composer.addPass(gtao);
        composer.addPass(new OutputPass());
        composer.setSize(width, height);
      }catch{
        composer = null;
      }
    }
    composerRef.current = composer;

    let frameId;
    const animate = () => {
      controls.update();
      if(composerRef.current) composerRef.current.render();
      else renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };
    animate();

    cameraRef.current = camera;
    controlsRef.current = controls;
    return () => {
      cancelAnimationFrame(frameId);
      controls.dispose();
      scene.remove(object3D);
      disposeVisualizationOverrides(object3D);
      envTexture?.dispose?.();
      composerRef.current?.dispose?.();
      composerRef.current = null;
      renderer.dispose();
      cameraRef.current = null;
      controlsRef.current = null;
      rendererRef.current = null;
      if(mount) mount.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [object3D, renderMode, perfPreset, showGrid, showAxes]);

  // Responsive real (tablet/movil, y el toggle de pantalla completa): el
  // efecto de arriba solo mide el contenedor UNA vez al montar -- sin esto,
  // rotar el dispositivo o entrar/salir de pantalla completa dejaria el
  // canvas con el tamano/aspecto viejo. ResizeObserver, no un listener de
  // window "resize" (el contenedor puede cambiar de tamano sin que la
  // ventana lo haga, ej. al abrir un panel lateral).
  useEffect(() => {
    const mount = mountRef.current;
    if(!mount || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if(!entry) return;
      const width = Math.round(entry.contentRect.width) || sizeRef.current.width;
      const height = Math.round(entry.contentRect.height) || sizeRef.current.height;
      if(width === sizeRef.current.width && height === sizeRef.current.height) return;
      sizeRef.current = { width, height };
      const camera = cameraRef.current, renderer = rendererRef.current;
      if(!camera || !renderer || !width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      composerRef.current?.setSize?.(width, height);
    });
    observer.observe(mount);
    return () => observer.disconnect();
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

  /* Captura la vista actual tal cual esta en pantalla (modo/preset/camara
     activos) -- lee directamente el canvas (preserveDrawingBuffer:true en
     el renderer, ver el efecto de montaje), nunca un render aparte "para la
     foto" que pudiera verse distinto de lo que el usuario esta viendo. */
  const captureImage = () => {
    const canvas = rendererRef.current?.domElement;
    if(!canvas) return;
    const link = document.createElement('a');
    link.download = `zoemec-visor3d-${renderMode}-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const toggleFullscreen = () => {
    const mount = mountRef.current;
    if(!mount) return;
    if(!document.fullscreenElement){
      mount.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

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

  const isTechnical = renderMode === RENDER_MODE.TECHNICAL;

  return <div className="model3d-preview">
    <ModelStatusPanel diagnostics={diagnostics} tr={tr} />

    {/* Toggle de alto nivel Realista/Tecnico -- pedido explicito del brief,
        separado de los sub-modos tecnicos de abajo. */}
    <div className="visual-actions" style={{ marginBottom: 6 }}>
      <button type="button" className={renderMode === RENDER_MODE.REALISTIC ? '' : 'soft'} onClick={() => setRenderMode(RENDER_MODE.REALISTIC)}>
        {tr('levantamiento.render3dModeRealistic')}
      </button>
      <button type="button" className={isTechnical ? '' : 'soft'} onClick={() => setRenderMode(RENDER_MODE.TECHNICAL)}>
        {tr('levantamiento.render3dModeTechnical')}
      </button>
      <span className="muted" style={{ fontSize: '.72rem', alignSelf: 'center', marginLeft: 8 }}>{tr('levantamiento.render3dPerfLabel')}:</span>
      {PERF_ORDER.map(p => (
        <button key={p} type="button" className={perfPreset === p ? '' : 'soft'} onClick={() => setPerfPreset(p)}>
          {tr(`levantamiento.${PERF_LABEL_KEY[p]}`)}
        </button>
      ))}
      <button type="button" className="soft" onClick={captureImage} style={{ marginLeft: 'auto' }}>
        {tr('levantamiento.render3dCapture')}
      </button>
      <button type="button" className="soft" onClick={toggleFullscreen}>
        {tr(isFullscreen ? 'levantamiento.render3dExitFullscreen' : 'levantamiento.render3dFullscreen')}
      </button>
    </div>

    {renderMode === RENDER_MODE.REALISTIC && materialQuality && !materialQuality.hasRealMaterials &&
      <p className="muted" style={{ fontSize: '.72rem', marginBottom: 6 }}>{tr('levantamiento.render3dRealisticFallbackHint')}</p>}

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

    {/* Sub-modos TECNICO (Fase 1 original, conservados tal cual): nunca
        mutan el archivo original, solo el material en memoria (ver
        three3dVisualizationModes.js#applyVisualizationMode). Ocultos en
        REALISTA -- ese modo no tiene color manual, usa material
        original/fallback profesional automatico. */}
    {isTechnical && <>
      <div className="visual-actions" style={{ marginBottom: 6, flexWrap: 'wrap' }}>
        {TECHNICAL_SUBMODE_ORDER.map(m => (
          <button key={m} type="button" className={mode === m ? '' : 'soft'} onClick={() => setMode(m)}>
            {tr(`levantamiento.${MODE_LABEL_KEY[m]}`)}
          </button>
        ))}
        <label style={{ fontSize: '.72rem', display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
          <input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} />
          {tr('levantamiento.render3dShowGrid')}
        </label>
        <label style={{ fontSize: '.72rem', display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={showAxes} onChange={e => setShowAxes(e.target.checked)} />
          {tr('levantamiento.render3dShowAxes')}
        </label>
      </div>

      <div className="visual-actions" style={{ marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: '.72rem' }}>{tr('levantamiento.viz3dColorLabel')}:</span>
        {MATERIAL_COLOR_PRESETS.map(preset => (
          <button
            key={preset.id} type="button" title={tr(`levantamiento.${colorLabelKey(preset.id)}`)}
            onClick={() => setColorHex(preset.hex)}
            style={{
              width: 22, height: 22, borderRadius: '50%', padding: 0, cursor: 'pointer',
              background: hexToCss(preset.hex), border: colorHex === preset.hex ? '2px solid var(--primary)' : '1px solid #0002'
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
      </div>

      {availableParts.length > 0 && <div className="visual-actions" style={{ marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
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
    </>}

    <div
      ref={mountRef}
      style={isFullscreen
        ? { width: '100vw', height: '100vh', background: hexToCss(RENDER_MODE_BACKGROUND[renderMode]) }
        : { width: '100%', minHeight: 360, height: 360 }}
    />
  </div>;
}
