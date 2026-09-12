/* ARNES DE QA -- diagnostico con el ARCHIVO 3D REAL reportado como "se ve
   mal en produccion" (casa_toledo_desde_plano.glb/.obj, provisto
   directamente por el usuario). NO es parte del producto ni del build de
   produccion. A diferencia de qa-model3d.jsx (fixtures sinteticas para
   probar la heuristica de deteccion de material), este arnes usa el
   archivo EXACTO y real -- copiado sin modificar a dev-qa/fixtures-real/
   solo para que el servidor de Vite pueda sevirlo, nunca alterado.

   Carga el archivo con el mismo loadModel3D real de produccion
   (src/lib/levantamientoModelLoader.js) y lo monta en el mismo
   Model3DPreview real -- ningun mock, ninguna geometria inventada. Expone
   ademas metadatos crudos por malla (nombre, bounding box LOCAL de cada
   mesh, si tiene normal/material propios) para poder diagnosticar sin
   depender solo de la inspeccion visual. */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import '../src/style.css';
import { loadModel3D } from '../src/lib/levantamientoModelLoader.js';
import { Model3DPreview } from '../src/features/levantamiento/Model3DPreview.jsx';
import { I18nProvider } from '../src/i18n/I18nContext.jsx';

const FILES = {
  glb: { label: 'casa_toledo_desde_plano.glb (real)', url: '/dev-qa/fixtures-real/casa_toledo_desde_plano.glb', formatId: 'glb' },
  obj: { label: 'casa_toledo_desde_plano.obj (real)', url: '/dev-qa/fixtures-real/casa_toledo_desde_plano.obj', formatId: 'obj' }
};

function inspectMeshes(object3D){
  const meshes = [];
  object3D.traverse(node => {
    if(!node.isMesh || !node.geometry) return;
    const box = new THREE.Box3().setFromObject(node);
    const size = new THREE.Vector3(); box.getSize(size);
    const min = box.min, max = box.max;
    const hasNormal = !!node.geometry.attributes?.normal;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    meshes.push({
      name: node.name || '(sin nombre)',
      vertexCount: node.geometry.attributes?.position?.count || 0,
      hasNormalBeforeFix: hasNormal,
      materialTypes: mats.map(m => m?.type || 'ninguno'),
      worldBox: { min: [min.x, min.y, min.z].map(v => +v.toFixed(3)), max: [max.x, max.y, max.z].map(v => +v.toFixed(3)), size: [size.x, size.y, size.z].map(v => +v.toFixed(3)) }
    });
  });
  return meshes;
}

function QaHarness(){
  const [fileId, setFileId] = useState('glb');
  const [result, setResult] = useState(null);
  const [meshInfo, setMeshInfo] = useState([]);

  useEffect(() => {
    setResult(null);
    setMeshInfo([]);
    const f = FILES[fileId];
    fetch(f.url).then(r => r.blob()).then(async blob => {
      const file = new File([blob], f.url.split('/').pop(), { type: f.formatId === 'obj' ? 'text/plain' : 'model/gltf-binary' });
      const res = await loadModel3D(file, f.formatId);
      setResult(res);
      if(res.ok) setMeshInfo(inspectMeshes(res.object3D));
    });
  }, [fileId]);

  return <div style={{ maxWidth: 1000, margin: '0 auto', padding: 16, fontFamily: 'sans-serif' }}>
    <div style={{ background: '#2A1740', color: '#fff', padding: '8px 14px', borderRadius: 8, marginBottom: 16, fontSize: '.82rem' }}>
      ARNES DE QA -- diagnostico con archivo 3D REAL (casa_toledo_desde_plano) -- no es producto.
    </div>
    <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
      {Object.entries(FILES).map(([id, f]) => (
        <button key={id} disabled={fileId === id} onClick={() => setFileId(id)}>{f.label}</button>
      ))}
    </div>
    {!result && <p>Cargando archivo real...</p>}
    {result && !result.ok && <p style={{ color: 'red' }}>ERROR: {result.reason} -- {result.message}</p>}
    {result?.ok && <>
      <pre id="qa-diagnostics" style={{ fontSize: '.72rem', background: '#f4f4f8', padding: 8, borderRadius: 6, overflow: 'auto' }}>
{JSON.stringify({
  meshCount: result.meshCount, triangleCount: result.triangleCount,
  boundingBox: result.boundingBox, diagnostics: result.diagnostics, meshes: meshInfo
}, null, 1)}
      </pre>
      <Model3DPreview object3D={result.object3D} boundingBox={result.boundingBox} diagnostics={result.diagnostics} />
    </>}
  </div>;
}

createRoot(document.getElementById('root')).render(<I18nProvider><QaHarness /></I18nProvider>);
