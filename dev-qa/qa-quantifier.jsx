/* ARNES DE QA (Fase B -- Cuantificador Parametrico ZOEMEC) -- NO es parte
   del producto ni del build de produccion. Prueba el wizard REAL
   (QuantifierWizard) contra el EMULADOR de Firebase (Auth+Firestore, nunca
   produccion): auxiliares base sembrados en Firestore, flujo completo
   Familia->Elemento->Datos->Parametros->Revision->Resultado->Generar APU,
   con un catalogo falso en memoria (no necesita Storage). */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import '../src/style.css';
import { auth } from '../src/firebase.js';
import { QuantifierWizard } from '../src/features/quantifier/QuantifierWizard.jsx';
import { buildBaseAuxiliaries } from '../src/domain/auxiliaries.js';
import { I18nProvider } from '../src/i18n/I18nContext.jsx';

const QA_EMAIL = 'qa.quantifier@zoemec.test';
const QA_PASSWORD = 'QaQuantifierEmulator!';

const FAKE_CATALOG = [
  { desc: 'Cemento gris CPC 30R', unidad: 'saco', precio: 248, estado: 'VERIFICADO', tipo: 'material' },
  { desc: 'Arena de río', unidad: 'm³', precio: 465, tipo: 'material' },
  { desc: 'Grava 3/4"', unidad: 'm³', precio: 505, tipo: 'material' },
  { desc: 'Block hueco de concreto 15x20x40 cm', unidad: 'pza', precio: 17.2, tipo: 'material' }
];

function QaHarness(){
  const [authState, setAuthState] = useState('signing-in');
  const [seeded, setSeeded] = useState(false);
  const [generatedApu, setGeneratedApu] = useState(null);
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    (async () => {
      try{
        try{ await signInWithEmailAndPassword(auth, QA_EMAIL, QA_PASSWORD); }
        catch{ await createUserWithEmailAndPassword(auth, QA_EMAIL, QA_PASSWORD); }
        setAuthState('ready');
      }catch(err){ setAuthState('error: ' + err.message); }
    })();
  }, []);

  const seedBaseAuxiliaries = async () => {
    // Sembrar auxiliares BASE (organizationId:null) es una operacion de
    // administracion (ver firestore.rules -- solo super_admin puede crear
    // un auxiliar global, correctamente probado en
    // test/auxiliaries.rules.test.mjs). Esta cuenta de QA normal no tiene
    // ese claim, asi que saveAuxiliary() aqui SI fallaria con
    // permission-denied -- lo correcto para esta prueba puntual es
    // simplemente confirmar que YA estan sembrados (via el REST admin del
    // emulador, hecho aparte para este arnes) en vez de re-escribirlos con
    // la cuenta normal.
    const { listGlobalAuxiliaries } = await import('../src/services/auxiliariesApi.js');
    const existing = await listGlobalAuxiliaries();
    if(existing.length >= buildBaseAuxiliaries().length) setSeeded(true);
    else alert('Los auxiliares base no estan sembrados todavia -- sembralos via el REST admin del emulador (ver notas de QA).');
  };

  return <div style={{ maxWidth: 900, margin: '0 auto', padding: 16, fontFamily: 'sans-serif' }}>
    <div style={{ background: '#2A1740', color: '#fff', padding: '8px 14px', borderRadius: 8, marginBottom: 16, fontSize: '.82rem' }}>
      ARNES DE QA -- Cuantificador Parametrico -- no es producto. Sesion: {authState}.
    </div>
    {authState === 'ready' && <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
      <button disabled={seeded} onClick={seedBaseAuxiliaries}>{seeded ? 'Auxiliares base sembrados' : 'QA: sembrar auxiliares base (CONC-200/MORT-1-4/CIMBRA-COMUN)'}</button>
      <button onClick={() => setMounted(m => !m)}>{mounted ? 'P0: Simular cambio de módulo (desmontar)' : 'P0: Volver (remontar)'}</button>
    </div>}
    {authState === 'ready' && seeded && mounted && <QuantifierWizard
      user={{ uid: auth.currentUser?.uid }}
      catalog={FAKE_CATALOG}
      organizationId="qa-org-A"
      activeProjectId="QA-PROJECT"
      onCancel={() => console.log('QA onCancel')}
      onApuGenerated={(apu) => { console.log('QA onApuGenerated', apu); setGeneratedApu(apu); }}
    />}
    {authState === 'ready' && seeded && !mounted && <p className="muted">(wizard desmontado -- como si hubieras cambiado de módulo)</p>}
    {generatedApu && <pre style={{ fontSize: '.7rem', background: '#f4f4f8', padding: 8, marginTop: 16, overflow: 'auto' }} id="qa-generated-apu">
{JSON.stringify({ id: generatedApu.id, family: generatedApu.family, parametricGenerated: generatedApu.parametricGenerated, materials: generatedApu.materials, labor: generatedApu.labor }, null, 1)}
    </pre>}
  </div>;
}

createRoot(document.getElementById('root')).render(<I18nProvider><QaHarness /></I18nProvider>);
