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
