import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EngineeringCopilot } from '../../../src/features/apu/EngineeringCopilot.jsx';
import '../../../src/style.css';
function Harness() {
  const [projectId, setProjectId] = useState('nebius-demo-las-palmas');
  return <><p>PRUEBA UI: todas las respuestas del proveedor son mocks; no es una llamada real.</p>
    <button onClick={() => setProjectId('otro-proyecto')}>Cambiar proyecto de prueba</button>
    <EngineeringCopilot projectId={projectId} apuId="nebius-demo-acero" projectName={projectId === 'otro-proyecto' ? 'Otro proyecto' : 'Residencial Las Palmas - Edificio A'} />
  </>;
}
createRoot(document.getElementById('root')).render(<Harness />);
