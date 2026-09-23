/* Visor 3D del Plano Inteligente (B.1, punto 9/10) + representacion
   arquitectonica (2a pasada de realismo). La GEOMETRIA y la sincronizacion
   NO cambian: lee src/domain/cad3d.js (puro), cada malla lleva
   userData.objectId = el mismo id de planta (M-01, P-01, V-01, ESP-01) y el
   clic/resaltado/enfoque operan sobre ese id -- 2D<->3D comparten objeto.
   Todo lo de este archivo es apariencia: materiales, iluminacion, sombras,
   detalle constructivo de puertas/ventanas (marco + hoja/vidrio + manija +
   alfeizar dentro del mismo vano de la geometria), zoclo visual, y tres
   modos de render. Cero texturas externas: todo procedural (CanvasTexture).

   Modos (materiales/luces/postproceso, NUNCA geometria distinta):
     - TECNICO: materiales planos neutros, bordes visibles, luz pareja, sin
       sombras -- maxima legibilidad.
     - SOMBREADO: materiales fisicos con microtextura, sombras suaves.
     - REALISTA: yeso/piso con normal+roughness procedural, vidrio con
       transmision, entorno neutro, AO de contacto (GTAO, escritorio), suelo
       de tierra calido, IDs/grid ocultos por defecto -- nivel BIM viewer.
   Renderer/camara/OrbitControls se montan UNA vez; solo el contenido se
   reconstruye al cambiar modelo o modo. */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { deriveCad3D } from '../../../domain/cad3d.js';
import { REVIEW_STATUS, OPENING_TYPE, wallLength, pointAlongWall } from '../../../domain/cadModel.js';
import {
  createRenderer, createScene, createPerspectiveCamera, createOrbitControls,
  createStudioEnvironment, createContactShadowGround, configureShadowLight, raycastFirstHit
} from '../../../lib/three3dSceneKit.js';

export const RENDER_MODE = Object.freeze({ TECHNICAL: 'tecnico', SHADED: 'sombreado', REALISTIC: 'realista' });
const MODE_LABEL = { tecnico: 'Técnico', sombreado: 'Sombreado', realista: 'Realista' };
const SELECT_HEX = 0x0F6BA8;
const BASE_FOV = 38;
const isMobileUA = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent || '');

const PALETTE = {
  wall: 0xEDE9E1, floor: 0xC9C6BF, zoclo: 0xC8C1B2, doorFrame: 0x5E4632, doorLeaf: 0x8A6B47,
  handle: 0x8A8F94, winFrame: 0xAAB1B6, sill: 0xCFCAC1, glass: 0xDCEBEF, edge: 0x39434C, groundR: 0xE9E4DC
};

const MODE_CFG = {
  tecnico: {
    background: 0xF5F7F9, toneMapping: THREE.NoToneMapping, exposure: 1, textured: false, physicalGlass: false, ground: 'grid',
    shadows: false, environment: false, ao: false, edges: 0.55, edgeHex: PALETTE.edge,
    hemi: 0.95, key: 0.35, fill: 0.25, glassOpacity: 0.35, labelsDefault: true, gridDefault: true
  },
  sombreado: {
    background: 0xEDF0F3, toneMapping: THREE.ACESFilmicToneMapping, exposure: 1.0, textured: true, physicalGlass: false, ground: 'contact',
    shadows: true, environment: false, ao: false, edges: 0.14, edgeHex: PALETTE.edge,
    hemi: 0.62, key: 1.1, fill: 0.3, glassOpacity: 0.4, labelsDefault: true, gridDefault: true
  },
  realista: {
    background: 0xEDEAE4, toneMapping: THREE.ACESFilmicToneMapping, exposure: 0.95, textured: true, physicalGlass: true, ground: 'solid',
    shadows: true, environment: true, ao: true, edges: 0, edgeHex: PALETTE.edge,
    hemi: 0.42, key: 1.25, fill: 0.32, glassOpacity: 0.3, labelsDefault: false, gridDefault: false
  }
};

/* ---------- texturas procedurales (CanvasTexture, ~256px, compartidas) ---------- */
function noiseCanvas(size, base, amp){
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(size, size);
  for(let i = 0; i < size * size; i++){
    // ruido suavizado (promedio de 2 muestras) para microtextura, no grano puro
    const v = Math.max(0, Math.min(255, base + (Math.random() + Math.random() - 1) * amp));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
function plasterMaps(){
  const bump = new THREE.CanvasTexture(noiseCanvas(256, 128, 40));
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping; bump.repeat.set(3, 3);
  const rough = new THREE.CanvasTexture(noiseCanvas(256, 210, 26));
  rough.wrapS = rough.wrapT = THREE.RepeatWrapping; rough.repeat.set(3, 3);
  return { bump, rough, textures: [bump, rough] };
}
/* Piso: porcelanato claro con junta MUY sutil de escala real (0.60 m). */
function floorMaps(tile = 0.6){
  const px = 256; const c = document.createElement('canvas'); c.width = c.height = px;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#cbc8c1'; ctx.fillRect(0, 0, px, px);
  // veta muy leve
  for(let i = 0; i < 1400; i++){ ctx.fillStyle = `rgba(${180 + Math.random() * 40|0},${178 + Math.random() * 40|0},${172 + Math.random() * 40|0},0.05)`; ctx.fillRect(Math.random() * px, Math.random() * px, 2, 1); }
  // junta en el borde de la celda (grout)
  ctx.strokeStyle = 'rgba(120,118,112,0.55)'; ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, px - 2, px - 2);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(1 / tile, 1 / tile);
  const bumpC = document.createElement('canvas'); bumpC.width = bumpC.height = px; const bctx = bumpC.getContext('2d');
  bctx.fillStyle = '#8a8a8a'; bctx.fillRect(0, 0, px, px);
  bctx.strokeStyle = '#000'; bctx.lineWidth = 3; bctx.strokeRect(1, 1, px - 2, px - 2);
  const bump = new THREE.CanvasTexture(bumpC); bump.wrapS = bump.wrapT = THREE.RepeatWrapping; bump.repeat.set(1 / tile, 1 / tile);
  return { map, bump, textures: [map, bump] };
}

function buildMaterials(cfg, hasEnv){
  const textures = [];
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...o });
  let wall, floor;
  if(cfg.textured){
    const pm = plasterMaps(); textures.push(...pm.textures);
    wall = std(PALETTE.wall, { roughness: 0.94, bumpMap: pm.bump, bumpScale: 0.0016, roughnessMap: pm.rough, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const fm = floorMaps(); textures.push(...fm.textures);
    floor = std(PALETTE.floor, { roughness: cfg.environment ? 0.6 : 0.8, metalness: cfg.environment ? 0.04 : 0, map: fm.map, bumpMap: fm.bump, bumpScale: 0.0015 });
  } else {
    wall = std(PALETTE.wall, { roughness: 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    floor = std(PALETTE.floor, { roughness: 0.85 });
  }
  const wallPending = std(0xF0DFB4, { roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const zoclo = std(PALETTE.zoclo, { roughness: 0.7, metalness: 0 });
  const doorFrame = std(PALETTE.doorFrame, { roughness: 0.62 });
  const doorLeaf = std(PALETTE.doorLeaf, { roughness: 0.55 });
  const handle = new THREE.MeshStandardMaterial({ color: PALETTE.handle, roughness: 0.3, metalness: 0.85 });
  const winFrame = std(PALETTE.winFrame, { roughness: 0.45, metalness: cfg.environment ? 0.55 : 0.2 });
  const sill = std(PALETTE.sill, { roughness: 0.6 });
  let glass;
  if(cfg.physicalGlass && hasEnv){
    try{ glass = new THREE.MeshPhysicalMaterial({ color: PALETTE.glass, roughness: 0.04, metalness: 0, transmission: 0.9, thickness: 0.03, ior: 1.5, transparent: true, opacity: 0.55, envMapIntensity: 1.1 }); }
    catch{ glass = null; }
  }
  if(!glass) glass = new THREE.MeshStandardMaterial({ color: PALETTE.glass, roughness: 0.08, metalness: 0.1, transparent: true, opacity: cfg.glassOpacity });
  const all = [wall, wallPending, floor, zoclo, doorFrame, doorLeaf, handle, winFrame, sill, glass];
  return { wall, wallPending, floor, zoclo, doorFrame, doorLeaf, handle, winFrame, sill, glass, all, textures };
}

/* Marco como anillo EXTRUIDO a todo el peralte del muro, con bisel sutil en
   los cantos -- da profundidad de jamba real + arista suave (no perfecta). */
function frameRingGeometry(width, height, profile, depth){
  const w = width / 2, h = height / 2, iw = w - profile, ih = h - profile;
  const shape = new THREE.Shape();
  shape.moveTo(-w, -h); shape.lineTo(w, -h); shape.lineTo(w, h); shape.lineTo(-w, h); shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-iw, -ih); hole.lineTo(-iw, ih); hole.lineTo(iw, ih); hole.lineTo(iw, -ih); hole.closePath();
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, steps: 1 });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

function addDoorHandle(group, mats, width, fw, hingeRight, geoms){
  const latchX = (hingeRight ? -1 : 1) * (width / 2 - fw - 0.06);
  const y = -0.03; // ~1.0 m sobre el piso para una hoja de 2.10 m
  [1, -1].forEach(side => {
    const z = side * (0.02 + 0.012);
    const roseG = new THREE.CylinderGeometry(0.026, 0.026, 0.012, 16);
    const rose = new THREE.Mesh(roseG, mats.handle); rose.rotation.x = Math.PI / 2; rose.position.set(latchX, y, z);
    const leverG = new THREE.CylinderGeometry(0.011, 0.011, 0.11, 12);
    const lever = new THREE.Mesh(leverG, mats.handle); lever.rotation.z = Math.PI / 2;
    lever.position.set(latchX - (hingeRight ? -1 : 1) * 0.05, y, z + side * 0.01);
    [rose, lever].forEach(m => { m.userData = { objectId: group.userData.objectId, wallGroup: group.userData.wallGroup, part: 'handle' }; group.add(m); });
    geoms.push(roseG, leverG);
  });
}

/* Grupo de una apertura: marco extruido (peralte del muro) + hoja/vidrio +
   manija (puerta) o alfeizar + mullion (ventana), DENTRO del vano real. */
function buildOpeningGroup(el, wallThickness, mats, cfg){
  const group = new THREE.Group();
  group.userData = { objectId: el.objectId, wallGroup: el.hostWallId };
  const { width, height } = el.dimensions;
  const isDoor = el.type === 'door';
  const depth = Math.max(0.06, wallThickness - 0.006);
  const fw = Math.min(isDoor ? 0.07 : 0.05, width * 0.16, height * 0.16);
  const geoms = [];
  const add = (geo, mat, part, tf) => {
    const m = new THREE.Mesh(geo, mat); if(tf) tf(m);
    m.userData = { objectId: el.objectId, wallGroup: el.hostWallId, part };
    if(cfg.shadows){ m.castShadow = true; m.receiveShadow = true; }
    group.add(m); geoms.push(geo); return m;
  };

  add(frameRingGeometry(width, height, fw, depth), isDoor ? mats.doorFrame : mats.winFrame, 'frame');

  if(isDoor){
    const gap = 0.006, lw = width - fw * 2 - gap * 2, lh = height - fw - gap - 0.012; // holgura inferior
    const leafG = new THREE.BoxGeometry(Math.max(lw, 0.01), Math.max(lh, 0.01), 0.04);
    add(leafG, mats.doorLeaf, 'leaf', m => m.position.set(0, (- (fw + 0.012) / 2 + gap), 0.006));
    addDoorHandle(group, mats, width, fw, el && el.swing === 'right', geoms);
  } else {
    const gw = width - fw * 2, gh = height - fw * 2;
    // vidrio dividido por un mullion central
    const halfW = gw / 2 - 0.012;
    [-1, 1].forEach(s => {
      const gg = new THREE.BoxGeometry(Math.max(halfW, 0.01), Math.max(gh, 0.01), 0.02);
      add(gg, mats.glass, 'glass', m => m.position.set(s * (gw / 4 + 0.006), 0, 0));
    });
    const mull = new THREE.BoxGeometry(fw * 0.6, gh, depth * 0.9);
    add(mull, isDoor ? mats.doorFrame : mats.winFrame, 'mullion');
    // alfeizar que sobresale al interior (lado -Z por convencion de la cara)
    const sillG = new THREE.BoxGeometry(width + 0.04, 0.03, depth + 0.05);
    add(sillG, mats.sill, 'sill', m => m.position.set(0, -height / 2 - 0.005, -0.02));
  }

  group.position.set(el.position.x, el.position.y, el.position.z);
  group.rotation.y = el.rotationY || 0;
  return { group, meshes: group.children.filter(c => c.isMesh), geometries: geoms };
}

function addEdges(mesh, geometry, cfg){
  if(cfg.edges <= 0) return;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 24), new THREE.LineBasicMaterial({ color: cfg.edgeHex, transparent: true, opacity: cfg.edges }));
  edges.userData.isEdge = true; edges.raycast = () => {};
  mesh.add(edges);
}

function makeLabelSprite(text){
  const font = 44, pad = 10;
  const c = document.createElement('canvas'); const ctx = c.getContext('2d');
  ctx.font = `700 ${font}px "JetBrains Mono", monospace`;
  const w = Math.ceil(ctx.measureText(text).width);
  c.width = w + pad * 2; c.height = font + pad * 2;
  ctx.font = `700 ${font}px "JetBrains Mono", monospace`;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  const r = 10; ctx.beginPath();
  ctx.moveTo(r, 0); ctx.arcTo(c.width, 0, c.width, c.height, r); ctx.arcTo(c.width, c.height, 0, c.height, r);
  ctx.arcTo(0, c.height, 0, 0, r); ctx.arcTo(0, 0, c.width, 0, r); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(11,47,74,0.55)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#0B2F4A'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true }));
  const h = 0.42; sp.scale.set(h * c.width / c.height, h, 1); sp.renderOrder = 999;
  return sp;
}

function buildContent(model, layers, cfg, hasEnv){
  const { elements, bounds } = deriveCad3D(model);
  const reviewById = new Map();
  [...(model.walls || []), ...(model.openings || []), ...(model.spaces || [])].forEach(el => reviewById.set(el.id, el.review?.status));
  const wallById = new Map((model.walls || []).map(w => [w.id, w]));
  const visible = type => {
    const key = type === 'wall' ? 'walls' : type === 'door' ? 'doors' : type === 'window' ? 'windows' : 'spaces';
    return !layers?.[key] || layers[key].visible;
  };
  const mats = buildMaterials(cfg, hasEnv);
  const group = new THREE.Group();
  const labels = new THREE.Group();
  const meshes = []; const geometries = [];
  const wallCenters = [];

  elements.forEach(el => {
    if(!visible(el.type)) return;
    const pending = reviewById.get(el.objectId) === REVIEW_STATUS.PENDIENTE;
    if(el.type === 'floor'){
      const shape = new THREE.Shape(el.polygon.map(p => new THREE.Vector2(p.x, p.z)));
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: el.thickness, bevelEnabled: false });
      const mesh = new THREE.Mesh(geometry, mats.floor);
      mesh.rotation.x = Math.PI / 2;
      mesh.userData = { objectId: el.objectId, type: 'floor' };
      if(cfg.shadows) mesh.receiveShadow = true;
      addEdges(mesh, geometry, cfg);
      group.add(mesh); meshes.push(mesh); geometries.push(geometry);
    } else if(el.type === 'wall'){
      const geometry = new THREE.BoxGeometry(Math.max(el.dimensions.width, 0.001), Math.max(el.dimensions.height, 0.001), Math.max(el.dimensions.depth, 0.001));
      const mesh = new THREE.Mesh(geometry, pending ? mats.wallPending : mats.wall);
      mesh.position.set(el.position.x, el.position.y, el.position.z); mesh.rotation.y = el.rotationY || 0;
      mesh.userData = { objectId: el.objectId, wallGroup: el.objectId, type: 'wall' };
      if(cfg.shadows){ mesh.castShadow = true; mesh.receiveShadow = true; }
      addEdges(mesh, geometry, cfg);
      group.add(mesh); meshes.push(mesh); geometries.push(geometry);
      // zoclo SOLO en tramos que llegan al piso (no en el dintel sobre un vano)
      const bottom = el.position.y - el.dimensions.height / 2;
      if(bottom <= 0.02){
        const zg = new THREE.BoxGeometry(el.dimensions.width, 0.09, el.dimensions.depth + 0.04);
        const z = new THREE.Mesh(zg, mats.zoclo);
        z.position.set(el.position.x, 0.045, el.position.z); z.rotation.y = el.rotationY || 0;
        z.userData = { objectId: el.objectId, wallGroup: el.objectId, part: 'zoclo' };
        if(cfg.shadows){ z.castShadow = true; z.receiveShadow = true; }
        addEdges(z, zg, cfg);
        group.add(z); meshes.push(z); geometries.push(zg);
      }
    } else {
      const wall = wallById.get(el.hostWallId);
      const { group: og, meshes: om, geometries: ogeo } = buildOpeningGroup(el, wall?.thickness || 0.15, mats, cfg);
      om.forEach(m => addEdges(m, m.geometry, cfg));
      group.add(og); om.forEach(m => meshes.push(m)); ogeo.forEach(g => geometries.push(g));
    }
  });

  (model.walls || []).forEach(w => {
    const mid = pointAlongWall(w, wallLength(w) / 2);
    wallCenters.push({ id: w.id, c: new THREE.Vector3(mid.x, (w.height || 2.7) / 2, mid.y) });
    if(!visible('wall')) return;
    const sp = makeLabelSprite(w.id); sp.position.set(mid.x, (w.height || 2.7) + 0.35, mid.y); labels.add(sp);
  });
  (model.openings || []).forEach(o => {
    if(!visible(o.type === OPENING_TYPE.WINDOW ? 'window' : 'door')) return;
    const wall = wallById.get(o.wallId); if(!wall) return;
    const c = pointAlongWall(wall, o.offset + o.width / 2);
    const sp = makeLabelSprite(o.id); sp.position.set(c.x, (o.sill || 0) + (o.height || 2) + 0.3, c.y); labels.add(sp);
  });
  (model.spaces || []).forEach(s => {
    if(!visible('space') || !s.points?.length) return;
    const cx = s.points.reduce((a, p) => a + p.x, 0) / s.points.length;
    const cz = s.points.reduce((a, p) => a + p.y, 0) / s.points.length;
    const sp = makeLabelSprite(s.id); sp.position.set(cx, 0.5, cz); labels.add(sp);
  });

  return { group, labels, meshes, materials: mats.all, geometries, textures: mats.textures, bounds, wallCenters };
}

function disposeContent(state){
  if(state.group) state.scene.remove(state.group);
  if(state.labels){ state.scene.remove(state.labels); state.labels.traverse(n => { if(n.material){ n.material.map?.dispose?.(); n.material.dispose?.(); } }); }
  (state.geometries || []).forEach(g => g.dispose?.());
  (state.materials || []).forEach(m => m.dispose?.());
  (state.textures || []).forEach(t => t.dispose?.());
  state.meshes?.forEach(m => m.children?.forEach(ch => { if(ch.userData?.isEdge){ ch.geometry?.dispose?.(); ch.material?.dispose?.(); } }));
  state.group = state.labels = null; state.meshes = []; state.materials = []; state.geometries = []; state.textures = [];
}

const VIEWS = [['iso', 'Iso'], ['perspective', 'Persp.'], ['interior', 'Interior'], ['top', 'Sup'], ['front', 'Frontal'], ['side', 'Lateral']];

export default function CadViewer3D({ model, layers, selectedId, onSelect, focusRequest, compact = false }){
  const mountRef = useRef(null);
  const stateRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const framedRef = useRef(false);
  const [mode, setMode] = useState(RENDER_MODE.SHADED);
  const [showGrid, setShowGrid] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [cutMode, setCutMode] = useState(false);
  const [bounds, setBounds] = useState(null);
  const [perf, setPerf] = useState(null);
  const modeRef = useRef(mode); modeRef.current = mode;

  useEffect(() => { setShowLabels(MODE_CFG[mode].labelsDefault); setShowGrid(MODE_CFG[mode].gridDefault); }, [mode]);
  useEffect(() => { if(stateRef.current) stateRef.current.cutMode = cutMode; if(!cutMode && stateRef.current) stateRef.current.meshes.forEach(m => { m.visible = true; }); }, [cutMode]);

  useEffect(() => {
    const mount = mountRef.current;
    if(!mount) return;
    const width = mount.clientWidth || 600, height = mount.clientHeight || 420;
    const scene = createScene(MODE_CFG.sombreado.background);
    const camera = createPerspectiveCamera(width, height, { x: 10, y: 9, z: 13 });
    camera.fov = BASE_FOV; camera.near = 0.05; camera.updateProjectionMatrix();
    const renderer = createRenderer(width, height, { preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.innerHTML = ''; mount.appendChild(renderer.domElement);
    const controls = createOrbitControls(camera, renderer.domElement);
    controls.maxDistance = 500; controls.minDistance = 0.3; controls.maxPolarAngle = Math.PI * 0.5;
    stateRef.current = { renderer, scene, camera, controls, group: null, labels: null, meshes: [], materials: [], geometries: [], textures: [], lights: [], grid: null, ground: null, env: null, composer: null, cutMode: false, wallCenters: [], roomCenter: new THREE.Vector3() };

    const raycaster = new THREE.Raycaster();
    let down = null;
    const onDown = e => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = e => {
      if(!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4){ down = null; return; }
      down = null;
      const st = stateRef.current;
      const hit = raycastFirstHit(raycaster, st.camera, e, renderer.domElement, st.meshes.filter(m => m.visible));
      onSelectRef.current?.(hit ? hit.object.userData.objectId : null);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    const cutTmpA = new THREE.Vector3(), cutTmpB = new THREE.Vector3();
    let frameId, frames = 0, t0 = performance.now();
    const animate = () => {
      controls.update();
      const st = stateRef.current;
      if(st){
        if(st.cutMode && st.wallCenters.length){
          const hidden = new Set();
          st.wallCenters.forEach(w => {
            cutTmpA.subVectors(st.roomCenter, w.c); cutTmpB.subVectors(st.camera.position, w.c);
            if(cutTmpA.dot(cutTmpB) < 0) hidden.add(w.id); // muro entre camara y centro
          });
          st.meshes.forEach(m => { const g = m.userData.wallGroup; m.visible = !(g && hidden.has(g)); });
        }
        if(st.composer) st.composer.render(); else renderer.render(scene, camera);
      }
      frames++;
      const now = performance.now();
      if(now - t0 >= 1000){ setPerf({ fps: Math.round(frames * 1000 / (now - t0)), calls: renderer.info.render.calls, tris: renderer.info.render.triangles }); frames = 0; t0 = now; }
      frameId = requestAnimationFrame(animate);
    };
    animate();

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(entries => {
      const r = entries[0]?.contentRect; if(!r || !r.width || !r.height) return;
      camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
      renderer.setSize(r.width, r.height); stateRef.current?.composer?.setSize?.(r.width, r.height);
    }) : null;
    ro?.observe(mount);

    return () => {
      cancelAnimationFrame(frameId); ro?.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      const st = stateRef.current;
      disposeContent(st);
      st.lights.forEach(l => scene.remove(l));
      if(st.grid){ scene.remove(st.grid); st.grid.geometry.dispose(); st.grid.material.dispose(); }
      if(st.ground){ scene.remove(st.ground); st.ground.geometry.dispose(); st.ground.material.dispose(); }
      st.env?.dispose?.(); st.composer?.dispose?.();
      renderer.dispose();
      stateRef.current = null; framedRef.current = false;
      if(mount) mount.innerHTML = '';
    };
  }, []);

  const frame = (b, preset = 'iso') => {
    const st = stateRef.current; if(!st || !b) return;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, cy = b.height / 2;
    const ex = b.maxX - b.minX, ez = b.maxZ - b.minZ;
    st.camera.up.set(0, preset === 'top' ? 0 : 1, preset === 'top' ? -1 : 0);
    if(preset === 'interior'){
      st.camera.fov = 52; st.camera.updateProjectionMatrix();
      st.camera.position.set(b.minX + ex * 0.88, 1.6, b.minZ + ez * 0.88);
      st.controls.target.set(cx - ex * 0.15, 1.25, cz - ez * 0.15);
      st.controls.update(); return;
    }
    st.camera.fov = preset === 'perspective' ? 46 : BASE_FOV; st.camera.updateProjectionMatrix();
    const radius = Math.max(1, Math.hypot(ex, ez, b.height) / 2);
    const vFov = st.camera.fov * Math.PI / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * st.camera.aspect);
    const fit = radius / Math.sin(Math.min(vFov, hFov) / 2);
    const dist = fit * (preset === 'perspective' ? 0.98 : 1.08);
    const dirs = {
      iso: new THREE.Vector3(0.72, 0.62, 0.9), perspective: new THREE.Vector3(0.85, 0.42, 1.05),
      top: new THREE.Vector3(0.0001, 1, 0.0001), front: new THREE.Vector3(0, 0.14, 1), side: new THREE.Vector3(1, 0.14, 0.0001)
    };
    const d = (dirs[preset] || dirs.iso).clone().normalize();
    st.controls.target.set(cx, cy, cz);
    st.camera.position.set(cx + d.x * dist, cy + d.y * dist, cz + d.z * dist);
    st.controls.update();
  };

  useEffect(() => {
    const st = stateRef.current; if(!st) return;
    const cfg = MODE_CFG[mode];
    st.scene.background = new THREE.Color(cfg.background);
    st.renderer.toneMapping = cfg.toneMapping; st.renderer.toneMappingExposure = cfg.exposure;
    st.renderer.shadowMap.enabled = cfg.shadows;

    if(st.env){ st.env.dispose?.(); st.env = null; st.scene.environment = null; }
    if(cfg.environment){ const tex = createStudioEnvironment(st.renderer); if(tex){ st.env = tex; st.scene.environment = tex; } }

    disposeContent(st);
    const built = buildContent(model, layers, cfg, !!st.env);
    st.group = built.group; st.labels = built.labels; st.meshes = built.meshes;
    st.materials = built.materials; st.geometries = built.geometries; st.textures = built.textures;
    st.wallCenters = built.wallCenters;
    st.scene.add(built.group); st.scene.add(built.labels);
    built.labels.visible = showLabels;
    st.bounds = built.bounds; setBounds(built.bounds);
    if(built.bounds) st.roomCenter.set((built.bounds.minX + built.bounds.maxX) / 2, built.bounds.height / 2, (built.bounds.minZ + built.bounds.maxZ) / 2);

    st.lights.forEach(l => st.scene.remove(l)); st.lights = [];
    const dim = built.bounds ? Math.max(built.bounds.maxX - built.bounds.minX, built.bounds.maxZ - built.bounds.minZ, built.bounds.height, 3) : 8;
    const hemi = new THREE.HemisphereLight(0xffffff, 0xBEB6A8, cfg.hemi);
    const key = new THREE.DirectionalLight(0xfff3e2, cfg.key);
    key.position.set(dim * 0.75, dim * 1.5, dim * 0.5);
    const fill = new THREE.DirectionalLight(0xdfe8ff, cfg.fill);
    fill.position.set(-dim * 0.9, dim * 0.55, -dim * 0.85);
    st.lights.push(hemi, key, fill); st.scene.add(hemi, key, fill);
    if(cfg.shadows){ configureShadowLight(key, { maxDimension: dim, mapSize: isMobileUA() ? 1024 : 2048 }); key.shadow.bias = -0.00035; key.shadow.normalBias = 0.025; }

    if(st.ground){ st.scene.remove(st.ground); st.ground.geometry.dispose(); st.ground.material.dispose(); st.ground = null; }
    if(cfg.shadows && built.bounds){
      if(cfg.ground === 'solid'){
        const g = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(60, dim * 8), Math.max(60, dim * 8)), new THREE.MeshStandardMaterial({ color: PALETTE.groundR, roughness: 1, metalness: 0 }));
        g.rotation.x = -Math.PI / 2; g.position.y = -0.03; g.receiveShadow = true;
        st.scene.add(g); st.ground = g;
      } else {
        const g = createContactShadowGround(Math.max(24, dim * 4), -0.001); st.scene.add(g); st.ground = g;
      }
    }
    if(st.grid){ st.scene.remove(st.grid); st.grid.geometry.dispose(); st.grid.material.dispose(); st.grid = null; }
    if(showGrid && built.bounds){
      const size = Math.ceil(Math.max(built.bounds.maxX - built.bounds.minX, built.bounds.maxZ - built.bounds.minZ) + 6);
      const grid = new THREE.GridHelper(size, size, 0xC6D0D8, 0xE6EBEF);
      grid.material.opacity = 0.55; grid.material.transparent = true;
      grid.position.set(Math.round((built.bounds.minX + built.bounds.maxX) / 2), -0.015, Math.round((built.bounds.minZ + built.bounds.maxZ) / 2));
      st.scene.add(grid); st.grid = grid;
    }

    st.composer?.dispose?.(); st.composer = null;
    if(cfg.ao && !isMobileUA()){
      try{
        const size = new THREE.Vector2(); st.renderer.getSize(size);
        const composer = new EffectComposer(st.renderer);
        composer.addPass(new RenderPass(st.scene, st.camera));
        const gtao = new GTAOPass(st.scene, st.camera, size.x, size.y);
        gtao.output = GTAOPass.OUTPUT.Default;
        if(gtao.updateGtaoMaterial) gtao.updateGtaoMaterial({ radius: 0.28, distanceExponent: 1, thickness: 1, scale: 1, samples: 16 });
        composer.addPass(gtao); composer.addPass(new OutputPass());
        composer.setSize(size.x, size.y); st.composer = composer;
      }catch{ st.composer = null; }
    }

    if(built.bounds && !framedRef.current){ frame(built.bounds, 'iso'); framedRef.current = true; }
    applyHighlight(st.meshes, selectedId, mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, layers, mode, showGrid]);

  useEffect(() => { if(stateRef.current?.labels) stateRef.current.labels.visible = showLabels; }, [showLabels]);
  useEffect(() => { const st = stateRef.current; if(st) applyHighlight(st.meshes, selectedId, mode); }, [selectedId, mode]);

  useEffect(() => {
    const st = stateRef.current;
    if(!st || !focusRequest?.id) return;
    const targets = st.meshes.filter(m => m.userData.objectId === focusRequest.id);
    if(!targets.length) return;
    const box = new THREE.Box3(); targets.forEach(m => box.expandByObject(m));
    const center = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 1.5) * 1.8 + 2;
    const dir = st.camera.position.clone().sub(st.controls.target).normalize();
    if(!Number.isFinite(dir.x) || dir.lengthSq() === 0) dir.set(0.7, 0.6, 0.9).normalize();
    st.controls.target.copy(center);
    st.camera.position.copy(center.clone().add(dir.multiplyScalar(radius)));
    st.controls.update();
  }, [focusRequest?.nonce]);

  const isRealistic = mode === RENDER_MODE.REALISTIC;
  return <div className={`cad-3d ${compact ? 'is-compact' : ''}`}>
    <div className="cad-3d-toolbar">
      <div className="cad-3d-modes" role="tablist" aria-label="Modo de render">
        {Object.values(RENDER_MODE).map(m => <button key={m} type="button" role="tab" aria-selected={mode === m}
          className={mode === m ? 'is-active' : ''} onClick={() => setMode(m)}>{MODE_LABEL[m]}</button>)}
      </div>
      <span className="cad-3d-views">
        {VIEWS.map(([k, label]) => <button key={k} type="button" className="soft" onClick={() => frame(bounds, k)}>{label}</button>)}
      </span>
      <button type="button" className={`soft ${cutMode ? 'is-on' : ''}`} onClick={() => setCutMode(v => !v)} title="Ocultar los muros entre la cámara y el interior">Corte</button>
      <label className="cad-3d-check"><input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} />Grid</label>
      <label className="cad-3d-check"><input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} />IDs</label>
    </div>
    <div ref={mountRef} className="cad-3d-mount" />
    {!bounds && <div className="cad-3d-empty">Sin geometría para mostrar en 3D todavía.</div>}
    {selectedId && bounds && stateRef.current?.meshes?.some(m => m.userData.objectId === selectedId) && <div className="cad-3d-selected">{selectedId}</div>}
    {perf && <div className="cad-3d-perf" title="FPS · draw calls · triángulos">{perf.fps} fps · {perf.calls} dc · {(perf.tris / 1000).toFixed(1)}k</div>}
  </div>;
}

function applyHighlight(meshes, selectedId, mode){
  const cfg = MODE_CFG[mode];
  meshes.forEach(mesh => {
    const selected = !!selectedId && mesh.userData.objectId === selectedId;
    if(mesh.material?.emissive){
      mesh.material.emissive.setHex(selected ? SELECT_HEX : 0x000000);
      mesh.material.emissiveIntensity = selected ? (mode === RENDER_MODE.REALISTIC ? 0.1 : 0.14) : 0;
    }
    let edge = mesh.children.find(ch => ch.userData?.isEdge);
    if(selected && !edge){
      edge = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 24), new THREE.LineBasicMaterial({ color: SELECT_HEX }));
      edge.userData.isEdge = true; edge.userData.temp = true; edge.raycast = () => {};
      mesh.add(edge);
    } else if(edge){
      if(selected){ edge.material.color.setHex(SELECT_HEX); edge.material.opacity = 1; edge.material.transparent = false; }
      else if(edge.userData.temp){ edge.geometry.dispose(); edge.material.dispose(); mesh.remove(edge); }
      else { edge.material.color.setHex(cfg.edgeHex); edge.material.opacity = cfg.edges; edge.material.transparent = true; }
    }
  });
}
