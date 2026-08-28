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
import { useEffect, useMemo, useRef, useState } from 'react';
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
  // `id` (ej. "floor-1") es el identificador UNICO por elemento dentro de
  // este APU (ver geometry3d.js#deriveGeometryFromApu); `clave` es la clave
  // del APU completo -- varios elementos del MISMO apu comparten la misma
  // `clave`, asi que la seleccion/highlight debe distinguirse por `id`,
  // nunca por `clave` (eso resaltaria todos los elementos del apu a la vez).
  mesh.userData = { id: element.id, clave: element.clave, label: element.label, type: element.type };
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

/* Color de resalte cuando un elemento esta seleccionado (highlight emisivo
   sobre el material real del mesh -- nunca se sustituye la geometria ni se
   agrega un mesh nuevo). */
const SELECTION_EMISSIVE = 0x9146ff;

export function Technical3DViewer({ apu, onSelectElement }){
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const meshesRef = useRef([]);
  // Bug reportado (seleccion 3D nunca conectada): onSelectElement puede
  // llegar como una funcion NUEVA en cada render del padre (ej. un arrow
  // function inline). Guardarla en un ref y NO incluirla en las
  // dependencias del efecto que crea la escena evita reconstruir todo
  // three.js (camara, controles, zoom acumulado) cada vez que el padre
  // renderiza por cualquier otro motivo -- solo se reconstruye cuando los
  // ELEMENTOS 3D realmente cambian.
  const onSelectElementRef = useRef(onSelectElement);
  onSelectElementRef.current = onSelectElement;
  const [geometryResult, setGeometryResult] = useState(null);
  const [resolvedElements, setResolvedElements] = useState([]);
  // Elemento actualmente resaltado, por `id` de elemento -- NUNCA por
  // `clave` (varios elementos del mismo APU comparten la misma clave, ver
  // buildMesh mas arriba). Puramente de UI: no inventa ninguna relacion con
  // Takeoff 2D que no exista ya en los datos del elemento.
  const [selectedElementId, setSelectedElementId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    TechnicalModelProvider.generate(apu).then(result => {
      if(cancelled) return;
      setGeometryResult(result);
      setResolvedElements(result.ok ? result.elements : []);
      setSelectedElementId(null);
    });
    return () => { cancelled = true; };
  }, [apu]);

  // Bug reportado (zoom 3D no funcionaba): `resolvedElements.filter(...)`
  // sin memoizar devuelve un ARRAY NUEVO en cada render del componente,
  // aunque el contenido no haya cambiado. Como el efecto que crea la escena
  // depende de `readyElements`, cualquier re-render incidental del padre
  // (por una razon totalmente ajena al modelo 3D) volvia a ejecutar ese
  // efecto: destruia la escena/camara/controles y los recreaba con la
  // camara en su posicion inicial fija -- el usuario podia rotar (un solo
  // gesto rapido, sin re-render de por medio) pero el zoom por rueda, hecho
  // de muchos eventos `wheel` pequenos en el tiempo, quedaba deshecho casi
  // de inmediato por el siguiente re-render. Memoizar por `resolvedElements`
  // (que solo cambia cuando el APU realmente cambia, ver el efecto de
  // arriba) mantiene la escena estable entre re-renders no relacionados.
  const pendingElements = useMemo(
    () => resolvedElements.filter(el => (el.missingDimensions || []).length > 0),
    [resolvedElements]
  );
  const readyElements = useMemo(
    () => resolvedElements.filter(el => (el.missingDimensions || []).length === 0),
    [resolvedElements]
  );

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
    // touch-action:none evita que el navegador interprete el gesto de
    // rueda/arrastre sobre el canvas como scroll/gesto de la pagina antes
    // de que OrbitControls reciba el evento -- el resto de la pagina
    // conserva su scroll normal (el listener queda acotado al canvas).
    renderer.domElement.style.touchAction = 'none';

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    // Configuracion EXPLICITA (antes dependia de los defaults de la
    // libreria): zoom y pan habilitados, con limites reales para que la
    // camara nunca atraviese el modelo ni se aleje al infinito.
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.zoomSpeed = 1;
    controls.minDistance = 1.5;
    controls.maxDistance = 50;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 10, 5);
    scene.add(dir);
    scene.add(new THREE.GridHelper(20, 20, 0xbbbbbb, 0xdddddd));

    const meshes = readyElements.map(buildMesh);
    meshes.forEach(m => scene.add(m));
    meshesRef.current = meshes;

    const raycaster = new THREE.Raycaster();
    const onClick = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(meshes)[0];
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

    sceneRef.current = { scene, renderer };
    return () => {
      cancelAnimationFrame(frameId);
      renderer.domElement.removeEventListener('click', onClick);
      controls.dispose();
      meshes.forEach(m => { m.geometry.dispose(); m.material.dispose(); });
      renderer.dispose();
      meshesRef.current = [];
      if(mount) mount.innerHTML = '';
    };
  }, [readyElements]);

  // Highlight IMPERATIVO del elemento seleccionado: ajusta el material de
  // los meshes ya existentes (nunca reconstruye la escena/camara -- eso
  // reintroduciria el mismo bug de zoom de arriba).
  useEffect(() => {
    meshesRef.current.forEach(m => {
      const isSelected = !!selectedElementId && m.userData.id === selectedElementId;
      m.material.emissive?.setHex(isSelected ? SELECTION_EMISSIVE : 0x000000);
      m.material.emissiveIntensity = isSelected ? 0.55 : 0;
    });
  }, [selectedElementId]);

  if(!geometryResult) return null;

  if(!geometryResult.ok){
    return <div className="panel">
      <b>MODELO TÉCNICO 3D</b>
      <p className="muted">REQUIERE VALIDACIÓN: {geometryResult.message}</p>
    </div>;
  }

  // Elemento seleccionado (para el panel de info): SOLO datos que ya existen
  // en resolvedElements -- si el elemento no declara concepto/dimensiones,
  // no se inventan (ver "si no existe relacion, no inventarla").
  const selectedElement = selectedElementId ? resolvedElements.find(el => el.id === selectedElementId) : null;

  return <div className="technical-3d-viewer">
    <div className="admin-panel-head"><h2>MODELO TÉCNICO 3D</h2><small className="hint">Geometría paramétrica determinista derivada de datos reales del APU -- nunca un render generado por IA. Orbita con clic + arrastrar, zoom con la rueda, desplaza con clic derecho + arrastrar (pan).</small></div>
    {pendingElements.map(el => <MissingDimensionForm key={el.id} element={el} onComplete={(updated)=>{
      setResolvedElements(prev => prev.map(e => e.id === updated.id ? updated : e));
    }}/>)}
    {readyElements.length > 0 && <div ref={mountRef} style={{width:'100%',minHeight:360}}/>}
    {selectedElement && <div className="panel" style={{marginTop:8}}>
      <b>Elemento seleccionado</b>
      <p className="muted" style={{fontSize:'.82rem',margin:'4px 0 0'}}>
        Clave: {selectedElement.clave || '—'} · Concepto: {apu?.concept || apu?.clave || '—'}
        {selectedElement.label ? ` · ${selectedElement.label}` : ''}
        {selectedElement.dimensions ? ` · Dimensiones: ${Object.entries(selectedElement.dimensions).map(([k,v])=>`${k}=${v}`).join(', ')}` : ''}
      </p>
    </div>}
    {!readyElements.length && !pendingElements.length && <p className="muted">Sin elementos para visualizar.</p>}
  </div>;
}
