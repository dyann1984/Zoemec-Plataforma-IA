/* ARNES DE QA (P1 -- contexto regional visible en APU) -- NO es parte del
   producto ni del build de produccion. Monta RegionalContextPanel solo,
   con 3 fixtures de apu que cubren los 3 estados reales: sin ubicacion,
   con ubicacion pero sin ningun insumo con busqueda regional todavia, y
   con insumos mezclados (ciudad/estado/nacional). */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/style.css';
import { RegionalContextPanel } from '../src/features/apu/RegionalContextPanel.jsx';

const FIXTURES = {
  sin_ubicacion: {
    label: 'Sin ubicación definida',
    apu: { ubicacionEstructurada: { country: null, state: null, city: null }, materials: [{ descripcion: 'Cemento', precioUnitario: 245 }] }
  },
  sin_busqueda: {
    label: 'Con ubicación, sin ningún insumo buscado todavía',
    apu: { ubicacionEstructurada: { country: 'México', state: 'Estado de México', city: 'Tecámac' }, materials: [{ descripcion: 'Cemento', precioUnitario: 245 }] }
  },
  mixto: {
    label: 'Mezclado: ciudad/estado/nacional',
    apu: {
      ubicacionEstructurada: { country: 'México', state: 'Estado de México', city: 'Tecámac' },
      materials: [
        { descripcion: 'Block hueco 15x20x40', precioUnitario: 18.7, regionalFallbackLevel: 'ciudad', regionalConfidence: 'ALTA', priceStatus: 'VERIFIED_MARKET', fuente: { region: 'Tecámac, Estado de México' }, regionalIntelligence: { nObservaciones: 14 } },
        { descripcion: 'Cemento CPC 30R', precioUnitario: 245, regionalFallbackLevel: 'estado', regionalConfidence: 'MEDIA', priceStatus: 'MARKET_REFERENCE', fuente: { region: 'Estado de México' } },
        { descripcion: 'Acero de refuerzo', precioUnitario: 800, regionalFallbackLevel: 'nacional', regionalConfidence: 'BAJA', priceStatus: 'AI_ESTIMATE_UNVERIFIED', fuente: { region: 'México (nacional)' } },
        { descripcion: 'Arena', precioUnitario: 90 }
      ]
    }
  }
};

function QaHarness(){
  const [fixtureId, setFixtureId] = useState('sin_ubicacion');
  return <div style={{ maxWidth: 700, margin: '0 auto', padding: 16, fontFamily: 'sans-serif' }}>
    <div style={{ background: '#2A1740', color: '#fff', padding: '8px 14px', borderRadius: 8, marginBottom: 16, fontSize: '.82rem' }}>
      ARNES DE QA -- P1 (contexto regional en APU) -- no es producto.
    </div>
    <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
      {Object.entries(FIXTURES).map(([id, f]) => (
        <button key={id} disabled={fixtureId === id} onClick={() => setFixtureId(id)}>{f.label}</button>
      ))}
    </div>
    <RegionalContextPanel apu={FIXTURES[fixtureId].apu} onConfigureLocation={() => alert('QA: iría a Cartera/Proyectos')} />
  </div>;
}

createRoot(document.getElementById('root')).render(<QaHarness />);
