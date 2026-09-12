/* ARNES DE QA (Fase 3 -- Propuesta constructiva con IA) -- NO es parte del
   producto ni del build de produccion. Monta ConstructionProposalPanel
   solo (sin SurveyDetail/Firebase/login) e intercepta window.fetch para
   /api/construction-proposal con una respuesta fija -- prueba la UI
   completa (formulario, badges de origen, banner de validacion
   profesional, boton de copiar conceptos) sin necesitar OPENAI_API_KEY ni
   una llamada real a OpenAI (que cuesta dinero y no aplica en dev). */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/style.css';
import { ConstructionProposalPanel } from '../src/features/levantamiento/ConstructionProposalPanel.jsx';
import { I18nProvider } from '../src/i18n/I18nContext.jsx';

const FIXED_PROPOSAL = {
  descripcion: 'Terraza cubierta con acceso desde la cocina, estructura ligera y techo de policarbonato.',
  dimensiones: {
    largo: { valor: 4.2, origen: 'proporcionado' },
    ancho: { valor: 3.5, origen: 'detectado' },
    altura: { valor: 2.6, origen: 'estimado' },
    superficie: { valor: 14.7, origen: 'inferido' },
    volumen: { valor: 38.2, origen: 'inferido' }
  },
  sistemaConstructivo: {
    preliminares: ['Trazo y nivelación del área'],
    cimentacion: ['Zapatas aisladas para postes de soporte'],
    estructura: ['Postes de acero PTR 4"x4"', 'Vigas de soporte PTR 2"x4"'],
    muros: [],
    cubierta: ['Lámina de policarbonato traslúcido'],
    instalaciones: ['Salida eléctrica para iluminación exterior'],
    acabados: ['Pintura anticorrosiva en estructura metálica']
  },
  requiresProfessionalValidation: true,
  notes: [
    'La altura se estimó por proporción visual, sin una medida real confirmada.',
    'El diseño estructural (postes/vigas) es conceptual -- requiere cálculo real de un ingeniero antes de construir.'
  ]
};

const originalFetch = window.fetch.bind(window);
window.fetch = async (url, options) => {
  if(typeof url === 'string' && url.startsWith('/api/construction-proposal')){
    const body = JSON.parse(options?.body || '{}');
    const payload = body.action === 'generate'
      ? { ok: true, proposal: FIXED_PROPOSAL }
      : { ok: true, concepts: [
          { categoria: 'preliminares', concept: 'Trazo y nivelación del área' },
          { categoria: 'cimentacion', concept: 'Zapatas aisladas para postes de soporte' },
          { categoria: 'estructura', concept: 'Postes de acero PTR 4"x4"' },
          { categoria: 'estructura', concept: 'Vigas de soporte PTR 2"x4"' },
          { categoria: 'cubierta', concept: 'Lámina de policarbonato traslúcido' },
          { categoria: 'instalaciones', concept: 'Salida eléctrica para iluminación exterior' },
          { categoria: 'acabados', concept: 'Pintura anticorrosiva en estructura metálica' }
        ] };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return originalFetch(url, options);
};

function QaHarness(){
  // P0: "mounted" simula cambiar de pestana/modulo (desmonta el panel por
  // completo) y volver -- si el borrador de verdad sobrevive, el formulario/
  // resultado deben reaparecer identicos al reabrir, sin volver a escribir
  // nada ni a generar de nuevo.
  const [mounted, setMounted] = useState(true);
  return <div style={{ maxWidth: 700, margin: '0 auto', padding: 16, fontFamily: 'sans-serif' }}>
    <div style={{ background: '#2A1740', color: '#fff', padding: '8px 14px', borderRadius: 8, marginBottom: 16, fontSize: '.82rem' }}>
      ARNES DE QA -- Fase 3 (Propuesta con IA) -- no es producto. fetch('/api/construction-proposal') interceptado con una respuesta fija, sin llamar a OpenAI real.
    </div>
    <button onClick={() => setMounted(m => !m)} style={{ marginBottom: 12 }}>
      {mounted ? 'P0: Simular cambio de pestaña (desmontar)' : 'P0: Volver (remontar)'}
    </button>
    {mounted
      ? <ConstructionProposalPanel surveyId="QA-SURVEY-1" imageUrls={[]} hasEvidence={true} stylePreferences={{ colors: ['blanco'], materials: ['concreto'], estilo: 'moderno' }} />
      : <p className="muted">(panel desmontado -- como si hubieras cambiado de módulo)</p>}
  </div>;
}

createRoot(document.getElementById('root')).render(<I18nProvider><QaHarness /></I18nProvider>);
