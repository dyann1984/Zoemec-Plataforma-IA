/* ARNES DE QA (Fase 5 + Fase 6) -- NO es parte del producto ni del build de
   produccion. Unico proposito: poder ver ProfessionalApuEditor (con
   ZoemecIntelligencePanel) en un navegador real.

   Fase 6: para probar persistencia real (Memoria Tecnica + decisiones de
   Challenge) con RECARGA de pagina, este arnes ahora inicia sesion de
   verdad contra el EMULADOR de Firebase Auth (nunca produccion) -- reusa
   `auth` de src/firebase.js, que YA tiene el flag VITE_USE_FIREBASE_EMULATOR
   (ver ese archivo, capacidad preexistente, no se agrego nada nuevo ahi).
   Requiere correr con VITE_USE_FIREBASE_EMULATOR=true y los emuladores de
   Firestore+Auth activos (ver dev-qa/qa-decisions-server.mjs). El correo
   usado ya esta en la lista ADMIN_EMAILS de respaldo
   (server/api-lib/_authGuard.mjs) -- en el EMULADOR (aislado de produccion)
   esto da rol de administrador real para poder probar Aprobar/Rechazar. */
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import '../src/style.css';
import { auth } from '../src/firebase.js';
import { ProfessionalApuEditor } from '../src/features/apu/ProfessionalApuEditor.jsx';
import { makeAPUFromConcept } from '../src/domain/apuGeneration.js';
import { migrateLegacyApuToV2 } from '../src/domain/apuSchema.js';
import { finalizeProfessionalAPU } from '../src/domain/apuProfessional.js';

const QA_EMAIL = 'dianalopez161184@gmail.com'; // correo de respaldo admin ya existente en _authGuard.mjs -- solo tiene efecto en el EMULADOR aislado
const QA_PASSWORD = 'QaFase6Emulator!';

function buildQaApu(){
  const raw = migrateLegacyApuToV2(makeAPUFromConcept("Colado de concreto premezclado f'c=250 para losa", []));
  raw.cantidadObra = 80;
  raw.id = 'QA-DEMO-001'; // estable entre recargas -- asi la prueba de persistencia (Fase 6, punto 16) es real
  raw.proyecto = 'Proyecto QA Fase 6';
  if(raw.labor?.[0]) raw.labor[0].rendimiento = Number(raw.labor[0].rendimiento) * 1.4; // desviacion real a proposito
  return finalizeProfessionalAPU(raw);
}

function QaHarness(){
  const [apu, setApu] = useState(buildQaApu);
  const [authState, setAuthState] = useState({ status: 'signing-in', user: null, error: null });

  useEffect(() => {
    (async () => {
      try{
        let cred;
        try{ cred = await signInWithEmailAndPassword(auth, QA_EMAIL, QA_PASSWORD); }
        catch{ cred = await createUserWithEmailAndPassword(auth, QA_EMAIL, QA_PASSWORD); }
        setAuthState({ status: 'ready', user: { uid: cred.user.uid, email: cred.user.email, isAdmin: true }, error: null });
      }catch(err){
        setAuthState({ status: 'error', user: null, error: err.message });
      }
    })();
  }, []);

  return <div style={{ maxWidth: 1200, margin: '0 auto', padding: 16 }}>
    <div style={{ background: '#2A1740', color: '#fff', padding: '8px 14px', borderRadius: 8, marginBottom: 16, fontSize: '.82rem' }}>
      ARNES DE QA -- Fase 6 -- no es producto, no forma parte del build de producción. Sesión: {authState.status === 'ready' ? `${authState.user.email} (emulador Auth, rol admin)` : authState.status === 'error' ? `ERROR: ${authState.error} (¿emuladores corriendo? ¿VITE_USE_FIREBASE_EMULATOR=true?)` : 'iniciando sesión contra el emulador…'}
    </div>
    {authState.status === 'ready' && <ProfessionalApuEditor
      apu={apu}
      onChange={setApu}
      onSave={() => {}}
      onExcel={() => alert('QA: export deshabilitado en el arnes')}
      onPdf={() => alert('QA: export deshabilitado en el arnes')}
      onFindPrices={async () => []}
      user={authState.user}
    />}
  </div>;
}

createRoot(document.getElementById('root')).render(<QaHarness />);
