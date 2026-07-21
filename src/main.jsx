import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import jsPDF from 'jspdf';
import writeXlsxFile from 'write-excel-file/browser';
import { createUserWithEmailAndPassword, GoogleAuthProvider, onAuthStateChanged, sendEmailVerification, signInWithEmailAndPassword, signInWithPopup, signOut, updateProfile } from 'firebase/auth';
import { addDoc, collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, db, firebaseReady, storage } from './firebase.js';
import { useCloudState } from './cloud.js';
import { consumeOneDriveRedirect, isOneDriveConfigured, startOneDriveConnect } from './lib/onedrive.js';
import './style.css';

const money = (n) => Number(n || 0).toLocaleString('es-MX', { style:'currency', currency:'MXN' });
const num = (n) => Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits:2, maximumFractionDigits:2 });
const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();
async function authHeaders(){
  const headers = {'Content-Type':'application/json'};
  const token = await auth?.currentUser?.getIdToken?.();
  if(token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
async function apiPost(path, body){
  const res = await fetch(path, {
    method:'POST',
    headers:await authHeaders(),
    body:JSON.stringify(body || {})
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'No se pudo completar la solicitud.');
  return data;
}
/* No lanza: se usa para indicadores de estado donde un endpoint no disponible
   (ej. servidor local de desarrollo, que no espeja /api/status) debe leerse
   como "no disponible" en vez de romper la interfaz. */
async function apiGetSafe(path){
  try{
    const res = await fetch(path, { headers:await authHeaders() });
    if(!res.ok) return null;
    return await res.json();
  }catch{
    return null;
  }
}

/* Set de íconos de línea (engineering/drafting) — reemplaza emojis */
const ICONS = {
  inicio:<><path d="M3 11l9-7 9 7"/><path d="M5 10v10a1 1 0 001 1h3v-6h4v6h3a1 1 0 001-1V10"/></>,
  apu:<><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1.5v2.5M15 1.5v2.5M9 20v2.5M15 20v2.5M1.5 9H4M1.5 15H4M20 9h2.5M20 15h2.5"/></>,
  presupuestos:<><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h8M8 9h2"/></>,
  proyectos:<><path d="M3 21h18"/><path d="M5 21V5a1 1 0 011-1h6a1 1 0 011 1v16"/><path d="M13 21V9h5a1 1 0 011 1v11"/><path d="M8 7h2M8 11h2M8 15h2"/></>,
  clientes:<><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></>,
  biblioteca:<><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></>,
  tecnico:<><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8"/><path d="M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/></>,
  oficina:<><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></>,
  comunidad:<><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/><path d="M8 9h8M8 13h5"/></>,
  academia:<><path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.3 2.7 3 6 3s6-1.7 6-3v-5"/></>,
  reportes:<><path d="M3 3v18h18"/><path d="M7 16v-5M12 16V8M17 16v-9"/></>,
  cuantificaciones:<><path d="M16 3l5 5L8 21l-5-5z"/><path d="M14 5l2 2M11 8l2 2M8 11l2 2"/></>,
  concreto:<><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.3 7L12 12l8.7-5M12 22V12"/></>,
  acero:<><path d="M5 4v16M12 4v16M19 4v16"/><path d="M3 8h18M3 16h18"/></>,
  pintura:<><path d="M9 11.9l8.1-8.1a2.85 2.85 0 114 4l-8.1 8.1z"/><path d="M7 14.9c-1.7 0-3 1.4-3 3 0 1.3-2.5 1.5-2 2 1.1 1.1 2.5 2 4 2 2.2 0 4-1.8 4-4a3 3 0 00-3-3z"/></>,
  impermeabilizante:<><path d="M12 2.7l5.7 5.7a8 8 0 11-11.3 0z"/></>,
  excavacion:<><path d="M12 2L2 7l10 5 10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></>,
  block:<><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9.3h18M3 14.6h18M9 4v5.3M15 9.3v5.3M11 14.6V20"/></>,
  fsr:<><path d="M19 5L5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></>,
  folder:<><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></>,
  doc:<><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></>,
  bell:<><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></>,
  play:<><path d="M6 4l14 8-14 8z"/></>,
  mic:<><path d="M12 2a3 3 0 00-3 3v6a3 3 0 006 0V5a3 3 0 00-3-3z"/><path d="M5 10v1a7 7 0 0014 0v-1M12 18v3M9 21h6"/></>,
  micStop:<><rect x="7" y="7" width="10" height="10" rx="2"/></>,
  speakerOn:<><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 8.5a4 4 0 010 7M19 6a7.5 7.5 0 010 12"/></>,
  speakerOff:<><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9l5 6M21 9l-5 6"/></>,
  history:<><path d="M3 12a9 9 0 109-9 9 9 0 00-8 5"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></>,
  admin:<><path d="M12 2l8 3.5v6c0 5-3.4 8.7-8 10.5-4.6-1.8-8-5.5-8-10.5v-6z"/><path d="M9 12l2 2 4-4"/></>,
  search:<><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></>,
  link:<><path d="M9 15l6-6"/><path d="M11 6l1-1a4 4 0 015.7 5.7l-1 1"/><path d="M13 18l-1 1a4 4 0 01-5.7-5.7l1-1"/></>
};
function Icon({name,size=20}){return <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]||ICONS.doc}</svg>;}

const defaultCompany = {
  name: 'ZOEMEC', rfc: 'RFC pendiente', phone: '55 0000 0000', email: 'contacto@zoemec.mx', address: 'México', logo: '/images/logo-web.png?v=zoemec-2026'
};
// Nombres de registros sembrados en versiones anteriores del proyecto (antes de que
// existiera cuenta real por usuario). Se usan solo para depurarlos de datos reales
// preexistentes en el primer render; no se usan para mostrar contenido en la interfaz.
const legacySeedClientNames = ['Municipio de Tlalmanalco','Grupo Residencial Volcanes','Cliente particular','Constructora del Centro','Desarrollos Industriales del Valle'];
const legacySeedProjectNames = ['Local comercial','Rehabilitación de plaza','Casa habitación 180 m²'];
const libraryFolders = [
  ['Bases OPUS', 'Importación y catálogos de precios unitarios', '124 archivos'],
  ['Bases NEODATA', 'Catálogos, presupuestos y formatos compatibles', '86 archivos'],
  ['Excel de precios', 'CMIC, BIMSA, ECOSTOS y bases propias', '300+ archivos'],
  ['Formatos Word / Excel', 'APU, generadores, estimaciones y bitácoras', '78 plantillas'],
  ['Normas y manuales', 'NTC, SCT, CFE, CONAGUA y reglamentos', '42 documentos'],
  ['Cursos y videos', 'Capacitación para costos, obra e ingeniería', '24 cursos']
];
const courses = [
  ['Precios Unitarios desde cero', 'APU, indirectos, utilidad, FSR y formatos', 68],
  ['Presupuestos profesionales', 'Catálogo, partidas, explosión de insumos y reportes', 42],
  ['OPUS / NEODATA para obra', 'Importación, revisión y exportación de catálogos', 25],
  ['IA aplicada a construcción', 'Cómo generar APUs, memorias y reportes con IA', 10]
];

function useLocalState(key, fallback){
  const [value, setValue] = useState(() => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  });
  // setValue(prev=>...) en vez de cerrar sobre `value`: dos llamadas funcionales
  // seguidas dentro del mismo handler (ej. agregar el turno del usuario y luego
  // el de la respuesta) deben encadenarse sobre el estado mas reciente, no sobre
  // el que existia cuando este closure se creo.
  const save = (next) => setValue(prev => {
    const v = typeof next === 'function' ? next(prev) : next;
    localStorage.setItem(key, JSON.stringify(v));
    return v;
  });
  return [value, save];
}
function getDeviceId(){
  let id = localStorage.getItem('zoemec-device-id');
  if(!id){
    id = 'DEV-' + uid() + '-' + Date.now().toString(36).toUpperCase();
    localStorage.setItem('zoemec-device-id', id);
  }
  return id;
}
function readLocal(key, fallback){
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeLocal(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}
function hasValidSession(user){
  return Boolean(user?.email && user?.plan && (user?.deviceId || user?.uid));
}
const PLAN_LIMITS = {
  Gratis:{ apus:1, library:false, ai:false, exports:false, label:'Gratis - 1 APU' },
  Inicial:{ apus:10, library:'limitada', ai:false, exports:true, label:'Inicial' },
  Profesional:{ apus:999, library:true, ai:true, exports:true, label:'Profesional' },
  Empresa:{ apus:9999, library:true, ai:true, exports:true, label:'Empresa' }
};
function canUse(user, feature, used=0){
  if(user?.role === 'admin') return true;
  const plan = PLAN_LIMITS[user?.plan || 'Gratis'] || PLAN_LIMITS.Gratis;
  if(feature === 'apu') return used < plan.apus;
  return Boolean(plan[feature]);
}
function userInitials(name='', email=''){
  const base = (name || email?.split('@')?.[0] || 'Usuario ZOEMEC').trim();
  return base.split(' ').map(x=>x[0]).filter(Boolean).slice(0,2).join('').toUpperCase() || 'UZ';
}
function firebaseMessage(error){
  const code = error?.code || '';
  if(code.includes('email-already-in-use')) return 'Ese correo ya esta registrado. Inicia sesion.';
  if(code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Correo o contrasena incorrectos.';
  if(code.includes('weak-password')) return 'La contrasena debe tener minimo 6 caracteres.';
  if(code.includes('network')) return 'No hay conexion con Firebase. Revisa internet y vuelve a intentar.';
  if(code.includes('permission-denied')) return 'No se pudo completar la operacion por permisos de Firestore. Intenta de nuevo o contacta al administrador.';
  return error?.message || 'No se pudo conectar con Firebase.';
}
/* Los endpoints /api/* devuelven a veces el detalle tecnico exacto (nombre de la
   variable de entorno faltante) para facilitar el diagnostico en Vercel. Esa cadena
   nunca debe llegar al usuario final: se sustituye por un mensaje comercial. */
function friendlyServiceError(err, fallback='Servicio temporalmente no disponible. Intenta de nuevo en unos minutos.'){
  const msg = String(err?.message || '').trim();
  if(!msg) return fallback;
  if(/API_KEY|ACCESS_TOKEN|SERVICE_ACCOUNT|PRIVATE_KEY|CLIENT_EMAIL|process\.env|\bVercel\b|\.env\b/i.test(msg)){
    return 'Servicio temporalmente no configurado. Intenta mas tarde o contacta a soporte.';
  }
  return msg;
}
async function loadOrCreateProfile(fbUser, fallbackName='Usuario ZOEMEC'){
  const userRef = doc(db, 'users', fbUser.uid);
  const snap = await getDoc(userRef);
  if(snap.exists()) return { uid: fbUser.uid, ...snap.data() };
  const profile = {
    uid: fbUser.uid,
    name: fbUser.displayName || fallbackName || fbUser.email?.split('@')[0] || 'Usuario ZOEMEC',
    email: fbUser.email,
    role: 'user',
    plan: 'Gratis',
    active: true,
    apusCreated: 0,
    deviceId: getDeviceId(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await setDoc(userRef, profile, { merge:true });
  return profile;
}
function buildSession(profile, fbUser){
  const name = profile?.name || fbUser?.displayName || fbUser?.email?.split('@')?.[0] || 'Usuario ZOEMEC';
  const role = profile?.role || 'user';
  return {
    uid: profile?.uid || fbUser?.uid,
    name,
    email: profile?.email || fbUser?.email,
    role,
    plan: role === 'admin' ? (profile?.plan || 'Empresa') : (profile?.plan || 'Gratis'),
    active: profile?.active !== false,
    initials: userInitials(name, profile?.email || fbUser?.email),
    deviceId: profile?.deviceId || getDeviceId(),
    apusCreated: Number(profile?.apusCreated || 0)
  };
}

/* Conexion real con OneDrive (OAuth2 + PKCE contra Microsoft Identity Platform,
   ver src/lib/onedrive.js). Sin VITE_ONEDRIVE_CLIENT_ID configurado, el intento
   falla con un mensaje honesto en vez de simular una conexion exitosa. */
async function connectOneDrive(){
  try{
    await startOneDriveConnect();
  }catch(err){
    window.zoemecNotify?.(err.message || 'No se pudo iniciar la conexion con OneDrive.', 'error');
  }
}

function CloudBadge({user}){
  const [st,setSt]=useState({status:'ok',message:''});
  const [online,setOnline]=useState(typeof navigator!=='undefined' ? navigator.onLine : true);
  const [open,setOpen]=useState(false);
  const [remote,setRemote]=useState(null);
  const [libInfo,setLibInfo]=useState(null);
  const [oneDrive,setOneDrive]=useState(null);
  const boxRef=useRef(null);
  useEffect(()=>{
    const onCloud=e=>setSt(e.detail||{status:'ok'});
    const up=()=>setOnline(true), down=()=>setOnline(false);
    window.addEventListener('zoemec-cloud',onCloud);
    window.addEventListener('online',up); window.addEventListener('offline',down);
    return ()=>{window.removeEventListener('zoemec-cloud',onCloud);window.removeEventListener('online',up);window.removeEventListener('offline',down);};
  },[]);
  useEffect(()=>{
    if(!open) return;
    let alive=true;
    apiGetSafe('/api/status').then(data=>{ if(alive) setRemote(data); });
    if(firebaseReady && user?.uid){
      getCountFromServer(query(collection(db,'library'), where('ownerUid','==',user.uid)))
        .then(snap=>{ if(alive) setLibInfo({count:snap.data().count, checkedAt:new Date().toLocaleTimeString('es-MX')}); })
        .catch(()=>{ if(alive) setLibInfo(null); });
    }
    apiPost('/api/onedrive', { action:'status' }).then(data=>{ if(alive) setOneDrive(data); }).catch(()=>{ if(alive) setOneDrive(null); });
    return ()=>{ alive=false; };
  },[open, user?.uid]);
  const disconnectOneDrive=async()=>{
    try{
      await apiPost('/api/onedrive', { action:'disconnect' });
      setOneDrive(d=>({...d, connected:false, account:''}));
      window.zoemecNotify?.('OneDrive desconectado.', 'info');
    }catch(err){
      window.zoemecNotify?.(err.message || 'No se pudo desconectar OneDrive.', 'error');
    }
  };
  useEffect(()=>{
    if(!open) return;
    const onDown=(e)=>{ if(boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return ()=>document.removeEventListener('mousedown', onDown);
  },[open]);
  const mode = !online ? 'off' : st.status;
  const label = mode==='off' ? 'Sin conexión · guardado local'
    : mode==='saving' ? 'Guardando en la nube...'
    : mode==='error' ? 'Nube con error · datos seguros en local'
    : 'Nube sincronizada';
  const rows = [
    { key:'firebase', label:'Firebase / Firestore', ok: online && st.status!=='error',
      detail: !online ? 'Sin conexión a internet.' : st.status==='error' ? (st.message || 'No se pudo sincronizar.') : 'Conectado y sincronizando.' },
    { key:'library', label:'Biblioteca', ok: Boolean(libInfo),
      detail: !user?.uid ? 'Inicia sesión para ver tu biblioteca.' : libInfo ? `${libInfo.count} documento(s) · verificado a las ${libInfo.checkedAt}` : 'Consultando Firestore...' },
    { key:'openai', label:'OpenAI', ok: remote?.openai==='ok',
      detail: remote ? (remote.openai==='ok' ? 'Configurada y responde.' : 'No disponible en este entorno.') : 'No disponible aquí (revisa conexión).' },
    { key:'onedrive', label:'OneDrive', ok: Boolean(oneDrive?.connected),
      detail: oneDrive?.connected ? `Conectado${oneDrive.account ? ' · ' + oneDrive.account : ''}.`
        : oneDrive && !oneDrive.configured ? 'No conectado (requiere configurar la app de Azure AD).'
        : 'No conectado.' }
  ];
  return <div className="cloud-panel" ref={boxRef}>
    <button type="button" className={'cloud-badge '+mode} title={st.message||label} onClick={()=>setOpen(v=>!v)}><i/><em>{label}</em></button>
    {open && <div className="cloud-drop">
      <b>Estado de la plataforma</b>
      {rows.map(r=><div className={'cloud-row'+(r.ok?' ok':' warn')} key={r.key}>
        <i/>
        <div><b>{r.label}</b><span>{r.detail}</span></div>
        {r.key==='onedrive' && (oneDrive?.connected
          ? <button className="soft" onClick={disconnectOneDrive}>Desconectar</button>
          : <button className="soft" onClick={connectOneDrive}>Conectar</button>)}
      </div>)}
    </div>}
  </div>;
}

function NotificationBell(){
  const [items,setItems]=useLocalState('zoemec-notif-history', []);
  const [open,setOpen]=useState(false);
  const boxRef=useRef(null);
  useEffect(()=>{
    const onLog=(e)=>{
      const text = String(e.detail?.message || '').trim();
      if(!text) return;
      setItems(list=>[{id:Date.now()+Math.random(), text, type:e.detail?.type||'info', at:new Date().toLocaleString('es-MX')}, ...list].slice(0,30));
    };
    window.addEventListener('zoemec-notify-log', onLog);
    return ()=>window.removeEventListener('zoemec-notify-log', onLog);
  },[setItems]);
  useEffect(()=>{
    if(!open) return;
    const onDown=(e)=>{ if(boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return ()=>document.removeEventListener('mousedown', onDown);
  },[open]);
  return <div className="notif-panel" ref={boxRef}>
    <button type="button" className="bell" onClick={()=>setOpen(v=>!v)} aria-label="Notificaciones">
      <Icon name="bell" size={19}/>{items.length>0 && <span className="notif-dot"/>}
    </button>
    {open && <div className="notif-drop">
      <div className="notif-drop-head"><b>Notificaciones</b>{items.length>0 && <button className="soft" onClick={()=>setItems([])}>Limpiar</button>}</div>
      {items.length ? items.slice(0,12).map(n=><div className="notif-item" key={n.id}><span className={'notif-mark '+n.type}/><div><p>{n.text}</p><small>{n.at}</small></div></div>) : <p className="notif-empty">Aún no hay notificaciones.</p>}
    </div>}
  </div>;
}

function NoticeHost(){
  const [notices,setNotices]=useState([]);
  useEffect(()=>{
    const nativeAlert = window.alert?.bind(window);
    const push = (message, type='info') => {
      const id = Date.now() + Math.random();
      const text = String(message || 'Accion completada.');
      setNotices(current => [{id,text,type}, ...current].slice(0,3));
      window.setTimeout(() => setNotices(current => current.filter(n => n.id !== id)), 5600);
      // Registro para el panel de notificaciones de la topbar (NotificationBell):
      // evento distinto de 'zoemec-notice' para no volver a disparar push() en bucle.
      window.dispatchEvent(new CustomEvent('zoemec-notify-log', { detail:{ message:text, type } }));
    };
    const onNotice = (event) => push(event.detail?.message, event.detail?.type || 'info');
    window.addEventListener('zoemec-notice', onNotice);
    window.alert = (message) => push(message);
    window.zoemecNotify = push;
    return () => {
      window.removeEventListener('zoemec-notice', onNotice);
      if(nativeAlert) window.alert = nativeAlert;
      delete window.zoemecNotify;
    };
  }, []);
  if(!notices.length) return null;
  return <div className="notice-stack" aria-live="polite">
    {notices.map(n=><div className={`notice-card ${n.type}`} key={n.id}>
      <div className="notice-mark"></div>
      <div><b>ZOEMEC</b><p>{n.text}</p></div>
      <button type="button" onClick={()=>setNotices(current=>current.filter(x=>x.id!==n.id))}>Cerrar</button>
    </div>)}
  </div>;
}

function App(){
  const [screen, setScreen] = useState('landing');
  const [module, setModule] = useState('inicio');
  const [user, setUser] = useState(null);
  const [accounts, setAccounts] = useLocalState('zoemec-accounts', []);
  const [usage, setUsage] = useLocalState('zoemec-usage', {});
  const [company, setCompany] = useCloudState(user, 'zoemec-company', defaultCompany);
  const [apus, setApus] = useCloudState(user, 'zoemec-apus', []);
  const [clients, setClients] = useCloudState(user, 'zoemec-clients', []);
  const [budgets, setBudgets] = useCloudState(user, 'zoemec-budgets', []);
  const [projects, setProjects] = useCloudState(user, 'zoemec-projects', []);
  const [catalog, setCatalog] = useCloudState(user, 'zoemec-catalogo', []);
  const [budgetItems, setBudgetItems] = useCloudState(user, 'zoemec-budget-items', [{concept:'Muro de block 15 cm',unit:'m²',qty:120,pu:825.39},{concept:'Piso cerámico 30x30 cm',unit:'m²',qty:86,pu:384.51}]);
  useEffect(() => {
    const onAdd = (e) => { if(e?.detail) setBudgetItems(list => [...list, e.detail]); };
    window.addEventListener('zoemec-budget-add', onAdd);
    return () => window.removeEventListener('zoemec-budget-add', onAdd);
  }, [setBudgetItems]);
  const companyView = (!company?.logo || company.logo === '/logo.png' || company.logo === '/images/logo-web.png') ? {...company, logo:'/images/logo-web.png?v=zoemec-2026'} : company;

  // Microsoft redirige de vuelta a la app con ?code=...&state=... tras un login
  // real (ver src/lib/onedrive.js). Se captura una sola vez al montar (antes de
  // que otra pantalla borre esos parametros de la URL) y se procesa en cuanto
  // haya sesion, ya que intercambiar el code por tokens requiere el ID token
  // del usuario autenticado.
  const [pendingOneDrive] = useState(() => consumeOneDriveRedirect());
  useEffect(() => {
    if(!pendingOneDrive) return;
    if(pendingOneDrive.error){
      alert(`No se pudo conectar OneDrive: ${pendingOneDrive.error}`);
      return;
    }
    if(!user?.uid) return;
    (async () => {
      try{
        const data = await apiPost('/api/onedrive', { action:'token', ...pendingOneDrive });
        alert(`OneDrive conectado${data.account ? ' (' + data.account + ')' : ''}.`);
      }catch(err){
        alert(`No se pudo completar la conexion con OneDrive: ${friendlyServiceError(err)}`);
      }
    })();
  }, [user?.uid, pendingOneDrive]);

  // Copia el nombre de la empresa en users/{uid} (denormalizado) para que el Panel
  // Admin pueda listar organizaciones sin necesitar acceso al blob comprimido de
  // estado por usuario (users/{uid}/state/*), que las reglas de Firestore no le
  // otorgan al rol admin. Debounced para no escribir en cada tecleo.
  useEffect(() => {
    if(!firebaseReady || !user?.uid || !company?.name) return;
    const t = window.setTimeout(() => {
      setDoc(doc(db, 'users', user.uid), { companyName: company.name }, { merge:true }).catch(()=>{});
    }, 1200);
    return () => window.clearTimeout(t);
  }, [user?.uid, company?.name]);

  useEffect(() => {
    localStorage.removeItem('zoemec-user');
    const legacyClients = new Set(legacySeedClientNames);
    const legacyProjects = new Set(legacySeedProjectNames);
    const legacyCourses = new Set(courses.map(c => c[0]));
    const legacyForumThreads = new Set(['Que rendimiento usan para muro de block 15 cm?','Proveedor de acero en zona centro','Formato de generadores para obra publica','Comparativo OPUS vs NEODATA']);
    if(clients.some(c => legacyClients.has(c.name))) setClients(clients.filter(c => !legacyClients.has(c.name)));
    if(projects.some(p => legacyProjects.has(p.name))) setProjects(projects.filter(p => !legacyProjects.has(p.name)));
    const savedCourses = readLocal('zoemec-cursos', []);
    if(Array.isArray(savedCourses) && savedCourses.some(c => legacyCourses.has(c.t))) localStorage.setItem('zoemec-cursos', JSON.stringify(savedCourses.filter(c => !legacyCourses.has(c.t))));
    const savedForum = readLocal('zoemec-foro', []);
    if(Array.isArray(savedForum) && savedForum.some(p => legacyForumThreads.has(p.q))) localStorage.setItem('zoemec-foro', JSON.stringify(savedForum.filter(p => !legacyForumThreads.has(p.q))));
  }, []);

  useEffect(() => {
    if(!firebaseReady) return undefined;
    return onAuthStateChanged(auth, async (fbUser) => {
      if(!fbUser){
        setUser(null);
        setScreen(current => current === 'app' ? 'landing' : current);
        return;
      }
      try{
        const profile = await loadOrCreateProfile(fbUser);
        if(!fbUser.emailVerified && profile.role !== 'admin'){
          setUser(null);
          return;
        }
        if(profile.active === false){
          await signOut(auth);
          setUser(null);
          setScreen('landing');
          alert('Tu cuenta esta desactivada. Contacta al administrador de ZOEMEC.');
          return;
        }
        const session = buildSession(profile, fbUser);
        setUser(session);
        setUsage(prev => ({...prev, [session.email]:{apusCreated:session.apusCreated || 0, deviceId:session.deviceId}}));
      }catch(error){
        console.error(error);
      }
    });
  }, []);

  const login = async (name='Usuario ZOEMEC', email='', password='', mode='login') => {
    const cleanEmail = email.trim().toLowerCase();
    if(!cleanEmail || !password || password.length < 6){
      alert('Captura un correo valido y una contrasena de minimo 6 caracteres.');
      return false;
    }
    if(!firebaseReady){
      alert('Firebase no esta configurado. Revisa src/firebase.js.');
      return false;
    }
    const deviceId = getDeviceId();
    try{
      if(mode === 'register'){
        // El chequeo de dispositivo (Firestore) necesita al usuario ya autenticado:
        // las reglas de seguridad exigen signedIn() para leer/crear en /devices/{id}.
        // Por eso primero se crea la cuenta y, si el dispositivo ya se uso, se borra
        // esa cuenta recien creada en vez de dejarla huerfana.
        const deviceRef = doc(db, 'devices', deviceId);
        const displayName = (name || cleanEmail.split('@')[0] || 'Usuario ZOEMEC').trim();
        const credential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        const deviceSnap = await getDoc(deviceRef);
        if(deviceSnap.exists()){
          await credential.user.delete().catch(()=>signOut(auth));
          alert('Este dispositivo ya uso la prueba gratis. Para evitar cuentas duplicadas, inicia sesion con tu cuenta o solicita un plan.');
          return false;
        }
        await updateProfile(credential.user, { displayName });
        const profile = {
          uid: credential.user.uid,
          name: displayName,
          email: cleanEmail,
          role: 'user',
          plan: 'Gratis',
          active: true,
          apusCreated: 0,
          deviceId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };
        await setDoc(doc(db, 'users', credential.user.uid), profile, { merge:true });
        await setDoc(deviceRef, { uid: credential.user.uid, email: cleanEmail, createdAt: serverTimestamp() }, { merge:true });
        setUsage({...usage, [cleanEmail]:{apusCreated:0, deviceId}});
        await sendEmailVerification(credential.user);
        await signOut(auth);
        setUser(null);
        setScreen('login');
        alert('Cuenta creada. Te enviamos un correo de verificacion. Confirma tu email y luego inicia sesion.');
        return true;
      }
      const credential = await signInWithEmailAndPassword(auth, cleanEmail, password);
      const profile = await loadOrCreateProfile(credential.user);
      if(!credential.user.emailVerified && profile.role !== 'admin'){
        await sendEmailVerification(credential.user).catch(()=>{});
        await signOut(auth);
        alert('Tu correo aun no esta verificado. Te enviamos otro correo de verificacion.');
        return false;
      }
      if(profile.active === false){
        await signOut(auth);
        alert('Tu cuenta esta desactivada. Contacta al administrador de ZOEMEC.');
        return false;
      }
      const session = buildSession(profile, credential.user);
      setUsage({...usage, [cleanEmail]:{apusCreated:session.apusCreated || 0, deviceId:session.deviceId}});
      setUser(session);
      setScreen('app');
      setModule('inicio');
      return true;
    }catch(error){
      alert(firebaseMessage(error));
      return false;
    }
  };
  const loginWithGoogle = async () => {
    if(!firebaseReady){
      alert('Firebase no esta configurado. Revisa src/firebase.js.');
      return false;
    }
    const provider = new GoogleAuthProvider();
    const deviceId = getDeviceId();
    try{
      const credential = await signInWithPopup(auth, provider);
      const fbUser = credential.user;
      const userRef = doc(db, 'users', fbUser.uid);
      const snap = await getDoc(userRef);
      let profile;
      if(snap.exists()){
        profile = { uid: fbUser.uid, ...snap.data() };
      }else{
        const deviceRef = doc(db, 'devices', deviceId);
        const deviceSnap = await getDoc(deviceRef);
        if(deviceSnap.exists()){
          await signOut(auth);
          alert('Este dispositivo ya uso la prueba gratis. Inicia sesion con tu cuenta original o solicita un plan ZOEMEC.');
          return false;
        }
        profile = {
          uid: fbUser.uid,
          name: fbUser.displayName || fbUser.email?.split('@')[0] || 'Usuario ZOEMEC',
          email: fbUser.email,
          role: 'user',
          plan: 'Gratis',
          active: true,
          apusCreated: 0,
          deviceId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };
        await setDoc(userRef, profile, { merge:true });
        await setDoc(deviceRef, { uid: fbUser.uid, email: fbUser.email, createdAt: serverTimestamp() }, { merge:true });
      }
      if(profile.active === false){
        await signOut(auth);
        alert('Tu cuenta esta desactivada. Contacta al administrador de ZOEMEC.');
        return false;
      }
      const session = buildSession(profile, fbUser);
      setUsage(prev => ({...prev, [session.email]:{apusCreated:session.apusCreated || 0, deviceId:session.deviceId}}));
      setUser(session);
      setScreen('app');
      setModule('inicio');
      return true;
    }catch(error){
      alert(firebaseMessage(error));
      return false;
    }
  };
  const logout = async () => {
    try { if(firebaseReady) await signOut(auth); } catch {}
    localStorage.removeItem('zoemec-user');
    setUser(null);
    setScreen('landing');
  };

  let content;
  if(screen === 'landing') content = <Landing setScreen={setScreen} login={login} company={companyView} />;
  else if(screen === 'login') content = <Auth mode="login" setScreen={setScreen} login={login} loginWithGoogle={loginWithGoogle} company={companyView} />;
  else if(screen === 'register') content = <Auth mode="register" setScreen={setScreen} login={login} loginWithGoogle={loginWithGoogle} company={companyView} />;
  else if(!hasValidSession(user)) content = <Landing setScreen={setScreen} login={login} company={companyView} />;
  else content = <Shell user={user} logout={logout} module={module} setModule={setModule} company={companyView} apus={apus} clients={clients} projects={projects}>
    {module === 'inicio' && <Dashboard setModule={setModule} apus={apus} clients={clients} budgets={budgets} projects={projects} />}
    {module === 'apu' && <APU company={companyView} user={user} usage={usage} setUsage={setUsage} apus={apus} setApus={setApus} budgets={budgets} setBudgets={setBudgets} catalog={catalog} setCatalog={setCatalog} />}
    {module === 'presupuestos' && <Budgets company={companyView} budgets={budgets} setBudgets={setBudgets} items={budgetItems} setItems={setBudgetItems} />}
    {module === 'cartera' && <ClientsProjects clients={clients} setClients={setClients} projects={projects} setProjects={setProjects} />}
    {module === 'biblioteca' && <Library user={user} />}
    {module === 'tecnico' && <TechnicalOffice company={companyView} setCompany={setCompany} catalog={catalog} setCatalog={setCatalog} />}
    {module === 'visual' && <VisualAI user={user} />}
    {module === 'comunidad' && <Community />}
    {module === 'planes' && <PlansAccess user={user} />}
    {module === 'reportes' && <Reports clients={clients} apus={apus} budgets={budgets} />}
    {module === 'admin' && user.role==='admin' && <AdminPanel user={user} />}
  </Shell>;
  return <><NoticeHost />{content}</>;
}

/* Fondo animado de construcción (line-art tipo plano) */
function Backdrop(){
  return <svg className="backdrop" viewBox="0 0 1440 760" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <g className="bd-sky" stroke="currentColor" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      {/* edificio alto */}
      <rect x="120" y="300" width="150" height="380"/>
      {[330,370,410,450,490,530,570,610].map(y=><g key={y}><line x1="140" y1={y} x2="250" y2={y}/></g>)}
      {[160,195,230].map(x=><line key={x} x1={x} y1="300" x2={x} y2="680"/>)}
      {/* edificio medio */}
      <rect x="300" y="420" width="120" height="260"/>
      {[450,490,530,570,610,650].map(y=><line key={y} x1="316" y1={y} x2="404" y2={y}/>)}
      <line x1="360" y1="420" x2="360" y2="680"/>
      {/* torre derecha */}
      <rect x="1140" y="250" width="170" height="430"/>
      {[290,335,380,425,470,515,560,605,650].map(y=><line key={y} x1="1158" y1={y} x2="1292" y2={y}/>)}
      {[1180,1225,1270].map(x=><line key={x} x1={x} y1="250" x2={x} y2="680"/>)}
      {/* casa baja */}
      <path d="M470 680V560h140v120M460 560l80-50 80 50"/>
    </g>
    {/* grúa torre */}
    <g className="bd-crane" stroke="currentColor" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1="820" y1="680" x2="820" y2="180"/>
      <line x1="806" y1="680" x2="834" y2="680"/>
      <path d="M820 200l-26 26M820 240l-26 26M820 280l-26 26M820 320l-26 26M820 360l-26 26M820 200l26 26M820 240l26 26M820 280l26 26M820 320l26 26M820 360l26 26" strokeWidth="1"/>
      {/* pluma + contrapluma */}
      <line x1="600" y1="170" x2="1060" y2="170"/>
      <line x1="820" y1="150" x2="650" y2="170"/>
      <line x1="820" y1="150" x2="1000" y2="170"/>
      <path d="M600 170l40-0M680 170v0" strokeWidth="1"/>
      <line x1="620" y1="170" x2="640" y2="185"/>
      {/* cable + gancho (se mueve) */}
      <g className="bd-hook"><line x1="980" y1="170" x2="980" y2="300"/><path d="M974 300a6 6 0 1012 0v8a8 8 0 01-16 0"/></g>
    </g>
    {/* datum punteado que fluye */}
    <line className="bd-datum" x1="0" y1="700" x2="1440" y2="700" stroke="currentColor" strokeWidth="1.4" strokeDasharray="10 10"/>
  </svg>;
}

/* Gráficas SVG ligeras (sin librerías) */
function Donut({segments,size=150,thickness=22,center,sub}){
  const total=segments.reduce((a,s)=>a+(s.value||0),0)||1;
  const r=(size-thickness)/2, c=2*Math.PI*r; let off=0;
  return <div className="donut-wrap"><svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="donut">
    <g transform={`rotate(-90 ${size/2} ${size/2})`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--line)" strokeWidth={thickness}/>
      {segments.map((s,i)=>{const len=(s.value/total)*c; const el=<circle key={i} cx={size/2} cy={size/2} r={r} fill="none" stroke={s.color} strokeWidth={thickness} strokeDasharray={`${len} ${c-len}`} strokeDashoffset={-off}/>; off+=len; return el;})}
    </g>
    {center!==undefined && <text x="50%" y="46%" textAnchor="middle" className="donut-c">{center}</text>}
    {sub && <text x="50%" y="60%" textAnchor="middle" className="donut-s">{sub}</text>}
  </svg></div>;
}
/* Gemelo Digital: visualizacion SVG que reacciona solo a datos reales de un APU
   guardado (estructura de costo real via calcAPU, familia/confianza real de la IA
   o el catalogo base). Sin BIM 3D ni metricas inventadas: si no hay APU, EmptyState. */
function twinFamilyIcon(apu){
  const t = `${apu?.family||''} ${apu?.concept||''}`.toLowerCase();
  if(/concreto|losa|zapata|firme|columna/.test(t)) return 'concreto';
  if(/acero|varilla|fierro|estructura met/.test(t)) return 'acero';
  if(/pintura|pintar|esmalte|vinil/.test(t)) return 'pintura';
  if(/imperm/.test(t)) return 'impermeabilizante';
  if(/excavaci|zanja/.test(t)) return 'excavacion';
  if(/block|tabique|muro/.test(t)) return 'block';
  return 'doc';
}
function twinOrigin(apu){
  if(apu.aiGenerated) return 'Generado por IA';
  if(apu.templateFallback) return 'Plantilla técnica (IA no disponible)';
  if(apu.templateGenerated) return 'Catálogo base ZOEMEC';
  return 'Editado manualmente';
}
function DigitalTwin({apu, compact=false, onOpen}){
  if(!apu){
    return <div className={'twin-card'+(compact?' compact':'')}>
      <EmptyState icon="apu" title="Gemelo Digital en espera" text="Genera y guarda tu primer APU para encender el modelo de costos en vivo."/>
    </div>;
  }
  const t = calcAPU(apu);
  const direct = t.direct || 0;
  const layers = [
    { key:'mat', label:'Materiales', value:t.mat, color:'#4FB8A8' },
    { key:'mo', label:'Mano de obra', value:t.mo, color:'#C9A24A' },
    { key:'equipo', label:'Equipo', value:t.equipo, color:'#9D6FD0' },
    { key:'herramienta', label:'Herramienta', value:t.herramienta, color:'#B54A62' }
  ];
  const confidence = Number(apu.confidence || 88);
  const risky = confidence < 80;
  let cursor = 0;
  return <div className={'twin-card'+(compact?' compact':'')+(risky?' risky':'')} onClick={onOpen} role={onOpen?'button':undefined}>
    <div className="twin-head">
      <span className="twin-icon"><Icon name={twinFamilyIcon(apu)} size={compact?18:24}/></span>
      <div><b>{apu.concept || apu.clave || 'Concepto sin nombre'}</b><small>{apu.family || 'Sin clasificar'}</small></div>
      <span className={'twin-confidence'+(risky?' risky':'')}>{confidence}%</span>
    </div>
    <svg className="twin-stack" viewBox="0 0 300 22" preserveAspectRatio="none" width="100%" height="22" aria-label="Estructura de costo directo">
      {direct>0 ? layers.map(l=>{ const w=(l.value/direct)*300; const el=<rect key={l.key} x={cursor} y="0" width={Math.max(0,w)} height="22" fill={l.color}/>; cursor+=w; return el; }) : <rect x="0" y="0" width="300" height="22" fill="var(--line)"/>}
    </svg>
    <div className="twin-legend">{layers.map(l=><span key={l.key}><i style={{background:l.color}}/>{l.label} <b>{direct?Math.round((l.value/direct)*100):0}%</b></span>)}</div>
    <div className="twin-foot">
      <div><small>P.U. total</small><b>{money(t.total)}</b></div>
      <div><small>Origen</small><b>{twinOrigin(apu)}</b></div>
    </div>
    {risky && <div className="twin-alert"><Icon name="bell" size={13}/> Confianza baja ({confidence}%): revisar antes de aprobar</div>}
  </div>;
}
function Spark({points,h=72,color='var(--teal)'}){
  const w=300, max=Math.max(...points), min=Math.min(...points), rng=(max-min)||1, step=w/(points.length-1);
  const pts=points.map((p,i)=>`${i*step},${h-((p-min)/rng)*(h-14)-7}`).join(' ');
  return <svg viewBox={`0 0 ${w} ${h}`} className="spark" preserveAspectRatio="none" width="100%" height={h}>
    <polygon points={`0,${h} ${pts} ${w},${h}`} fill="var(--mint)"/>
    <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
  </svg>;
}

import { matchPrice, parseExcelToCatalog, cleanText, normalizeUnitLabel, parseExcelToAPU, parseRobustConceptCatalog, parseConceptText } from './lib/excelImport.js';

async function exportRowsExcel(rows, fileName){
  const safeName = fileName.replace(/[\\/:*?"<>|]/g, '-');
  const data = rows.map(row => row.map(excelCell));
  try{
    const result = writeXlsxFile(data);
    if(result && typeof result.toFile === 'function') return await result.toFile(safeName);
    return await result;
  }catch(error){
    exportRowsCSV(rows, safeName.replace(/\.xlsx$/i, '.csv'));
  }
}
function excelCell(value){
  if(value === null) return null;
  if(value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value,'value')){
    const base = excelCell(value.value);
    return {...base, ...value, value:value.value ?? base?.value ?? '', type:value.type ?? base?.type ?? String};
  }
  if(value == null) return { value: '', type: String };
  if(typeof value === 'number' && Number.isFinite(value)) return { value, type: Number, format: '#,##0.00' };
  if(typeof value === 'boolean') return { value, type: Boolean };
  return { value: String(value), type: String };
}
const XLS = {
  title:{fontWeight:'bold', fontSize:16, color:'#ffffff', backgroundColor:'#2A1740', align:'center', alignVertical:'center'},
  subtitle:{fontWeight:'bold', color:'#6F3FA7', backgroundColor:'#F2ECF8', align:'center'},
  head:{fontWeight:'bold', color:'#ffffff', backgroundColor:'#2A1740', align:'center'},
  section:{fontWeight:'bold', color:'#2A1740', backgroundColor:'#EDE3F6'},
  total:{fontWeight:'bold', color:'#2A1740', backgroundColor:'#F6F0FB'},
  grand:{fontWeight:'bold', color:'#ffffff', backgroundColor:'#2A1740'},
  label:{fontWeight:'bold', color:'#2A1740', backgroundColor:'#F7F2FA'},
  note:{color:'#6D6078', backgroundColor:'#FBF8FD', wrap:true},
  input:{backgroundColor:'#FFFDF7', color:'#1F162A'},
  calc:{backgroundColor:'#F7F2FA', format:'$#,##0.00'},
  formula:{color:'#6D6078', backgroundColor:'#FBF8FD', wrap:true},
  money:{format:'$#,##0.00'},
  qty:{format:'#,##0.0000'},
  pct:{format:'0.00%'},
  ok:{fontWeight:'bold', color:'#166534', backgroundColor:'#ECFDF3'}
};
const xcell = (value, style={}) => ({ value, ...style });
const fcell = (formula, style={}) => ({ value:String(formula || '').replace(/^=/,''), type:'Formula', ...XLS.money, ...style });
const styleHeader = (row) => row.map(value => xcell(value, XLS.head));
const styleSection = (label) => [xcell(label, XLS.section)];
async function exportWorkbookExcel(sheets, fileName){
  const safeName = fileName.replace(/[\\/:*?"<>|]/g, '-');
  const workbook = sheets.map(sheet => ({
    sheet: sheet.sheet,
    data: sheet.rows.map(row => row.map(excelCell)),
    columns: sheet.widths?.map(width => ({ width })),
    stickyRowsCount: sheet.stickyRowsCount || 0
  }));
  try{
    const result = writeXlsxFile(workbook, { fontFamily:'Arial', fontSize:10 });
    if(result && typeof result.toFile === 'function') return await result.toFile(safeName);
    return await writeXlsxFile(workbook, { fontFamily:'Arial', fontSize:10, fileName:safeName });
  }catch(error){
    console.error('No pude generar XLSX, exporto CSV de respaldo:', error);
    const flat = sheets.flatMap(sheet => [[sheet.sheet], ...sheet.rows, []]);
    exportRowsCSV(flat, safeName.replace(/\.xlsx$/i, '.csv'));
    throw error;
  }
}
function exportRowsCSV(rows, fileName){
  const safeName = fileName.replace(/[\\/:*?"<>|]/g, '-');
  const csv = rows.map(row => row.map(value => {
    const text = String(value ?? '').replace(/"/g, '""');
    return /[",\n\r]/.test(text) ? `"${text}"` : text;
  }).join(',')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/* ---------- Mascota / asistente ZOEMIC ---------- */
function HardHat({size=46}){
  return <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="38" r="16" fill="#ffe0c2"/>
    <path d="M22 36c0 6 4 11 10 11s10-5 10-11" fill="none" stroke="var(--petrol)" strokeWidth="2" strokeLinecap="round"/>
    <circle cx="27" cy="38" r="1.8" fill="var(--petrol)"/><circle cx="37" cy="38" r="1.8" fill="var(--petrol)"/>
    <path d="M16 30a16 16 0 0132 0z" fill="#D6A23E"/>
    <rect x="13" y="29" width="38" height="4.5" rx="2.2" fill="#c08f2f"/>
    <rect x="30.5" y="14" width="3" height="14" rx="1.5" fill="#c08f2f"/>
  </svg>;
}
function assistantReply(q){
  const t=q.toLowerCase();
  const r=(...m)=>m.join(' ');
  if(/hola|buenas|hey|saludos/.test(t)) return 'Hola. Soy ZOE, copiloto tecnico de costos y obra. Te ayudo con APU, FSR, rendimientos, catalogos, presupuestos, explosiones de insumos y programa de obra.';
  if(/fsr|salario real|fasar/.test(t)) return r('El FSR (Factor de Salario Real, Art. 191 RLOPSRM) convierte el salario base en salario real: Salario real = base × FSR.','Calcúlalo en Centro Técnico con Tp (días pagados), Tl (días laborados) y Ps (cargas obrero-patronales). Suele andar entre 1.6 y 1.9.');
  if(/apu|precio unitario/.test(t)) return r('Para un APU: ve a "APU Inteligente", pega tu concepto y pulsa "Generar desarrollo".','Edita insumos, ajusta indirectos de campo/oficina, utilidad y cargos, y exporta a PDF o Excel. La herramienta menor se calcula como % de la mano de obra.');
  if(/excel|importar|catalogo|catálogo|precios/.test(t)) return r('Importa tu Excel de precios en Oficina Técnica o desde "Generar con IA".','Detecto las columnas de descripción, unidad y precio, y al generar un APU uso tus precios reales cuando coinciden con los insumos.');
  if(/pdf|exportar|excel de salida|descargar/.test(t)) return 'Desde el APU o el Presupuesto usa "Descargar PDF" / "Descargar Excel": salen con el membrete y datos de tu empresa (configúralos en Oficina Técnica).';
  if(/concreto|acero|block|pintura|excavaci|calculadora/.test(t)) return 'En Centro Técnico tienes calculadoras de concreto, acero, block, pintura, impermeabilizante, excavación y FSR. Te dan cantidades y costo al instante con precios editables.';
  if(/indirecto/.test(t)) return 'Los indirectos van separados en campo y oficina; ambos % se suman y se aplican sobre el costo directo. Luego siguen financiamiento, utilidad y cargos adicionales hasta el P.U.';
  if(/presupuesto/.test(t)) return 'En Presupuestos capturas conceptos con su P.U. (sin IVA); el sistema suma subtotal, IVA y total, y lo exportas a PDF/Excel con tu membrete.';
  return r('Puedo orientarte sobre APU, FSR, indirectos, calculadoras, importar tu Excel o exportar formatos.','Cuando la IA este activa en Vercel, tambien puedo consultar tu biblioteca tecnica y responder con fuentes.');
}
async function assistantReplyReal(q, history=[]){
  try{
    const response = await fetch('/api/assistant', {
      method:'POST',
      headers:await authHeaders(),
      body:JSON.stringify({question:q, history})
    });
    const data = await response.json();
    if(!response.ok) throw new Error(data?.error || 'IA no disponible');
    if(!data.answer) return {answer:assistantReply(q), source:'local'};
    return {answer:data.answer, source:'ai'};
  }catch{
    return {answer:assistantReply(q), source:'local'};
  }
}
const ZOE_SEED_MSG = {me:false,t:'Soy ZOE. Leo conceptos, APUs, costos y evidencia para ayudarte a decidir como ingeniero, no como chatbot generico.'};
const ZOE_VOICE_SUPPORTED = typeof window!=='undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
const ZOE_SPEECH_SUPPORTED = typeof window!=='undefined' && Boolean(window.speechSynthesis);
function Assistant(){
  const [open,setOpen]=useState(false);
  const [msgs,setMsgs]=useLocalState('zoemec-zoe-thread', [ZOE_SEED_MSG]);
  const [threads,setThreads]=useLocalState('zoemec-zoe-history', []);
  const [showHistory,setShowHistory]=useState(false);
  const [q,setQ]=useState('');
  const [busy,setBusy]=useState(false);
  const [listening,setListening]=useState(false);
  const [speakOn,setSpeakOn]=useState(false);
  const [speaking,setSpeaking]=useState(false);
  const recognitionRef=useRef(null);
  const bodyRef=useRef(null);

  useEffect(()=>{ if(bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [msgs, busy]);

  const speak=(text)=>{
    if(!ZOE_SPEECH_SUPPORTED || !speakOn || !text) return;
    try{
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang='es-MX'; utter.rate=1.02;
      utter.onstart=()=>setSpeaking(true);
      utter.onend=()=>setSpeaking(false);
      utter.onerror=()=>setSpeaking(false);
      window.speechSynthesis.speak(utter);
    }catch{ setSpeaking(false); }
  };

  const send=async(text=q)=>{
    if(!text.trim() || busy) return;
    const user=text.trim(); setQ(''); setBusy(true);
    setMsgs(m=>[...m,{me:true,t:user}]);
    const history = msgs.slice(-6).map(m=>({role:m.me?'user':'assistant', content:m.t}));
    const {answer, source} = await assistantReplyReal(user, history);
    setMsgs(m=>[...m,{me:false,t:answer,source}]);
    setBusy(false);
    speak(answer);
  };
  const startNewConversation=()=>{
    if(msgs.length>1) setThreads(t=>[{id:'ZOE-'+uid(), startedAt:new Date().toLocaleString('es-MX'), msgs}, ...t].slice(0,20));
    setMsgs([ZOE_SEED_MSG]);
    setShowHistory(false);
  };
  const openThread=(thread)=>{ setMsgs(thread.msgs); setShowHistory(false); };
  const toggleListen=()=>{
    if(!ZOE_VOICE_SUPPORTED) return;
    if(listening){ recognitionRef.current?.stop(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang='es-MX'; rec.interimResults=false; rec.maxAlternatives=1;
    rec.onstart=()=>setListening(true);
    rec.onend=()=>setListening(false);
    rec.onerror=()=>setListening(false);
    rec.onresult=(e)=>{ const transcript=e.results?.[0]?.[0]?.transcript; if(transcript) send(transcript); };
    recognitionRef.current=rec;
    rec.start();
  };
  const prompts=['Revisa este APU','Detecta riesgos','Explica evidencia','Prepara entregables'];
  return <>
    <button className={'asst-fab'+(busy?' thinking':'')+(speaking?' speaking':'')} onClick={()=>setOpen(o=>!o)} title="Copiloto ZOE"><img src="/images/zoemic-assistant-web.webp" alt="ZOE copiloto"/></button>
    {open && <div className="asst-panel">
      <div className="asst-head">
        <img className={'asst-avatar'+(busy?' thinking':'')+(speaking?' speaking':'')} src="/images/zoemic-assistant-web.webp" alt="ZOE copiloto"/>
        <div><b>Copiloto ZOE</b><small><i className={busy?'pulse':''}></i> {busy?'ZOE esta analizando...':'Inteligencia de costos en linea'}</small></div>
        <div className="asst-head-actions">
          {ZOE_SPEECH_SUPPORTED && <button className={'asst-icon-btn'+(speakOn?' active':'')} title={speakOn?'Silenciar respuestas':'Leer respuestas en voz alta'} onClick={()=>{ setSpeakOn(v=>!v); if(speakOn) window.speechSynthesis.cancel(); }} aria-label="Alternar voz"><Icon name={speakOn?'speakerOn':'speakerOff'} size={16}/></button>}
          <button className="asst-icon-btn" title="Historial de conversaciones" onClick={()=>setShowHistory(v=>!v)} aria-label="Historial"><Icon name="history" size={16}/></button>
          <button className="asst-x" onClick={()=>setOpen(false)} aria-label="Cerrar chat de ZOE">×</button>
        </div>
      </div>
      <div className="asst-strip"><span>Contexto</span><span>APU</span><span>BIM</span><span>Entrega</span></div>
      {showHistory ? <div className="asst-history">
        <button className="soft asst-new-thread" onClick={startNewConversation}>+ Nueva conversación</button>
        {threads.length ? threads.map(th=><button key={th.id} className="asst-thread-item" onClick={()=>openThread(th)}>
          <b>{th.msgs.find(m=>m.me)?.t?.slice(0,48) || 'Conversación'}</b><small>{th.startedAt} · {th.msgs.length} mensajes</small>
        </button>) : <p className="asst-history-empty">Aún no tienes conversaciones anteriores guardadas.</p>}
      </div> : <>
        <div className="asst-body" ref={bodyRef}>
          {msgs.map((m,i)=><div key={i} className={'asst-msg'+(m.me?' me':'')}>{m.t}{!m.me && m.source==='local' && <em className="asst-offline-tag">Respuesta local (IA no disponible)</em>}</div>)}
          {busy && <div className="asst-msg asst-thinking-msg"><span className="asst-dots"><i/><i/><i/></span></div>}
        </div>
        <div className="asst-suggestions">{prompts.map(p=><button key={p} onClick={()=>send(p)} disabled={busy}>{p}</button>)}</div>
        <div className="asst-input">
          <input value={q} placeholder="Pregunta por costos, obra, evidencia..." onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()}/>
          {ZOE_VOICE_SUPPORTED && <button className={'asst-icon-btn'+(listening?' active listening':'')} title={listening?'Detener grabación':'Hablar con ZOE'} onClick={toggleListen} aria-label="Entrada por voz"><Icon name={listening?'micStop':'mic'} size={16}/></button>}
          <button onClick={()=>send()} disabled={busy}>{busy?'...':'Enviar'}</button>
        </div>
        <div className="asst-note">Copiloto visual conectado al flujo tecnico existente.</div>
      </>}
    </div>}
  </>;
}

const LANDING_PIPELINE = [
  { tag:'Excel', flow:['Excel','Contexto BIM','APU'], head:'ZOE está leyendo', metric:'48 conceptos',
    rows:[['01','Falso plafón de tablaroca','m²','94%'],['02','Estructura metálica ASTM A500','kg','91%'],['03','Pintura vinílica en muros','m²','88%']],
    foot:['Extrayendo conceptos','Contexto BIM'] },
  { tag:'Biblioteca', flow:['Catálogo','Coincidencias','Precios'], head:'ZOE consulta biblioteca', metric:'12 matrices base',
    rows:[['01','Concreto premezclado f\'c=250','m³','96%'],['02','Bomba centrífuga 1 HP','pza','90%'],['03','Tubería PVC hidráulica 1/2"','m','93%']],
    foot:['Cruzando evidencia técnica','Catálogo base ZOEMEC'] },
  { tag:'APU', flow:['Materiales','Mano de obra','Equipo'], head:'ZOE genera la matriz', metric:'3 insumos por concepto',
    rows:[['01','Cemento gris CPC 30R','bulto','$225.00'],['02','Oficial albañil','jor','1.85 FSR'],['03','Revolvedora 1 saco','hr','$95.00']],
    foot:['Aplicando indirectos y utilidad', 'Metodología RLOPSRM'] },
  { tag:'Validación', flow:['Indirectos','Financiamiento','Utilidad'], head:'ZOE valida resultados', metric:'Confianza 94%',
    rows:[['01','Costo directo','—','$2,716.26'],['02','Indirectos + financiamiento','—','$469.91'],['03','Utilidad + cargos','—','$336.14']],
    foot:['Precio unitario integrado', 'Listo para revisión'] },
];

function Landing({setScreen, login, company}){
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep(s => (s + 1) % LANDING_PIPELINE.length), 3200);
    return () => clearInterval(t);
  }, []);
  const p = LANDING_PIPELINE[step];
  return <div className="landing">
    <header className="nav-public">
      <div className="brand-mini"><img src={company?.logo || '/images/logo-web.png'} onError={(e)=>e.currentTarget.style.display='none'} /><b>ZOEMEC</b></div>
      <nav><a>Copiloto</a><a>Gemelo Digital</a><a>APU con IA</a><a>Entregables</a></nav>
      <div className="nav-actions"><button className="ghost" onClick={()=>setScreen('login')}>Iniciar sesión</button><button onClick={()=>setScreen('register')}>Comenzar gratis</button></div>
    </header>
    <section className="hero-build">
      <div className="hero-copy">
        <span className="eyebrow">Copiloto de IA para ingeniería de costos en construcción</span>
        <h1>Construye el modelo de costos antes de verter el concreto.</h1>
        <p>ZOEMEC convierte conceptos, Excel y evidencia tecnica en APUs trazables, presupuesto y entregables profesionales con una experiencia de copiloto visual para obra digital.</p>
        <div className="hero-actions"><button onClick={()=>setScreen('register')}>Abrir centro de mando</button><button className="secondary" onClick={()=>setScreen('login')}>Ya tengo cuenta</button></div>
        <div className="future-proof"><span>Documento</span><i/><span>Conceptos</span><i/><span>Evidencia</span><i/><span>APU</span><i/><span>PDF/XLSX</span></div>
      </div>
      <div className="future-stage" aria-label="Modelo digital de construcción">
        <img className="stage-photo" src="/images/hero/zoemec-hero-web.webp" alt="Obra de construccion con overlays de IA mostrando APU, presupuestos, licitaciones y costos en tiempo real" />
        <div className="hero-scan" aria-hidden="true"></div>
        <div className="stage-status">
          <span>MODELO EN VIVO</span>
          <b>Panel de inteligencia de costos</b>
        </div>
        <div className="ai-console" key={step}>
          <div className="command-strip"><span>{p.head}</span><b>{p.metric}</b></div>
          <div className="command-flow">{p.flow.map((f,i)=><React.Fragment key={f}>{i>0 && <i/>}<span>{f}</span></React.Fragment>)}</div>
          <div className="command-table">
            {p.rows.map(r=><div key={r[0]}><b>{r[0]}</b><span>{r[1]}</span><em>{r[2]}</em><strong>{r[3]}</strong></div>)}
          </div>
          <div className="command-total"><span>{p.foot[0]}</span><b>{p.foot[1]}</b></div>
        </div>
        <div className="stage-tag">Vista ilustrativa del flujo ZOE</div>
      </div>
      <div className="hero-benefits">
        <div><Icon name="apu" size={28}/><b>Motor de APU con IA</b><span>Matrices de costo con revisión</span></div>
        <div><Icon name="doc" size={28}/><b>Importación de Excel</b><span>Catálogos de construcción multi-hoja</span></div>
        <div><Icon name="biblioteca" size={28}/><b>Trazabilidad de evidencia</b><span>Rastreo de fuente, hoja y fila</span></div>
        <div><Icon name="reportes" size={28}/><b>Entregables</b><span>PDF y Excel profesionales</span></div>
      </div>
    </section>
    <section className="landing-story">
      <div className="landing-story-head">
        <span className="eyebrow">Cómo funciona</span>
        <h2>De un Excel disperso a un presupuesto auditable, en el mismo flujo.</h2>
      </div>
      <div className="story-steps">
        <div className="story-step"><b>01</b><h3>Importa tu Excel o pega el concepto</h3><p>ZOEMEC lee catálogos completos o un solo concepto y detecta unidad, cantidad y precio de referencia automáticamente.</p></div>
        <div className="story-step"><b>02</b><h3>ZOE genera la matriz APU</h3><p>Materiales, mano de obra y equipo con la metodología RLOPSRM: FSR, herramienta menor, indirectos, financiamiento y utilidad.</p></div>
        <div className="story-step"><b>03</b><h3>Exporta entregables profesionales</h3><p>PDF y Excel auditables con membrete, listos para concurso, licitación u obra — con la fuente de cada insumo trazable.</p></div>
      </div>
    </section>
    <section className="landing-preview">
      <div className="landing-story-head">
        <span className="eyebrow">La plataforma real</span>
        <h2>Así se ve ZOEMEC por dentro.</h2>
      </div>
      <div className="preview-grid">
        <figure><img src="/images/dashboard/zoemec-dashboard-web.webp" alt="Dashboard de ZOEMEC con proyectos, presupuesto y actividad reciente"/><figcaption>Centro de costos</figcaption></figure>
        <figure><img src="/images/screenshots/apu-matrix.png" alt="Matriz APU real generada en ZOEMEC con materiales, mano de obra y equipo"/><figcaption>Matriz APU generada</figcaption></figure>
      </div>
    </section>
  </div>
}

function Auth({mode,setScreen,login,loginWithGoogle,company}){
  const [name,setName]=useState('');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState(null);
  useEffect(()=>{ apiGetSafe('/api/status').then(setStatus); },[]);
  const submit=async ()=>{
    if(!email.trim() || !password.trim()){
      alert('Captura correo y contraseña para continuar.');
      return;
    }
    setBusy(true);
    try{ await login(name, email.trim(), password, mode); }
    finally{ setBusy(false); }
  };
  return <div className="auth-split">
    <div className="auth-brand">
      <Backdrop/>
      <div className="auth-brand-inner">
        <div className="hero-logo light"><img src={company?.logo || '/images/logo-web.png'} onError={(e)=>e.currentTarget.style.display='none'} /><span>ZOEMEC</span></div>
        <h2>Ingeniería de costos, precisa y profesional.</h2>
        <p>Un copiloto tecnico que lee documentos, detecta conceptos, valida evidencia y convierte APUs en entregables listos para concurso y obra.</p>
        <div className="auth-points">
          <span><Icon name="apu" size={18}/> ZOE interpreta conceptos y propone matrices APU</span>
          <span><Icon name="tecnico" size={18}/> Modelo visual con evidencia, riesgos y costos</span>
          <span><Icon name="presupuestos" size={18}/> Exporta presupuesto profesional en PDF y Excel</span>
        </div>
        {status && <div className="auth-status">
          <span className={'auth-status-dot'+(status.firebase==='ok'&&status.openai==='ok'?' ok':'')}/>
          <span>{status.firebase==='ok'&&status.openai==='ok' ? 'Plataforma operando con normalidad' : 'Algunos servicios de IA no responden en este momento'}</span>
        </div>}
        {status?.announcement && <div className="auth-announcement"><b>Novedades</b><p>{status.announcement}</p></div>}
      </div>
    </div>
    <div className="auth-form-side">
      <div className="auth-card">
        <h1>{mode==='login'?'Iniciar sesion':'Crear cuenta'}</h1>
        <p>{mode==='login'?'Accede con tu cuenta registrada.':'Empieza con 1 APU gratis por dispositivo.'}</p>
        {mode==='register' && <><label>Nombre completo</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="Tu nombre" /></>}
        <label>Correo electronico</label>
        <input placeholder="correo@empresa.com" type="email" value={email} onChange={e=>setEmail(e.target.value)} />
        <label>Contrasena</label>
        <input placeholder="minimo 6 caracteres" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
        <button onClick={submit} disabled={busy}>{busy?'Conectando...':(mode==='login'?'Entrar':'Crear cuenta')}</button>
        <div className="auth-or"><span>o</span></div>
        <button className="google" disabled={busy} onClick={async()=>{ setBusy(true); try{ await loginWithGoogle?.(); } finally{ setBusy(false); } }}><Icon name="clientes" size={18}/> Continuar con Google</button>
        {mode==='register' && <div className="auth-warning"><b>Cuenta gratis:</b> 1 APU sin costo. Se registra el dispositivo para evitar multiples correos gratis.</div>}
        <small>{mode==='login'?'¿No tienes cuenta? ':'¿Ya tienes cuenta? '}<a onClick={()=>setScreen(mode==='login'?'register':'login')}>{mode==='login'?'Regístrate':'Inicia sesión'}</a></small>
        <a className="back" onClick={()=>setScreen('landing')}>← Volver al inicio</a>
      </div>
    </div>
  </div>
}

function TopSearch({apus=[],clients=[],projects=[],setModule}){
  const [q,setQ]=useState('');
  const [open,setOpen]=useState(false);
  const boxRef=useRef(null);
  useEffect(()=>{
    if(!open) return;
    const onDown=(e)=>{ if(boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return ()=>document.removeEventListener('mousedown', onDown);
  },[open]);
  const term = q.trim().toLowerCase();
  const results = term ? [
    ...apus.filter(a=>(a.concept||a.clave||'').toLowerCase().includes(term)).slice(0,4).map(a=>({type:'APU', label:a.concept||a.clave||'APU', module:'apu'})),
    ...clients.filter(c=>(c.name||'').toLowerCase().includes(term)).slice(0,4).map(c=>({type:'Cliente', label:c.name, module:'cartera'})),
    ...projects.filter(p=>(p.name||'').toLowerCase().includes(term)).slice(0,4).map(p=>({type:'Proyecto', label:p.name, module:'cartera'}))
  ].slice(0,8) : [];
  const go=(r)=>{ setModule(r.module); setOpen(false); setQ(''); };
  return <div className="top-search" ref={boxRef}>
    <Icon name="search" size={16}/>
    <input value={q} placeholder="Buscar concepto, cliente o proyecto..." onChange={e=>{setQ(e.target.value); setOpen(true);}} onFocus={()=>term && setOpen(true)}/>
    {open && term && <div className="top-search-drop">
      {results.length ? results.map((r,i)=><button type="button" key={i} onClick={()=>go(r)}><b>{r.type}</b><span>{r.label}</span></button>) : <p>Sin resultados para "{q}".</p>}
    </div>}
  </div>;
}

function Shell({children,user,logout,module,setModule,company,apus,clients,projects}){
  // Comunidad, Planes y acceso y Visual IA se ocultan temporalmente del menu principal
  // (fase de concurso: se mantienen en el codigo, solo no se muestran en la navegacion).
  const menu = [
    ['inicio','inicio','Inicio'], ['apu','apu','APU Inteligente'], ['presupuestos','presupuestos','Presupuestos'],
    ['cartera','clientes','Proyectos y clientes','Cartera de obra'],
    ['biblioteca','biblioteca','Biblioteca','Academia y documentos'],
    ['tecnico','tecnico','Oficina técnica','Cálculos y formatos'],
    ['reportes','reportes','Reportes'],
    ...(user.role==='admin' ? [['admin','admin','Panel Admin','Usuarios, planes y sistema']] : [])
  ];
  return <div className="app-layout">
    <aside className="sidebar">
      <div className="brand"><img src={company.logo || '/images/logo-web.png'} onError={(e)=>e.currentTarget.style.display='none'} /><div><b>ZOEMEC</b><span>Ingeniería y construcción</span></div></div>
      <div className="menu">{menu.map(m=><button key={m[0]} className={module===m[0]?'active':''} onClick={()=>setModule(m[0])}><span className="mi"><Icon name={m[1]}/></span><span className="menu-copy"><b>{m[2]}</b>{m[3] && <small>{m[3]}</small>}</span></button>)}</div>
      <button className="plan-box" onClick={()=>setModule('planes')}><b>Plan Profesional</b><p>APU, PDF, Excel, IA y biblioteca técnica.</p><div><i style={{width:'68%'}}></i></div><small>Ver permisos y cobro</small></button>
      <button className="logout-side" onClick={logout}>Salir</button>
    </aside>
    <main className="main">
      <header className="topbar">
        <TopSearch apus={apus} clients={clients} projects={projects} setModule={setModule}/>
        <div className="user"><CloudBadge user={user}/><NotificationBell/><span className="avatar">{user.initials}</span><div><b>{user.name}</b><small>{user.role === 'admin' ? 'Administrador' : user.plan}</small></div><button onClick={logout}>Salir</button></div>
      </header>
      {children}
    </main>
    <Assistant/>
  </div>
}

function PageHead({kicker,title,desc,action}){return <div className="page-head"><div><span>{kicker}</span><h1>{title}</h1><p>{desc}</p></div>{action}</div>}

function Dashboard({setModule,apus,clients,budgets,projects}){
  const monto = budgets.reduce((a,b)=>a+(b.total||0),0);
  const pr = projects || [];
  const estados = pr.reduce((m,p)=>{m[p.status]=(m[p.status]||0)+1;return m;},{});
  const palette = ['#9D6FD0','#2A1740','#C7A35C','#B8A4CC','#B54A62'];
  const segs = Object.keys(estados).map((k,i)=>({label:k,value:estados[k],color:palette[i%palette.length]}));
  const spark = budgets.length ? budgets.slice(-8).map((b,i)=>Math.max(1,(Number(b.total)||0)/1000+i)) : [0,0,0,0,0,0,0,0];
  const pipeline=[
    ['Doc','Excel / PDF','ready'],
    ['Extraer','Conceptos','active'],
    ['Clasificar','Especialidad','ready'],
    ['Evidencia','Fuente tecnica',apus.length?'ready':'watch'],
    ['APU','Matriz editable',apus.length?'ready':'active'],
    ['Entregar','PDF / XLSX',budgets.length?'ready':'watch']
  ];
  return <section className="ai-os"><PageHead kicker="ZOEMEC AI OS" title="Copiloto de costos de construcción" desc="Un centro visual donde documentos, modelos, evidencia y APUs viven en el mismo flujo tecnico." action={<button onClick={()=>setModule('apu')}>Pedir a ZOE que cotice</button>} />
    <div className="os-grid">
      <div className="os-command">
        <div className="os-command-head"><span>Inteligencia del proyecto en vivo</span><b>{monto ? money(monto) : 'Sin presupuesto aun'}</b></div>
        <h2>{pr[0]?.name || 'Espacio de trabajo de construcción digital'}</h2>
        <p>{pr[0]?.client || 'Importa un concepto o crea un APU para encender el modelo de costos.'}</p>
        <div className="os-prompt"><i>ZOE</i><span>Convierte el siguiente alcance en una matriz APU trazable...</span><button onClick={()=>setModule('apu')}>Iniciar</button></div>
        <div className="os-pipeline">{pipeline.map((p,i)=><button key={p[0]} className={p[2]} onClick={()=>setModule(i<2?'biblioteca':i<5?'apu':'presupuestos')}><b>{p[0]}</b><span>{p[1]}</span></button>)}</div>
      </div>
      <div className="os-bim">
        <DigitalTwin apu={apus[0]} compact onOpen={()=>setModule('apu')}/>
      </div>
      <div className="os-side">
        <div><small>Conceptos</small><b>{apus.length || 'Listo'}</b><span>{apus.length ? 'matrices activas' : 'genera tu primer APU'}</span></div>
        <div><small>Presupuesto</small><b>{budgets.length || 'Borrador'}</b><span>{budgets.length ? 'entregables listos' : 'sin costo final'}</span></div>
        <div><small>Clientes</small><b>{clients.length}</b><span>cartera conectada</span></div>
      </div>
    </div>
    <div className="quick os-actions"><button onClick={()=>setModule('apu')}><Icon name="apu"/> Generar APU</button><button onClick={()=>setModule('biblioteca')}><Icon name="biblioteca"/> Abrir evidencia</button><button onClick={()=>setModule('cartera')}><Icon name="clientes"/> Ver proyectos y clientes</button><button onClick={()=>setModule('presupuestos')}><Icon name="presupuestos"/> Exportar entregables</button></div>
    <div className="dash-charts">
      <div className="panel future-panel"><h2>Tendencia de costo</h2><Spark points={spark}/><div className="chart-foot"><span>{budgets.length ? 'Datos de presupuesto' : 'Esperando primer presupuesto real'}</span><b>{budgets.length ? 'Sincronizado' : 'Standby'}</b></div></div>
      <div className="panel chart-donut future-panel"><h2>Mapa de proyecto</h2><Donut segments={segs} center={pr.length || 'IA'} sub="nodos"/><div className="donut-legend">{segs.length ? segs.map(s=><span key={s.label}><i style={{background:s.color}}/>{s.label} <b>{s.value}</b></span>) : <span><i style={{background:'#C7A35C'}}/>Sin proyectos: crea uno o genera APU</span>}</div></div>
    </div>
    <div className="grid-2"><div className="panel"><h2>Proyectos recientes</h2>{pr.length ? pr.slice(0,4).map(p=><div className="project-row" key={p.name}><div><b>{p.name}</b><small>{p.client}</small></div><span>{p.progress}%</span><progress value={p.progress} max="100" /></div>) : <EmptyState text="Aún no hay proyectos reales. Crea el primero para alimentar este tablero."/>}</div><div className="panel"><h2>Actividad reciente</h2>{apus.length || budgets.length ? [...apus.slice(0,2).map(a=>`APU ${a.clave || a.id} creado`), ...budgets.slice(0,2).map(b=>`Presupuesto ${b.name} guardado`)].map(x=><div className="activity" key={x}><Icon name="doc" size={15}/> {x}</div>) : <EmptyState text="La actividad aparecerá cuando guardes APUs, presupuestos, clientes o documentos."/>}</div></div>
  </section>
}
function EmptyState({icon,title,text,actionLabel,onAction}){
  return <div className="empty-state">
    {icon && <span className="empty-state-icon"><Icon name={icon} size={30}/></span>}
    {title ? <><h3>{title}</h3><p>{text}</p></> : <p>{text}</p>}
    {actionLabel && onAction && <button className="soft" onClick={onAction}>{actionLabel}</button>}
  </div>;
}

/* ====================================================================
   MOTOR APU - Metodología mexicana (RLOPSRM Art. 191, 220)
   Estructura de fila por insumo:
     materials : [descripción, cantidad, unidad, precioBase, merma%]
     labor     : [descripción, jornadas, unidad, salarioBase, FSR]
     equipment : [descripción, cantidad, unidad, costoHorario]
   ==================================================================== */

const APU_STANDARD_FACTORS = Object.freeze({
  herramienta:3,
  indCampo:8,
  indOficina:7,
  finance:2,
  utility:10,
  cargos:0.5,
  iva:16
});
function canonicalAPUText(value){
  return cleanText(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
}
function stableHash(value){
  const text = canonicalAPUText(value);
  let hash = 2166136261;
  for(let i=0;i<text.length;i++){
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(6,'0').slice(0,6);
}
function conceptApuKey(item={}){
  return [
    item.code || item.clave || '',
    item.concept || item.description || '',
    normalizeUnitLabel(item.unit || ''),
    Number(item.referencePU || 0) ? Number(item.referencePU || 0).toFixed(4) : ''
  ].map(canonicalAPUText).join('|');
}
function cloneApuRows(rows=[]){
  return rows.map(row => Array.isArray(row) ? [...row] : row);
}
function cloneAPU(apu={}){
  return {
    ...apu,
    materials:cloneApuRows(apu.materials),
    labor:cloneApuRows(apu.labor),
    equipment:cloneApuRows(apu.equipment),
    aiNotes:[...(apu.aiNotes || [])]
  };
}
function applyConceptMetadata(apu, item={}, index=0, sourceFile='Catalogo de conceptos'){
  const next = cloneAPU(apu);
  next.clave = String(item.code || item.clave || next.clave || `APU-${index+1}`).slice(0,24);
  next.concept = cleanText(item.concept || item.description || next.concept).replace(/\s+/g,' ').trim();
  next.unit = normalizeUnitLabel(item.unit || next.unit);
  next.sourceQty = Number(item.qty || item.sourceQty || 1) || 1;
  next.referencePU = Number(item.referencePU || 0) || 0;
  next.sourceFile = sourceFile;
  next.sourceSection = item.section || item.sourceSection || '';
  next.rowNumber = item.rowNumber || index + 1;
  next.cacheKey = conceptApuKey({...item, concept:next.concept, unit:next.unit});
  return next;
}
function standardizeAPU(base, item={}, index=0, sourceFile='Catalogo de conceptos'){
  const next = applyConceptMetadata(base, item, index, sourceFile);
  next.herramienta = APU_STANDARD_FACTORS.herramienta;
  next.indCampo = APU_STANDARD_FACTORS.indCampo;
  next.indOficina = APU_STANDARD_FACTORS.indOficina;
  next.finance = APU_STANDARD_FACTORS.finance;
  next.utility = APU_STANDARD_FACTORS.utility;
  next.cargos = APU_STANDARD_FACTORS.cargos;
  next.iva = APU_STANDARD_FACTORS.iva;
  next.materials = cloneApuRows(next.materials).map(r => [cleanText(r[0]), Number(r[1]) || 0, normalizeUnitLabel(r[2]), Number(r[3]) || 0, Number(r[4]) || 0]);
  next.labor = cloneApuRows(next.labor).map(r => [cleanText(r[0]), Number(r[1]) || 0, normalizeUnitLabel(r[2]), Number(r[3]) || 0, Number(r[4]) || 1]);
  next.equipment = cloneApuRows(next.equipment).map(r => [cleanText(r[0]), Number(r[1]) || 0, normalizeUnitLabel(r[2]), Number(r[3]) || 0]);
  next.aiNotes = [
    'APU estandarizado: insumos, rendimientos, precios, FSR e indirectos salen del catalogo base ZOEMEC.',
    ...(next.aiNotes || [])
  ].filter(Boolean);
  return next;
}
/* A diferencia de standardizeAPU (que fuerza la plantilla local), esta funcion
   conserva los materiales/mano de obra/equipo y los % que la IA realmente devolvio,
   solo normaliza texto/unidades/numeros y le aplica la metadata del concepto. */
function finalizeAIAPU(aiDraft={}, item={}, index=0, sourceFile='OpenAI API'){
  const next = applyConceptMetadata(aiDraft, item, index, sourceFile);
  next.materials = cloneApuRows(next.materials).map(r => [cleanText(r[0]), Number(r[1]) || 0, normalizeUnitLabel(r[2]), Number(r[3]) || 0, Number(r[4]) || 0]);
  next.labor = cloneApuRows(next.labor).map(r => [cleanText(r[0]), Number(r[1]) || 0, normalizeUnitLabel(r[2]), Number(r[3]) || 0, Number(r[4]) || 1]);
  next.equipment = cloneApuRows(next.equipment).map(r => [cleanText(r[0]), Number(r[1]) || 0, normalizeUnitLabel(r[2]), Number(r[3]) || 0]);
  next.herramienta = Number(aiDraft.herramienta ?? APU_STANDARD_FACTORS.herramienta);
  next.indCampo = Number(aiDraft.indCampo ?? APU_STANDARD_FACTORS.indCampo);
  next.indOficina = Number(aiDraft.indOficina ?? APU_STANDARD_FACTORS.indOficina);
  next.finance = Number(aiDraft.finance ?? APU_STANDARD_FACTORS.finance);
  next.utility = Number(aiDraft.utility ?? APU_STANDARD_FACTORS.utility);
  next.cargos = Number(aiDraft.cargos ?? APU_STANDARD_FACTORS.cargos);
  next.iva = Number(aiDraft.iva ?? APU_STANDARD_FACTORS.iva);
  next.family = aiDraft.family || next.family;
  next.sat = aiDraft.sat || next.sat;
  next.confidence = Number(aiDraft.confidence || 92);
  next.templateGenerated = false;
  next.aiGenerated = true;
  next.templateFallback = false;
  next.aiNotes = [
    'Generado por IA (OpenAI) para este concepto exacto. Revisa y ajusta antes de aprobar.',
    ...(aiDraft.aiNotes || [])
  ].filter(Boolean);
  return applyMarketPrices(next);
}
/* Cuando la IA no responde (sin API key, sin conexion, timeout), se usa la matriz
   tecnica real del catalogo base ZOEMEC como respaldo editable, para no romper el
   flujo. No son datos inventados: son valores estandar del catalogo tecnico. */
function templateFallbackAPU(item={}, catalog, index=0, sourceFile='Plantilla tecnica ZOEMEC', reason=''){
  const next = standardAPUForConcept(item, catalog, index, sourceFile);
  next.templateFallback = true;
  next.aiGenerated = false;
  next.aiNotes = [
    `Plantilla tecnica aplicada: la IA no respondio en este entorno${reason ? ' (' + reason + ')' : ''}. Esta matriz usa el catalogo base ZOEMEC editable.`,
    ...(next.aiNotes || [])
  ].filter(Boolean);
  return next;
}
const MARKET_PRICES_KEY = 'zoemec-market-prices';
function readMarketPrices(){
  try{ return JSON.parse(localStorage.getItem(MARKET_PRICES_KEY)) || {}; }catch{ return {}; }
}
function saveMarketPrice(desc, registro){
  try{
    const all = readMarketPrices();
    all[String(desc).trim().toLowerCase()] = registro;
    localStorage.setItem(MARKET_PRICES_KEY, JSON.stringify(all));
  }catch{ /* almacenamiento no disponible */ }
}
function applyMarketPrices(apu){
  const all = readMarketPrices();
  if(!Object.keys(all).length) return apu;
  const sources = { ...(apu.marketSources || {}) };
  let touched = false;
  const applyRows = (rows) => (rows || []).map(r => {
    const key = String(r?.[0] || '').trim().toLowerCase();
    const m = all[key];
    if(m && Number(m.price) > 0){
      const nr = [...r];
      nr[3] = Number(m.price);
      sources[String(r[0]).trim()] = m;
      touched = true;
      return nr;
    }
    return r;
  });
  const materials = applyRows(apu.materials);
  const labor = applyRows(apu.labor);
  const equipment = applyRows(apu.equipment);
  if(!touched) return apu;
  return { ...apu, materials, labor, equipment, marketSources: sources };
}
function standardAPUForConcept(item, catalog, index=0, sourceFile='Catalogo de conceptos'){
  const base = makeAPUFromConcept(item?.concept || item?.description || String(item || ''), catalog);
  return applyMarketPrices(standardizeAPU(base, item || {}, index, sourceFile));
}
function makeAPUFromConcept(concept, catalog){
  const c = concept || 'Muro de block hueco de concreto de 15 cm asentado con mortero cemento-arena';
  const t = c.toLowerCase();
  // Plafon / tablaroca manda: menciones como "pintura anticorrosiva" dentro de las
  // inclusiones de un falso plafon NO deben clasificar el concepto como pintura.
  const isSuspendedCeiling = /falso\s*plaf|plaf[oó]n(d)?\s+de\s+(tablaroca|yeso|tablacemento)|suspensi[oó]n\s*oculta|colganter[ií]a|canal\s*list[oó]n|perfacinta|redimix/.test(t);
  const isDrywallConcept = isSuspendedCeiling || /tablaroca|durock|tablacemento|trasdosado|cajillo|panel.*yeso/.test(t);
  const isPaintingConcept = !isDrywallConcept && (
    /pua\s*501|pua501|mapla|suministro y aplicaci[oó]n de pintura|pintar|repint|esmalte|vin[ií]lic|acr[ií]l|ep[oó]x|sellador vin/.test(t)
    || (/(muro|muros|plaf[oó]n|plafones)/.test(t) && /(pintura|recubrimiento|preparaci[oó]n de la superficie|lija|lavado)/.test(t))
  );
  let tipo;
  if(isSuspendedCeiling) tipo='plafon_suspendido';
  else if(isDrywallConcept) tipo='tablaroca';
  else if(isPaintingConcept) tipo='pintura';
  else if(/escalera|barandal|herrer|ptr|perfil tubular|estructura metal|soldadur|acero.*calibre|bastidor.*acero/.test(t)) tipo='estructura_metalica';
  else if(/plaf|fald|tablaroca|durock|tablacemento|trasdosado|cajillo|enchape|panel.*yeso|yeso|antimoho|anti moho/.test(t)) tipo='tablaroca';
  else if(/marmol|granito|cubierta|barra lavamanos/.test(t)) tipo='marmol_granito';
  else if(/registro|tapa de acceso|tapa registro|paso de instalaciones/.test(t)) tipo='registro';
  else if(/aplanado|repellado|enjarre|plaster|uniblock|resane|emboquillado|chukum/.test(t)) tipo='aplanado';
  else if(/pintura|pintar|esmalte|vinil|acril|epox|primario|sellador vin/.test(t)) tipo='pintura';
  else if(/plaf|fald|tablaroca|durock|tablacemento|trasdosado|cajillo|enchape|panel.*yeso|yeso|antimoho|anti moho/.test(t)) tipo='tablaroca';
  else if(/porcelanato|loseta|azulejo|cer[aá]mic|lambr|piso|zoclo|boquilla|sardinel/.test(t)) tipo='piso';
  else if(/marmol|m[aá]rmol|granito|cubierta|barra lavamanos/.test(t)) tipo='marmol_granito';
  else if(/aplanado|repellado|enjarre|plaster|uniblock|resane|emboquillado|chukum/.test(t)) tipo='aplanado';
  else if(/sellado|sello|silicon|silic[oó]n|calafate|junta|espuma/.test(t)) tipo='sello';
  if(!tipo){
  if(/bomba|electrobomba|equipo de bombeo|bombeo hidr[aá]ulico|motobomba/.test(t)) tipo='bomba';
  else if(/tuber[ií]a|tubo\s|tubos\s|conducci[oó]n hidr[aá]ulica|red hidr[aá]ulica|l[ií]nea hidr[aá]ulica|bajada pluvial|drenaje sanitario/.test(t)) tipo='tuberia';
  else if(/lavabo|durock|ptr|mueble.*bañ|mueble.*ban|base.*lavabo|cer[aá]mico/.test(t)) tipo='lavabo_ptr';
  else if(/estructura met[aá]lica|astm|a500|fy\s*=?\s*46|soldadur|perfil de acero|placa.*acero|grout|primario anticorrosivo|montaje.*estructura|fabricaci[oó]n.*estructura/.test(t)) tipo='estructura_metalica';
  else if(/acero|varilla|castillo|cadena|armad|fierro|malla/.test(t)) tipo='acero';
  else if(/concreto|losa|zapata|firme|cimentaci|colado|columna de conc/.test(t)) tipo='concreto';
  else if(isPaintingConcept) tipo='pintura';
  else if(/block|tabique|tabic[oó]n|muro|partici[oó]n|mamposter|junteo/.test(t)) tipo='block';
  else if(/pintura|pintar|esmalte|vinil/.test(t)) tipo='pintura';
  else if(/impermeabiliz/.test(t)) tipo='imper';
  else if(/aplanado|repellado|enjarre|yeso|resane/.test(t)) tipo='aplanado';
  else if(/piso|cer[aá]mic|loseta|porcelanato|azulejo/.test(t)) tipo='piso';
  else if(/excavaci|zanja|despalme/.test(t)) tipo='excavacion';
  else tipo='generico';

  }
  const unmatched = tipo === 'generico';
  const TPL = {
    lavabo_ptr:{ unit:'m',
      materials:[['Perfil PTR de acero de 2" x 2" cal. 14',1.15,'m',92,0],['Tablero de cemento Durock 12.7 mm',0.65,'m²',210,0],['Anclajes, fijaciones, tornillería y soldadura',1,'lote',25,0],['Pasta, cinta y malla para juntas',0.18,'jgo',85,3],['Pintura anticorrosiva / primario',0.08,'L',98,3],['Materiales misceláneos de ajuste y protección',0.04,'jgo',120,0]],
      labor:[['Cuadrilla de herrero + ayudante',0.035,'jor',1400,1],['Trazo, nivelación y presentación',0.015,'jor',700,1],['Resanes, cortes y adecuaciones',0.02,'jor',700,1],['Limpieza, retiro y protección del área',0.02,'jor',470,1]],
      equipment:[['Equipo de protección y andamios (5% de M.O.)',0.05,'(%MO)',49],['Soldadora y herramienta de corte',0.03,'día',120]] },
    tablaroca:{ unit:'m²',
      materials:[['Panel de yeso / tablacemento 12.7 mm segun especificacion',1.05,'m²',210,5],['Poste o canal metalico galvanizado',1.25,'m',38,5],['Canal de amarre y refuerzos',0.55,'m',32,5],['Tornilleria, taquetes y fijaciones',0.18,'jgo',85,3],['Cinta y compuesto para juntas',0.22,'kg',42,5],['Pasta / sellador de acabado',0.12,'L',70,5],['Materiales miscelaneos y proteccion',0.04,'jgo',120,0]],
      labor:[['Instalador de panel (oficial)',0.12,'jor',420,1.85],['Ayudante instalador',0.12,'jor',285,1.82],['Trazo, plomeo y nivelacion',0.025,'jor',420,1.85],['Tratamiento de juntas y resanes',0.05,'jor',380,1.85],['Limpieza y retiro de desperdicio',0.035,'jor',258,1.82]],
      equipment:[['Andamio / escalera de trabajo',0.04,'día',120],['Herramienta electrica de corte y fijacion',0.03,'día',150],['Equipo de seguridad personal',0.02,'día',90]] },
    plafon_suspendido:{ unit:'m²',
      materials:[
        ['Panel de yeso (tablaroca) 12.7 mm segun especificacion',1.05,'m²',95,8],
        ['Canaleta de carga 38 mm cal. 22 con pintura anticorrosiva',0.95,'m',38,5],
        ['Canal liston para suspension oculta',2.3,'m',30,5],
        ['Colganteria de alambre galvanizado No. 14',0.12,'kg',48,5],
        ['Alambre recocido No. 16 para amarres',0.05,'kg',38,3],
        ['Ancla de agujero tipo Ramset con fulminante',1.5,'pza',9,3],
        ['Tornilleria S-1" y fijaciones para panel',0.18,'jgo',85,3],
        ['Perfacinta para tratamiento de juntas',1.5,'m',3,5],
        ['Compuesto Redimix para juntas y resanes',0.9,'kg',22,5]
      ],
      labor:[
        ['Tablaroquero oficial (suspension oculta hasta 4.00 m)',0.1,'jor',420,1.85],
        ['Ayudante instalador',0.1,'jor',285,1.82],
        ['Trazo, nivelacion y balanceado de colganteria',0.03,'jor',420,1.85],
        ['Tratamiento de juntas: perfacinta y Redimix',0.05,'jor',380,1.85],
        ['Limpieza y retiro de desperdicio',0.03,'jor',258,1.82]
      ],
      equipment:[
        ['Andamio de trabajo hasta 4.00 m de altura',0.06,'día',120],
        ['Herramienta electrica: rotomartillo y atornillador',0.04,'día',150],
        ['Equipo de seguridad personal',0.02,'día',90]
      ] },
    sello:{ unit:'ml',
      materials:[['Sellador elastomerico / silicon anti hongos',0.12,'cartucho',95,5],['Primer o limpiador de superficie',0.03,'L',85,3],['Cinta de respaldo o espuma de poliuretano',0.08,'m',18,5],['Material de limpieza y proteccion',0.03,'jgo',60,0]],
      labor:[['Oficial aplicador de sellos',0.035,'jor',380,1.85],['Ayudante',0.025,'jor',258,1.82],['Preparacion, limpieza y retiro',0.02,'jor',258,1.82]],
      equipment:[['Pistola calafateadora y herramienta menor',0.02,'día',60],['Escalera / andamio proporcional',0.02,'día',120]] },
    marmol_granito:{ unit:'m²',
      materials:[['Adhesivo flexible para piedra natural',0.22,'bulto',220,5],['Boquilla / resina de junta',0.28,'kg',85,5],['Anclajes, separadores y niveladores',0.12,'jgo',120,3],['Material de limpieza y proteccion',0.05,'jgo',90,0]],
      labor:[['Colocador especializado en marmol/granito',0.16,'jor',520,1.85],['Ayudante colocador',0.16,'jor',285,1.82],['Trazo, cortes y ajuste de piezas',0.06,'jor',520,1.85],['Limpieza final y proteccion',0.04,'jor',258,1.82]],
      equipment:[['Cortadora con disco diamantado',0.05,'día',180],['Pulidora / herramienta menor',0.04,'día',150],['Equipo de izaje o apoyo proporcional',0.02,'día',200]] },
    registro:{ unit:'pza',
      materials:[['Marco y tapa de registro segun medida especificada',1,'pza',480,3],['Canal / perfil galvanizado para soporte',1.2,'m',38,5],['Tornilleria, taquetes y fijaciones',0.12,'jgo',85,3],['Panel de cierre o placa de ajuste',0.35,'m²',210,5],['Pasta, cinta y resane perimetral',0.15,'kg',42,5],['Material de limpieza y proteccion',0.03,'jgo',60,0]],
      labor:[['Oficial instalador',0.18,'jor',420,1.85],['Ayudante instalador',0.18,'jor',285,1.82],['Trazo, nivelacion y ajuste de vano',0.04,'jor',420,1.85],['Resane y limpieza final',0.04,'jor',258,1.82]],
      equipment:[['Herramienta electrica de corte y fijacion',0.05,'día',150],['Escalera / andamio proporcional',0.03,'día',120],['Equipo de seguridad personal',0.02,'día',90]] },
    estructura_metalica:{ unit:'kg',
      materials:[['Acero estructural ASTM A500 Fy=46 KSI (incl. desperdicio)',1.05,'kg',46.5,0],['Soldadura E-7018 y consumibles de taller',0.03,'kg',120,0],['Primario anticorrosivo alquidálico de alta resistencia',0.02,'L',110,0],['Grout, anclajes y placas base proporcionales',0.015,'jgo',180,0]],
      labor:[['Cuadrilla de montadores y soldadores calificados',0.012,'jor',1650,1],['Trazo, plomeo y verificación de montaje',0.004,'jor',900,1],['Habilitado, limpieza y protección de soldadura',0.004,'jor',780,1]],
      equipment:[['Grúa / equipo de izaje proporcional',0.015,'hr',550],['Soldadora, extensiones y herramienta de montaje',0.018,'hr',180],['Herramienta menor y equipo de protección (EPP)',0.08,'(%MO)',19.8]] },
    concreto:{ unit:'m³',
      materials:[['Cemento gris CPC 30R',7,'bulto',225,3],['Arena',0.55,'m³',480,5],['Grava 19 mm',0.75,'m³',520,5],['Agua',0.18,'m³',65,0],['Curacreto / membrana de curado',0.12,'L',68,3],['Clavo y madera auxiliar para niveles',0.015,'jgo',180,5]],
      labor:[['Oficial albañil',0.22,'jor',380,1.85],['Ayudante / peón',0.22,'jor',258,1.82],['Cabo de obra',0.03,'jor',520,1.85],['Limpieza y curado',0.08,'jor',258,1.82]],
      equipment:[['Revolvedora 1 saco',0.25,'hr',95],['Vibrador de concreto',0.2,'hr',110],['Herramienta de nivelación',0.05,'día',90]] },
    acero:{ unit:'kg',
      materials:[['Acero de refuerzo fy=4200',1.05,'kg',26.5,2],['Alambre recocido cal. 18',0.03,'kg',32,3]],
      labor:[['Fierrero (oficial)',0.018,'jor',400,1.85],['Ayudante',0.018,'jor',258,1.82]],
      equipment:[['Cizalla / dobladora',0.01,'día',180]] },
    pintura:{ unit:'m²',
      materials:[['Pintura vinílica / acrílica según especificación',0.18,'L',85,5],['Sellador vinílico 5x1 / primario según sustrato',0.06,'L',70,5],['Diluyente / agua limpia para aplicación',0.02,'L',28,0],['Lija fina para preparación de superficie',0.08,'pza',18,0],['Cinta masking para cortes y remates',0.05,'rollo',42,0],['Plástico, cartón y protección de áreas',0.08,'m²',12,0],['Rodillo, brocha y charola proporcional',0.035,'jgo',145,0]],
      labor:[['Pintor oficial',0.055,'jor',360,1.85],['Ayudante de pintor',0.045,'jor',258,1.82],['Preparación, lavado ligero, lijado y limpieza de superficie',0.025,'jor',258,1.82],['Protección de áreas, cortes y limpieza final',0.02,'jor',258,1.82]],
      equipment:[['Andamio / escalera de trabajo',0.04,'día',120],['Herramienta de aplicación: extensiones, rodillos y brochas',0.025,'día',75],['Equipo de seguridad personal',0.015,'día',90]] },
    imper:{ unit:'m²',
      materials:[['Impermeabilizante acrílico',1.6,'L',78,5],['Membrana de refuerzo',0.3,'m²',22,5],['Sellador / primario',0.15,'L',60,5]],
      labor:[['Aplicador (oficial)',0.05,'jor',360,1.85],['Ayudante',0.05,'jor',258,1.82]],
      equipment:[['Equipo de aplicación',0.03,'día',90]] },
    aplanado:{ unit:'m²',
      materials:[['Cemento gris CPC 30R',0.09,'bulto',225,3],['Cal hidratada',0.04,'bulto',95,3],['Arena cernida',0.025,'m³',480,5],['Agua',0.012,'m³',65,0],['Sellador / aditivo de adherencia',0.04,'L',85,3],['Materiales misceláneos',0.03,'jgo',120,0],['Plástico y protección de áreas',0.04,'m²',12,5]],
      labor:[['Albañil (oficial)',0.18,'jor',380,1.85],['Peón',0.18,'jor',258,1.82],['Resanes, cortes y adecuaciones',0.08,'jor',380,1.85],['Limpieza, acarreos y retiro al término',0.06,'jor',258,1.82]],
      equipment:[['Andamio / regla',0.04,'día',120],['Herramienta menor especializada',0.03,'día',85],['Carretilla y equipo de acarreo',0.02,'día',75]] },
    piso:{ unit:'m²',
      materials:[['Loseta cerámica 30x30',1.05,'m²',135,8],['Adhesivo / pegazulejo',0.18,'bulto',135,5],['Boquilla / junteador',0.3,'kg',28,5]],
      labor:[['Colocador (oficial)',0.12,'jor',400,1.85],['Ayudante',0.12,'jor',258,1.82]],
      equipment:[['Cortadora de loseta',0.03,'día',150]] },
    excavacion:{ unit:'m³',
      materials:[],
      labor:[['Peón',0.6,'jor',258,1.82]],
      equipment:[['Herramienta de excavación',0.05,'día',60]] },
    block:{ unit:'m²',
      materials:[['Block hueco 15x20x40',12.5,'pza',16.5,3],['Cemento gris CPC 30R',0.16,'bulto',225,3],['Arena cernida',0.035,'m³',480,5],['Agua',0.012,'m³',65,0],['Alambre / plomeo / nivelación',0.015,'jgo',90,0],['Materiales misceláneos',0.02,'jgo',120,0]],
      labor:[['Albañil (oficial)',0.35,'jor',380,1.85],['Peón',0.35,'jor',258,1.82],['Trazo, plomeo y nivelación',0.04,'jor',380,1.85],['Acarreos internos y limpieza',0.05,'jor',258,1.82]],
      equipment:[['Andamio / equipo básico',0.05,'día',280],['Revolvedora 1 saco',0.04,'hr',95],['Herramienta de corte y ajuste',0.02,'día',90]] },
    bomba:{ unit:'pza',
      materials:[['Bomba centrifuga / sumergible segun especificacion',1,'pza',8500,0],['Base o soporte antivibratorio',1,'jgo',420,0],['Valvulas de conexion (check y compuerta)',2,'pza',380,0],['Conexiones electricas, cable y proteccion termica',1,'lote',650,0],['Accesorios de acople e instalacion',1,'jgo',280,3]],
      labor:[['Instalador electromecanico (oficial)',0.8,'jor',520,1.85],['Ayudante instalador',0.8,'jor',285,1.82],['Pruebas, arranque y ajuste de equipo',0.2,'jor',520,1.85]],
      equipment:[['Polipasto / equipo de izaje proporcional',0.15,'día',220],['Herramienta electrica y de conexion',0.1,'día',150],['Equipo de seguridad personal',0.05,'día',90]] },
    tuberia:{ unit:'m',
      materials:[['Tubo segun diametro y material especificado',1.05,'m',95,3],['Coples y conexiones proporcionales',0.3,'pza',45,3],['Pegamento / soldadura segun material de tuberia',0.06,'lote',85,0],['Soporteria y abrazaderas',0.25,'pza',38,3]],
      labor:[['Tubero / plomero (oficial)',0.09,'jor',400,1.85],['Ayudante',0.09,'jor',258,1.82],['Pruebas hidrostaticas y ajuste de juntas',0.02,'jor',400,1.85]],
      equipment:[['Herramienta de corte y union de tuberia',0.03,'día',110],['Equipo de prueba de presion',0.02,'día',150]] },
    generico:{ unit:'pza',
      materials:[['Insumo principal segun especificacion del concepto (revisar y ajustar)',1,'pza',0,0],['Materiales complementarios y de fijacion (revisar y ajustar)',1,'lote',0,0]],
      labor:[['Oficial (revisar cuadrilla segun concepto)',0.1,'jor',380,1.85],['Ayudante',0.1,'jor',258,1.82]],
      equipment:[['Herramienta menor y equipo de apoyo (revisar segun concepto)',0.05,'día',100]] }
  };
  const tpl = TPL[tipo];
  const normalizeApuRow = (r) => {
    const nr = [...r];
    nr[0] = cleanText(nr[0]);
    nr[2] = normalizeUnitLabel(nr[2]);
    return nr;
  };
  const useCat = (arr) => arr.map(r=>{
    const m = matchPrice(r[0],catalog);
    const nr = normalizeApuRow(r);
    if(m){
      nr[3]=m.precio;
      if(m.unidad) nr[2]=normalizeUnitLabel(m.unidad);
    }
    return nr;
  });
  const materials = useCat(tpl.materials);
  const labor = tpl.labor.map(normalizeApuRow);
  const equipment = tpl.equipment.map(normalizeApuRow);
  if(/calafate|sellado|junta/.test(t)) materials.push(normalizeApuRow(['Calafateo / sellador de juntas',0.08,'L',95,5]));
  if(/resane|adecuacion|adecuaci[oó]n|corte|elevaci[oó]n/.test(t)) labor.push(['Cortes, elevaciones, resanes y adecuaciones',0.07,'jor',380,1.85]);
  if(/retiro|limpieza|termino|t[eé]rmino/.test(t)) labor.push(['Retiro al término, limpieza fina y carga manual',0.06,'jor',258,1.82]);
  if(/acarreo|acarreos/.test(t)) equipment.push(['Equipo menor para acarreos internos',0.04,'día',110]);
  const standardClave = 'APU-' + stableHash(c);
  const TPL_META = {
    plafon_suspendido:{ confidence:88, sat:'72152400' },
    pintura:{ confidence:88, sat:'72151300' },
    lavabo_ptr:{ confidence:98, sat:'72101500' },
    estructura_metalica:{ confidence:97, sat:'72101700' },
    bomba:{ confidence:90, sat:'40101700' },
    tuberia:{ confidence:88, sat:'72101507' },
    generico:{ confidence:45, sat:'72100000' }
  };
  const meta = { family: APU_FAMILY_LABELS[tipo] || tipo, confidence: TPL_META[tipo]?.confidence ?? 88, sat: TPL_META[tipo]?.sat ?? '72100000' };
  return {
    id:standardClave, clave:standardClave, concept:cleanText(c), unit:normalizeUnitLabel(tpl.unit), templateGenerated:true,
    materials, labor, equipment,
    herramienta:APU_STANDARD_FACTORS.herramienta, indCampo:APU_STANDARD_FACTORS.indCampo, indOficina:APU_STANDARD_FACTORS.indOficina, finance:APU_STANDARD_FACTORS.finance, utility:APU_STANDARD_FACTORS.utility, cargos:APU_STANDARD_FACTORS.cargos, iva:APU_STANDARD_FACTORS.iva,
    family: meta.family,
    confidence: meta.confidence,
    sat: meta.sat,
    aiNotes: unmatched ? ['No se identifico con precision el tipo de concepto: revisa y ajusta materiales, mano de obra y unidad antes de usar este APU.'] : [],
    date:new Date().toLocaleDateString('es-MX')
  };
}

function rowImporte(kind, r){
  const cant = Number(r[1])||0;
  if(kind==='materials') return cant * (Number(r[3])||0) * (1 + (Number(r[4])||0)/100);
  if(kind==='labor')     return cant * (Number(r[3])||0) * (Number(r[4])||0); // jornadas × salarioBase × FSR
  return cant * (Number(r[3])||0); // equipo: cantidad × costo horario
}

function calcAPU(apu){
  const sumKind = (kind)=> (apu[kind]||[]).reduce((a,r)=>a+rowImporte(kind,r),0);
  const mat = sumKind('materials');
  const mo  = sumKind('labor');
  const equipo = sumKind('equipment');
  const herramienta = mo * (Number(apu.herramienta)||0)/100;     // % de mano de obra
  const direct = mat + mo + equipo + herramienta;                // Costo Directo
  const indPct = (Number(apu.indCampo)||0) + (Number(apu.indOficina)||0);
  const indirect = direct * indPct/100;                          // Indirectos (campo + oficina)
  const finance  = (direct + indirect) * (Number(apu.finance)||0)/100;
  const utility  = (direct + indirect + finance) * (Number(apu.utility)||0)/100;
  const cargos   = (direct + indirect + finance + utility) * (Number(apu.cargos)||0)/100;
  const pu = direct + indirect + finance + utility + cargos;     // Precio Unitario (P.U.O.T., sin IVA)
  const iva = pu * (Number(apu.iva)||0)/100;
  return { mat, mo, equipo, herramienta, direct, indirect, finance, utility, cargos, pu, iva, total: pu };
}
function auditSource(apu, kind, row){
  const desc = String(row?.[0] || '').toLowerCase();
  const market = apu.marketSources?.[String(row?.[0] || '').trim()];
  if(market) return `Precio de mercado (${market.date}): ${market.source}${market.url ? ' | ' + market.url : ''}`;
  if(apu.templateGenerated && apu.sourceFile) return `Plantilla ZOEMEC | partida de: ${apu.sourceFile}`;
  if(apu.templateGenerated) return 'Plantilla ZOEMEC / revisar precios';
  if(apu.sourceFile) return `Excel completo: ${apu.sourceFile}`;
  if(apu.referencePU) return 'Concepto importado con P.U. de referencia';
  if(desc.includes('nuevo ')) return 'Usuario';
  if(Number(apu.confidence || 0) >= 92) return 'IA ZOEMEC validada';
  return 'IA ZOEMEC / revisar';
}
function auditFormula(kind, row){
  if(kind === 'materials') return 'Cantidad x P. base x (1 + Merma %)';
  if(kind === 'labor') return 'Jornadas x Salario base x FSR';
  return 'Cantidad x Costo horario';
}
function auditRow(kind, row, index, apu){
  const prefix = kind === 'materials' ? 'MAT' : kind === 'labor' ? 'MO' : 'EQ';
  const qty = Number(row?.[1]) || 0;
  const unit = String(row?.[2] || '');
  const base = Number(row?.[3]) || 0;
  const factor = kind === 'materials' ? Number(row?.[4] || 0) : kind === 'labor' ? Number(row?.[4] || 1) : 0;
  const importe = rowImporte(kind, row);
  const rendimiento = qty > 0 ? `${num(1 / qty)} ${apu.unit || 'u'} / ${unit || 'insumo'}` : 'Sin rendimiento';
  const detalle = kind === 'materials'
    ? `${num(qty)} x ${money(base)} x (1 + ${num(factor)}%) = ${money(importe)}`
    : kind === 'labor'
    ? `${num(qty)} x ${money(base)} x ${num(factor)} = ${money(importe)}`
    : `${num(qty)} x ${money(base)} = ${money(importe)}`;
  return {
    kind,
    code: `${prefix}-${String(index+1).padStart(3,'0')}`,
    desc: String(row?.[0] || ''),
    qty,
    unit,
    base,
    factor,
    importe,
    formula: auditFormula(kind, row),
    detalle,
    rendimiento,
    source: auditSource(apu, kind, row),
    confidence: Number(apu.confidence || 88),
    notes: kind === 'labor' ? 'Salario real = salario base x FSR' : kind === 'materials' ? 'Incluye merma cuando aplica' : 'Costo horario o cargo proporcional'
  };
}
function buildAuditModel(apu, totals){
  const materials = (apu.materials || []).map((r,i)=>auditRow('materials', r, i, apu));
  const labor = (apu.labor || []).map((r,i)=>auditRow('labor', r, i, apu));
  const equipment = (apu.equipment || []).map((r,i)=>auditRow('equipment', r, i, apu));
  const all = [...materials, ...labor, ...equipment];
  const explosion = materials.map(r => ({
    code:r.code,
    desc:r.desc,
    unit:r.unit,
    qtyUnit:r.qty,
    qtyTotal:(Number(apu.sourceQty || 1) || 1) * r.qty,
    pu:r.base,
    importeTotal:(Number(apu.sourceQty || 1) || 1) * r.importe,
    source:r.source
  }));
  const formulas = [
    ['Materiales', 'SUMA(Cantidad x P. base x (1 + Merma %))', totals.mat],
    ['Mano de obra', 'SUMA(Jornadas x Salario base x FSR)', totals.mo],
    ['Equipo / maquinaria', 'SUMA(Cantidad x Costo horario)', totals.equipo],
    ['Herramienta menor', `Mano de obra x ${num(apu.herramienta)}%`, totals.herramienta],
    ['Costo directo', 'Materiales + Mano de obra + Equipo + Herramienta menor', totals.direct],
    ['Indirectos', `Costo directo x (${num(apu.indCampo)}% campo + ${num(apu.indOficina)}% oficina)`, totals.indirect],
    ['Financiamiento', `(Costo directo + indirectos) x ${num(apu.finance)}%`, totals.finance],
    ['Utilidad', `(Costo directo + indirectos + financiamiento) x ${num(apu.utility)}%`, totals.utility],
    ['Cargos adicionales', `Subtotal x ${num(apu.cargos)}%`, totals.cargos],
    ['Precio unitario sin IVA', 'Costo directo + indirectos + financiamiento + utilidad + cargos', totals.pu],
    ['IVA informativo', `Precio unitario x ${num(apu.iva)}%`, totals.iva]
  ];
  return { materials, labor, equipment, all, explosion, formulas };
}
function normalizeAIAPU(raw, fallbackConcept){
  const text = (v, fallback='') => String(v ?? fallback).trim();
  const numeric = (v, fallback=0) => {
    const n = Number(String(v ?? '').replace(/[^0-9.\-]/g,''));
    return Number.isFinite(n) ? n : fallback;
  };
  const cleanRows = (rows, defaults) => Array.isArray(rows)
    ? rows.map(r => defaults.map((d,i)=> (i===0 || i===2) ? text(r?.[i], d) : numeric(r?.[i], d)))
    : [];
  return {
    id:'APU-'+uid(),
    clave:'APU-'+uid().slice(0,4),
    concept: text(raw.concept, fallbackConcept),
    unit: text(raw.unit || 'pza').replace('m2','m²').replace('m3','m³'),
    materials: cleanRows(raw.materials, ['Material',1,'pza',0,0]),
    labor: cleanRows(raw.labor, ['Mano de obra',0.01,'jor',0,1]),
    equipment: cleanRows(raw.equipment, ['Equipo',0,'hr',0]),
    herramienta: Number(raw.herramienta ?? 3),
    indCampo: Number(raw.indCampo ?? 5),
    indOficina: Number(raw.indOficina ?? 5),
    finance: Number(raw.finance ?? 1),
    utility: Number(raw.utility ?? 12),
    cargos: Number(raw.cargos ?? 0),
    iva: Number(raw.iva ?? 16),
    family: raw.family || 'APU generado con IA',
    confidence: Number(raw.confidence || 92),
    sat: raw.sat || '72100000',
    aiNotes: Array.isArray(raw.notes) ? raw.notes : [],
    date:new Date().toLocaleDateString('es-MX')
  };
}
function makeEmptyAPU(){
  return {
    id:'APU-'+uid(),
    clave:'APU-'+uid(),
    concept:'',
    unit:'m²',
    materials:[],
    labor:[],
    equipment:[],
    herramienta:0,
    indCampo:0,
    indOficina:0,
    finance:0,
    utility:0,
    cargos:0,
    iva:16,
    family:'pendiente',
    confidence:0,
    sat:'',
    aiNotes:[]
  };
}
function aiServerUrl(path=''){ return path; }

function APU({company,user,usage,setUsage,apus,setApus,budgets,setBudgets,catalog,setCatalog}){
  const [concept,setConcept]=useState('');
  const [apu,setApu]=useState(()=>makeEmptyAPU());
  const [aiOpen,setAiOpen]=useState(false);
  const [excelInfo,setExcelInfo]=useState(null);
  const [aiStatus,setAiStatus]=useState('');
  const [conceptBatch,setConceptBatch]=useState(null);
  const [batchAPUs,setBatchAPUs]=useState([]);
  const [batchBusy,setBatchBusy]=useState(false);
  const priceCatalogInputRef = useRef(null);
  const fullExcelInputRef = useRef(null);
  const conceptCatalogInputRef = useRef(null);
  const mainExcelInputRef = useRef(null);
  const clearFileInputs = () => [priceCatalogInputRef, fullExcelInputRef, conceptCatalogInputRef, mainExcelInputRef].forEach(ref => { if(ref.current) ref.current.value = ''; });
  const resetAPUForm = () => {
    clearFileInputs();
    setConcept('');
    setApu(makeEmptyAPU());
    setAiOpen(false);
    setExcelInfo(null);
    setConceptBatch(null);
    setBatchAPUs([]);
    setAiStatus('');
    setBatchBusy(false);
  };
  const totals=calcAPU(apu);
  const userUsage = usage?.[user?.email] || {apusCreated:0};
  const isFree = user?.role !== 'admin' && (user?.plan || 'Gratis') === 'Gratis';
  const requireApuAccess = () => {
    if(canUse(user, 'apu', userUsage.apusCreated)) return true;
    alert('Tu APU gratis ya fue usado. Para generar, guardar y exportar mas APUs activa un plan.');
    return false;
  };

  const updateRow=(kind,i,k,v)=>setApu({...apu,[kind]:apu[kind].map((r,idx)=>idx===i?r.map((x,j)=>j===k?v:x):r)});
  const [priceBusy,setPriceBusy]=useState(null);
  const marketPrice=async(kind,i)=>{
    const r = apu[kind]?.[i];
    if(!r) return;
    const desc = String(r[0]||'').trim();
    if(!desc){ alert('Escribe la descripcion del insumo antes de consultar el precio.'); return; }
    setPriceBusy(`${kind}-${i}`);
    try{
      const res = await fetch('/api/market-price',{
        method:'POST',
        headers:await authHeaders(),
        body:JSON.stringify({description:desc,unit:r[2]||'',kind})
      });
      const data = await res.json();
      if(!res.ok) throw new Error(data?.error||'No se pudo consultar el precio.');
      const q = data.quote||{};
      const nuevoPrecio = Number(q.price)||0;
      if(!(nuevoPrecio>0)) throw new Error('La busqueda no encontro un precio confiable.');
      const registro = {
        price:nuevoPrecio, min:Number(q.priceMin)||nuevoPrecio, max:Number(q.priceMax)||nuevoPrecio,
        source:q.source||'Busqueda web', url:q.url||'', date:q.date||new Date().toLocaleDateString('es-MX'),
        notes:q.notes||'', unit:r[2]||''
      };
      saveMarketPrice(desc, registro);
      setApu(prev=>({
        ...prev,
        [kind]: prev[kind].map((row,idx)=>idx===i?row.map((x,j)=>j===3?nuevoPrecio:x):row),
        marketSources:{...(prev.marketSources||{}),[desc]:registro}
      }));
      alert(`Precio de mercado aplicado: $${nuevoPrecio.toFixed(2)} MXN por ${r[2]||'unidad'}\nRango: $${(Number(q.priceMin)||nuevoPrecio).toFixed(2)} - $${(Number(q.priceMax)||nuevoPrecio).toFixed(2)}\nFuente: ${q.source||'busqueda web'}${q.url?`\n${q.url}`:''}${q.notes?`\nNota: ${q.notes}`:''}`);
    }catch(err){
      alert(`No pude consultar el precio de mercado: ${friendlyServiceError(err,'error de conexion')}`);
    }finally{
      setPriceBusy(null);
    }
  };
  const addRow=(kind)=>{
    const blank = kind==='materials' ? ['Nuevo material',1,'pza',0,0] : kind==='labor' ? ['Nuevo oficio',0,'jor',0,1.85] : ['Nuevo equipo',0,'hr',0];
    setApu({...apu,[kind]:[...apu[kind],blank]});
  };
  const removeRow=(kind,i)=>setApu({...apu,[kind]:apu[kind].filter((_,idx)=>idx!==i)});
  const setParam=(k,v)=>setApu({...apu,[k]:v});
  const generate=()=>{
    if(!requireApuAccess()) return;
    if(!concept.trim()){ alert('Pega o sube un concepto real para generar el APU.'); return; }
    const parsed=parseConceptText(concept);
    const next=standardAPUForConcept({concept:parsed.concept, unit:parsed.unit, qty:parsed.qty, referencePU:parsed.referencePU}, catalog, 0, 'Texto pegado');
    setConcept(parsed.concept);
    setApu(next);
    setExcelInfo(parsed.referencePU ? {fileName:'Texto pegado',concept:parsed.concept,unit:next.unit,qty:parsed.qty,referencePU:parsed.referencePU,catalog:[]} : null);
    setAiStatus('APU estandarizado desde catalogo base ZOEMEC.');
  };
  const [aiBusy,setAiBusy]=useState(false);
  const generateAI=async()=>{
    if(!requireApuAccess()) return;
    if(!concept.trim()){ alert('Pega o sube un concepto real para generar con IA.'); return; }
    if(aiBusy) return;
    setAiBusy(true);
    setAiStatus('Analizando el concepto...');
    const parsed=parseConceptText(concept);
    const controller=new AbortController();
    const timer=window.setTimeout(()=>controller.abort(), 30000);
    try{
      setAiStatus('Consultando biblioteca y catálogo de precios...');
      const res=await fetch(aiServerUrl('/api/generate-apu'),{
        method:'POST',
        headers:await authHeaders(),
        body:JSON.stringify({concept:parsed.concept,catalog}),
        signal:controller.signal
      });
      const data=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data?.error || 'No se pudo generar con IA.');
      setAiStatus('Generando matriz APU...');
      const aiDraft=normalizeAIAPU(data.apu, parsed.concept);
      const next=finalizeAIAPU(aiDraft, {concept:parsed.concept, unit:parsed.unit || aiDraft.unit, qty:parsed.qty, referencePU:parsed.referencePU}, 0, 'OpenAI API');
      setAiStatus('Validando resultados y aplicando precios de catálogo...');
      setConcept(next.concept);
      setApu(next);
      setExcelInfo({fileName:'OpenAI API',concept:next.concept,unit:next.unit,qty:parsed.qty,referencePU:parsed.referencePU,catalog});
      setAiStatus(`IA lista: ${next.family} (${next.confidence}%)`);
      setAiOpen(false);
    }catch(err){
      const reason = err?.name==='AbortError' ? 'la IA tardo demasiado en responder' : friendlyServiceError(err,'servidor no disponible');
      const next = templateFallbackAPU({concept:parsed.concept, unit:parsed.unit, qty:parsed.qty, referencePU:parsed.referencePU}, catalog, 0, 'Plantilla tecnica ZOEMEC', reason);
      setConcept(next.concept);
      setApu(next);
      setExcelInfo({fileName:'Plantilla tecnica ZOEMEC',concept:next.concept,unit:next.unit,qty:parsed.qty,referencePU:parsed.referencePU,catalog});
      setAiStatus(`Plantilla tecnica aplicada (IA no disponible): ${next.family}`);
      setAiOpen(false);
    }finally{
      window.clearTimeout(timer);
      setAiBusy(false);
    }
  };
  const importExcel=async(file)=>{ if(!file) return; if(/\.xls$/i.test(file.name)){alert('Este lector trabaja con .xlsx o .csv. Abre tu archivo en Excel y guárdalo como .xlsx.');return;} try{ const cat=await parseExcelToCatalog(file); if(!cat.length){alert('No detecté columnas de descripción y precio en el Excel. Revisa que tenga encabezados como "Descripción" y "Precio".');return;} setCatalog(cat); alert(`Catálogo importado: ${cat.length} insumos con precio. Al generar el APU usaré tus precios reales cuando coincidan.`); }catch(err){ alert(`No pude leer el archivo: ${err?.message || 'formato no compatible'}. Usa .xlsx o .csv.`); } };
  const importFullExcel=async(file)=>{
    if(!file) return;
    if(/\.xls$/i.test(file.name)){
      alert('Ese archivo parece .xls antiguo. Guárdalo como .xlsx desde Excel y vuelve a subirlo.');
      return;
    }
    try{
      const batch = await parseRobustConceptCatalog(file);
      if(batch.concepts.length > 0){
        setConceptBatch(batch);
        const first = batch.concepts[0];
        const next = standardAPUForConcept(first, catalog, 0, batch.fileName);
        setConcept(first.concept);
        setApu(next);
        setExcelInfo({fileName:batch.fileName, concept:first.concept, unit:first.unit, qty:first.qty, referencePU:first.referencePU, catalog});
        setAiStatus(batch.concepts.length > 1
          ? `Excel completo leído: ${batch.concepts.length} conceptos. Cada concepto se desarrollará con IA y se exportará en su propia hoja.`
          : 'Concepto leído desde Excel. Puedes generar el APU y exportarlo con formato.');
        setAiOpen(true);
        return;
      }
    }catch(_batchErr){
      // Si no es presupuesto/catalogo de conceptos, intenta leerlo como un solo APU.
    }
    try{
      const data=await parseExcelToAPU(file,catalog);
      setCatalog(data.mergedCatalog);
      setConcept(data.concept);
      const next=standardAPUForConcept({concept:data.concept, unit:data.unit, qty:data.qty, referencePU:data.referencePU}, data.mergedCatalog, 0, data.fileName);
      setApu(next);
      setExcelInfo(data);
      setAiOpen(true);
    }catch(err){
      alert(`No pude leer el Excel completo: ${err?.message || 'formato no compatible'}. Usa .xlsx o .csv, o pega el renglón del concepto y presiona Actualizar desarrollo.`);
    }
  };
  const importConceptCatalog=async(file)=>{
    if(!file) return;
    if(/\.xls$/i.test(file.name)){
      alert('Guarda el archivo como .xlsx o .csv para poder leer todos los conceptos.');
      return;
    }
    try{
      const data = await parseRobustConceptCatalog(file);
      setConceptBatch(data);
      const first = data.concepts[0];
      if(first){
        const next = standardAPUForConcept(first, catalog, 0, data.fileName);
        setConcept(first.concept);
        setApu(next);
        setExcelInfo({fileName:data.fileName, concept:first.concept, unit:first.unit, qty:first.qty, referencePU:first.referencePU, catalog});
      }
      setAiStatus(`Catálogo leído: ${data.concepts.length} conceptos. Excel por concepto usará IA real por cada hoja.`);
      setAiOpen(true);
    }catch(err){
      alert(`No pude leer la lista de conceptos: ${err?.message || 'formato no compatible'}. Revisa que tenga columnas Codigo, Concepto, Unidad, Cantidad y P.U.`);
    }
  };
  const generateBatchAPU=async(item, index)=>{
    const conceptForAI = [
      item.code ? `Clave: ${item.code}` : '',
      `Concepto: ${item.concept}`,
      `Unidad: ${item.unit}`,
      item.referencePU ? `PU base de Excel: ${money(item.referencePU)}` : '',
      item.section ? `Partida: ${item.section}` : ''
    ].filter(Boolean).join('\n');
    /* Un intento = una llamada con su propio timeout de 45 s (el reloj arranca
       cuando la petición sale de verdad, ya no mientras espera en cola). */
    const attempt = async () => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 45000);
      try{
        const res=await fetch(aiServerUrl('/api/generate-apu'),{method:'POST',headers:await authHeaders(),body:JSON.stringify({concept:conceptForAI,catalog,company,mode:'batch-concept',preserveOriginal:true}),signal:controller.signal});
        const data=await res.json();
        if(!res.ok){ const err=new Error(data?.error || 'No fue posible generar con IA'); err.status=res.status; throw err; }
        return data;
      }finally{
        window.clearTimeout(timer);
      }
    };
    let data=null, lastError=null;
    for(let tryNum=0; tryNum<2 && !data; tryNum++){
      try{
        if(tryNum>0) await new Promise(r=>setTimeout(r, 2500)); // espera antes de reintentar (429/red)
        data = await attempt();
      }catch(error){ lastError = error; }
    }
    if(data){
      const aiDraft=normalizeAIAPU(data.apu, item.concept);
      return finalizeAIAPU(aiDraft, item, index, conceptBatch?.fileName || 'Catalogo de conceptos');
    }
    const reason = lastError?.name === 'AbortError' ? 'tiempo agotado' : (lastError?.message || 'sin detalle');
    return templateFallbackAPU(item, catalog, index, conceptBatch?.fileName || 'Catalogo de conceptos', `IA externa no respondio tras 2 intentos: ${reason}`);
  };

  /* Procesa la lista en una cola con máximo N llamadas simultáneas.
     Evita saturar el navegador, Vercel y los límites de OpenAI. */
  const mapWithConcurrency=async(items, worker, limit, onProgress)=>{
    const out=new Array(items.length);
    let next=0, done=0;
    const lane=async()=>{
      while(next<items.length){
        const i=next++;
        out[i]=await worker(items[i], i);
        done++; onProgress?.(done, items.length);
      }
    };
    await Promise.all(Array.from({length:Math.min(limit, items.length)}, lane));
    return out;
  };

  const buildBatchAPUs=async(list)=>{
    setAiStatus(`Validando repetidos y estandarizando ${list.length} conceptos.`);
    const groups = new Map();
    list.forEach((item, index) => {
      const key = conceptApuKey(item);
      if(!groups.has(key)) groups.set(key, {item, index, count:0});
      groups.get(key).count += 1;
    });
    setAiStatus(`IA trabajando en ${groups.size} conceptos únicos (4 a la vez). Repetidos reutilizan el mismo APU y P.U.`);
    const groupList = [...groups.values()];
    const generated = await mapWithConcurrency(
      groupList,
      (group) => generateBatchAPU(group.item, group.index),
      4,
      (done, total) => setAiStatus(`IA desarrollando APUs: ${done} de ${total} conceptos únicos...`)
    );
    const byKey = new Map(generated.map((apu, index) => [conceptApuKey(groupList[index].item), apu]));
    const out = list.map((item, index) => applyConceptMetadata(byKey.get(conceptApuKey(item)), item, index, conceptBatch?.fileName || 'Catalogo de conceptos'));
    const repeated = list.length - groups.size;
    setBatchAPUs(out);
    const first=out[0];
    setApu(first);
    setConcept(first.concept);
    setAiStatus(`Desarrollo listo: ${out.length} conceptos (${groups.size} únicos, ${repeated} repetidos reutilizados).`);
    return out;
  };

  const exportConceptBatch=async()=>{
    if(!conceptBatch?.concepts?.length){
      alert('Primero sube el catálogo de conceptos.');
      return;
    }
    if(batchBusy) return;
    const list = conceptBatch.concepts.filter(isExportableConceptItem);
    if(!list.length){
      alert('No hay conceptos válidos para exportar.');
      return;
    }
    setBatchBusy(true);
    try{
      const apuList = await buildBatchAPUs(list);
      await exportConceptsAPUWorkbook(list, catalog, company, apuList);
      setAiStatus(`Excel generado: ${list.length} conceptos, una hoja APU por concepto.`);
    }catch(error){
      alert(`No pude descargar el Excel por concepto: ${error?.message || 'error desconocido'}.`);
    }finally{
      setBatchBusy(false);
    }
  };
  const exportConceptBatchPDF=async()=>{
    if(!conceptBatch?.concepts?.length){
      alert('Primero sube el catalogo de conceptos.');
      return;
    }
    if(batchBusy) return;
    const list = conceptBatch.concepts.filter(isExportableConceptItem);
    if(!list.length){
      alert('No hay conceptos válidos para exportar.');
      return;
    }
    setBatchBusy(true);
    try{
      const apuList = await buildBatchAPUs(list);
      exportConceptsAPUPDF(list, catalog, company, apuList);
      setAiStatus(`PDF generado: ${list.length} conceptos, un APU por concepto.`);
    }catch(error){
      alert(`No pude descargar el PDF por concepto: ${error?.message || 'error desconocido'}.`);
    }finally{
      setBatchBusy(false);
    }
  };
  const markApuUsed=()=>{
    if(user?.role === 'admin') return;
    const nextCount = (userUsage.apusCreated||0)+1;
    setUsage({...usage,[user.email]:{...userUsage,apusCreated:nextCount,deviceId:user.deviceId}});
    if(firebaseReady && user?.uid){
      setDoc(doc(db, 'users', user.uid), { apusCreated:nextCount, updatedAt:serverTimestamp() }, { merge:true }).catch(console.error);
    }
  };
  const save=()=>{ if(!requireApuAccess()) return; setApus([apu,...apus.filter(x=>x.id!==apu.id)]); markApuUsed(); alert('APU guardado');};
  const addBudget=()=>{ if(!requireApuAccess()) return; setBudgets([{id:'PRE-'+uid(), name:'Presupuesto desde APU', client:'Cliente por definir', items:[{concept:apu.concept, unit:apu.unit, qty:1, pu:totals.pu}], total:totals.pu, date:new Date().toLocaleDateString('es-MX')},...budgets]); markApuUsed(); alert('Agregado a presupuestos (PU sin IVA)');};
  const hasConceptBatch = (conceptBatch?.concepts || []).filter(isExportableConceptItem).length > 1;
  const [exportBusy,setExportBusy]=useState(false);
  const exportPDF=async()=>{
    if(!hasConceptBatch && isFree && userUsage.apusCreated>=1){ alert('La exportacion ilimitada requiere plan activo.'); return; }
    setExportBusy(true);
    try{ hasConceptBatch ? await exportConceptBatchPDF() : exportAPUPDFPro(apu,totals,company); }
    finally{ setExportBusy(false); }
    if(isFree && !hasConceptBatch) markApuUsed();
  };
  const exportExcel=async()=>{
    if(!hasConceptBatch && isFree && userUsage.apusCreated>=1){ alert('La exportacion ilimitada requiere plan activo.'); return; }
    setExportBusy(true);
    try{ if(hasConceptBatch) await exportConceptBatch(); else await exportAPUExcel(apu,totals,company); }
    finally{ setExportBusy(false); }
    if(isFree && !hasConceptBatch) markApuUsed();
  };

  return <section><PageHead kicker="APU Inteligente" title="Análisis de Precio Unitario" desc="Metodología RLOPSRM: salario real con FSR, herramienta menor sobre mano de obra, indirectos de campo y oficina, financiamiento, utilidad y cargos adicionales." action={<div className="head-actions"><button className="secondary" onClick={generate}>Generar desarrollo</button><button className="ai-btn" onClick={()=>setAiOpen(o=>!o)}><Icon name="apu" size={17}/> Generar con IA</button></div>} />
    {isFree && <div className="trial-banner"><b>Plan gratis activo:</b> tienes {Math.max(0,1-(userUsage.apusCreated||0))} APU disponible. Para exportar y crear mas APUs activa un plan.</div>}
    {aiOpen && <div className="panel ai-panel">
      <div className="ai-panel-head"><HardHat size={36}/><div><b>Generar con IA</b><small className="muted">Pega tu concepto y/o importa tu Excel de precios. Usaré tus precios reales donde coincidan los insumos.</small></div></div>
      <textarea className="ai-concept" value={concept} onChange={e=>setConcept(e.target.value)} placeholder="Pega aquí el concepto, ej. Muro de tabique rojo recocido asentado con mortero…"/>
      <div className="ai-panel-foot">
        <label className="up-btn ghost-up">Importar catálogo de precios<input ref={priceCatalogInputRef} type="file" accept=".xlsx,.csv" hidden onChange={e=>importExcel(e.target.files[0])}/></label>
        <label className="up-btn">Generar desde Excel completo<input ref={fullExcelInputRef} type="file" accept=".xlsx,.csv" hidden onChange={e=>importFullExcel(e.target.files[0])}/></label>
        <label className="up-btn ghost-up">Subir catálogo de conceptos<input ref={conceptCatalogInputRef} type="file" accept=".xlsx,.csv" hidden onChange={e=>importConceptCatalog(e.target.files[0])}/></label>
        {catalog.length>0 && <span className="cat-badge"><Icon name="presupuestos" size={14}/> Catálogo: {catalog.length} insumos</span>}
        <button onClick={generateAI} disabled={aiBusy}>{aiBusy?'Generando...':'Generar APU con IA real'}</button><button className="soft" type="button" onClick={resetAPUForm}>Limpiar</button>
        {conceptBatch?.concepts?.length>0 && <button onClick={exportConceptBatch} disabled={batchBusy}>{batchBusy?'Generando con IA...':`Descargar Excel: ${conceptBatch.concepts.length} hojas APU`}</button>}
        {conceptBatch?.concepts?.length>0 && <button onClick={exportConceptBatchPDF}>Descargar PDF: {conceptBatch.concepts.length} APUs</button>}
      </div>
      {aiStatus && <div className={'ai-note'+(aiBusy?' ai-note-busy':'')}>{aiBusy && <span className="asst-dots"><i/><i/><i/></span>}<b>{aiStatus}</b></div>}
      {excelInfo && <div className="excel-preview">
        <div><small>Archivo</small><b>{excelInfo.fileName}</b></div>
        <div><small>Concepto detectado</small><b>{excelInfo.concept}</b></div>
        <div><small>Unidad / cantidad</small><b>{excelInfo.unit} - {num(excelInfo.qty)}</b></div>
        <div><small>P.U. referencia</small><b>{excelInfo.referencePU ? money(excelInfo.referencePU) : 'No detectado'}</b></div>
      </div>}
      <div className="ai-note">El desarrollo se arma con tus precios importados, matrices base y metodologia ZOEMEC. La IA real se ejecuta por endpoints seguros en Vercel.</div>
    </div>}
    <div className="apu-grid">
      <div className="panel">
        <label>Concepto</label>
        <textarea value={concept} onChange={e=>setConcept(e.target.value)} />
        <div className="inline-tools">
          <label className="up-btn ghost-up">Subir Excel completo<input ref={mainExcelInputRef} type="file" accept=".xlsx,.csv" hidden onChange={e=>importFullExcel(e.target.files[0])}/></label>
          <button className="soft" onClick={generate}>Actualizar desarrollo</button>
          <button className="soft" onClick={generateAI} disabled={aiBusy}>{aiBusy?'Generando...':'IA real'}</button><button className="soft" type="button" onClick={resetAPUForm}>Limpiar</button>
          {apu.referencePU>0 && <span className="cat-badge">P.U. Excel: {money(apu.referencePU)}</span>}
          {conceptBatch?.concepts?.length>0 && <button className="soft" onClick={exportConceptBatch} disabled={batchBusy}>{batchBusy?'IA generando hojas...':`Excel por concepto (${conceptBatch.concepts.length})`}</button>}
          {conceptBatch?.concepts?.length>0 && <button className="soft" onClick={exportConceptBatchPDF}>PDF por concepto ({conceptBatch.concepts.length})</button>}
        </div>
        <div className="apu-detect">
          <div><small>Familia detectada</small><b>{apu.family || 'APU general'}</b></div>
          <div><small>Confianza IA</small><b>{apu.confidence || 88}%</b></div>
          <div><small>Clave SAT sugerida</small><b>{apu.sat || '72100000'}</b></div>
          <div><small>Origen</small><b>{apu.templateFallback ? 'Plantilla tecnica' : apu.aiGenerated ? 'IA real (OpenAI)' : 'Matriz base ZOEMEC'}</b></div>
        </div>
        {apu.templateFallback && <div className="fallback-banner"><b>Plantilla tecnica aplicada:</b> el servicio de IA no esta disponible en este momento. Esta matriz usa el catalogo base ZOEMEC editable (no son datos inventados); vuelve a intentar en unos minutos para un desarrollo a la medida del concepto.</div>}
        {apu.aiNotes?.length>0 && <div className="ai-decisions">{apu.aiNotes.map((n,i)=><span key={i}>{n}</span>)}</div>}
        <div className="form-row"><input value={apu.clave} onChange={e=>setApu({...apu,clave:e.target.value})} placeholder="Clave"/><input value={apu.unit} onChange={e=>setApu({...apu,unit:e.target.value})} placeholder="Unidad"/></div>

        <h2>Materiales <small className="hint">(incluye merma % puesto en obra)</small></h2>
        <MatrixTable kind="materials" rows={apu.materials} updateRow={updateRow} removeRow={removeRow} onMarketPrice={marketPrice} priceBusy={priceBusy}/>
        <button className="soft" onClick={()=>addRow('materials')}>+ Material</button>

        <h2>Mano de obra <small className="hint">(salario real = base x FSR - Art. 191)</small></h2>
        <MatrixTable kind="labor" rows={apu.labor} updateRow={updateRow} removeRow={removeRow} onMarketPrice={marketPrice} priceBusy={priceBusy}/>
        <button className="soft" onClick={()=>addRow('labor')}>+ Oficio</button>

        <h2>Equipo / maquinaria <small className="hint">(costo horario × cantidad)</small></h2>
        <MatrixTable kind="equipment" rows={apu.equipment} updateRow={updateRow} removeRow={removeRow} onMarketPrice={marketPrice} priceBusy={priceBusy}/>
        <button className="soft" onClick={()=>addRow('equipment')}>+ Equipo</button>

        <h2>Sobrecostos (%)</h2>
        <div className="params-grid">
          <Param label="Herramienta menor (% M.O.)" v={apu.herramienta} on={v=>setParam('herramienta',v)}/>
          <Param label="Indirectos de campo (%)" v={apu.indCampo} on={v=>setParam('indCampo',v)}/>
          <Param label="Indirectos de oficina (%)" v={apu.indOficina} on={v=>setParam('indOficina',v)}/>
          <Param label="Financiamiento (%)" v={apu.finance} on={v=>setParam('finance',v)}/>
          <Param label="Utilidad (%)" v={apu.utility} on={v=>setParam('utility',v)}/>
          <Param label="Cargos adicionales (%)" v={apu.cargos} on={v=>setParam('cargos',v)}/>
        </div>
      </div>

      <div className="panel sticky">
        <h2>Integración del precio</h2>
        <Cost label="Materiales" v={totals.mat}/>
        <Cost label="Mano de obra (con FSR)" v={totals.mo}/>
        <Cost label="Equipo / maquinaria" v={totals.equipo}/>
        <Cost label={`Herramienta menor (${num(apu.herramienta)}% M.O.)`} v={totals.herramienta}/>
        <div className="cost subtotal"><span>= Costo directo</span><b>{money(totals.direct)}</b></div>
        <Cost label={`Indirectos (${num(Number(apu.indCampo)+Number(apu.indOficina))}%: campo ${num(apu.indCampo)} + oficina ${num(apu.indOficina)})`} v={totals.indirect}/>
        <Cost label={`Financiamiento (${num(apu.finance)}%)`} v={totals.finance}/>
        <Cost label={`Utilidad (${num(apu.utility)}%)`} v={totals.utility}/>
        <Cost label={`Cargos adicionales (${num(apu.cargos)}%)`} v={totals.cargos}/>
        <div className="grand"><span>Precio unitario (sin IVA)</span><b>{money(totals.pu)}</b></div>
        <div className="cost iva-note"><span>IVA {num(apu.iva)}% (informativo)</span><b>{money(totals.iva)}</b></div>
        <Incidence t={totals}/>
        <div className="actions-col">
          <button onClick={save}>Guardar</button>
          <button onClick={addBudget}>Agregar al presupuesto</button>
          <button onClick={exportPDF} disabled={exportBusy || batchBusy}>{exportBusy ? 'Generando PDF...' : hasConceptBatch ? `Descargar PDF por concepto (${conceptBatch.concepts.length})` : 'Descargar PDF con formato'}</button>
          {conceptBatch?.concepts?.length>0 && !hasConceptBatch && <button onClick={exportConceptBatchPDF}>PDF por concepto ({conceptBatch.concepts.length})</button>}
          <button onClick={exportExcel} disabled={exportBusy || batchBusy}>{exportBusy ? 'Generando Excel...' : hasConceptBatch ? (batchBusy ? 'Generando Excel por concepto...' : `Descargar Excel por concepto (${conceptBatch.concepts.length})`) : 'Descargar Excel'}</button>
        </div>
      </div>
    </div>

    {apus.length>0 && <div className="panel" style={{marginTop:16}}>
      <h2>Mis APU guardados <small className="hint">({apus.length})</small></h2>
      <div className="saved-grid">{apus.map(a=>{const tt=calcAPU(a);return <div className="saved-card" key={a.id}>
        <div className="sc-clave">{a.clave} - {a.unit} - {a.date}</div>
        <div className="sc-concept">{a.concept}</div>
        <div className="sc-pu">{money(tt.pu)} <small>/ {a.unit}</small></div>
        <div className="sc-actions"><button onClick={()=>setApu(a)}>Abrir</button><button className="del" onClick={()=>setApus(apus.filter(x=>x.id!==a.id))}>Borrar</button></div>
      </div>;})}</div>
    </div>}
  </section>
}

function Incidence({t}){
  const d = t.direct || 1;
  const segs = [['m','Materiales',t.mat,'#9D6FD0'],['o','Mano de obra',t.mo,'#2A1740'],['e','Equipo',t.equipo,'#B8A4CC'],['h','Herramienta',t.herramienta,'#C7A35C']];
  const pct = v => Math.max(0, v/d*100);
  return <div className="incid">
    <small className="hint">Incidencia sobre el costo directo</small>
    <div className="incid-bar">{segs.map(s=><i key={s[0]} className={s[0]} style={{width:pct(s[2])+'%'}}/>)}</div>
    <div className="incid-legend">{segs.map(s=><span key={s[0]}><i style={{background:s[3]}}/>{s[1]} <b className="incid-num">{num(pct(s[2]))}%</b></span>)}</div>
  </div>;
}

function MatrixTable({kind,rows,updateRow,removeRow,onMarketPrice,priceBusy}){
  const headers = kind==='materials'
    ? ['Descripción','Cant.','Unidad','P. base','Merma %','Importe','$','']
    : kind==='labor'
    ? ['Descripción','Jornadas','Unidad','Salario base','FSR','Importe','$','']
    : ['Descripción','Cant.','Unidad','Costo horario','Importe','$',''];
  const editIdx = kind==='equipment' ? [0,1,2,3] : [0,1,2,3,4];
  return <div className="apu-table-scroll"><table className="data-table apu-table">
    <thead><tr>{headers.map((h,hi)=><th key={hi}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((r,i)=><tr key={i}>
      {editIdx.map(k=><td key={k}><input value={r[k]} onChange={e=>updateRow(kind,i,k,e.target.value)} /></td>)}
      <td className="imp">{money(rowImporte(kind,r))}</td>
      <td className="del">{onMarketPrice ? <button className="row-del" title="Buscar precio real de mercado (busqueda web con IA)" aria-label="Buscar precio real de mercado" disabled={priceBusy===`${kind}-${i}`} onClick={()=>onMarketPrice(kind,i)}>{priceBusy===`${kind}-${i}` ? '…' : '$'}</button> : null}</td>
      <td className="del"><button className="row-del" title="Eliminar" aria-label="Eliminar renglon" onClick={()=>removeRow(kind,i)}>×</button></td>
    </tr>)}</tbody>
  </table></div>
}

function Param({label,v,on}){return <div className="param"><label>{label}</label><input type="number" step="0.1" value={v} onChange={e=>on(e.target.value)}/></div>}
function Cost({label,v}){return <div className="cost"><span>{label}</span><b>{money(v)}</b></div>}

function exportAPUPDFPro(apu, totals, company){
  const doc = new jsPDF('landscape', 'mm', 'letter');
  const audit = buildAuditModel(apu, totals);
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 12;
  const tableW = W - M*2;
  const codeX = M + 2;
  const descX = M + 26;
  const unitX = W - 112;
  const qtyX = W - 88;
  const puX = W - 52;
  const impX = W - M - 2;
  const descW = unitX - descX - 10;
  const purple = [42, 23, 64];
  const violet = [111, 63, 167];
  const soft = [246, 242, 250];
  const line = [221, 211, 232];
  let y = 14;
  let page = 1;

  const safe = (v) => cleanText(v).replace(/\s+/g, ' ').trim();
  const mxn = (v) => money(v).replace('MX$', '$');
  const code = (prefix,i)=>`${prefix}-${String(i+1).padStart(3,'0')}`;
  const footer = () => {
    doc.setFont('helvetica','normal');
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.text('Generado por ZOEMEC IA - Version 2.1 - Revision tecnica editable por el usuario', M, H-8);
    doc.text(`Pagina ${page}`, W-M, H-8, {align:'right'});
  };
  const addPage = () => { footer(); doc.addPage(); page += 1; y = 14; };
  const check = (need=10) => { if(y + need > H - 18) addPage(); };
  const title = (text) => {
    check(12);
    doc.setFont('helvetica','bold');
    doc.setFontSize(9);
    doc.setTextColor(...violet);
    doc.text(text, M, y);
    y += 6;
  };

  doc.setFillColor(...purple);
  doc.roundedRect(M, y, W - M*2, 18, 1.5, 1.5, 'F');
  doc.setTextColor(255);
  doc.setFont('helvetica','bold');
  doc.setFontSize(14);
  doc.text('CEDULA DE ANALISIS DE PRECIO UNITARIO', M+4, y+8);
  doc.setFont('helvetica','normal');
  doc.setFontSize(8.5);
  doc.text(`${company.name || 'ZOEMEC'} | ${company.address || 'Mexico'} | ${company.email || 'contacto@zoemec.mx'}`, M+4, y+14);
  y += 25;

  doc.setFillColor(...soft);
  doc.setDrawColor(...line);
  doc.roundedRect(M, y, W - M*2, 18, 1.5, 1.5, 'FD');
  doc.setTextColor(40);
  doc.setFontSize(8);
  doc.setFont('helvetica','bold');
  doc.text('Clave:', M+4, y+6); doc.text('Unidad:', M+62, y+6); doc.text('Fecha:', M+118, y+6);
  doc.text('Familia:', M+4, y+13); doc.text('SAT:', M+118, y+13); doc.text('Confianza:', M+152, y+13);
  doc.setFont('helvetica','normal');
  doc.text(safe(apu.clave), M+18, y+6);
  doc.text(safe(apu.unit), M+78, y+6);
  doc.text(safe(apu.date || new Date().toLocaleDateString('es-MX')), M+132, y+6);
  doc.text(safe(apu.family || 'APU general').slice(0, 56), M+22, y+13);
  doc.text(safe(apu.sat || '72100000'), M+128, y+13);
  doc.text(`${Number(apu.confidence || 88)}%`, M+170, y+13);
  y += 25;

  doc.setFont('helvetica','bold');
  doc.setFontSize(8);
  doc.setTextColor(...violet);
  doc.text('CONCEPTO ANALIZADO', M, y);
  y += 5;
  doc.setFont('helvetica','normal');
  doc.setFontSize(8.5);
  doc.setTextColor(35);
  const conceptLines = doc.splitTextToSize(safe(apu.concept), W - M*2);
  doc.text(conceptLines, M, y);
  y += conceptLines.length * 4.2 + 6;

  const tableHeader = () => {
    doc.setFillColor(...soft);
    doc.setDrawColor(...line);
    doc.rect(M, y, tableW, 7, 'FD');
    doc.setTextColor(55);
    doc.setFont('helvetica','bold');
    doc.setFontSize(7.3);
    doc.text('CODIGO', codeX, y+4.7);
    doc.text('DESCRIPCION', descX, y+4.7);
    doc.text('UNIDAD', unitX, y+4.7, {align:'center'});
    doc.text('CANT.', qtyX, y+4.7, {align:'right'});
    doc.text('P.U.', puX, y+4.7, {align:'right'});
    doc.text('IMPORTE', impX, y+4.7, {align:'right'});
    y += 7;
  };

  const section = (title) => {
    check(16);
    doc.setFillColor(...purple);
    doc.rect(M, y, tableW, 7, 'F');
    doc.setTextColor(255);
    doc.setFont('helvetica','bold');
    doc.setFontSize(8);
    doc.text(title, M+2, y+4.8);
    y += 7;
    tableHeader();
  };

  const row = (prefix, idx, desc, unit, qty, pu, importe) => {
    const descLines = doc.splitTextToSize(safe(desc), descW);
    const rowH = Math.max(7, descLines.length * 3.8 + 2.8);
    check(rowH + 2);
    doc.setDrawColor(...line);
    doc.line(M, y, W-M, y);
    doc.setTextColor(35);
    doc.setFont('helvetica','normal');
    doc.setFontSize(7.7);
    doc.text(code(prefix, idx), codeX, y+4.8);
    doc.text(descLines, descX, y+4.8);
    doc.text(safe(unit), unitX, y+4.8, {align:'center'});
    doc.text(num(qty), qtyX, y+4.8, {align:'right'});
    doc.text(mxn(pu), puX, y+4.8, {align:'right'});
    doc.text(mxn(importe), impX, y+4.8, {align:'right'});
    y += rowH;
  };

  section('MATERIALES');
  apu.materials.forEach((r,i)=>{
    const desc = `${r[0]}${Number(r[4]) ? ` (+${num(r[4])}% merma)` : ''}`;
    row('MAT', i, desc, r[2], r[1], r[3], rowImporte('materials', r));
  });
  y += 3;
  section('MANO DE OBRA');
  apu.labor.forEach((r,i)=>{
    const desc = `${safe(r[0])} | FSR ${num(r[4] || 1)} | Salario base ${mxn(r[3])}`;
    row('MO', i, desc, r[2], r[1], Number(r[3]) * Number(r[4] || 1), rowImporte('labor', r));
  });
  y += 3;
  section('HERRAMIENTA, EQUIPO Y MAQUINARIA');
  apu.equipment.forEach((r,i)=>row('EQ', i, r[0], r[2], r[1], r[3], rowImporte('equipment', r)));
  y += 5;

  check(58);
  const boxX = W - 108;
  const sum = (label, value, strong=false, fill=false) => {
    if(fill){
      doc.setFillColor(238, 224, 247);
      doc.rect(boxX, y-4.5, 96, 7, 'F');
    }
    doc.setDrawColor(...line);
    doc.line(boxX, y+2.5, W-M, y+2.5);
    doc.setTextColor(strong ? 35 : 75);
    doc.setFont('helvetica', strong ? 'bold' : 'normal');
    doc.setFontSize(strong ? 8.4 : 7.8);
    doc.text(label, boxX+4, y);
    doc.text(mxn(value), W-M-2, y, {align:'right'});
    y += 7;
  };
  sum(`Herramienta menor (${num(apu.herramienta)}% M.O.)`, totals.herramienta);
  sum('Costo directo', totals.direct, true);
  sum(`Indirectos (${num(Number(apu.indCampo)+Number(apu.indOficina))}%)`, totals.indirect);
  sum(`Financiamiento (${num(apu.finance)}%)`, totals.finance);
  sum(`Utilidad (${num(apu.utility)}%)`, totals.utility);
  if(Number(apu.cargos || 0)) sum(`Cargos adicionales (${num(apu.cargos)}%)`, totals.cargos);
  sum('PRECIO UNITARIO (sin IVA)', totals.pu, true, true);
  sum(`IVA ${num(apu.iva)}% (informativo)`, totals.iva);

  y += 5;
  title('FORMULAS BASE DEL ANALISIS');
  audit.formulas.forEach(([label, formula, value]) => {
    check(6);
    doc.setFont('helvetica','normal');
    doc.setFontSize(7.4);
    doc.setTextColor(45);
    doc.text(label, M, y);
    doc.text(doc.splitTextToSize(formula, 135), M+45, y);
    doc.text(mxn(value), W-M-2, y, {align:'right'});
    y += 5.5;
  });

  addPage();
  doc.setFont('helvetica','bold');
  doc.setFontSize(13);
  doc.setTextColor(...purple);
  doc.text('ANEXO TECNICO AUDITABLE', M, y);
  y += 8;
  doc.setFont('helvetica','normal');
  doc.setFontSize(8);
  doc.setTextColor(65);
  doc.text('Cada importe conserva formula, rendimiento, fuente y nivel de confianza para revision tecnica.', M, y);
  y += 8;

  const auditHeader = () => {
    doc.setFillColor(...soft);
    doc.setDrawColor(...line);
    doc.rect(M, y, tableW, 7, 'FD');
    doc.setTextColor(55);
    doc.setFont('helvetica','bold');
    doc.setFontSize(7);
    doc.text('CODIGO', M+2, y+4.7);
    doc.text('FORMULA / DETALLE', M+24, y+4.7);
    doc.text('RENDIMIENTO', W-120, y+4.7);
    doc.text('FUENTE', W-72, y+4.7);
    doc.text('CONF.', W-M-2, y+4.7, {align:'right'});
    y += 7;
  };
  auditHeader();
  audit.all.forEach(r => {
    const detail = `${r.desc}: ${r.detalle}`;
    const detailLines = doc.splitTextToSize(detail, W-160);
    const rowH = Math.max(8, detailLines.length * 3.6 + 3);
    check(rowH + 2);
    if(y < 20) auditHeader();
    doc.setDrawColor(...line);
    doc.line(M, y, W-M, y);
    doc.setFont('helvetica','normal');
    doc.setFontSize(7.2);
    doc.setTextColor(35);
    doc.text(r.code, M+2, y+4.7);
    doc.text(detailLines, M+24, y+4.7);
    doc.text(doc.splitTextToSize(r.rendimiento, 42), W-120, y+4.7);
    doc.text(doc.splitTextToSize(r.source, 42), W-72, y+4.7);
    doc.text(`${r.confidence}%`, W-M-2, y+4.7, {align:'right'});
    y += rowH;
  });

  if(audit.explosion.length){
    y += 5;
    title('EXPLOSION DE MATERIALES');
    audit.explosion.forEach(r => {
      check(6);
      doc.setFont('helvetica','normal');
      doc.setFontSize(7.2);
      doc.setTextColor(35);
      doc.text(`${r.code} ${safe(r.desc).slice(0, 78)}`, M, y);
      doc.text(`${num(r.qtyTotal)} ${r.unit}`, W-74, y, {align:'right'});
      doc.text(mxn(r.importeTotal), W-M-2, y, {align:'right'});
      y += 5;
    });
  }

  footer();
  doc.save(`${apu.clave}-APU-ZOEMEC.pdf`);
}

function isExportableConceptItem(item){
  const concept = String(item?.concept || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
  const unit = normalizeUnitLabel(item?.unit);
  const qty = Number(item?.qty || 0);
  if(!concept || concept.length < 12 || qty <= 0) return false;
  if(!/^(m2|m²|m3|m³|kg|pza|pieza|pzas|ml|m|l|lt|lote|jgo|hr|hora|dia|día|jor|jornal)$/i.test(unit)) return false;
  if(/^(total|subtotal|gran total)\b/.test(concept)) return false;
  if(/\b(total partida|total zona|total area|total capitulo|subtotal partida|gran total)\b/.test(concept)) return false;
  return true;
}

function exportConceptsAPUPDF(concepts, catalog, company, preparedAPUs=[]){
  const list = (Array.isArray(concepts) ? concepts : []).filter(isExportableConceptItem);
  if(!list.length) return;
  const doc = new jsPDF('landscape', 'mm', 'letter');
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 12;
  const purple = [42, 23, 64];
  const violet = [111, 63, 167];
  const soft = [246, 242, 250];
  const line = [221, 211, 232];
  const safe = (v) => cleanText(v).replace(/\s+/g, ' ').trim();
  const mxn = (v) => money(v).replace('MX$', '$');
  const code = (prefix,i)=>`${prefix}-${String(i+1).padStart(3,'0')}`;

  const drawRows = (ctx, title, prefix, rows, mapper) => {
    let { y } = ctx;
    const tableW = W - M*2;
    const codeX = M + 2;
    const descX = M + 26;
    const unitX = W - 112;
    const qtyX = W - 88;
    const puX = W - 52;
    const impX = W - M - 2;
    const descW = unitX - descX - 10;
    const check = (need=10) => {
      if(y + need > H - 18){
        doc.addPage();
        y = 14;
      }
    };
    check(16);
    doc.setFillColor(...purple);
    doc.rect(M, y, tableW, 7, 'F');
    doc.setTextColor(255);
    doc.setFont('helvetica','bold');
    doc.setFontSize(8);
    doc.text(title, M+2, y+4.8);
    y += 7;
    doc.setFillColor(...soft);
    doc.setDrawColor(...line);
    doc.rect(M, y, tableW, 7, 'FD');
    doc.setTextColor(55);
    doc.setFontSize(7);
    doc.text('CODIGO', codeX, y+4.7);
    doc.text('DESCRIPCION', descX, y+4.7);
    doc.text('UNIDAD', unitX, y+4.7, {align:'center'});
    doc.text('CANT.', qtyX, y+4.7, {align:'right'});
    doc.text('P.U.', puX, y+4.7, {align:'right'});
    doc.text('IMPORTE', impX, y+4.7, {align:'right'});
    y += 7;
    rows.forEach((rowData, idx) => {
      const r = mapper(rowData, idx);
      const descLines = doc.splitTextToSize(safe(r.desc), descW);
      const rowH = Math.max(7, descLines.length * 3.6 + 2.8);
      check(rowH + 2);
      doc.setDrawColor(...line);
      doc.line(M, y, W-M, y);
      doc.setTextColor(35);
      doc.setFont('helvetica','normal');
      doc.setFontSize(7.4);
      doc.text(code(prefix, idx), codeX, y+4.8);
      doc.text(descLines, descX, y+4.8);
      doc.text(safe(r.unit), unitX, y+4.8, {align:'center'});
      doc.text(num(r.qty), qtyX, y+4.8, {align:'right'});
      doc.text(mxn(r.pu), puX, y+4.8, {align:'right'});
      doc.text(mxn(r.importe), impX, y+4.8, {align:'right'});
      y += rowH;
    });
    ctx.y = y + 3;
  };

  list.forEach((item, index) => {
    if(index > 0) doc.addPage();
    const apuBase = preparedAPUs[index] || makeAPUFromConcept(item.concept, catalog);
    const apu = {
      ...apuBase,
      clave: item.code || apuBase.clave,
      unit: item.unit || apuBase.unit,
      sourceQty: item.qty,
      referencePU: item.referencePU,
      sourceSection:item.section || apuBase.sourceSection || '',
      rowNumber:item.rowNumber || apuBase.rowNumber || index+1,
      sourceFile:apuBase.sourceFile || 'Catalogo de conceptos'
    };
    const totals = calcAPU(apu);
    let y = 14;

    doc.setFillColor(...purple);
    doc.roundedRect(M, y, W - M*2, 18, 1.5, 1.5, 'F');
    doc.setTextColor(255);
    doc.setFont('helvetica','bold');
    doc.setFontSize(13);
    doc.text('CEDULA DE ANALISIS DE PRECIO UNITARIO', M+4, y+8);
    doc.setFont('helvetica','normal');
    doc.setFontSize(8);
    doc.text(`${company.name || 'ZOEMEC'} | ${company.address || 'Mexico'} | ${company.email || 'contacto@zoemec.mx'}`, M+4, y+14);
    y += 25;

    doc.setFillColor(...soft);
    doc.setDrawColor(...line);
    doc.roundedRect(M, y, W - M*2, 18, 1.5, 1.5, 'FD');
    doc.setTextColor(40);
    doc.setFontSize(8);
    doc.setFont('helvetica','bold');
    doc.text('Clave:', M+4, y+6);
    doc.text('Unidad:', M+62, y+6);
    doc.text('Cantidad:', M+104, y+6);
    doc.text('Fecha:', M+148, y+6);
    doc.text('Familia:', M+4, y+13);
    doc.text('SAT:', M+148, y+13);
    doc.setFont('helvetica','normal');
    doc.text(safe(apu.clave), M+18, y+6);
    doc.text(safe(apu.unit), M+78, y+6);
    doc.text(num(item.qty || 1), M+124, y+6);
    doc.text(new Date().toLocaleDateString('es-MX'), M+162, y+6);
    doc.text(safe(apu.family || 'APU general').slice(0, 72), M+22, y+13);
    doc.text(safe(apu.sat || '72100000'), M+158, y+13);
    y += 25;

    doc.setFont('helvetica','bold');
    doc.setFontSize(8);
    doc.setTextColor(...violet);
    doc.text('CONCEPTO ANALIZADO', M, y);
    y += 5;
    doc.setFont('helvetica','normal');
    doc.setFontSize(8.3);
    doc.setTextColor(35);
    const conceptLines = doc.splitTextToSize(safe(apu.concept), W - M*2);
    doc.text(conceptLines, M, y);
    y += conceptLines.length * 4 + 6;

    const ctx = { y };
    drawRows(ctx, 'MATERIALES', 'MAT', apu.materials || [], (r)=>({
      desc: `${r[0]}${Number(r[4]) ? ` (+${num(r[4])}% merma)` : ''}`,
      unit: r[2],
      qty: r[1],
      pu: r[3],
      importe: rowImporte('materials', r)
    }));
    drawRows(ctx, 'MANO DE OBRA', 'MO', apu.labor || [], (r)=>({
      desc: `${safe(r[0])} | FSR ${num(r[4] || 1)} | Salario base ${mxn(r[3])}`,
      unit: r[2],
      qty: r[1],
      pu: Number(r[3]) * Number(r[4] || 1),
      importe: rowImporte('labor', r)
    }));
    drawRows(ctx, 'EQUIPO / MAQUINARIA', 'EQ', apu.equipment || [], (r)=>({
      desc: r[0],
      unit: r[2],
      qty: r[1],
      pu: r[3],
      importe: rowImporte('equipment', r)
    }));
    y = ctx.y + 2;
    if(y > H - 62){ doc.addPage(); y = 14; }

    const boxX = W - 108;
    const sum = (label, value, strong=false, fill=false) => {
      if(fill){
        doc.setFillColor(238, 224, 247);
        doc.rect(boxX, y-4.5, 96, 7, 'F');
      }
      doc.setDrawColor(...line);
      doc.line(boxX, y+2.5, W-M, y+2.5);
      doc.setTextColor(strong ? 35 : 75);
      doc.setFont('helvetica', strong ? 'bold' : 'normal');
      doc.setFontSize(strong ? 8.2 : 7.6);
      doc.text(label, boxX+4, y);
      doc.text(mxn(value), W-M-2, y, {align:'right'});
      y += 7;
    };
    sum(`Herramienta menor (${num(apu.herramienta)}% M.O.)`, totals.herramienta);
    sum('Costo directo', totals.direct, true);
    sum(`Indirectos (${num(Number(apu.indCampo)+Number(apu.indOficina))}%)`, totals.indirect);
    sum(`Financiamiento (${num(apu.finance)}%)`, totals.finance);
    sum(`Utilidad (${num(apu.utility)}%)`, totals.utility);
    if(Number(apu.cargos || 0)) sum(`Cargos adicionales (${num(apu.cargos)}%)`, totals.cargos);
    sum('PRECIO UNITARIO (sin IVA)', totals.pu, true, true);
    sum(`IVA ${num(apu.iva)}% (informativo)`, totals.iva);

    if(y > H - 32){ doc.addPage(); y = 14; }
    doc.setFont('helvetica','bold');
    doc.setFontSize(7.8);
    doc.setTextColor(...violet);
    doc.text('TRAZABILIDAD Y SUPUESTOS IA', M, y);
    y += 5;
    doc.setFont('helvetica','normal');
    doc.setFontSize(7.2);
    doc.setTextColor(90);
    const trace = [
      `Fuente: ${safe(apu.sourceFile || 'Generacion ZOEMEC')}`,
      `Partida/fila: ${safe(apu.sourceSection || 'Sin partida')}${apu.rowNumber ? ` | fila ${apu.rowNumber}` : ''}`,
      `Revision: validar rendimientos, precios, FSR, indirectos y utilidad contra catalogo vigente.`,
      ...((apu.aiNotes || apu.notes || []).slice(0,3).map(safe))
    ];
    trace.forEach(note => {
      const lines = doc.splitTextToSize(note, W - M*2);
      doc.text(lines, M, y);
      y += lines.length * 3.6 + 1;
    });

    doc.setFont('helvetica','normal');
    doc.setFontSize(7.3);
    doc.setTextColor(120);
    doc.text(`Concepto ${index+1} de ${list.length} | Generado por ZOEMEC IA`, M, H-8);
    doc.text(`Pagina ${doc.internal.getNumberOfPages()}`, W-M, H-8, {align:'right'});
  });
  doc.save('APU-POR-CONCEPTO-ZOEMEC.pdf');
}

function buildCompleteAPUSheet(apu, totals, company, audit){
  const rows = [];
  const widths = [13,52,12,13,15,12,34,17,28];
  const add = (row=[]) => {
    const full = [...row];
    while(full.length < widths.length) full.push(null);
    rows.push(full);
    return rows.length;
  };
  const span = (value, style=XLS.title) => [xcell(value, {...style, columnSpan:widths.length}), ...Array(widths.length-1).fill(null)];
  const section = (label) => add(span(label, XLS.section));
  const header = () => add(styleHeader(['Codigo','Descripcion','Unidad','Cantidad','P.U. / salario','Merma / FSR','Formula auditable','Importe','Fuente']));
  const moneyFormula = (formula) => fcell(formula, XLS.calc);
  const sumRange = (col, start, end) => end >= start ? `=SUM(${col}${start}:${col}${end})` : '=0';
  const formulaNote = (text) => xcell(text, XLS.formula);
  const inputNumber = (value, style={}) => xcell(Number(value || 0), {...XLS.input, ...style});

  add(span(company.name || 'ZOEMEC', XLS.title));
  add(span('CEDULA DE ANALISIS DE PRECIO UNITARIO AUDITABLE', XLS.subtitle));
  add([xcell('Clave', XLS.label), apu.clave, xcell('Unidad', XLS.label), apu.unit, xcell('Fecha', XLS.label), apu.date, xcell('Confianza IA', XLS.label), `${apu.confidence || 88}%`]);
  add([xcell('Familia', XLS.label), apu.family || 'APU general', xcell('Clave SAT', XLS.label), apu.sat || '72100000', xcell('Cantidad base', XLS.label), Number(apu.sourceQty || 1) || 1, xcell('P.U. referencia', XLS.label), Number(apu.referencePU || 0) || 0]);
  add(span('CONCEPTO ANALIZADO', XLS.label));
  add([xcell(apu.concept, {...XLS.note, columnSpan:widths.length}), ...Array(widths.length-1).fill(null)]);
  add([]);
  section('RESUMEN EJECUTIVO');
  add(styleHeader(['Partida','Base de calculo','Importe','','Partida','Base de calculo','Importe','','']));
  const resRow1 = add(['Materiales','Suma de insumos materiales',null,null,'Herramienta menor',`${apu.herramienta}% sobre M.O.`,null,null,null]);
  const resRow2 = add(['Mano de obra','Jornadas x salario base x FSR',null,null,'Indirectos',`${Number(apu.indCampo || 0)+Number(apu.indOficina || 0)}% sobre C.D.`,null,null,null]);
  const resRow3 = add(['Equipo / maquinaria','Cantidad x costo horario',null,null,'Precio unitario sin IVA','Resultado auditable',null,null,null]);
  add([]);

  section('MATERIALES');
  header();
  const matStart = rows.length + 1;
  audit.materials.forEach(r => {
    const n = rows.length + 1;
    add([r.code,r.desc,r.unit,inputNumber(r.qty, XLS.qty),inputNumber(r.base, XLS.money),inputNumber(r.factor),formulaNote(`D${n} x E${n} x (1 + F${n}/100)`),moneyFormula(`=D${n}*E${n}*(1+F${n}/100)`),r.source]);
  });
  const matEnd = rows.length;
  const matTotalRow = add([null,xcell('SUBTOTAL MATERIALES', XLS.total),null,null,null,null,null,moneyFormula(sumRange('H', matStart, matEnd)),null]);
  add([]);

  section('MANO DE OBRA  (salario real = salario base x FSR)');
  header();
  const laborStart = rows.length + 1;
  audit.labor.forEach(r => {
    const n = rows.length + 1;
    add([r.code,r.desc,r.unit,inputNumber(r.qty, XLS.qty),inputNumber(r.base, XLS.money),inputNumber(r.factor),formulaNote(`D${n} x E${n} x F${n}`),moneyFormula(`=D${n}*E${n}*F${n}`),r.source]);
  });
  const laborEnd = rows.length;
  const laborTotalRow = add([null,xcell('SUBTOTAL MANO DE OBRA', XLS.total),null,null,null,null,null,moneyFormula(sumRange('H', laborStart, laborEnd)),null]);
  add([]);

  section('EQUIPO / MAQUINARIA');
  header();
  const eqStart = rows.length + 1;
  audit.equipment.forEach(r => {
    const n = rows.length + 1;
    add([r.code,r.desc,r.unit,inputNumber(r.qty, XLS.qty),inputNumber(r.base, XLS.money),null,formulaNote(`D${n} x E${n}`),moneyFormula(`=D${n}*E${n}`),r.source]);
  });
  const eqEnd = rows.length;
  const eqTotalRow = add([null,xcell('SUBTOTAL EQUIPO', XLS.total),null,null,null,null,null,moneyFormula(sumRange('H', eqStart, eqEnd)),null]);
  add([]);

  section('INTEGRACION DEL PRECIO UNITARIO');
  add(styleHeader(['Concepto','Formula tecnica','Base / porcentaje','','','','Formula Excel','Importe','']));
  const hmRow = add(['Herramienta menor',`H${laborTotalRow} x ${Number(apu.herramienta || 0)}%`,`${apu.herramienta}% M.O.`,null,null,null,formulaNote(`H${laborTotalRow} x ${Number(apu.herramienta || 0)}%`),moneyFormula(`=H${laborTotalRow}*${Number(apu.herramienta || 0)}/100`),null]);
  const directRow = add([xcell('COSTO DIRECTO', XLS.total),'Materiales + Mano de obra + Equipo + Herramienta',null,null,null,null,formulaNote(`H${matTotalRow}+H${laborTotalRow}+H${eqTotalRow}+H${hmRow}`),moneyFormula(`=H${matTotalRow}+H${laborTotalRow}+H${eqTotalRow}+H${hmRow}`),null]);
  const indirectPct = Number(apu.indCampo || 0)+Number(apu.indOficina || 0);
  const indirectRow = add(['Indirectos',`Costo directo x (${apu.indCampo}% campo + ${apu.indOficina}% oficina)`,`${indirectPct}%`,null,null,null,formulaNote(`H${directRow} x ${indirectPct}%`),moneyFormula(`=H${directRow}*${indirectPct}/100`),null]);
  const financeRow = add(['Financiamiento',`(Costo directo + indirectos) x ${apu.finance}%`,`${apu.finance}%`,null,null,null,formulaNote(`(H${directRow}+H${indirectRow}) x ${apu.finance}%`),moneyFormula(`=(H${directRow}+H${indirectRow})*${Number(apu.finance || 0)}/100`),null]);
  const utilityRow = add(['Utilidad',`(Costo directo + indirectos + financiamiento) x ${apu.utility}%`,`${apu.utility}%`,null,null,null,formulaNote(`(H${directRow}+H${indirectRow}+H${financeRow}) x ${apu.utility}%`),moneyFormula(`=(H${directRow}+H${indirectRow}+H${financeRow})*${Number(apu.utility || 0)}/100`),null]);
  const chargesRow = add(['Cargos adicionales',`Subtotal anterior x ${apu.cargos}%`,`${apu.cargos}%`,null,null,null,formulaNote(`(H${directRow}+H${indirectRow}+H${financeRow}+H${utilityRow}) x ${apu.cargos}%`),moneyFormula(`=(H${directRow}+H${indirectRow}+H${financeRow}+H${utilityRow})*${Number(apu.cargos || 0)}/100`),null]);
  const puRow = add([xcell('PRECIO UNITARIO SIN IVA', XLS.grand),'Costo directo + sobrecostos',null,null,null,null,formulaNote(`SUM(H${directRow}:H${chargesRow})`),fcell(`=SUM(H${directRow}:H${chargesRow})`, XLS.grand),null]);
  add(['IVA informativo',`Precio unitario x ${apu.iva}%`,`${apu.iva}%`,null,null,null,formulaNote(`H${puRow} x ${apu.iva}%`),moneyFormula(`=H${puRow}*${Number(apu.iva || 0)}/100`),null]);
  // Resumen ejecutivo ligado por formula a los subtotales reales: recalcula al editar cualquier insumo
  rows[resRow1-1][2] = moneyFormula(`=H${matTotalRow}`);
  rows[resRow1-1][6] = moneyFormula(`=H${hmRow}`);
  rows[resRow2-1][2] = moneyFormula(`=H${laborTotalRow}`);
  rows[resRow2-1][6] = moneyFormula(`=H${indirectRow}`);
  rows[resRow3-1][2] = moneyFormula(`=H${eqTotalRow}`);
  rows[resRow3-1][6] = fcell(`=H${puRow}`, XLS.grand);
  add([]);

  section('ANALISIS DE CUADRILLAS Y FSR');
  add(styleHeader(['Oficio','Jornadas','Unidad','Salario base','FSR','Salario real','Importe','Rendimiento','']));
  audit.labor.forEach(r => {
    const n = rows.length + 1;
    add([r.desc,inputNumber(r.qty, XLS.qty),r.unit,inputNumber(r.base, XLS.money),inputNumber(r.factor),fcell(`=D${n}*E${n}`, XLS.money),fcell(`=B${n}*D${n}*E${n}`, XLS.money),r.rendimiento,null]);
  });
  add([]);

  section('EXPLOSION DE INSUMOS DEL CONCEPTO');
  add(styleHeader(['Codigo','Descripcion','Unidad','Cantidad por unidad','Cantidad concepto','P.U.','Importe','Fuente','Formula']));
  audit.explosion.forEach(r => {
    const n = rows.length + 1;
    add([r.code,r.desc,r.unit,inputNumber(r.qtyUnit, XLS.qty),inputNumber(r.qtyTotal, XLS.qty),inputNumber(r.pu, XLS.money),fcell(`=E${n}*F${n}`, XLS.money),r.source,formulaNote(`E${n} x F${n}`)]);
  });
  add([]);
  section('SUPUESTOS Y TRAZABILIDAD');
  add([xcell('Editable por el usuario', XLS.ok), xcell('Cantidades, precios, mermas, FSR, indirectos, financiamiento, utilidad y cargos se pueden modificar. Los importes se recalculan por formula.', {...XLS.note, columnSpan:8}), ...Array(7).fill(null)]);
  add([xcell('Fuente principal', XLS.label), apu.sourceFile || 'Generacion IA ZOEMEC / captura del usuario', xcell('Partida / fila origen', XLS.label), `${apu.sourceSection || 'Sin partida'}${apu.rowNumber ? ` | fila ${apu.rowNumber}` : ''}`, xcell('Revision requerida', XLS.label), 'Validar rendimientos y precios contra catalogo vigente', null, null, null]);
  return { sheet:`APU-${apu.clave}`.slice(0,31), rows, widths, stickyRowsCount:13 };
}

async function exportAPUExcel(apu, totals, company){
  const audit = buildAuditModel(apu, totals);
  const meta = [
    [xcell(company.name || 'ZOEMEC', XLS.title)],
    [xcell('CEDULA DE ANALISIS DE PRECIO UNITARIO AUDITABLE', XLS.subtitle)],
    [xcell('Clave', XLS.section),apu.clave,xcell('Unidad', XLS.section),apu.unit,xcell('Fecha', XLS.section),apu.date],
    [xcell('Familia detectada', XLS.section),apu.family || 'APU general',xcell('Clave SAT', XLS.section),apu.sat || '72100000',xcell('Confianza IA', XLS.section),`${apu.confidence || 88}%`],
    [xcell('Concepto', XLS.section),apu.concept],
    ['Cantidad de referencia', Number(apu.sourceQty || 1) || 1, 'P.U. referencia', Number(apu.referencePU || 0) || 0],
    ['Criterio','La IA propone insumos; ZOEMEC calcula importes, formulas, rendimientos y trazabilidad.']
  ];
  const matrizHead = ['Tipo','Codigo','Descripcion','Cantidad','Unidad','Precio / salario / costo','Merma o FSR','Formula visible','Detalle numerico','Rendimiento','Fuente','Confianza','Importe'];
  const matrizRows = audit.all.map(r=>[
    r.kind === 'materials' ? 'Material' : r.kind === 'labor' ? 'Mano de obra' : 'Equipo',
    r.code,r.desc,r.qty,r.unit,r.base,r.factor,r.formula,r.detalle,r.rendimiento,r.source,`${r.confidence}%`,r.importe
  ]);
  const sectionRows = (title, rows) => [
    styleSection(title),
    styleHeader(matrizHead.slice(1)),
    ...rows.map(r=>[r.code,r.desc,r.qty,r.unit,r.base,r.factor,r.formula,r.detalle,r.rendimiento,r.source,`${r.confidence}%`,r.importe])
  ];
  const sobrecostos = [
    styleHeader(['Concepto','Formula visible','Importe']),
    ...audit.formulas
  ];
  const explosion = [
    styleHeader(['Codigo','Descripcion','Unidad','Cantidad por unidad','Cantidad total concepto','P.U.','Importe total','Fuente']),
    ...audit.explosion.map(r=>[r.code,r.desc,r.unit,r.qtyUnit,r.qtyTotal,r.pu,r.importeTotal,r.source])
  ];
  const trazabilidad = [
    styleHeader(['Codigo','Descripcion','Fuente','Confianza','Nota tecnica']),
    ...audit.all.map(r=>[r.code,r.desc,r.source,`${r.confidence}%`,r.notes]),
    [],
    styleSection('Notas IA / tecnicas'),
    ...((apu.notes || []).length ? apu.notes.map(n=>[n]) : [['Sin notas adicionales']])
  ];
  const sheets = [buildCompleteAPUSheet(apu, totals, company, audit)];
  await exportWorkbookExcel(sheets, `${apu.clave}-APU-AUDITABLE-ZOEMEC.xlsx`).catch(()=>alert('No pude generar el Excel. Inténtalo de nuevo.'));
}

function uniqueSheetName(base, used){
  const clean = String(base || 'APU').replace(/[\\/*?:[\]]/g,'-').slice(0,31) || 'APU';
  let name = clean;
  let i = 2;
  while(used.has(name)){
    const suffix = `-${i++}`;
    name = clean.slice(0,31-suffix.length) + suffix;
  }
  used.add(name);
  return name;
}
function buildConceptCatalogSheet(concepts){
  const rows = [
    [xcell('CATALOGO DE CONCEPTOS', XLS.title), null, null, null, null, null, null, null, null],
    [xcell('Esta hoja conserva el listado base. Cada renglon valido genera una hoja APU independiente con desarrollo de IA real cuando esta disponible.', {...XLS.note, columnSpan:9}), null, null, null, null, null, null, null, null],
    [],
    styleHeader(['No.','Clave','Partida / ubicacion','Fila origen','Concepto','Unidad','Cantidad','P.U. referencia','Importe referencia'])
  ];
  concepts.forEach((item, index) => {
    const row = rows.length + 1;
    rows.push([
      index + 1,
      item.code || `CON-${String(index+1).padStart(3,'0')}`,
      item.section || '',
      item.rowNumber || '',
      item.concept,
      item.unit || 'u',
      Number(item.qty || 1) || 1,
      Number(item.referencePU || 0) || 0,
      item.importe ? Number(item.importe) : fcell(`=G${row}*H${row}`, XLS.money)
    ]);
  });
  rows.push([]);
  rows.push([null,null,null,null,null,null,xcell('TOTAL REFERENCIA', XLS.grand), null, fcell(`=SUM(I5:I${rows.length-1})`, XLS.grand)]);
  return { sheet:'CATALOGO', rows, widths:[10,18,32,12,76,12,14,18,18], stickyRowsCount:4 };
}
async function exportConceptsAPUWorkbook(concepts, catalog, company, preparedAPUs=[]){
  const used = new Set();
  const limited = concepts.filter(isExportableConceptItem);
  const sheets = [buildConceptCatalogSheet(limited), ...limited.map((item, idx) => {
    const base = preparedAPUs[idx] || makeAPUFromConcept(item.concept, catalog);
    const apu = {
      ...base,
      clave: String(item.code || base.clave || `APU-${idx+1}`).slice(0,24),
      concept: item.concept,
      unit: item.unit || base.unit,
      sourceQty: Number(item.qty || 1) || 1,
      referencePU: Number(item.referencePU || 0) || 0,
      sourceFile: base.sourceFile || 'Catalogo de conceptos',
      sourceSection: item.section || base.sourceSection || '',
      rowNumber: item.rowNumber || base.rowNumber || idx+1
    };
    const totals = calcAPU(apu);
    const audit = buildAuditModel(apu, totals);
    const sheet = buildCompleteAPUSheet(apu, totals, company, audit);
    sheet.sheet = uniqueSheetName(`${String(idx+1).padStart(2,'0')}-${apu.clave || `APU-${idx+1}`}`, used);
    return sheet;
  })];
  if(!sheets.length){
    alert('No hay conceptos para exportar.');
    return;
  }
  return await exportWorkbookExcel(sheets, `APU-POR-CONCEPTO-ZOEMEC.xlsx`);
}

function Budgets({company,budgets,setBudgets,items,setItems}){
  const total=items.reduce((a,i)=>a+Number(i.qty)*Number(i.pu),0), iva=total*.16;
  const update=(i,k,v)=>setItems(items.map((r,idx)=>idx===i?{...r,[k]:v}:r));
  const removeRow=(i)=>setItems(items.filter((_,idx)=>idx!==i));
  const save=()=>{setBudgets([{id:'PRE-'+uid(),name:'Presupuesto ejecutivo',client:'Cliente por definir',items,total:total+iva,date:new Date().toLocaleDateString('es-MX')},...budgets]); alert('Presupuesto guardado');};
  return <section><PageHead kicker="Presupuestos" title="Presupuesto profesional" desc="Captura conceptos con su precio unitario (sin IVA), calcula totales con IVA y exporta con membrete. Las calculadoras del Centro Técnico pueden enviar conceptos directo aquí." action={<button onClick={save}>Guardar presupuesto</button>} />
    <div className="panel"><div className="apu-table-scroll"><table className="budget-table"><thead><tr><th>Concepto</th><th>Unidad</th><th>Cantidad</th><th>P.U. (sin IVA)</th><th>Importe</th><th></th></tr></thead><tbody>{items.map((it,i)=><tr key={i}><td><input value={it.concept} onChange={e=>update(i,'concept',e.target.value)}/></td><td><input value={it.unit} onChange={e=>update(i,'unit',e.target.value)}/></td><td><input type="number" value={it.qty} onChange={e=>update(i,'qty',e.target.value)}/></td><td><input type="number" value={it.pu} onChange={e=>update(i,'pu',e.target.value)}/></td><td>{money(it.qty*it.pu)}</td><td><a className="row-del" title="Eliminar concepto" onClick={()=>removeRow(i)}>✕</a></td></tr>)}</tbody></table></div><button className="soft" onClick={()=>setItems([...items,{concept:'Nuevo concepto',unit:'m²',qty:1,pu:0}])}>+ Agregar concepto</button><div className="totals"><Cost label="Subtotal" v={total}/><Cost label="IVA 16%" v={iva}/><div className="grand"><span>Total</span><b>{money(total+iva)}</b></div></div><div className="export-row"><button onClick={()=>exportBudgetExcel(items,total,iva)}>Exportar Excel</button><button onClick={()=>exportBudgetPDF(items,total,iva,company)}>Exportar PDF</button></div></div>
  </section>
}
function exportBudgetExcel(items,total,iva){const rows=[['PRESUPUESTO'],['Concepto','Unidad','Cantidad','P.U. (sin IVA)','Importe'],...items.map(i=>[i.concept,i.unit,i.qty,i.pu,Number(i.qty)*Number(i.pu)]),[],['Subtotal',total],['IVA 16%',iva],['Total',total+iva]];exportRowsExcel(rows,'Presupuesto-ZOEMEC.xlsx').catch(()=>alert('No pude generar el Excel. Inténtalo de nuevo.'));}
function exportBudgetPDF(items,total,iva,company){const doc=new jsPDF();let y=16;doc.setFontSize(16);doc.text(company.name||'ZOEMEC',14,y);doc.setFontSize(13);doc.text('PRESUPUESTO EJECUTIVO',14,y+14);y+=28;items.forEach(i=>{doc.text(i.concept,14,y,{maxWidth:100});doc.text(i.unit,118,y);doc.text(String(i.qty),135,y);doc.text(money(i.pu),152,y);doc.text(money(i.qty*i.pu),174,y);y+=10;if(y>270){doc.addPage();y=18;}});y+=6;doc.text('Subtotal',130,y);doc.text(money(total),170,y);y+=8;doc.text('IVA 16%',130,y);doc.text(money(iva),170,y);y+=8;doc.text('Total',130,y);doc.text(money(total+iva),170,y);doc.save('Presupuesto-ZOEMEC.pdf');}

function ClientsProjects({clients,setClients,projects,setProjects}){
  return <section><PageHead kicker="Centro de costos" title="Clientes y proyectos" desc="Administra clientes, contactos, RFC, obras, avances y presupuestos desde un solo módulo." />
    <div className="combined-stack">
      <Projects projects={projects} setProjects={setProjects} embedded />
      <Clients clients={clients} setClients={setClients} embedded />
    </div>
  </section>;
}

function Projects({projects,setProjects,embedded=false}){
  const list = projects || [];
  useEffect(()=>{
    const cleaned=list.filter(p=>!(p?.name==='Nuevo proyecto' && p?.client==='Cliente por definir' && Number(p?.budget||0)===0 && Number(p?.progress||0)===0));
    if(cleaned.length!==list.length) setProjects(cleaned);
  }, []);
  const [showForm,setShowForm]=useState(false);
  const [draft,setDraft]=useState({name:'',client:'',budget:'',progress:0,status:'Anteproyecto'});
  const add = () => setShowForm(true);
  const save = () => {
    if(!draft.name.trim() || !draft.client.trim()){
      alert('Captura nombre del proyecto y cliente.');
      return;
    }
    setProjects([{id:'PRO-'+uid(),name:draft.name.trim(),client:draft.client.trim(),progress:Number(draft.progress)||0,budget:Number(draft.budget)||0,status:draft.status||'Anteproyecto'}, ...list]);
    setDraft({name:'',client:'',budget:'',progress:0,status:'Anteproyecto'});
    setShowForm(false);
  };
  const update = (i,k,v) => setProjects(list.map((p,idx)=>idx===i?{...p,[k]:v}:p));
  const remove = (i) => setProjects(list.filter((_,idx)=>idx!==i));
  return <section>{!embedded && <PageHead kicker="Proyectos" title="Control de obra y proyectos" desc="Vista ejecutiva de obras, avance, presupuesto, cliente y estado." action={<button onClick={add}>+ Nuevo proyecto</button>} />}
    {embedded && <div className="module-subhead"><div><small>Proyectos</small><h2>Control de obra y avance</h2></div><button onClick={add}>+ Nuevo proyecto</button></div>}
    {showForm && <div className="record-modal" role="dialog" aria-modal="true">
    <div className="record-backdrop" onClick={()=>setShowForm(false)}></div>
    <div className="panel record-form project-form">
      <div className="record-form-head"><div><span>Alta de proyecto</span><h2>Datos iniciales de obra</h2></div><button className="secondary" onClick={()=>setShowForm(false)}>Cancelar</button></div>
      <div className="field-grid">
        <div className="nf"><label>Nombre del proyecto</label><input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} placeholder="Ej. Remodelacion local comercial"/></div>
        <div className="nf"><label>Cliente</label><input value={draft.client} onChange={e=>setDraft({...draft,client:e.target.value})} placeholder="Nombre del cliente o empresa"/></div>
        <div className="nf"><label>Presupuesto estimado</label><input type="number" value={draft.budget} onChange={e=>setDraft({...draft,budget:e.target.value})} placeholder="0.00"/></div>
        <div className="nf"><label>Estado</label><select value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value})}><option>Anteproyecto</option><option>Cotizacion</option><option>En ejecucion</option><option>Pausado</option><option>Cerrado</option></select></div>
        <div className="nf wide"><label>Avance inicial: {draft.progress}%</label><input type="range" min="0" max="100" value={draft.progress} onChange={e=>setDraft({...draft,progress:e.target.value})}/></div>
      </div>
      <div className="form-actions"><button className="secondary" onClick={()=>setDraft({name:'',client:'',budget:'',progress:0,status:'Anteproyecto'})}>Limpiar</button><button onClick={save}>Guardar proyecto</button></div>
    </div></div>}
    {list.length ? <div className="cards-3">{list.map((p,i)=><div className="project-card" key={i}>
      <span>{p.status}</span>
      <h2><input value={p.name} onChange={e=>update(i,'name',e.target.value)} /></h2>
      <p><input value={p.client} onChange={e=>update(i,'client',e.target.value)} /></p>
      <b>{money(p.budget)}</b>
      <progress value={p.progress} max="100"/>
      <small>{p.progress}% de avance - <a onClick={()=>remove(i)} style={{color:'var(--danger)'}}>eliminar</a></small>
    </div>)}</div> : <div className="panel"><EmptyState icon="proyectos" title="Tu cartera de proyectos está vacía" text="Crea el primer proyecto para activar el seguimiento de avance y presupuesto." actionLabel="+ Nuevo proyecto" onAction={add}/></div>}</section>
}
function Clients({clients,setClients,embedded=false}){
  const [q,setQ]=useState('');
  const [showForm,setShowForm]=useState(false);
  const [draft,setDraft]=useState({name:'',type:'Empresa',contact:'',phone:'',email:'',rfc:'',status:'Prospecto'});
  useEffect(()=>{
    const cleaned=clients.filter(c=>!(c?.name==='Nuevo cliente' && c?.contact==='Contacto' && !c?.phone && !c?.email && !c?.rfc && Number(c?.amount||0)===0));
    if(cleaned.length!==clients.length) setClients(cleaned);
  }, []);
  const filtered=clients.filter(c=>(c.name||'').toLowerCase().includes(q.toLowerCase()) || (c.contact||'').toLowerCase().includes(q.toLowerCase()) || (c.email||'').toLowerCase().includes(q.toLowerCase()));
  const save=()=>{
    if(!draft.name.trim() || !draft.contact.trim()){
      alert('Captura nombre del cliente y contacto principal.');
      return;
    }
    const next={id:'CLI-'+uid(),name:draft.name.trim(),type:draft.type,contact:draft.contact.trim(),phone:draft.phone.trim(),email:draft.email.trim(),rfc:draft.rfc.trim().toUpperCase(),projects:0,budgets:0,amount:0,status:draft.status};
    setClients([next,...clients]);
    setDraft({name:'',type:'Empresa',contact:'',phone:'',email:'',rfc:'',status:'Prospecto'});
    setShowForm(false);
  };
  return <section>{!embedded && <PageHead kicker="CRM de obra" title="Clientes" desc="Cartera profesional con proyectos, presupuestos, contactos, RFC e historial." action={<button onClick={()=>setShowForm(true)}>+ Nuevo cliente</button>} />}
    {embedded && <div className="module-subhead"><div><small>Clientes</small><h2>CRM de obra</h2></div><button onClick={()=>setShowForm(true)}>+ Nuevo cliente</button></div>}
    {showForm && <div className="record-modal" role="dialog" aria-modal="true">
    <div className="record-backdrop" onClick={()=>setShowForm(false)}></div>
    <div className="panel record-form client-form">
      <div className="record-form-head"><div><span>Alta de cliente</span><h2>Datos comerciales y contacto</h2></div><button className="secondary" onClick={()=>setShowForm(false)}>Cancelar</button></div>
      <div className="field-grid">
        <div className="nf"><label>Cliente o razon social</label><input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} placeholder="Ej. Constructora del Centro"/></div>
        <div className="nf"><label>Tipo</label><select value={draft.type} onChange={e=>setDraft({...draft,type:e.target.value})}><option>Empresa</option><option>Gobierno</option><option>Particular</option><option>Proveedor</option></select></div>
        <div className="nf"><label>Contacto principal</label><input value={draft.contact} onChange={e=>setDraft({...draft,contact:e.target.value})} placeholder="Nombre del responsable"/></div>
        <div className="nf"><label>Telefono</label><input value={draft.phone} onChange={e=>setDraft({...draft,phone:e.target.value})} placeholder="55 0000 0000"/></div>
        <div className="nf"><label>Correo</label><input type="email" value={draft.email} onChange={e=>setDraft({...draft,email:e.target.value})} placeholder="contacto@empresa.com"/></div>
        <div className="nf"><label>RFC</label><input value={draft.rfc} onChange={e=>setDraft({...draft,rfc:e.target.value})} placeholder="RFC opcional"/></div>
        <div className="nf"><label>Estado</label><select value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value})}><option>Prospecto</option><option>Activo</option><option>En seguimiento</option><option>Inactivo</option></select></div>
      </div>
      <div className="form-actions"><button className="secondary" onClick={()=>setDraft({name:'',type:'Empresa',contact:'',phone:'',email:'',rfc:'',status:'Prospecto'})}>Limpiar</button><button onClick={save}>Guardar cliente</button></div>
    </div></div>}
    <div className="panel clients-panel"><input className="search" placeholder="Buscar cliente, contacto o correo..." value={q} onChange={e=>setQ(e.target.value)}/><div className="client-grid">{filtered.map(c=><div className="client-card" key={c.id}><div className="client-avatar">{(c.name||'C')[0]}</div><div><h2>{c.name}</h2><p>{c.type} - {c.contact}</p><small>{c.email || c.phone || 'Sin contacto registrado'}</small><small>RFC: {c.rfc || 'Pendiente'}</small><div className="client-stats"><span>{c.projects} proyectos</span><span>{c.budgets} presupuestos</span><b>{money(c.amount)}</b></div></div><em>{c.status}</em></div>)}</div>{!filtered.length && !clients.length && <EmptyState icon="clientes" title="Aún no tienes clientes en tu Centro de costos" text="Agrega tu primer cliente con datos de contacto y RFC para iniciar la cartera." actionLabel="+ Nuevo cliente" onAction={()=>setShowForm(true)}/>}{!filtered.length && clients.length>0 && <EmptyState text="No hay clientes con ese criterio de búsqueda."/>}</div>
  </section>
}

/* Taxonomia unica de disciplinas: la usan tanto la Biblioteca (para clasificar
   documentos) como el motor de APU (para etiquetar la familia de un concepto,
   via APU_FAMILY_LABELS mas abajo). Un documento y un APU con la misma familia
   usan literalmente el mismo texto, para que "usar como fuente" tenga sentido. */
const LIBRARY_DISCIPLINES=[
  ['Acabados',['acabado','piso','azulejo','loseta','porcelanato','ceramico','pintura','aplanado','recubrimiento','boquilla','marmol','granito','sellador','registro','impermeabiliz']],
  ['Albanileria',['albanileria','muro','block','tabique','castillo','cadena','mortero','aplanado']],
  ['Tablaroca y Durock',['tablaroca','durock','yeso','plafon','bastidor','panel','lavabo']],
  ['Electricidad',['electricidad','electrico','electrica','cfe','luminaria','cable','contacto','canalizacion','conduit']],
  ['Hidrosanitaria',['hidrosanitario','hidraulica','sanitario','agua potable','drenaje','alcantarillado','tuberia','valvula','bomba','bombeo']],
  ['Aire acondicionado',['aire acondicionado','hvac','ducto','difusor','chiller','minisplit']],
  ['Estructura metalica',['estructura','metalica','acero','ptr','perfil','soldadura','herrerias','herreria']],
  ['Cimentacion',['cimentacion','zapata','losa','contratrabe','pilote','plantilla','concreto']],
  ['Terracerias',['terraceria','excavacion','relleno','compactacion','acarreo','base hidraulica']],
  ['Urbanizacion',['urbanizacion','pavimento','banqueta','guarnicion','asfalto','adoquin']],
  ['Equipamiento',['equipamiento','mobiliario','senaletica','senalizacion','juego','equipo']],
  ['Limpieza y preliminares',['limpieza','preliminar','trazo','nivelacion','demolicion','retiro']],
  ['Gas e incendio',['gas','incendio','sprinkler','hidrante','extintor']]
];
/* Mapa tipo interno del motor APU -> familia compartida con la Biblioteca.
   No cambia la clasificacion tecnica (tipo), solo la etiqueta que se muestra. */
const APU_FAMILY_LABELS = {
  concreto:'Cimentacion', acero:'Estructura metalica', estructura_metalica:'Estructura metalica',
  block:'Albanileria', tablaroca:'Tablaroca y Durock', lavabo_ptr:'Tablaroca y Durock', plafon_suspendido:'Tablaroca y Durock',
  pintura:'Acabados', aplanado:'Acabados', piso:'Acabados', marmol_granito:'Acabados', sello:'Acabados', registro:'Acabados', imper:'Acabados',
  excavacion:'Terracerias', tuberia:'Hidrosanitaria', bomba:'Hidrosanitaria', generico:'General'
};
function libKey(v=''){
  return cleanText(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9.%/ -]/g,' ').replace(/\s+/g,' ').trim();
}
function detectLibraryFamily(name='', cat=''){
  const key=libKey(`${name} ${cat}`);
  const hit=LIBRARY_DISCIPLINES.find(([,terms])=>terms.some(t=>key.includes(libKey(t))));
  return hit ? hit[0] : 'General';
}
function extractLibraryTags(name='', cat='', family=''){
  const key=libKey(`${name} ${cat} ${family}`);
  const tags=[
    ['apu','APU'],['matriz','Matriz'],['matrices','Matriz'],['precio','Precio'],['costo','Costo'],
    ['rendimiento','Rendimiento'],['mano de obra','Mano de obra'],['cuadrilla','Cuadrilla'],
    ['fsr','FSR'],['catalogo','Catalogo'],['base','Base'],['norma','Norma'],['formato','Formato'],
    ['excel','Excel'],['xlsx','Excel'],['pdf','PDF'],['obra publica','Obra publica'],['neodata','Neodata'],['opus','OPUS']
  ].filter(([needle])=>key.includes(needle)).map(([,tag])=>tag);
  const familyTags=family && family!=='General' ? [family] : [];
  return [...new Set([...familyTags,...tags])].slice(0,7);
}
function enrichLibraryMeta(meta, classify){
  const cat=meta.cat || classify(meta.name);
  const family=meta.family || detectLibraryFamily(meta.name, cat);
  const tags=meta.tags?.length ? meta.tags : extractLibraryTags(meta.name, cat, family);
  const sourceType=['XLS','XLSX','CSV'].includes(meta.ext) ? 'Hoja de costos' : ['PDF'].includes(meta.ext) ? 'Documento tecnico' : ['JPG','JPEG','PNG','WEBP'].includes(meta.ext) ? 'Imagen tecnica' : 'Archivo tecnico';
  return {...meta,cat,family,tags,sourceType,indexed:true,status:meta.status && meta.status!=='Pendiente de indice' ? meta.status : 'Indexado por metadata',confidence:Math.min(98,55+tags.length*7)};
}
function scoreLibraryFile(file,q=''){
  const query=libKey(q);
  if(!query) return 1;
  const hay=libKey([file.name,file.cat,file.family,file.sourceType,...(file.tags||[])].join(' '));
  const terms=query.split(' ').filter(Boolean);
  return terms.reduce((n,t)=>n+(hay.includes(t)?2:0), hay.includes(query)?8:0);
}

function Library({user}){
  const fileInputRef=useRef(null);
  const [files,setFiles]=useLocalState('zoemec-biblioteca',[]);
  const [uploading,setUploading]=useState(false);
  const [q,setQ]=useState('');
  const [type,setType]=useState('Todos');
  const [selected,setSelected]=useState(null);
  const [view,setView]=useState('tabla');
  const [page,setPage]=useState(1);
  const [syncing,setSyncing]=useState(false);
  const [lastSync,setLastSync]=useState(null);
  /* Antes esta lista solo salia de localStorage: cada subida escribia en Firestore
     pero nunca se volvia a leer de ahi, asi que el Panel Admin (que si lee Firestore)
     y esta pantalla mostraban datos distintos para el mismo usuario. Ahora Firestore
     es la fuente real; localStorage sigue siendo el cache de arranque instantaneo, y
     se conservan solo los archivos que de verdad nunca se sincronizaron (sin docId,
     ej. subidos sin sesion o sin Storage disponible). */
  useEffect(()=>{
    if(!firebaseReady || !user?.uid) return;
    let alive=true;
    setSyncing(true);
    (async()=>{
      try{
        const [ownSnap, globalSnap] = await Promise.all([
          getDocs(query(collection(db,'library'), where('ownerUid','==',user.uid))),
          getDocs(query(collection(db,'library'), where('visibility','==','global')))
        ]);
        const remote=new Map();
        [...ownSnap.docs, ...globalSnap.docs].forEach(d=>{
          const data=d.data();
          remote.set(d.id, {
            name:data.name || 'Documento', size:data.size || '0.00 MB', ext:data.ext || 'DOC',
            when:data.when || 'Sin fecha', cat:data.cat, family:data.family, tags:data.tags || [],
            status:data.status || 'Subido e indexado', uses:Number(data.uses || 0),
            downloadURL:data.downloadURL || '', storagePath:data.storagePath || '',
            ownerUid:data.ownerUid, visibility:data.visibility, indexed:Boolean(data.indexed),
            docId:d.id
          });
        });
        if(!alive) return;
        setFiles(current=>{
          const localOnly=current.filter(f=>!f.docId);
          return [...remote.values(), ...localOnly];
        });
        setLastSync(new Date().toLocaleTimeString('es-MX'));
      }catch{ /* sin conexion o sin permisos: se conserva el cache local */ }
      finally{ if(alive) setSyncing(false); }
    })();
    return ()=>{ alive=false; };
  },[user?.uid]);
  const classify=(name='')=>{
    const n=libKey(name);
    if(/matriz|matrices|precio unitario|analisis|apu/.test(n)) return 'Matrices APU';
    if(/rendimiento|mano de obra|mo |destajo|cuadrilla/.test(n)) return 'Mano de obra';
    if(/base|precio|costo|catalogo|opus|neodata|cmic|tabulador/.test(n)) return 'Costos';
    if(/norma|sct|cfe|conagua|reglamento|ntc/.test(n)) return 'Normas';
    if(/formato|generador|estimacion|presupuesto|plantilla/.test(n)) return 'Formatos';
    if(/curso|video|capacitacion/.test(n)) return 'Academia';
    return 'Documentos';
  };
  const add=async(fl)=>{
    if(!fl||!fl.length) return;
    const picked=[...fl];
    setUploading(true);
    try{
      const arr=[];
      for(const f of picked){
        const fileId='LIB-'+uid()+'-'+Date.now().toString(36);
        const meta=enrichLibraryMeta({name:cleanText(f.name),size:(f.size/1048576).toFixed(2)+' MB',ext:(f.name.split('.').pop()||'').toUpperCase(),when:new Date().toLocaleDateString('es-MX'),cat:classify(f.name),status:'Pendiente de indice',uses:0}, classify);
        if(firebaseReady && user?.uid){
          const fileRef=ref(storage, `library/${user.uid}/${fileId}/${f.name}`);
          await uploadBytes(fileRef, f, { customMetadata:{ ownerUid:user.uid, category:meta.cat, family:meta.family, tags:(meta.tags||[]).join(',') } });
          const downloadURL=await getDownloadURL(fileRef);
          const visibility=user.role === 'admin' ? 'global' : 'private';
          const docRef=await addDoc(collection(db,'library'), {
            ...meta,
            ownerUid:user.uid,
            visibility,
            storagePath:fileRef.fullPath,
            downloadURL,
            indexed:meta.indexed,
            createdAt:serverTimestamp()
          });
          meta.docId=docRef.id;
          meta.ownerUid=user.uid;
          meta.visibility=visibility;
          meta.downloadURL=downloadURL;
          meta.storagePath=fileRef.fullPath;
          meta.status='Subido e indexado';
        }
        arr.push(meta);
      }
      setFiles([...arr,...files]);
      setSelected(arr[0]);
      alert(firebaseReady && user?.uid ? `Subi ${arr.length} archivo(s) a Firebase Storage.` : `Agregue ${arr.length} archivo(s). Para compartirlos con otros usuarios inicia sesion y activa Storage.`);
    }catch(err){
      alert(`No pude subir el lote: ${err?.message || 'revisa reglas de Storage/Firestore'}`);
    }finally{
      setUploading(false);
    }
  };
  /* Antes solo se quitaba del arreglo local: el archivo real seguia vivo en
     Firestore/Storage y volvia a aparecer en la proxima sincronizacion. Ahora
     se borra de verdad cuando el usuario tiene permiso para hacerlo. */
  const del=async(i)=>{
    const target=files[i];
    setFiles(files.filter((_,idx)=>idx!==i));
    if(!target?.docId || !firebaseReady) return;
    try{
      await deleteDoc(doc(db,'library',target.docId));
      if(target.storagePath){
        await deleteObject(ref(storage, target.storagePath)).catch(()=>{});
      }
    }catch(err){
      alert(`Se quito de tu lista, pero no se pudo borrar de la nube: ${err?.message || 'revisa permisos.'}`);
    }
  };
  const types=['Todos','Costos','Matrices APU','Mano de obra','Normas','Formatos','Academia','Documentos'];
  const normalizedFiles=files.map((f,idx)=>({...enrichLibraryMeta(f, classify),__idx:idx}));
  const visible=normalizedFiles
    .filter(f=>(type==='Todos'||(f.cat||classify(f.name))===type) && scoreLibraryFile(f,q)>0)
    .sort((a,b)=>scoreLibraryFile(b,q)-scoreLibraryFile(a,q));
  const totalMb=files.reduce((a,f)=>a+(parseFloat(f.size)||0),0);
  const counts=types.slice(1).map(t=>[t,normalizedFiles.filter(f=>(f.cat||classify(f.name))===t).length]);
  const active=selected ? enrichLibraryMeta(selected, classify) : visible[0] || normalizedFiles[0];
  const pageSize = view === 'tablero' ? 12 : 25;
  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(page, pages);
  const pageItems = visible.slice((safePage - 1) * pageSize, safePage * pageSize);
  const batch = pageItems;
  const setFilterType=(next)=>{ setType(next); setPage(1); };
  const indexVisible=()=>{
    const names=new Set(visible.map(f=>`${f.name}|${f.when}`));
    const next=files.map(f=>names.has(`${f.name}|${f.when}`)?enrichLibraryMeta(f, classify):f);
    setFiles(next);
    alert(`Indice actualizado para ${visible.length} documento(s). Ya puedes buscar por familia, tags y tipo tecnico.`);
  };
  const suggestions=['muro block 15','loseta porcelanato','rendimiento albanil','PTR lavabo','tablaroca durock','indirectos oficina'];
  if(!canUse(user,'library')){
    return <section><PageHead kicker="Biblioteca ZOEMEC" title="Centro inteligente de costos" desc="La biblioteca tecnica es una funcion premium porque permite consultar bases, matrices, documentos y fuentes para IA." />
      <div className="locked-panel panel"><Icon name="biblioteca" size={42}/><div><h2>Biblioteca bloqueada para plan gratis</h2><p>Tu cuenta gratis incluye 1 APU. Para subir bases, indexar documentos, consultar matrices y usar la biblioteca como fuente de IA necesitas plan Inicial, Profesional o Empresa.</p><button onClick={()=>alert('Aqui se conectara Stripe o Mercado Pago para activar el plan automaticamente.')}>Activar plan</button></div></div>
      <div className="library-grid">{[['Inicial','Biblioteca limitada, academia y 10 APUs/mes','Para probar'],['Profesional','Biblioteca completa, cursos, IA y exportaciones','Recomendado'],['Empresa','Usuarios, permisos y biblioteca privada','Equipos']].map(f=><div className="folder" key={f[0]}><b>{f[0]}</b><p>{f[1]}</p><span>{f[2]}</span></div>)}</div>
    </section>;
  }
  return <section><PageHead kicker="Biblioteca ZOEMEC" title="Biblioteca y academia técnica" desc="Organiza costos, matrices, mano de obra, normas, formatos y cursos en un solo centro de conocimiento." />
    <div className="lib-hero panel">
      <div><small>Base tecnica</small><h2>{files.length ? `${files.length} documentos listos` : 'Tu Workspace documental está vacío'}</h2><p>La biblioteca debe funcionar como buscador tecnico, no como bodega de archivos. Cada documento queda clasificado por uso y listo para IA.</p></div>
      <div className="lib-hero-actions"><button className="secondary" onClick={()=>alert('Estado de nube: Firebase Storage guarda archivos y Firestore guarda metadata. Revisa reglas de Storage/Firestore y planes de usuario para produccion.')}>Estado de nube</button><label className="up-btn">{uploading?'Subiendo...':'Subir lote'}<input ref={fileInputRef} type="file" multiple onChange={e=>add(e.target.files)} hidden disabled={uploading}/></label></div>
    </div>
    <div className="lib-cloud panel">
      {[['1. Subida masiva','Puedes cargar lotes completos desde la plataforma. Para carpetas grandes conviene subir ZIP o seleccionar multiples archivos.'],['2. Nube privada','Los archivos reales deben vivir en Firebase Storage o Vercel Blob. Firestore guarda nombre, categoria, permiso, usuario y fuente.'],['3. Busqueda IA','Despues se indexa el contenido para buscar por insumo, concepto, unidad, precio, rendimiento o norma.']].map(x=><div key={x[0]}><b>{x[0]}</b><p>{x[1]}</p></div>)}
    </div>
    <div className="library-dashboard"><div className="lib-stat"><small>Documentos</small><b>{files.length}</b><span>{totalMb.toFixed(2)} MB cargados</span></div><div className="lib-stat"><small>Categorias activas</small><b>{counts.filter(x=>x[1]>0).length}</b><span>{type === 'Todos' ? 'Vista global' : type}</span></div><div className="lib-stat"><small>Seleccionados</small><b>{batch.length}</b><span>Lote visible para acciones IA</span></div></div>
    <div className="lib-console panel">
      <div className="lib-searchbar"><input className="search" placeholder="Buscar por concepto, insumo, familia, archivo o fuente..." value={q} onChange={e=>{setQ(e.target.value);setPage(1)}}/><button onClick={()=>alert('Busqueda IA: usa el indice documental para encontrar matrices, insumos y referencias compatibles con tu concepto.')}>Buscar con IA</button></div>
      <div className="lib-suggestions">{suggestions.map(s=><button key={s} onClick={()=>{setQ(s);setPage(1)}}>{s}</button>)}</div>
      <div className="lib-toolbar pro"><div className="lib-tabs">{types.map(t=><button key={t} className={type===t?'active':''} onClick={()=>setFilterType(t)}>{t}</button>)}</div><div className="seg"><button className={view==='tabla'?'active':''} onClick={()=>setView('tabla')}>Tabla</button><button className={view==='tablero'?'active':''} onClick={()=>setView('tablero')}>Tarjetas</button></div></div>
      <div className="lib-bulkbar"><b>{visible.length}</b><span>documentos encontrados</span><em>Pagina {safePage} de {pages}</em><label className="soft file-soft">Subida masiva<input type="file" multiple hidden onChange={e=>add(e.target.files)} disabled={uploading}/></label><button className="soft" onClick={indexVisible}>Indexar lote visible</button></div>
      <div className="lib-workbench">
        <aside className="lib-folders">{counts.map(([name,count])=><button key={name} onClick={()=>setFilterType(name)} className={type===name?'active':''}><Icon name="folder" size={15}/><span>{name}</span><b>{count}</b></button>)}</aside>
        <div className={view==='tablero'?'lib-board':'lib-table'}>
          {pageItems.length ? pageItems.map((f)=>{ const i=f.__idx ?? files.indexOf(f); const cat=f.cat||classify(f.name); const isActive=active?.name===f.name && active?.when===f.when; return <div className={'lib-file '+(isActive?'active':'')} key={i} onClick={()=>setSelected(f)}><span className="lib-ext">{f.ext||'DOC'}</span><div className="lib-meta"><b>{f.name}</b><small>{cat} - {f.family || 'General'} - {f.size} - {f.when}</small><em>{(f.tags||[]).length ? (f.tags||[]).slice(0,5).join(' · ') : cat==='Matrices APU'?'Puede alimentar APUs':cat==='Mano de obra'?'Rendimientos y cuadrillas':cat==='Costos'?'Precios y catalogos':'Consulta tecnica'}</em></div><div className="lib-actions"><button className="soft" onClick={(e)=>{e.stopPropagation(); f.downloadURL ? window.open(f.downloadURL,'_blank') : setSelected(f)}}>{f.downloadURL?'Abrir':'Ver'}</button><button className="row-del" onClick={(e)=>{e.stopPropagation();del(i)}}>x</button></div></div>}) : (files.length===0 ? <EmptyState icon="biblioteca" title="Tu Workspace documental está vacío" text="Sube tu primera base técnica para que ZOE pueda consultarla al generar APUs." actionLabel="Subir lote" onAction={()=>fileInputRef.current?.click()}/> : <div className="lib-empty">No hay documentos con ese filtro. Sube archivos o cambia la busqueda.</div>)}
          {visible.length > pageSize && <div className="lib-pager"><button className="soft" disabled={safePage<=1} onClick={()=>setPage(safePage-1)}>Anterior</button><span>{(safePage-1)*pageSize+1}-{Math.min(safePage*pageSize,visible.length)} de {visible.length}</span><button className="soft" disabled={safePage>=pages} onClick={()=>setPage(safePage+1)}>Siguiente</button></div>}
        </div>
        <aside className="lib-preview pro"><small>Ficha tecnica</small><h2>{active?.name || 'Sin archivo seleccionado'}</h2><p>{active ? (active.cat || classify(active.name))+' - '+(active.family || 'General')+' - '+(active.ext || 'DOC')+' - '+active.size : 'Sube documentos para crear una base consultable.'}</p>{active?.tags?.length ? <div className="lib-tags-mini">{active.tags.map(t=><span key={t}>{t}</span>)}</div> : null}<div className="lib-ai-card"><b>Acciones IA</b><button onClick={()=>alert('Usara este archivo como fuente para sugerir materiales, MO, equipo y rendimientos.')}>Usar para generar APU</button><button onClick={()=>alert('Comparara nombre, categoria y familia tecnica para sugerir matrices compatibles.')}>Buscar matrices similares</button><button onClick={()=>alert('Extraera descripciones, unidades, precios y rendimientos a una tabla auditable cuando el extractor de contenido este conectado.')}>Extraer insumos</button><button onClick={indexVisible}>Crear indice</button></div><div className="lib-trace"><span>Estado</span><b>{active?.status || 'Pendiente'}</b><span>Permiso</span><b>{user?.role==='admin'?'Administrador':'Plan Profesional'}</b><span>Confianza</span><b>{active ? `${active.confidence || 50}%` : 'Sin fuente'}</b></div></aside>
      </div>
    </div>
    <AcademyPanel />
    <div className="panel"><h2>Flujo recomendado</h2><div className="library-grid">{[['1. Carga masiva','Bases CMIC, matrices, MO, normas y formatos','Entrada'],['2. Clasificacion','Tipo, familia, unidad, fuente, fecha y confianza','Orden'],['3. Indice IA','Busqueda semantica y extraccion de insumos','IA'],['4. APU auditable','Fuente visible en Excel/PDF por cada insumo','Salida']].map(f=><div className="folder" key={f[0]}><b><Icon name="folder" size={17}/> {f[0]}</b><p>{f[1]}</p><span>{f[2]}</span></div>)}</div></div>
  </section>
}

function AcademyPanel(){
  const [list,setList]=useLocalState('zoemec-cursos', []);
  const [t,setT]=useState(''); const [d,setD]=useState(''); const [link,setLink]=useState('');
  const add=()=>{ if(!t.trim()) return; setList([{t:t.trim(),d:d.trim()||'Curso nuevo',p:0,link:link.trim()},...list]); setT(''); setD(''); setLink(''); };
  const del=(i)=>setList(list.filter((_,idx)=>idx!==i));
  const avg=Math.round(list.reduce((a,c)=>a+(Number(c.p)||0),0)/(list.length||1));
  return <div className="library-academy">
    <div className="academy-hero panel"><div><small>Academia integrada</small><h2>Capacitación dentro de tu biblioteca</h2><p>Cursos, videos y rutas de aprendizaje viven junto a tus bases, normas y matrices para alimentar el trabajo técnico.</p></div><div className="academy-meter"><b>{avg}%</b><span>avance promedio</span></div></div>
    <div className="academy-path">{['APU base','FSR y cuadrillas','Matrices e insumos','Presupuesto','IA y auditoria'].map((x,i)=><div key={x} className={i<2?'done':''}><span>{i+1}</span><b>{x}</b></div>)}</div>
    <div className="panel course-new pro"><div className="cn-fields"><div className="nf"><label>Titulo del curso</label><input value={t} onChange={e=>setT(e.target.value)} placeholder="Ej. Estimaciones y generadores"/></div><div className="nf"><label>Descripcion</label><input value={d} onChange={e=>setD(e.target.value)} placeholder="Que aprenderan"/></div></div><div className="nf"><label>Link del video</label><input value={link} onChange={e=>setLink(e.target.value)} placeholder="https://..."/></div><div className="cn-foot"><label className="up-btn ghost-up">Subir video<input type="file" accept="video/*" hidden onChange={()=>alert('La subida y alojamiento de video se habilita con Storage. Mientras tanto, pega el link del video.')}/></label><button onClick={add}>Crear curso</button></div></div>
    <div className="cards-3 academy-grid">{list.map((c,i)=><div className="course-card pro" key={i}><div className="thumb"><button className="thumb-play" onClick={()=>c.link ? window.open(c.link,'_blank') : alert('Agrega un link o sube video para reproducirlo.')}><Icon name="play" size={30}/></button></div><div className="cc-body"><small className="course-pill">Modulo {i+1}</small><h2>{c.t}</h2><p>{c.d}</p>{c.link && <a className="cc-link" href={c.link} target="_blank" rel="noreferrer">Ver video</a>}<progress value={c.p} max="100"/><div className="cc-foot"><input type="range" min="0" max="100" value={c.p} onChange={e=>setList(list.map((x,idx)=>idx===i?{...x,p:+e.target.value}:x))}/><small>{c.p}%</small></div><a className="cc-del" onClick={()=>del(i)}>Eliminar</a></div></div>)}</div>
  </div>;
}

/* Centro Técnico: calculadora de block + calculadora de FSR real (Art. 191 RLOPSRM) */
/* ---------- Calculadoras del Centro Técnico ---------- */
function NField({label,value,on,step}){return <div className="nf"><label>{label}</label><input type="number" step={step||'any'} value={value} onChange={e=>on(e.target.value)}/></div>;}
function ORow({label,val,total}){return <div className={"o"+(total?" total":"")}><span>{label}</span><b>{val}</b></div>;}
/* Envía el resultado de una calculadora directo al módulo de Presupuestos (ventaja vs OPUS/Neodata) */
function sendToBudget(p){
  const qty=Number(p?.qty)||0, pu=Number(p?.pu)||0;
  if(!p?.concept || qty<=0 || pu<=0 || !isFinite(pu)){ alert('Captura cantidades y precios válidos antes de enviar a presupuesto.'); return; }
  window.dispatchEvent(new CustomEvent('zoemec-budget-add',{detail:{concept:p.concept,unit:p.unit||'lote',qty:+qty.toFixed(2),pu:+pu.toFixed(2)}}));
  alert(`"${p.concept}" se agregó a Presupuestos con cantidad y P.U. calculados.`);
}
function copyCalcResult(title,out){
  const text=`${title}\n${out}`;
  navigator.clipboard?.writeText(text).then(()=>alert('Resultado copiado al portapapeles.')).catch(()=>alert(text));
}
function CalcCard({icon,title,sub,children,out,budget,copyText}){
  return <div className="panel calc">
    <div className="calc-head"><span className="ci"><Icon name={icon} size={20}/></span><div><h2>{title}</h2>{sub && <small className="muted">{sub}</small>}</div></div>
    {children}
    <div className="calc-out">{out}</div>
    {(budget||copyText) && <div className="calc-actions">
      {copyText && <button className="ghost" onClick={()=>copyCalcResult(title,copyText)}>Copiar</button>}
      {budget && <button onClick={()=>sendToBudget(budget)}>→ Presupuesto</button>}
    </div>}
  </div>;
}
const n2 = x => (Number(x)||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});

function ConcreteCalc(){
  const [s,setS]=useState({l:3,a:3,h:0.1,fc:'200',cem:225,are:480,gra:520});
  const set=(k,v)=>setS({...s,[k]:v});
  const DOS={'100':[5.5,0.56,0.69],'150':[6.2,0.54,0.68],'200':[7.0,0.51,0.66],'250':[8.0,0.50,0.65],'300':[9.0,0.49,0.63]};
  const vol=(+s.l||0)*(+s.a||0)*(+s.h||0), d=DOS[s.fc];
  const cem=vol*d[0], are=vol*d[1], gra=vol*d[2], agua=vol*180;
  const cost=cem*(+s.cem)+are*(+s.are)+gra*(+s.gra);
  return <CalcCard icon="concreto" title="Concreto hidráulico" sub="Volumen, dosificación y costo de material"
    budget={{concept:`Concreto hidráulico f'c=${s.fc} kg/cm² hecho en obra`,unit:'m³',qty:vol,pu:vol>0?cost/vol:0}}
    copyText={`Volumen: ${n2(vol)} m³ | Cemento: ${Math.ceil(cem)} bultos | Arena: ${n2(are)} m³ | Grava: ${n2(gra)} m³ | Costo: ${money(cost)}`}
    out={<><ORow label="Volumen" val={n2(vol)+' m³'}/><ORow label="Cemento" val={Math.ceil(cem)+' bulto'}/><ORow label="Arena" val={n2(are)+' m³'}/><ORow label="Grava" val={n2(gra)+' m³'}/><ORow label="Agua" val={Math.round(agua)+' L'}/><ORow label="Costo de material" val={money(cost)} total/></>}>
    <div className="calc-row"><NField label="Largo (m)" value={s.l} on={v=>set('l',v)}/><NField label="Ancho (m)" value={s.a} on={v=>set('a',v)}/><NField label="Espesor (m)" value={s.h} on={v=>set('h',v)}/></div>
    <div className="calc-row"><div className="nf"><label>Resistencia f'c</label><select value={s.fc} onChange={e=>set('fc',e.target.value)}>{Object.keys(DOS).map(k=><option key={k} value={k}>{k} kg/cm²</option>)}</select></div><NField label="Cemento ($/bulto)" value={s.cem} on={v=>set('cem',v)}/></div>
    <div className="calc-row"><NField label="Arena ($/m³)" value={s.are} on={v=>set('are',v)}/><NField label="Grava ($/m³)" value={s.gra} on={v=>set('gra',v)}/></div>
  </CalcCard>;
}

function SteelCalc(){
  const [s,setS]=useState({pzas:20,largo:6,diam:'1/2',merma:5,precio:26.5});
  const set=(k,v)=>setS({...s,[k]:v});
  const KGM={'3/8':0.560,'1/2':0.994,'5/8':1.552,'3/4':2.235,'1':3.973};
  const kg=(+s.pzas||0)*(+s.largo||0)*KGM[s.diam];
  const kgM=kg*(1+(+s.merma||0)/100);
  const cost=kgM*(+s.precio);
  return <CalcCard icon="acero" title="Acero de refuerzo" sub="Peso por varilla, merma y costo"
    budget={{concept:`Acero de refuerzo fy=4200 var. ${s.diam}" (incluye merma)`,unit:'kg',qty:kgM,pu:+s.precio||0}}
    copyText={`Acero: ${n2(kg)} kg | Con merma: ${n2(kgM)} kg | Costo: ${money(cost)}`}
    out={<><ORow label="Peso de acero" val={n2(kg)+' kg'}/><ORow label={`Con merma (${n2(s.merma)}%)`} val={n2(kgM)+' kg'}/><ORow label="Costo de acero" val={money(cost)} total/></>}>
    <div className="calc-row"><NField label="Piezas (varillas)" value={s.pzas} on={v=>set('pzas',v)}/><NField label="Largo c/u (m)" value={s.largo} on={v=>set('largo',v)}/></div>
    <div className="calc-row"><div className="nf"><label>Diámetro</label><select value={s.diam} onChange={e=>set('diam',e.target.value)}>{Object.keys(KGM).map(k=><option key={k} value={k}>{k}" ({KGM[k]} kg/m)</option>)}</select></div><NField label="Merma (%)" value={s.merma} on={v=>set('merma',v)}/></div>
    <NField label="Precio acero ($/kg)" value={s.precio} on={v=>set('precio',v)}/>
  </CalcCard>;
}

function BlockCalc(){
  const [s,setS]=useState({area:30,piezas:12.5,precio:16.5,cem:225,arena:480});
  const set=(k,v)=>setS({...s,[k]:v});
  const blocks=Math.ceil((+s.area||0)*(+s.piezas||0));
  const cemBultos=(+s.area||0)*0.16, arenaM3=(+s.area||0)*0.035;
  const cost=blocks*(+s.precio)+cemBultos*(+s.cem)+arenaM3*(+s.arena);
  return <CalcCard icon="block" title="Muro de block" sub="Piezas, mortero de junteo y costo"
    budget={{concept:'Muro de block de concreto 15 cm asentado con mortero',unit:'m²',qty:+s.area||0,pu:(+s.area||0)>0?cost/(+s.area):0}}
    copyText={`Blocks: ${blocks} pza | Cemento: ${Math.ceil(cemBultos)} bultos | Arena: ${n2(arenaM3)} m³ | Costo: ${money(cost)}`}
    out={<><ORow label="Blocks" val={blocks+' pza'}/><ORow label="Cemento (junteo)" val={Math.ceil(cemBultos)+' bulto'}/><ORow label="Arena" val={n2(arenaM3)+' m³'}/><ORow label="Costo de material" val={money(cost)} total/></>}>
    <div className="calc-row"><NField label="Área de muro (m²)" value={s.area} on={v=>set('area',v)}/><NField label="Blocks por m²" value={s.piezas} on={v=>set('piezas',v)}/></div>
    <div className="calc-row"><NField label="Precio block ($/pza)" value={s.precio} on={v=>set('precio',v)}/><NField label="Cemento ($/bulto)" value={s.cem} on={v=>set('cem',v)}/></div>
    <NField label="Arena ($/m³)" value={s.arena} on={v=>set('arena',v)}/>
  </CalcCard>;
}

function PaintCalc(){
  const [s,setS]=useState({area:100,rend:10,manos:2,precio:85});
  const set=(k,v)=>setS({...s,[k]:v});
  const litros=(+s.area||0)*(+s.manos||0)/(+s.rend||1);
  const cubetas=Math.ceil(litros/19), cost=litros*(+s.precio);
  return <CalcCard icon="pintura" title="Pintura" sub="Litros por rendimiento y manos"
    budget={{concept:`Pintura vinílica a ${s.manos} manos`,unit:'m²',qty:+s.area||0,pu:(+s.area||0)>0?cost/(+s.area):0}}
    copyText={`Litros: ${n2(litros)} L | Cubetas 19 L: ${cubetas} | Costo: ${money(cost)}`}
    out={<><ORow label="Litros" val={n2(litros)+' L'}/><ORow label="Cubetas 19 L" val={cubetas+' pza'}/><ORow label="Costo de pintura" val={money(cost)} total/></>}>
    <div className="calc-row"><NField label="Área (m²)" value={s.area} on={v=>set('area',v)}/><NField label="Rendimiento (m²/L)" value={s.rend} on={v=>set('rend',v)}/></div>
    <div className="calc-row"><NField label="Manos / capas" value={s.manos} on={v=>set('manos',v)}/><NField label="Precio ($/L)" value={s.precio} on={v=>set('precio',v)}/></div>
  </CalcCard>;
}

function WaterproofCalc(){
  const [s,setS]=useState({area:80,rend:1.2,capas:2,precio:78});
  const set=(k,v)=>setS({...s,[k]:v});
  const litros=(+s.area||0)*(+s.capas||0)/(+s.rend||1);
  const cubetas=Math.ceil(litros/19), cost=litros*(+s.precio);
  return <CalcCard icon="impermeabilizante" title="Impermeabilizante" sub="Material por capas de aplicación"
    budget={{concept:`Impermeabilizante acrílico a ${s.capas} capas`,unit:'m²',qty:+s.area||0,pu:(+s.area||0)>0?cost/(+s.area):0}}
    copyText={`Material: ${n2(litros)} L | Cubetas: ${cubetas} | Costo: ${money(cost)}`}
    out={<><ORow label="Material" val={n2(litros)+' L'}/><ORow label="Cubetas 19 L" val={cubetas+' pza'}/><ORow label="Costo de material" val={money(cost)} total/></>}>
    <div className="calc-row"><NField label="Área (m²)" value={s.area} on={v=>set('area',v)}/><NField label="Rendimiento (m²/L)" value={s.rend} on={v=>set('rend',v)}/></div>
    <div className="calc-row"><NField label="Capas" value={s.capas} on={v=>set('capas',v)}/><NField label="Precio ($/L)" value={s.precio} on={v=>set('precio',v)}/></div>
  </CalcCard>;
}

function ExcavationCalc(){
  const [s,setS]=useState({l:10,a:0.6,prof:0.8,abund:25,precio:180});
  const set=(k,v)=>setS({...s,[k]:v});
  const banco=(+s.l||0)*(+s.a||0)*(+s.prof||0);
  const suelto=banco*(1+(+s.abund||0)/100), cost=banco*(+s.precio);
  return <CalcCard icon="excavacion" title="Excavación" sub="Volumen en banco, abundamiento y mano de obra"
    budget={{concept:'Excavación a mano en material tipo B',unit:'m³',qty:banco,pu:+s.precio||0}}
    copyText={`Banco: ${n2(banco)} m³ | Suelto: ${n2(suelto)} m³ | Costo M.O.: ${money(cost)}`}
    out={<><ORow label="Volumen en banco" val={n2(banco)+' m³'}/><ORow label={`Vol. suelto (+${n2(s.abund)}%)`} val={n2(suelto)+' m³'}/><ORow label="Costo mano de obra" val={money(cost)} total/></>}>
    <div className="calc-row"><NField label="Largo (m)" value={s.l} on={v=>set('l',v)}/><NField label="Ancho (m)" value={s.a} on={v=>set('a',v)}/><NField label="Profundidad (m)" value={s.prof} on={v=>set('prof',v)}/></div>
    <div className="calc-row"><NField label="Abundamiento (%)" value={s.abund} on={v=>set('abund',v)}/><NField label="Precio M.O. ($/m³)" value={s.precio} on={v=>set('precio',v)}/></div>
  </CalcCard>;
}

function FoundationCalc(){
  const [s,setS]=useState({l:12,a:0.6,h:0.25,exc:180,conc:2450,plantilla:0.05});
  const set=(k,v)=>setS({...s,[k]:v});
  const vol=(+s.l||0)*(+s.a||0)*(+s.h||0);
  const excVol=(+s.l||0)*(+s.a||0)*((+s.h||0)+(+s.plantilla||0));
  const plantVol=(+s.l||0)*(+s.a||0)*(+s.plantilla||0);
  const cost=excVol*(+s.exc||0)+(vol+plantVol)*(+s.conc||0);
  return <CalcCard icon="concreto" title="Cimentación" sub="Excavación, plantilla y concreto por tramo"
    budget={{concept:'Cimentación de concreto (excavación, plantilla y colado)',unit:'m³',qty:vol,pu:vol>0?cost/vol:0}}
    copyText={`Excavación: ${n2(excVol)} m³ | Plantilla: ${n2(plantVol)} m³ | Concreto: ${n2(vol)} m³ | Costo: ${money(cost)}`}
    out={<><ORow label="Excavación" val={n2(excVol)+' m³'}/><ORow label="Plantilla" val={n2(plantVol)+' m³'}/><ORow label="Concreto cimentación" val={n2(vol)+' m³'}/><ORow label="Costo estimado" val={money(cost)} total/></>}>
    <div className="calc-row"><NField label="Largo (m)" value={s.l} on={v=>set('l',v)}/><NField label="Ancho (m)" value={s.a} on={v=>set('a',v)}/><NField label="Peralte (m)" value={s.h} on={v=>set('h',v)}/></div>
    <div className="calc-row"><NField label="Plantilla (m)" value={s.plantilla} on={v=>set('plantilla',v)} step="0.01"/><NField label="Excavación ($/m³)" value={s.exc} on={v=>set('exc',v)}/><NField label="Concreto ($/m³)" value={s.conc} on={v=>set('conc',v)}/></div>
  </CalcCard>;
}

function StoneCalc(){
  const [s,setS]=useState({l:10,a:0.6,h:0.8,piedra:520,cemento:225,arena:480,mo:650});
  const set=(k,v)=>setS({...s,[k]:v});
  const vol=(+s.l||0)*(+s.a||0)*(+s.h||0);
  const piedra=vol*1.15, cem=vol*3.1, arena=vol*0.42;
  const cost=piedra*(+s.piedra||0)+cem*(+s.cemento||0)+arena*(+s.arena||0)+vol*(+s.mo||0);
  return <CalcCard icon="block" title="Piedra" sub="Mampostería de piedra braza con mortero"
    budget={{concept:'Mampostería de piedra braza asentada con mortero cemento-arena',unit:'m³',qty:vol,pu:vol>0?cost/vol:0}}
    copyText={`Volumen: ${n2(vol)} m³ | Piedra: ${n2(piedra)} m³ | Cemento: ${Math.ceil(cem)} bultos | Arena: ${n2(arena)} m³ | Costo: ${money(cost)}`}
    out={<><ORow label="Volumen muro" val={n2(vol)+' m³'}/><ORow label="Piedra braza" val={n2(piedra)+' m³'}/><ORow label="Cemento" val={Math.ceil(cem)+' bultos'}/><ORow label="Arena" val={n2(arena)+' m³'}/><ORow label="Costo estimado" val={money(cost)} total/></>}>
    <div className="calc-row"><NField label="Largo (m)" value={s.l} on={v=>set('l',v)}/><NField label="Ancho (m)" value={s.a} on={v=>set('a',v)}/><NField label="Altura (m)" value={s.h} on={v=>set('h',v)}/></div>
    <div className="calc-row"><NField label="Piedra ($/m³)" value={s.piedra} on={v=>set('piedra',v)}/><NField label="Cemento ($/bulto)" value={s.cemento} on={v=>set('cemento',v)}/><NField label="M.O. ($/m³)" value={s.mo} on={v=>set('mo',v)}/></div>
    <NField label="Arena ($/m³)" value={s.arena} on={v=>set('arena',v)}/>
  </CalcCard>;
}

function ChainCalc(){
  const [s,setS]=useState({l:12,b:0.15,h:0.2,varillas:4,diam:'3/8',sep:0.2,conc:2450,acero:26.5});
  const set=(k,v)=>setS({...s,[k]:v});
  const KGM={'3/8':0.560,'1/2':0.994,'5/8':1.552};
  const vol=(+s.l||0)*(+s.b||0)*(+s.h||0);
  const longKg=(+s.l||0)*(+s.varillas||0)*KGM[s.diam];
  const estribos=Math.ceil((+s.l||0)/((+s.sep||0.2)||0.2))+1;
  const per=Math.max(0,2*((+s.b||0)+(+s.h||0)-0.08));
  const estrKg=estribos*per*0.25;
  const kg=(longKg+estrKg)*1.05;
  const cost=vol*(+s.conc||0)+kg*(+s.acero||0);
  return <CalcCard icon="acero" title="Cadena" sub="Concreto, varillas longitudinales y estribos"
    budget={{concept:`Cadena de concreto armado ${s.b}x${s.h} m con ${s.varillas} var. ${s.diam}"`,unit:'m',qty:+s.l||0,pu:(+s.l||0)>0?cost/(+s.l):0}}
    copyText={`Concreto: ${n2(vol)} m³ | Estribos: ${estribos} pza | Acero: ${n2(kg)} kg | Costo: ${money(cost)}`}
    out={<><ORow label="Concreto" val={n2(vol)+' m³'}/><ORow label="Estribos" val={estribos+' pza'}/><ORow label="Acero estimado" val={n2(kg)+' kg'}/><ORow label="Costo material" val={money(cost)} total/></>}>
    <div className="calc-row"><NField label="Largo (m)" value={s.l} on={v=>set('l',v)}/><NField label="Base (m)" value={s.b} on={v=>set('b',v)}/><NField label="Peralte (m)" value={s.h} on={v=>set('h',v)}/></div>
    <div className="calc-row"><NField label="Varillas" value={s.varillas} on={v=>set('varillas',v)}/><div className="nf"><label>Diámetro</label><select value={s.diam} onChange={e=>set('diam',e.target.value)}>{Object.keys(KGM).map(k=><option key={k}>{k}</option>)}</select></div><NField label="Estribos cada (m)" value={s.sep} on={v=>set('sep',v)} step="0.05"/></div>
    <div className="calc-row"><NField label="Concreto ($/m³)" value={s.conc} on={v=>set('conc',v)}/><NField label="Acero ($/kg)" value={s.acero} on={v=>set('acero',v)}/></div>
  </CalcCard>;
}

function ColumnTieCalc(){
  const [s,setS]=useState({pzas:4,h:2.6,b:0.15,d:0.15,varillas:4,diam:'3/8',sep:0.2,conc:2450,acero:26.5});
  const set=(k,v)=>setS({...s,[k]:v});
  const KGM={'3/8':0.560,'1/2':0.994,'5/8':1.552};
  const vol=(+s.pzas||0)*(+s.h||0)*(+s.b||0)*(+s.d||0);
  const longKg=(+s.pzas||0)*(+s.h||0)*(+s.varillas||0)*KGM[s.diam];
  const estribos=(+s.pzas||0)*(Math.ceil((+s.h||0)/((+s.sep||0.2)||0.2))+1);
  const per=Math.max(0,2*((+s.b||0)+(+s.d||0)-0.08));
  const estrKg=estribos*per*0.25;
  const kg=(longKg+estrKg)*1.05;
  const cost=vol*(+s.conc||0)+kg*(+s.acero||0);
  return <CalcCard icon="acero" title="Castillo" sub="Castillos de concreto armado por pieza"
    budget={{concept:`Castillo de concreto armado ${s.b}x${s.d} m, h=${s.h} m`,unit:'pza',qty:+s.pzas||0,pu:(+s.pzas||0)>0?cost/(+s.pzas):0}}
    copyText={`Concreto: ${n2(vol)} m³ | Estribos: ${estribos} pza | Acero: ${n2(kg)} kg | Costo: ${money(cost)}`}
    out={<><ORow label="Concreto" val={n2(vol)+' m³'}/><ORow label="Estribos" val={estribos+' pza'}/><ORow label="Acero estimado" val={n2(kg)+' kg'}/><ORow label="Costo material" val={money(cost)} total/></>}>
    <div className="calc-row"><NField label="Piezas" value={s.pzas} on={v=>set('pzas',v)}/><NField label="Altura c/u (m)" value={s.h} on={v=>set('h',v)}/><NField label="Sección b (m)" value={s.b} on={v=>set('b',v)}/><NField label="Sección d (m)" value={s.d} on={v=>set('d',v)}/></div>
    <div className="calc-row"><NField label="Varillas" value={s.varillas} on={v=>set('varillas',v)}/><div className="nf"><label>Diámetro</label><select value={s.diam} onChange={e=>set('diam',e.target.value)}>{Object.keys(KGM).map(k=><option key={k}>{k}</option>)}</select></div><NField label="Estribos cada (m)" value={s.sep} on={v=>set('sep',v)} step="0.05"/></div>
    <div className="calc-row"><NField label="Concreto ($/m³)" value={s.conc} on={v=>set('conc',v)}/><NField label="Acero ($/kg)" value={s.acero} on={v=>set('acero',v)}/></div>
  </CalcCard>;
}

function PlasterCalc(){
  const [s,setS]=useState({area:80,esp:1.5,cemento:225,arena:480,mo:95});
  const set=(k,v)=>setS({...s,[k]:v});
  const factor=(+s.esp||1.5)/1.5;
  const cem=(+s.area||0)*0.09*factor, arena=(+s.area||0)*0.025*factor;
  const cost=cem*(+s.cemento||0)+arena*(+s.arena||0)+(+s.area||0)*(+s.mo||0);
  return <CalcCard icon="pintura" title="Aplanado" sub="Mortero cemento-arena por espesor"
    budget={{concept:`Aplanado de mortero cemento-arena, espesor ${s.esp} cm`,unit:'m²',qty:+s.area||0,pu:(+s.area||0)>0?cost/(+s.area):0}}
    copyText={`Área: ${n2(s.area)} m² | Cemento: ${Math.ceil(cem)} bultos | Arena: ${n2(arena)} m³ | Costo: ${money(cost)}`}
    out={<><ORow label="Área" val={n2(s.area)+' m²'}/><ORow label="Cemento" val={Math.ceil(cem)+' bultos'}/><ORow label="Arena" val={n2(arena)+' m³'}/><ORow label="Costo estimado" val={money(cost)} total/></>}>
    <div className="calc-row"><NField label="Área (m²)" value={s.area} on={v=>set('area',v)}/><NField label="Espesor (cm)" value={s.esp} on={v=>set('esp',v)} step="0.1"/></div>
    <div className="calc-row"><NField label="Cemento ($/bulto)" value={s.cemento} on={v=>set('cemento',v)}/><NField label="Arena ($/m³)" value={s.arena} on={v=>set('arena',v)}/><NField label="M.O. ($/m²)" value={s.mo} on={v=>set('mo',v)}/></div>
  </CalcCard>;
}

function SlabCalc(){
  const [s,setS]=useState({area:60,esp:0.1,conc:2450,malla:48,mo:85});
  const set=(k,v)=>setS({...s,[k]:v});
  const vol=(+s.area||0)*(+s.esp||0);
  const malla=(+s.area||0)*1.05;
  const cost=vol*(+s.conc||0)+malla*(+s.malla||0)+(+s.area||0)*(+s.mo||0);
  return <CalcCard icon="concreto" title="Firme" sub="Firme de concreto con malla proporcional"
    budget={{concept:`Firme de concreto de ${Math.round((+s.esp||0)*100)} cm con malla electrosoldada`,unit:'m²',qty:+s.area||0,pu:(+s.area||0)>0?cost/(+s.area):0}}
    copyText={`Concreto: ${n2(vol)} m³ | Malla: ${n2(malla)} m² | Costo: ${money(cost)}`}
    out={<><ORow label="Concreto" val={n2(vol)+' m³'}/><ORow label="Malla / refuerzo" val={n2(malla)+' m²'}/><ORow label="Área firme" val={n2(s.area)+' m²'}/><ORow label="Costo estimado" val={money(cost)} total/></>}>
    <div className="calc-row"><NField label="Área (m²)" value={s.area} on={v=>set('area',v)}/><NField label="Espesor (m)" value={s.esp} on={v=>set('esp',v)} step="0.01"/></div>
    <div className="calc-row"><NField label="Concreto ($/m³)" value={s.conc} on={v=>set('conc',v)}/><NField label="Malla/refuerzo ($/m²)" value={s.malla} on={v=>set('malla',v)}/><NField label="M.O. ($/m²)" value={s.mo} on={v=>set('mo',v)}/></div>
  </CalcCard>;
}

function FSRCalc(){
  const [s,setS]=useState({tp:365,tl:250,ps:0.27});
  const set=(k,v)=>setS({...s,[k]:v});
  const tp=+s.tp||0, tl=+s.tl||1, ps=+s.ps||0;
  const fsr=(ps*(tp/tl))+(tp/tl);
  return <CalcCard icon="fsr" title="Factor de Salario Real" sub="Art. 191 RLOPSRM - Fsr = Ps x (Tp/Tl) + (Tp/Tl)"
    copyText={`FSR = ${fsr.toFixed(4)} (Tp=${s.tp}, Tl=${s.tl}, Ps=${s.ps})`}
    out={<><ORow label="Relación pagado/laborado" val={(tp/tl).toFixed(4)}/><ORow label="FSR" val={fsr.toFixed(4)} total/></>}>
    <div className="calc-row"><NField label="Tp — días pagados/año" value={s.tp} on={v=>set('tp',v)}/><NField label="Tl — días laborados/año" value={s.tl} on={v=>set('tl',v)}/></div>
    <NField label="Ps — obligaciones obrero-patronales (fracción)" value={s.ps} on={v=>set('ps',v)} step="0.01"/>
    <small className="muted">Úsalo en la columna FSR del APU.</small>
  </CalcCard>;
}

const CALC_GROUPS={
  'Estructura':[['Cimentación',FoundationCalc],['Cadena',ChainCalc],['Castillo',ColumnTieCalc],['Concreto',ConcreteCalc],['Acero',SteelCalc],['Firme',SlabCalc]],
  'Albañilería':[['Piedra',StoneCalc],['Muro de block',BlockCalc],['Aplanado',PlasterCalc]],
  'Acabados':[['Pintura',PaintCalc],['Impermeabilizante',WaterproofCalc]],
  'Terracerías':[['Excavación',ExcavationCalc]],
  'Costos':[['FSR',FSRCalc]]
};
function TechnicalCenter({embedded=false}){
  const [cat,setCat]=useState('Todas');
  const cats=['Todas',...Object.keys(CALC_GROUPS)];
  const list=cat==='Todas' ? Object.values(CALC_GROUPS).flat() : CALC_GROUPS[cat];
  return <section>{!embedded && <PageHead kicker="Centro Técnico" title="Calculadoras de obra" desc="Cuantifica y costea al instante. Todas las cantidades, rendimientos y precios son editables, y cada resultado puede enviarse directo a Presupuestos." />}
    {embedded && <div className="module-subhead"><div><small>Centro técnico</small><h2>Calculadoras de obra</h2></div></div>}
    <div className="lib-tabs calc-tabs">{cats.map(c=><button key={c} className={cat===c?'active':''} onClick={()=>setCat(c)}>{c}</button>)}</div>
    <div className="calc-wrap">
      {list.map(([name,C])=><C key={name}/>)}
    </div></section>;
}

function TechnicalOffice({company,setCompany,catalog,setCatalog}){
  return <section><PageHead kicker="Oficina Técnica" title="Centro técnico y configuración" desc="Calculadoras de obra, membrete, logo, plantillas y catálogo de precios en un solo módulo." />
    <div className="combined-stack">
      <Office company={company} setCompany={setCompany} catalog={catalog} setCatalog={setCatalog} embedded />
      <TechnicalCenter embedded />
    </div>
  </section>;
}

function Office({company,setCompany,catalog,setCatalog,embedded=false}){
  const uploadLogo=(file)=>{if(!file)return;const r=new FileReader();r.onload=()=>setCompany({...company,logo:r.result});r.readAsDataURL(file)};
  const importExcel=async(file)=>{ if(!file) return; if(/\.xls$/i.test(file.name)){alert('Guarda el archivo como .xlsx o .csv para importarlo.');return;} try{ const cat=await parseExcelToCatalog(file); if(!cat.length){alert('No detecté columnas de descripción y precio. Revisa los encabezados del Excel.');return;} setCatalog(cat); alert(`Catálogo importado: ${cat.length} insumos. El APU usará estos precios al generar.`);}catch(err){ alert(`No pude leer el archivo: ${err?.message || 'formato no compatible'}. Usa .xlsx o .csv.`); } };
  return <section>{!embedded && <PageHead kicker="Oficina Técnica" title="Empresa, logo y formatos" desc="Configura membretes, datos fiscales, firmas, plantillas y tu Excel de precios." />}{embedded && <div className="module-subhead"><div><small>Oficina técnica</small><h2>Empresa, logo y formatos</h2></div></div>}<div className="grid-2"><div className="panel form"><label>Logo</label><img className="logo-preview" src={company.logo}/><input type="file" accept="image/*" onChange={e=>uploadLogo(e.target.files[0])}/><label>Empresa</label><input value={company.name} onChange={e=>setCompany({...company,name:e.target.value})}/><label>RFC</label><input value={company.rfc} onChange={e=>setCompany({...company,rfc:e.target.value})}/><label>Teléfono</label><input value={company.phone} onChange={e=>setCompany({...company,phone:e.target.value})}/><label>Correo</label><input value={company.email} onChange={e=>setCompany({...company,email:e.target.value})}/></div><div className="panel"><h2>Plantillas</h2>{['Formato ZOEMEC','Formato gobierno','Formato CFE','Formato CONAGUA','Formato personalizado'].map(x=><div className="activity" key={x}><Icon name="doc" size={16}/> {x}</div>)}<h2>Mi Excel de precios</h2><label className="up-btn ghost-up" style={{display:'inline-block',marginTop:4}}>Importar catálogo (.xlsx/.csv)<input type="file" accept=".xlsx,.csv" hidden onChange={e=>importExcel(e.target.files[0])}/></label>{catalog&&catalog.length>0 && <p className="muted" style={{marginTop:10}}>Catálogo cargado: <b>{catalog.length}</b> insumos. Se usan al generar APUs por coincidencia de nombre.</p>}<p className="muted">Detecto columnas de descripción, unidad y precio automáticamente.</p></div></div></section>}

function Community(){
  const legacyForumThreads = ['Que rendimiento usan para muro de block 15 cm?','Proveedor de acero en zona centro','Formato de generadores para obra publica','Comparativo OPUS vs NEODATA'];
  const [posts,setPosts]=useLocalState('zoemec-foro',[]);
  useEffect(()=>{ if(posts.some(p=>legacyForumThreads.includes(p.q))) setPosts(posts.filter(p=>!legacyForumThreads.includes(p.q))); },[]);
  const [q,setQ]=useState(''); const [search,setSearch]=useState(''); const [cat,setCat]=useState('Tecnico'); const [filter,setFilter]=useState('Todos'); const [openReply,setOpenReply]=useState(-1); const [reply,setReply]=useState('');
  const cats=['Todos','Tecnico','Proveedores','Formatos','Software','Obra publica'];
  const visible=(filter==='Todos'?posts:posts.filter(p=>(p.cat||'Tecnico')===filter)).filter(p=>p.q.toLowerCase().includes(search.toLowerCase()) || (p.replies||[]).join(' ').toLowerCase().includes(search.toLowerCase()));
  const publish=()=>{ if(!q.trim()) return; setPosts([{q:q.trim(),who:'Diany',when:'ahora',likes:0,cat,status:'Abierto',replies:[]},...posts]); setQ(''); setFilter(cat); };
  const like=(i)=>setPosts(posts.map((p,idx)=>idx===i?{...p,likes:p.likes+1}:p));
  const addReply=(i)=>{ if(!reply.trim())return; setPosts(posts.map((p,idx)=>idx===i?{...p,replies:[...p.replies,reply.trim()],status:'Activo'}:p)); setReply(''); setOpenReply(-1); };
  return <section><PageHead kicker="Comunidad ZOEMEC" title="Red profesional de obra" desc="Resuelve dudas tecnicas, encuentra proveedores y comparte formatos con trazabilidad por usuario." />
    <div className="community-layout"><main><div className="community-hero"><div><small>Actividad</small><b>{posts.length}</b><span>hilos activos</span></div><div><small>Respuestas</small><b>{posts.reduce((a,p)=>a+p.replies.length,0)}</b><span>aportes tecnicos</span></div><div><small>Valorados</small><b>{posts.reduce((a,p)=>a+p.likes,0)}</b><span>votos utiles</span></div></div><div className="panel forum-new pro"><textarea placeholder="Pregunta algo tecnico: rendimiento, proveedor, formato, precio, software..." value={q} onChange={e=>setQ(e.target.value)} /><div className="forum-new-foot"><select value={cat} onChange={e=>setCat(e.target.value)}>{cats.filter(x=>x!=='Todos').map(x=><option key={x}>{x}</option>)}</select><span className="muted">Modo real: guardado por usuario, moderacion y permisos por plan.</span><button onClick={publish}>Publicar</button></div></div><div className="forum-tools"><div className="forum-tabs">{cats.map(x=><button key={x} className={filter===x?'active':''} onClick={()=>setFilter(x)}>{x}</button>)}</div><input className="search" placeholder="Buscar en el foro..." value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="panel forum-list pro">{visible.map((p)=>{ const i=posts.indexOf(p); return <div className="forum-item" key={i}><div className="forum-row"><div className="forum-q"><span className="forum-av">{p.who[0]}</span><div><div className="forum-tags"><em>{p.cat || 'Tecnico'}</em><strong>{p.status || 'Abierto'}</strong></div><b>{p.q}</b><small>{p.who} - {p.when}</small></div></div><div className="forum-acts"><button className="chip" onClick={()=>like(i)}>👍 {p.likes}</button><button className="chip" onClick={()=>setOpenReply(openReply===i?-1:i)}><Icon name="comunidad" size={14}/> {p.replies.length}</button></div></div>{p.replies.length>0 && <div className="forum-replies">{p.replies.map((r,ri)=><div className="forum-reply" key={ri}>{r}</div>)}</div>}{openReply===i && <div className="forum-replybox"><input value={reply} onChange={e=>setReply(e.target.value)} placeholder="Escribe una respuesta..." onKeyDown={e=>e.key==='Enter'&&addReply(i)}/><button onClick={()=>addReply(i)}>Responder</button></div>}</div>})}</div></main><aside className="community-side"><div className="panel"><h2>Temas calientes</h2>{['Rendimientos MO','Matrices APU','Proveedores','Obra publica'].map((x,i)=><div className="trend" key={x}><span>#{i+1}</span><b>{x}</b><small>{12-i*2} conversaciones</small></div>)}</div><div className="panel"><h2>Reglas de calidad</h2><p className="muted">Pregunta con concepto, unidad, zona y condicion de obra. Las mejores respuestas alimentan la biblioteca tecnica.</p></div></aside></div>
  </section>
}


function VisualAI({user}){
  const [image,setImage]=useState('');
  const [fileName,setFileName]=useState('');
  const [mode,setMode]=useState('fachada');
  const [prompt,setPrompt]=useState('Modernizar fachada con estilo contemporaneo, materiales aparentes, iluminacion arquitectonica y propuesta viable para obra.');
  const [result,setResult]=useState('');
  const [generatedImage,setGeneratedImage]=useState('');
  const [loading,setLoading]=useState(false);
  const load=(file)=>{
    if(!file) return;
    const reader = new FileReader();
    reader.onload=()=>{ setImage(reader.result); setFileName(file.name); };
    reader.readAsDataURL(file);
  };
  const localBrief=()=>{
    const modes = {
      fachada:'Analisis de fachada: conservar estructura principal, proponer paleta de materiales, iluminacion, herreria, canceleria, textura, jardineria y mejoras de acceso.',
      plano:'Plano a 3D: interpretar areas, volumenes, alturas aproximadas, circulaciones, estilo arquitectonico, materialidad y sugerir una volumetria inicial.',
      interior:'Interiorismo: proponer distribucion, mobiliario, acabados, iluminacion, plafones, colores y puntos criticos de ejecucion.',
      obra:'Revision de obra: detectar riesgos visuales, pendientes, seguridad, limpieza, avance y recomendaciones para reporte fotografico.'
    };
    return `${modes[mode]}\n\nInstruccion del usuario:\n${prompt}\n\nSalida esperada:\n1. Imagen o render propuesto.\n2. Lista de cambios visibles.\n3. Materiales sugeridos.\n4. Alcance preliminar para presupuesto.\n5. Observaciones tecnicas y supuestos.`;
  };
  const generate=async()=>{
    setLoading(true);
    try{
      const data=await apiPost('/api/visual-ai', { image, fileName, mode, prompt, uid:user?.uid, email:user?.email });
      const img = data.imageUrl || (data.imageB64 ? `data:image/png;base64,${data.imageB64}` : '');
      setGeneratedImage(img);
      setResult(data.result || localBrief());
    }catch(err){
      setGeneratedImage('');
      setResult(`${localBrief()}\n\nNo pude generar con IA en este momento:\n${friendlyServiceError(err,'Servicio temporalmente no disponible. Intenta de nuevo mas tarde.')}`);
    }finally{
      setLoading(false);
    }
  };
  return <section><PageHead kicker="Visual IA" title="Imagen, fachada y plano a propuesta" desc="Sube una fachada, avance de obra, interior o plano. ZOEMEC prepara un brief visual para generar propuestas, renders y alcances tecnicos." action={<button onClick={generate}>Generar propuesta</button>} />
    <div className="visual-grid">
      <div className="panel visual-uploader">
        <label className="visual-drop">
          {image ? <img src={image} alt="Referencia visual"/> : <div><Icon name="play" size={42}/><b>Subir imagen o plano</b><span>JPG, PNG o captura de plano</span></div>}
          <input type="file" accept="image/*" hidden onChange={e=>load(e.target.files[0])}/>
        </label>
        <div className="visual-meta"><b>{fileName || 'Sin archivo cargado'}</b><span>{image ? 'Vista previa lista para IA' : 'Sube una imagen para analizar fachada, plano u obra'}</span></div>
      </div>
      <div className="panel visual-form">
        <h2>Que quieres generar</h2>
        <div className="visual-modes">{[['fachada','Fachada'],['plano','Plano a 3D'],['interior','Interior'],['obra','Revision de obra']].map(x=><button key={x[0]} className={mode===x[0]?'active':''} onClick={()=>setMode(x[0])}>{x[1]}</button>)}</div>
        <label>Instrucciones para la IA</label>
        <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Ej. Quiero ver esta fachada mas moderna, con piedra, luz calida y porton negro..." />
        <div className="visual-actions"><button onClick={generate} disabled={loading}>{loading?'Generando...':'Generar brief visual'}</button><button className="secondary" onClick={()=>alert('La generacion con IA y el historial se procesan de forma segura en el servidor.')}>Ver configuracion IA</button></div>
      </div>
      <div className="panel visual-result">
        <h2>Salida tecnica</h2>
        {generatedImage && <img className="visual-generated" src={generatedImage} alt="Propuesta visual generada por ZOEMEC IA"/>}
        {result ? <pre>{result}</pre> : <p className="muted">Sube una imagen y genera el brief. ZOEMEC puede devolver propuesta visual, descripcion tecnica, materiales y alcance para presupuesto.</p>}
      </div>
    </div>
    <div className="visual-flow">{['Subir imagen a Storage','Guardar solicitud en Firestore','IA analiza referencia','Genera render o brief','Usuario aprueba y manda a presupuesto'].map((x,i)=><div key={x}><b>{i+1}</b><span>{x}</span></div>)}</div>
  </section>
}

function PlansAccess({user}){
  const [paying,setPaying]=useState('');
  const plans = [
    {name:'Inicial', price:'$399/mes', note:'Para probar la plataforma', items:['10 APUs al mes', 'PDF basico con marca ZOEMEC', 'Biblioteca de consulta limitada', 'Sin IA real masiva']},
    {name:'Profesional', price:'$899/mes', note:'Para oficina tecnica activa', featured:true, items:['APUs con IA y Excel auditable', 'PDF y Excel con membrete', 'Biblioteca tecnica completa', 'Presupuestos y reportes']},
    {name:'Empresa', price:'$1,899/mes', note:'Para equipos y constructoras', items:['Usuarios por rol', 'Matriz, FSR, cuadrillas y explosiones', 'Carga masiva de catalogos', 'Soporte y configuracion']},
    {name:'Admin', price:'Interno', note:'Control ZOEMEC', items:['Alta de usuarios', 'Control de planes', 'Biblioteca global', 'Moderacion de foro']}
  ];
  const payments = [
    {name:'Mercado Pago', tag:'Recomendado MX', desc:'Tarjeta, SPEI, OXXO y meses segun configuracion. Ideal para cobrar en Mexico.', action:'Crear checkout Mercado Pago'},
    {name:'Stripe', tag:'Internacional', desc:'Tarjetas, wallets y suscripciones. Bueno si despues venderas fuera de Mexico.', action:'Crear checkout Stripe'},
    {name:'Transferencia', tag:'Manual', desc:'Pago por SPEI/factura. Un admin valida y activa el plan en Firestore.', action:'Registrar pago manual'}
  ];
  const features = [
    ['APU inteligente', '10/mes', 'Ilimitado razonable', 'Equipo completo'],
    ['Excel auditable', 'Basico', 'Completo', 'Completo + plantillas'],
    ['Biblioteca tecnica', 'Lectura limitada', 'Completa', 'Completa + privada'],
    ['Foro y comunidad', 'Lectura', 'Publicar y responder', 'Moderacion interna'],
    ['IA real', 'No incluida', 'Incluida con limites', 'Mayor limite mensual'],
    ['Usuarios', '1', '1', '5+']
  ];
  const production = [
    ['Autenticacion', 'Firebase Auth con correo, Google y roles por usuario.'],
    ['Base de datos', 'Firestore para APUs, presupuestos, biblioteca, foro, planes y permisos.'],
    ['Archivos', 'Firebase Storage o Vercel Blob para Excel, PDF, cursos y documentos pesados.'],
    ['Cobro', 'Mercado Pago o Stripe con webhooks para activar plan automaticamente.'],
    ['IA segura', 'Endpoint serverless; la llave de IA nunca viaja al navegador del usuario.'],
    ['Control de uso', 'Contadores mensuales por plan: APUs, tokens IA, descargas y usuarios.']
  ];
  const payPlan=async(plan, method='Mercado Pago')=>{
    if(plan === 'Admin'){
      alert('El plan Admin se asigna manualmente desde Firestore para cuentas internas.');
      return;
    }
    if(method === 'Transferencia'){
      alert('Para transferencia: el usuario envia comprobante y un administrador activa el plan en Firestore. Siguiente paso: crear modulo de comprobantes.');
      return;
    }
    if(!user?.uid){
      alert('Inicia sesion para crear un checkout.');
      return;
    }
    setPaying(`${method}-${plan}`);
    try{
      const data=await apiPost('/api/create-checkout', { plan, method, uid:user.uid, email:user.email, name:user.name });
      if(data.url) window.location.href=data.url;
      else alert('El checkout respondio sin URL. Revisa el endpoint de Vercel.');
    }catch(err){
      alert(`No pude crear el checkout: ${friendlyServiceError(err,'Este metodo de pago no esta disponible en este momento.')}`);
    }finally{
      setPaying('');
    }
  };
  return <section><PageHead kicker="Planes y acceso" title="Modelo de cobro y permisos" desc="Define que puede usar cada cliente: APUs, IA, biblioteca, exportaciones, usuarios, descargas y soporte." />
    <div className="plans-grid">{plans.map(p=><div className={p.featured?'plan-card featured':'plan-card'} key={p.name}>
      <span>{p.name}</span><h2>{p.price}</h2><p>{p.note}</p>
      <ul>{p.items.map(x=><li key={x}>{x}</li>)}</ul>
      <button onClick={()=>payPlan(p.name)} disabled={Boolean(paying)}>{paying.endsWith(p.name)?'Conectando...':(p.featured?'Plan recomendado':'Configurar')}</button>
    </div>)}</div>
    <div className="payment-panel panel">
      <div className="payment-head"><div><small>Cobro real</small><h2>Metodos de pago para publicar</h2><p>El pago debe hacerse con un endpoint seguro. Las llaves secretas de Mercado Pago o Stripe nunca van dentro del React.</p></div><button onClick={()=>alert('Las credenciales de cobro se configuran de forma segura en el servidor, nunca en el navegador.')}>Ver configuracion</button></div>
      <div className="payment-grid">{payments.map(m=><div className="payment-card" key={m.name}>
        <span>{m.tag}</span><h3>{m.name}</h3><p>{m.desc}</p>
        <button onClick={()=>payPlan('Profesional',m.name)} disabled={Boolean(paying)}>{paying.startsWith(m.name)?'Conectando...':m.action}</button>
      </div>)}</div>
      <div className="pay-flow">{['Usuario elige plan','Checkout seguro','Webhook confirma pago','Firestore activa permisos','ZOEMEC libera funciones'].map((x,i)=><div key={x}><b>{i+1}</b><span>{x}</span></div>)}</div>
    </div>
    <div className="panel plan-matrix"><h2>Accesos por plan</h2><table><thead><tr><th>Funcion</th><th>Inicial</th><th>Profesional</th><th>Empresa</th></tr></thead><tbody>{features.map(r=><tr key={r[0]}>{r.map((c,i)=><td key={i}>{c}</td>)}</tr>)}</tbody></table></div>
    <div className="prod-grid">{production.map(([t,d])=><div className="prod-step" key={t}><b>{t}</b><p>{d}</p><small>Configurado por variables seguras y reglas de Firebase</small></div>)}</div>
  </section>
}
function Reports({clients,apus,budgets}){
  const total=budgets.reduce((a,b)=>a+(b.total||0),0);
  const hasData = Boolean(clients.length || apus.length || budgets.length);
  const segs=hasData ? [{label:'Presupuestos',value:budgets.length,color:'#9D6FD0'},{label:'APUs',value:apus.length,color:'#2A1740'},{label:'Clientes',value:clients.length,color:'#C7A35C'}].filter(s=>s.value>0) : [];
  const bars=[['Presupuestos enviados',Math.min(100,budgets.length*10),'#9D6FD0'],['APU creados',Math.min(100,apus.length*10),'#2A1740'],['Clientes nuevos',Math.min(100,clients.length*10),'#C7A35C']];
  const alerts=hasData ? [...apus.slice(0,2).map(a=>`APU ${a.clave || a.id} disponible para revisar`), ...budgets.slice(0,2).map(b=>`Presupuesto ${b.name} en cartera`)] : [];
  return <section><PageHead kicker="Reportes" title="Tablero ejecutivo" desc="Ventas, presupuestos, clientes, APUs, avances, utilidad y rendimiento de la oficina." action={<button>Exportar reporte</button>} /><div className="report-hero"><div><small>Venta potencial</small><b>{money(total)}</b><span>acumulado</span></div><div><small>Pipeline</small><b>{budgets.length ? 'Activo' : '0%'}</b><span>tasa de cierre</span></div><div><small>Productividad</small><b>{apus.length}</b><span>APU generados</span></div><div><small>Clientes</small><b>{clients.length}</b><span>activos</span></div></div><div className="dash-charts report-grid"><div className="panel"><h2>Cotizacion mensual</h2><Spark points={budgets.length ? budgets.slice(-8).map(b=>Math.max(1,(Number(b.total)||0)/1000)) : [0,0,0,0,0,0,0,0]} h={110}/><div className="chart-foot"><span>{budgets.length ? 'Presupuestos reales' : 'Sin datos reales'}</span><b>{budgets.length ? 'Actualizado' : '0% acumulado'}</b></div></div><div className="panel chart-donut"><h2>Cartera por tipo de obra</h2><Donut segments={segs} center={hasData ? '100%' : '0%'} sub="cartera"/><div className="donut-legend">{segs.length ? segs.map(s=><span key={s.label}><i style={{background:s.color}}/>{s.label} <b>{s.value}</b></span>) : <EmptyState text="Sin datos para graficar."/>}</div></div></div><div className="report-bottom"><div className="panel"><h2>Resumen mensual</h2>{bars.map(([label,val,color])=><div className="bar-row" key={label}><span>{label}</span><i><b style={{width:val+'%',background:color}}></b></i><em className="bar-val">{val}%</em></div>)}</div><div className="panel"><h2>Alertas ejecutivas</h2>{alerts.length ? alerts.map(a=><div className="activity" key={a}><Icon name="bell" size={15}/> {a}</div>) : <EmptyState text="Sin alertas hasta que existan movimientos reales."/>}</div></div></section>
}

function AdminPanel({user}){
  const [tab,setTab]=useState('usuarios');
  const [users,setUsers]=useState(null);
  const [usersErr,setUsersErr]=useState('');
  const [library,setLibrary]=useState(null);
  const [config,setConfig]=useState(null);
  const [health,setHealth]=useState(null);
  const [savingUid,setSavingUid]=useState(null);
  const [savingConfig,setSavingConfig]=useState(false);

  const loadUsers=async()=>{
    setUsers(null); setUsersErr('');
    try{
      const snap=await getDocs(collection(db,'users'));
      setUsers(snap.docs.map(d=>({id:d.id,...d.data()})));
    }catch(err){ setUsersErr(friendlyServiceError(err,'No se pudo leer la lista de usuarios.')); setUsers([]); }
  };
  const loadLibrary=async()=>{
    setLibrary(null);
    try{ const snap=await getDocs(collection(db,'library')); setLibrary(snap.docs.map(d=>({id:d.id,...d.data()}))); }
    catch{ setLibrary([]); }
  };
  const loadConfig=async()=>{
    setConfig(null);
    try{ const snap=await getDoc(doc(db,'config','platform')); setConfig(snap.exists()?snap.data():{}); }
    catch{ setConfig({}); }
  };
  const loadHealth=async()=>{
    setHealth(null);
    try{
      const res=await fetch('/api/health', { headers: await authHeaders() });
      const data=await res.json().catch(()=>null);
      if(!data) throw new Error('El servicio de diagnostico no respondio con datos validos.');
      if(!res.ok) throw new Error(data?.error || 'No se pudo consultar el estado del sistema.');
      setHealth(data);
    }catch(err){ setHealth({error:friendlyServiceError(err,'No se pudo consultar el estado del sistema.')}); }
  };

  useEffect(()=>{ loadUsers(); },[]);
  useEffect(()=>{
    if(tab==='biblioteca' && library===null) loadLibrary();
    if(tab==='config' && config===null) loadConfig();
    if(tab==='sistema' && health===null) loadHealth();
  },[tab]);

  const updateUser=async(uid,patch)=>{
    setSavingUid(uid);
    try{
      await setDoc(doc(db,'users',uid), patch, {merge:true});
      setUsers(list=>list.map(u=>u.id===uid?{...u,...patch}:u));
    }catch(err){ alert(`No pude actualizar el usuario: ${friendlyServiceError(err)}`); }
    finally{ setSavingUid(null); }
  };
  const saveConfig=async()=>{
    setSavingConfig(true);
    try{ await setDoc(doc(db,'config','platform'), config||{}, {merge:true}); alert('Configuración guardada.'); }
    catch(err){ alert(`No pude guardar la configuración: ${friendlyServiceError(err)}`); }
    finally{ setSavingConfig(false); }
  };

  const tabs=[['usuarios','Usuarios'],['empresas','Empresas'],['biblioteca','Biblioteca'],['planes','Planes y licencias'],['config','Configuración'],['sistema','Estado del sistema']];
  const Busy=()=><div className="ai-note-busy"><span className="asst-dots"><i/><i/><i/></span><b>Cargando datos reales de Firestore...</b></div>;

  return <section>
    <PageHead kicker="Panel Admin" title="Administración de la plataforma" desc="Usuarios, roles, organizaciones, biblioteca, licencias, configuración y estado del sistema, con datos reales de Firestore." />
    <div className="admin-tabs">{tabs.map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}</div>

    {tab==='usuarios' && <div className="panel admin-panel-body">
      <div className="admin-panel-head"><h2>Usuarios <small className="hint">({users?.length ?? '…'})</small></h2><button className="soft" onClick={loadUsers}>Actualizar</button></div>
      {users===null ? <Busy/> :
       usersErr ? <EmptyState icon="admin" title="No se pudo cargar" text={usersErr}/> :
       !users.length ? <EmptyState icon="clientes" title="Sin usuarios registrados" text="Cuando alguien se registre en ZOEMEC aparecerá aquí."/> :
       <div className="admin-table-wrap"><table className="data-table admin-table">
         <thead><tr><th>Usuario</th><th>Correo</th><th>Empresa</th><th>Rol</th><th>Plan</th><th>Estado</th><th>APUs</th></tr></thead>
         <tbody>{users.map(u=><tr key={u.id}>
           <td>{u.name||'—'}</td>
           <td>{u.email||'—'}</td>
           <td>{u.companyName||'—'}</td>
           <td><select value={u.role||'user'} disabled={savingUid===u.id} onChange={e=>updateUser(u.id,{role:e.target.value})}><option value="user">Usuario</option><option value="admin">Administrador</option></select></td>
           <td><select value={u.plan||'Gratis'} disabled={savingUid===u.id} onChange={e=>updateUser(u.id,{plan:e.target.value})}><option>Gratis</option><option>Inicial</option><option>Profesional</option><option>Empresa</option></select></td>
           <td><button className={'admin-status-toggle '+(u.active!==false?'ok':'off')} disabled={savingUid===u.id} onClick={()=>updateUser(u.id,{active:u.active===false})}>{u.active!==false?'Activo':'Inactivo'}</button></td>
           <td>{u.apusCreated||0}</td>
         </tr>)}</tbody>
       </table></div>}
    </div>}

    {tab==='empresas' && (()=>{
      const groups={};
      (users||[]).forEach(u=>{ const k=u.companyName||'Sin nombre de empresa'; (groups[k]=groups[k]||[]).push(u); });
      const rows=Object.entries(groups).sort((a,b)=>b[1].length-a[1].length);
      return <div className="panel admin-panel-body">
        <div className="admin-panel-head"><h2>Empresas <small className="hint">({rows.length})</small></h2></div>
        {users===null ? <Busy/> : !rows.length ? <EmptyState icon="oficina" title="Sin organizaciones aún" text="El nombre de empresa se registra cuando un usuario lo captura en Oficina técnica."/> :
        <div className="admin-table-wrap"><table className="data-table admin-table">
          <thead><tr><th>Empresa</th><th>Usuarios</th><th>Planes</th></tr></thead>
          <tbody>{rows.map(([name,us])=><tr key={name}><td>{name}</td><td>{us.length}</td><td>{[...new Set(us.map(u=>u.plan||'Gratis'))].join(', ')}</td></tr>)}</tbody>
        </table></div>}
      </div>;
    })()}

    {tab==='biblioteca' && <div className="panel admin-panel-body">
      <div className="admin-panel-head"><h2>Biblioteca <small className="hint">({library?.length ?? '…'})</small></h2><button className="soft" onClick={loadLibrary}>Actualizar</button></div>
      {library===null ? <Busy/> : !library.length ? <EmptyState icon="biblioteca" title="Sin documentos en Firestore" text="Los documentos que los usuarios suben a la Biblioteca aparecerán aquí."/> :
      <div className="admin-table-wrap"><table className="data-table admin-table">
        <thead><tr><th>Documento</th><th>Categoría</th><th>Visibilidad</th><th>Propietario</th><th>Tamaño</th></tr></thead>
        <tbody>{library.map(f=><tr key={f.id}><td>{f.name||'—'}</td><td>{f.cat||'—'}</td><td>{f.visibility||'private'}</td><td className="admin-uid">{f.ownerUid?String(f.ownerUid).slice(0,8):'—'}</td><td>{f.size||'—'}</td></tr>)}</tbody>
      </table></div>}
    </div>}

    {tab==='planes' && (()=>{
      const plans=['Gratis','Inicial','Profesional','Empresa'];
      const counts=plans.map(p=>({plan:p,count:(users||[]).filter(u=>(u.plan||'Gratis')===p).length,active:(users||[]).filter(u=>(u.plan||'Gratis')===p && u.active!==false).length}));
      return <div className="panel admin-panel-body">
        <div className="admin-panel-head"><h2>Planes y licencias</h2></div>
        {users===null ? <Busy/> : <div className="admin-plan-grid">{counts.map(c=><div className="admin-plan-card" key={c.plan}><b>{c.plan}</b><span className="admin-plan-count">{c.count}</span><small>{c.active} activos</small></div>)}</div>}
      </div>;
    })()}

    {tab==='config' && <div className="panel admin-panel-body">
      <div className="admin-panel-head"><h2>Configuración de la plataforma</h2></div>
      {config===null ? <Busy/> : <>
        <div className="field-grid">
          <div className="nf"><label>Correo de soporte</label><input value={config.supportEmail||''} onChange={e=>setConfig({...config,supportEmail:e.target.value})} placeholder="soporte@zoemec.mx"/></div>
          <div className="nf wide"><label>Aviso para todos los usuarios</label><input value={config.announcement||''} onChange={e=>setConfig({...config,announcement:e.target.value})} placeholder="Ej. Mantenimiento programado el sábado"/></div>
        </div>
        <button onClick={saveConfig} disabled={savingConfig}>{savingConfig?'Guardando...':'Guardar configuración'}</button>
      </>}
    </div>}

    {tab==='sistema' && <div className="panel admin-panel-body">
      <div className="admin-panel-head"><h2>Estado del sistema</h2><button className="soft" onClick={loadHealth}>Actualizar</button></div>
      {health===null ? <Busy/> :
       health.error ? <EmptyState icon="admin" title="No se pudo consultar" text={health.error}/> :
       <div className="admin-health-grid">{Object.entries(health.checks||{}).map(([key,c])=><div className={'admin-health-card '+c.status} key={key}>
         <b>{c.label||key}</b>
         <span className="admin-health-status">{c.status==='ok'?'Operativo':c.status==='error'?'Con errores':'No disponible'}</span>
         <p>{c.detail}</p>
       </div>)}</div>}
    </div>}
  </section>;
}

createRoot(document.getElementById('root')).render(<App />);
