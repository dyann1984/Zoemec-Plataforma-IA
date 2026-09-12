/* ARNES DE QA (Incidente 2 -- camara/evidencias) -- NO es parte del producto
   ni del build de produccion. Unico proposito: probar el wizard REAL
   (PhoneScanSurveyForm) contra el EMULADOR de Firebase (Auth+Storage, nunca
   produccion) sin necesitar una camara fisica -- la camara en si (getUserMedia)
   solo puede probarse con hardware real/un navegador real, ver informe. Esto
   SI prueba de extremo a extremo, con el codigo real de produccion: las 3
   acciones (Usar camara/Subir fotos/Subir video), el input de fotos con
   seleccion multiple, la subida real con progreso contra Storage, el estado
   "error"+"reintentar", y que nada quede en spinner infinito.

   Los botones "QA: generar foto de prueba" / "QA: generar video de prueba"
   de aqui abajo generan un archivo EN EL NAVEGADOR (canvas.toBlob para la
   foto, un Blob binario con type video/webm para el video) y lo inyectan en
   el <input type=file> REAL del componente via DataTransfer + evento
   'change' -- exactamente la misma ruta de codigo que si el usuario hubiera
   elegido un archivo real del dispositivo, sin necesitar un dialogo de
   archivos (que la automatizacion de navegador no puede operar). */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import '../src/style.css';
import { auth } from '../src/firebase.js';
import { PhoneScanSurveyForm } from '../src/features/levantamiento/PhoneScanSurveyForm.jsx';
import { I18nProvider } from '../src/i18n/I18nContext.jsx';

const QA_EMAIL = 'qa.incidente2@zoemec.test';
const QA_PASSWORD = 'QaIncidente2Emulator!';

function injectFileIntoInput(selector, file){
  const input = document.querySelector(selector);
  if(!input){ alert('QA: no se encontro el input ' + selector); return; }
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function makeFakePhotoFile(){
  return new Promise(resolve => {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2A1740'; ctx.fillRect(0, 0, 640, 480);
    ctx.fillStyle = '#fff'; ctx.font = '28px sans-serif'; ctx.fillText('QA foto de prueba', 40, 240);
    canvas.toBlob(blob => resolve(new File([blob], 'qa-foto.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.9);
  });
}

function makeFakeVideoFile(){
  // Contenido binario arbitrario (no es un video reproducible real) -- solo
  // para probar la tuberia de subida/progreso/Storage, no la reproduccion.
  const bytes = new Uint8Array(500 * 1024).fill(7);
  return new File([bytes], 'qa-video.webm', { type: 'video/webm' });
}

function QaHarness(){
  const [authState, setAuthState] = useState('signing-in');
  // P0 (persistencia de galeria multimedia): "mounted" simula cambiar de
  // pestana/modulo -- desmonta PhoneScanSurveyForm por completo y lo vuelve
  // a montar. Si la foto ya subida reaparece SOLA (sin volver a subirla),
  // evidenceItems + la reconstruccion de galeria funcionan de verdad.
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

  return <div style={{ maxWidth: 900, margin: '0 auto', padding: 16, fontFamily: 'sans-serif' }}>
    <div style={{ background: '#2A1740', color: '#fff', padding: '8px 14px', borderRadius: 8, marginBottom: 16, fontSize: '.82rem' }}>
      ARNES DE QA -- Incidente 2 -- no es producto. Sesion: {authState} (emulador Auth).
    </div>
    {authState === 'ready' && <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
      <button onClick={async () => injectFileIntoInput('input[type=file][accept*="image/jpeg"]', await makeFakePhotoFile())}>
        QA: generar foto de prueba y subirla
      </button>
      <button onClick={() => injectFileIntoInput('input[type=file][accept="video/*"]', makeFakeVideoFile())}>
        QA: generar video de prueba y subirlo
      </button>
      <button onClick={() => setMounted(m => !m)}>
        {mounted ? 'P0: Simular cambio de pestaña (desmontar wizard)' : 'P0: Volver (remontar wizard)'}
      </button>
    </div>}
    {authState === 'ready' && mounted && <PhoneScanSurveyForm projectId="QA-PROJECT" organizationId={null} onCancel={() => {}} onSave={(survey) => console.log('QA onSave', survey)} />}
    {authState === 'ready' && !mounted && <p className="muted">(wizard desmontado -- como si hubieras cambiado de módulo)</p>}
  </div>;
}

createRoot(document.getElementById('root')).render(<I18nProvider><QaHarness /></I18nProvider>);
