/* Visualizacion 3D -- MODELO TECNICO (punto 18 del spec del usuario).
   Renderiza la geometria DETERMINISTA que produce
   src/domain/geometry3d.js/visualizationProviders.js#TechnicalModelProvider
   -- nunca un render generado por IA (ver NullAIRenderProvider, sin
   proveedor configurado en esta fase). Etiqueta "MODELO TECNICO" siempre
   visible para que nunca se confunda con una visualizacion realista futura.

   Si el APU no tiene datos suficientes (deriveGeometryFromApu regresa
   ok:false) o el elemento tiene dimensiones pendientes (missingDimensions),
   se muestra el motivo y un formulario para capturarlas a mano -- NUNCA se
   renderiza una caja con una dimension inventada.

   Nota de alcance: el render de three.js en si no tiene cobertura de tests
   automatizados (WebGL no esta disponible en el entorno de pruebas/CI de
   este proyecto) -- la geometria que consume (geometry3d.js) si esta
   probada de forma pura. Verificacion visual en navegador real pendiente. */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TechnicalModelProvider } from '../../lib/visualizationProviders.js';
import { applyManualDimensions } from '../../domain/geometry3d.js';

const PLACEHOLDER_RENDER_THICKNESS = 0.02; // solo para que la malla sea visible; nunca se presenta como medida real

const COLOR_BY_TYPE = { floor: 0xd9c8a8, ceiling: 0xe8e8ec, wall: 0xb7a98f };

function buildMesh(element){
  const d = element.dimensions;
  let width, height, depth;
  if(element.type === 'wall'){
    width = d.width || Math.sqrt(d.area || 1);
    height = d.height || Math.sqrt(d.area || 1);
    depth = d.thickness || PLACEHOLDER_RENDER_THICKNESS;
  } else {
    width = d.width || 1;
    depth = d.depth || 1;
    height = d.thickness || PLACEHOLDER_RENDER_THICKNESS;
  }
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.MeshStandardMaterial({ color: COLOR_BY_TYPE[element.type] || 0xaaaaaa });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = { clave: element.clave, label: element.label, type: element.type };
  if(element.type === 'wall') mesh.position.y = height / 2;
  else if(element.type === 'ceiling') mesh.position.y = 2.5;
  else mesh.position.y = height / 2;
  return mesh;
}

/* Formulario minimo para capturar UNA dimension pendiente (nunca se asume
   un valor: el input arranca vacio). */
function MissingDimensionForm({ element, onComplete }){
  const [values, setValues] = useState({});
  const labels = { height: 'Altura (m)', thickness: 'Espesor (m)', width: 'Ancho (m)', depth: 'Profundidad (m)' };
  return <div className="panel" style={{marginBottom:10}}>
    <b>Faltan dimensiones reales para "{element.label || element.clave}"</b>
    <p className="muted" style={{fontSize:'.8rem'}}>El concepto no las declara -- captura el valor real (nunca se inventan) para completar el modelo tecnico 3D.</p>
    <div className="grid-2">
      {element.missingDimensions.map(key => <div key={key}>
        <label>{labels[key] || key}</label>
        <input type="number" step="any" value={values[key] ?? ''} onChange={e=>setValues(v=>({...v,[key]:e.target.value}))} placeholder="0.00"/>
      </div>)}
    </div>
    <div className="visual-actions" style={{marginTop:8}}>
      <button onClick={()=>onComplete(applyManualDimensions(element, values))}>Aplicar y generar modelo 3D</button>
    </div>
  </div>;
}

export function Technical3DViewer({ apu, onSelectElement }){
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const [geometryResult, setGeometryResult] = useState(null);
  const [resolvedElements, setResolvedElements] = useState([]);

  useEffect(() => {
    let cancelled = false;
    TechnicalModelProvider.generate(apu).then(result => {
      if(cancelled) return;
      setGeometryResult(result);
      setResolvedElements(result.ok ? result.elements : []);
    });
    return () => { cancelled = true; };
  }, [apu]);

  const pendingElements = resolvedElements.filter(el => (el.missingDimensions || []).length > 0);
  const readyElements = resolvedElements.filter(el => (el.missingDimensions || []).length === 0);

  useEffect(() => {
    const mount = mountRef.current;
    if(!mount || !readyElements.length) return;
    const width = mount.clientWidth || 480, height = 360;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf2efe9);
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(6, 6, 8);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 10, 5);
    scene.add(dir);
    scene.add(new THREE.GridHelper(20, 20, 0xbbbbbb, 0xdddddd));

    const meshes = readyElements.map(buildMesh);
    meshes.forEach(m => scene.add(m));

    const raycaster = new THREE.Raycaster();
    const onClick = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(meshes)[0];
      if(hit) onSelectElement?.(hit.object.userData);
    };
    renderer.domElement.addEventListener('click', onClick);

    let frameId;
    const animate = () => { controls.update(); renderer.render(scene, camera); frameId = requestAnimationFrame(animate); };
    animate();

    sceneRef.current = { scene, renderer };
    return () => {
      cancelAnimationFrame(frameId);
      renderer.domElement.removeEventListener('click', onClick);
      controls.dispose();
      meshes.forEach(m => { m.geometry.dispose(); m.material.dispose(); });
      renderer.dispose();
      if(mount) mount.innerHTML = '';
    };
  }, [readyElements, onSelectElement]);

  if(!geometryResult) return null;

  if(!geometryResult.ok){
    return <div className="panel">
      <b>MODELO TÉCNICO 3D</b>
      <p className="muted">REQUIERE VALIDACIÓN: {geometryResult.message}</p>
    </div>;
  }

  return <div className="technical-3d-viewer">
    <div className="admin-panel-head"><h2>MODELO TÉCNICO 3D</h2><small className="hint">Geometría paramétrica determinista derivada de datos reales del APU -- nunca un render generado por IA. Orbita con clic + arrastrar, zoom con la rueda.</small></div>
    {pendingElements.map(el => <MissingDimensionForm key={el.id} element={el} onComplete={(updated)=>{
      setResolvedElements(prev => prev.map(e => e.id === updated.id ? updated : e));
    }}/>)}
    {readyElements.length > 0 && <div ref={mountRef} style={{width:'100%',minHeight:360}}/>}
    {!readyElements.length && !pendingElements.length && <p className="muted">Sin elementos para visualizar.</p>}
  </div>;
}
