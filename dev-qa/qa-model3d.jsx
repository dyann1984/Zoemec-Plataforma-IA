/* ARNES DE QA (Incidente 3 + Fase 1 -- visor/importador 3D) -- NO es parte
   del producto ni del build de produccion (mismo criterio que
   qa-apu-editor.jsx: vite.config.js no lo referencia como entrada).

   Dos fixtures para cubrir las dos ramas de detectMaterialQuality:
   - OBJ (dev-qa/fixtures/qa-inverted-nolight.obj): sin normales, winding
     invertido en 3 caras, SIN material -- debe arrancar en modo "tecnico".
   - GLB generado EN VIVO en el navegador (GLTFExporter, sin descargar nada
     ni depender de un archivo binario en el repo): dos cajas con nombre y
     color distintos ("Muro_Norte" rojo, "Losa_Entrepiso" azul) -- debe
     arrancar en modo "realista" (>=2 colores reales) y el selector "pintar
     por parte" debe ofrecer Muros/Losas (nombres reconocidos por
     classifyMeshPart en three3dVisualizationModes.js). */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import '../src/style.css';
import { loadModel3D } from '../src/lib/levantamientoModelLoader.js';
import { Model3DPreview } from '../src/features/levantamiento/Model3DPreview.jsx';
import { I18nProvider } from '../src/i18n/I18nContext.jsx';

async function buildGlbFixtureFile(){
  const scene = new THREE.Scene();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 2.5, 0.2), new THREE.MeshStandardMaterial({ color: 0xb33a3a }));
  wall.name = 'Muro_Norte';
  wall.position.set(0, 1.25, 0);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 3), new THREE.MeshStandardMaterial({ color: 0x2f5f8a }));
  slab.name = 'Losa_Entrepiso';
  slab.position.set(0, 0, 1.5);
  scene.add(wall, slab);
  const glb = await new Promise((resolve, reject) => {
    new GLTFExporter().parse(scene, resolve, reject, { binary: true });
  });
  return new File([glb], 'qa-real-materials.glb', { type: 'model/gltf-binary' });
}

/* QA cierre (matriz completa): faltaba un GLB SIN material real -- un solo
   mesh, un solo color plano, sin textura -- mismo criterio que
   detectMaterialQuality (necesita >=2 colores o una textura para contar como
   "material real"). Cubre el mismo camino que el OBJ pero via glb/GLTFLoader,
   y sirve tambien como caso "una sola malla" en formato GLB. */
async function buildGlbSinMaterialFixtureFile(){
  const scene = new THREE.Scene();
  const box = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 1.5), new THREE.MeshStandardMaterial({ color: 0x8a8a8a }));
  box.name = 'Columna_Sin_Material';
  scene.add(box);
  const glb = await new Promise((resolve, reject) => {
    new GLTFExporter().parse(scene, resolve, reject, { binary: true });
  });
  return new File([glb], 'qa-no-material.glb', { type: 'model/gltf-binary' });
}

/* QA cierre: "modelo grande" + "multi-mesh" en un solo fixture -- grilla de
   cajas independientes (mesh por celda, NUNCA geometria fusionada, para que
   siga siendo un caso real de muchos meshes) con 2 colores alternados (>=2
   colores reales). Sirve para medir FPS/draw calls/triangulos bajo carga. */
async function buildGlbLargeMultiMeshFixtureFile(){
  const scene = new THREE.Scene();
  const cols = 20, rows = 20, floors = 3;
  const matA = new THREE.MeshStandardMaterial({ color: 0xb33a3a });
  const matB = new THREE.MeshStandardMaterial({ color: 0x2f5f8a });
  const geo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
  for(let f = 0; f < floors; f++){
    for(let x = 0; x < cols; x++){
      for(let z = 0; z < rows; z++){
        const mesh = new THREE.Mesh(geo, (x + z) % 2 === 0 ? matA : matB);
        mesh.name = `Bloque_${f}_${x}_${z}`;
        mesh.position.set(x - cols / 2, f, z - rows / 2);
        scene.add(mesh);
      }
    }
  }
  const glb = await new Promise((resolve, reject) => {
    new GLTFExporter().parse(scene, resolve, reject, { binary: true });
  });
  return new File([glb], 'qa-large-multimesh.glb', { type: 'model/gltf-binary' });
}

const FIXTURES = {
  obj_sin_material: {
    label: 'OBJ sin material (espera: modo Técnico)',
    load: async () => {
      const res = await fetch('/dev-qa/fixtures/qa-inverted-nolight.obj');
      const blob = await res.blob();
      return loadModel3D(new File([blob], 'qa-inverted-nolight.obj', { type: 'text/plain' }), 'obj');
    }
  },
  glb_con_material: {
    label: 'GLB con 2 colores reales (espera: modo Realista + pintar por parte)',
    load: async () => loadModel3D(await buildGlbFixtureFile(), 'glb')
  },
  glb_sin_material: {
    label: 'GLB sin material real (espera: modo Técnico, 1 mesh)',
    load: async () => loadModel3D(await buildGlbSinMaterialFixtureFile(), 'glb')
  },
  glb_grande_multimesh: {
    label: 'GLB grande multi-mesh (1200 meshes, ~14400 triangulos)',
    load: async () => loadModel3D(await buildGlbLargeMultiMeshFixtureFile(), 'glb')
  }
};

function QaHarness(){
  const [fixtureId, setFixtureId] = useState('obj_sin_material');
  const [result, setResult] = useState(null);

  useEffect(() => {
    setResult(null);
    FIXTURES[fixtureId].load().then(setResult);
  }, [fixtureId]);

  return <div style={{ maxWidth: 900, margin: '0 auto', padding: 16, fontFamily: 'sans-serif' }}>
    <div style={{ background: '#2A1740', color: '#fff', padding: '8px 14px', borderRadius: 8, marginBottom: 16, fontSize: '.82rem' }}>
      ARNES DE QA -- Incidente 3 / Fase 1 -- no es producto.
    </div>
    <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
      {Object.entries(FIXTURES).map(([id, f]) => (
        <button key={id} disabled={fixtureId === id} onClick={() => setFixtureId(id)}>{f.label}</button>
      ))}
    </div>
    {!result && <p>Cargando fixture...</p>}
    {result && !result.ok && <p style={{ color: 'red' }}>ERROR: {result.reason} -- {result.message}</p>}
    {result?.ok && <>
      <p style={{ fontSize: '.82rem' }}>
        meshCount={result.meshCount} triangleCount={result.triangleCount}<br/>
        boundingBox.size = x:{result.boundingBox.size.x.toFixed(2)} y:{result.boundingBox.size.y.toFixed(2)} z:{result.boundingBox.size.z.toFixed(2)}
      </p>
      <Model3DPreview object3D={result.object3D} boundingBox={result.boundingBox} />
    </>}
  </div>;
}

createRoot(document.getElementById('root')).render(<I18nProvider><QaHarness /></I18nProvider>);
