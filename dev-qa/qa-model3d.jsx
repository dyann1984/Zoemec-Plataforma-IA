/* ARNES DE QA (Incidente 3 -- visor/importador 3D) -- NO es parte del
   producto ni del build de produccion (mismo criterio que qa-apu-editor.jsx:
   vite.config.js no lo referencia como entrada). Unico proposito: cargar el
   fixture dev-qa/fixtures/qa-inverted-nolight.obj (sin normales, con winding
   invertido en 3 caras, dimensiones X=1/Y=2/Z=3 en el archivo) a traves del
   MISMO codigo de produccion (loadModel3D + Model3DPreview) y verificar
   visualmente, sin login, que: no se vea negra, no se vea deformada (la
   dimension mayor -3- debe terminar vertical), y las vistas top/front/iso
   funcionen. No usa Firebase para nada -- este modulo es 100% cliente. */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/style.css';
import { loadModel3D } from '../src/lib/levantamientoModelLoader.js';
import { Model3DPreview } from '../src/features/levantamiento/Model3DPreview.jsx';
import { I18nProvider } from '../src/i18n/I18nContext.jsx';

function QaHarness(){
  const [result, setResult] = useState(null);

  useEffect(() => {
    (async () => {
      const res = await fetch('/dev-qa/fixtures/qa-inverted-nolight.obj');
      const blob = await res.blob();
      const file = new File([blob], 'qa-inverted-nolight.obj', { type: 'text/plain' });
      const loaded = await loadModel3D(file, 'obj');
      setResult(loaded);
    })();
  }, []);

  return <div style={{ maxWidth: 900, margin: '0 auto', padding: 16, fontFamily: 'sans-serif' }}>
    <div style={{ background: '#2A1740', color: '#fff', padding: '8px 14px', borderRadius: 8, marginBottom: 16, fontSize: '.82rem' }}>
      ARNES DE QA -- Incidente 3 -- no es producto. Fixture: caja SIN normales, 3 caras con winding invertido, dimensiones archivo X=1 Y=2 Z=3 (Z-up).
    </div>
    {!result && <p>Cargando fixture...</p>}
    {result && !result.ok && <p style={{ color: 'red' }}>ERROR: {result.reason} -- {result.message}</p>}
    {result?.ok && <>
      <p style={{ fontSize: '.82rem' }}>
        meshCount={result.meshCount} triangleCount={result.triangleCount}<br/>
        boundingBox.size (YA con la correccion Z-up-&gt;Y-up aplicada) = x:{result.boundingBox.size.x.toFixed(2)} y:{result.boundingBox.size.y.toFixed(2)} z:{result.boundingBox.size.z.toFixed(2)}<br/>
        Esperado: y (vertical, Three.js Y-up) debe ser la dimension MAYOR (~3), x~1, z~2 -- si no, la correccion de ejes fallo.
      </p>
      <Model3DPreview object3D={result.object3D} boundingBox={result.boundingBox} />
    </>}
  </div>;
}

createRoot(document.getElementById('root')).render(<I18nProvider><QaHarness /></I18nProvider>);
