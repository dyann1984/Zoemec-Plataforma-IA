import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { jsPDF } from 'jspdf';
import { createUserWithEmailAndPassword, getIdTokenResult, GoogleAuthProvider, onAuthStateChanged, sendEmailVerification, signInWithEmailAndPassword, signInWithPopup, signOut, updateProfile } from 'firebase/auth';
import { addDoc, collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, db, firebaseReady, storage } from './firebase.js';
import { useCloudState } from './cloud.js';
import { consumeOneDriveRedirect, isOneDriveConfigured } from './lib/onedrive.js';
import { createDemoContext } from './lib/apuFlow.js';
import { APU_DEFAULT_FACTORS, DEFAULT_IVA_RATE, calcAPU, rowImporte, toSafeNonNegativeNumber } from './lib/apuCalc.js';
import { migrateLegacyApuToV2 } from './domain/apuSchema.js';
import { finalizeProfessionalAPU, makePriceRecord } from './domain/apuProfessional.js';
import { runApuConfidence, formatGlobalConfidence } from './domain/apuConfidence.js';
import { AI_PROGRESS_STEPS, nextProgressIndex, resolveBusyLabel, canStartAiGeneration } from './domain/aiGenerationProgress.js';
import { validateProjectDraft } from './domain/projectDraftValidation.js';
import { exportAPUExcelV2, exportAPUPdfV2, exportAPUPdfMaster } from './lib/apuExportV2.js';
import { exportProjectDossierPdf } from './lib/apuProjectDossierPdf.js';
import { exportProjectDossierExcel } from './lib/apuProjectDossierXlsx.js';
import {
  money, num, excelCell, XLS, xcell, fcell, styleHeader, styleSection,
  exportRowsCSV, exportRowsExcel, exportWorkbookExcel,
  buildAuditModel, exportAPUPDFPro, buildCompleteAPUSheet, exportAPUExcel,
  exportBudgetExcel, exportBudgetPDF
} from './lib/apuExport.js';
import { uid } from './utils/id.js';
import { getDeviceId, readLocal, writeLocal } from './utils/localStorage.js';
import { setActiveUid } from './utils/scopedStorage.js';
import { useLocalState } from './hooks/useLocalState.js';
import { useAuthoritativeProjects } from './hooks/useAuthoritativeProjects.js';
import { useAuthoritativeApus } from './hooks/useAuthoritativeApus.js';
import { authHeaders, apiPost, readJsonSafe, httpErrorMessage, apiGetSafe, aiServerUrl } from './services/apiClient.js';
import { firebaseMessage, friendlyServiceError } from './services/errorMessages.js';
import { loadOrCreateProfile, fallbackProfile, buildSession, connectOneDrive } from './services/userSession.js';
import {
  hasValidSession, PLAN_LIMITS, ADMIN_EMAILS,
  isAdminUser, canUse, userInitials
} from './domain/permissions.js';
import { Icon } from './components/ui/Icon.jsx';
import { ZoemecBrand } from './components/ui/ZoemecBrand.jsx';
import { Backdrop } from './components/ui/Backdrop.jsx';
import { Donut, Spark } from './components/ui/charts.jsx';
import { PageHead, InfoCard, EmptyState } from './components/ui/PageElements.jsx';
import { Param, Cost, NField, ORow } from './components/ui/FormFields.jsx';
import { HardHat } from './components/ui/HardHat.jsx';
import {
  conceptApuKey, applyConceptMetadataV2, templateFallbackAPU,
  saveMarketPrice, standardAPUForConcept, makeAPUFromConcept, makeEmptyAPU
} from './domain/apuGeneration.js';
import { enrichApuWithIntelligence2 } from './domain/materialPriceIntelligence2.js';
import { createIntelligence2RunContext } from './domain/intelligence2Runtime.js';
import { libKey, enrichLibraryMeta, scoreLibraryFile } from './domain/library.js';
import { INSUMO_STATES, applyInsumoReview, extractValidatedCatalogRows, extractAllValidatedCatalogRows, mergeCatalogRows } from './domain/libraryReview.js';
import { toApuSeed, applyPlanoElementReview } from './domain/planoReview.js';
import { calibrateScale, measureElement } from './domain/planoMeasurement.js';
import { createTakeoffRecord, applyManualCorrection, upsertTakeoffRecord, findLatestTakeoffForFile, hashFileContent } from './domain/planoTakeoffStore.js';
import {
  emptyApuWorkspaceState, removeBatchApus, describeAmbiguousSingleExport,
  duplicateGroupKey, groupConceptsByDuplicateKey, defaultBatchSelection, isExportableConceptItem,
  conceptNeedsReviewFlag, resolveBatchSelection, scopedListView, mergeScopedUpdate,
  resolveBatchExportApus, assertExpectedExportCount
} from './domain/apuWorkspace.js';
import {
  ITEM_STATUS, createBatchJob, fingerprintCatalog, selectNextBatch,
  markItemStatus, markItemError, markItemDone, retryFailedItems, cancelJob,
  summarizeJob, isJobComplete
} from './domain/apuBatchQueue.js';
import {
  saveJobMeta, saveItemState, loadJob, markJobCancelled,
  setActiveBatchId, getActiveBatchId, clearActiveBatchId, deleteJob as deleteQueueJob
} from './lib/apuBatchQueueCloud.js';
import { TechnicalCenter } from './features/technical-center/TechnicalCenter.jsx';
import { AdminPanel } from './features/admin/AdminPanel.jsx';
import { ProfessionalApuEditor } from './features/apu/ProfessionalApuEditor.jsx';
import { RevisionBandeja } from './features/apu/RevisionBandeja.jsx';
import { parseExcelToCatalog, cleanText, normalizeUnitLabel, parseExcelToAPU, parseRobustConceptCatalog, parseConceptText, parseConceptListText, conceptVariablesFromParsed } from './lib/excelImport.js';
import {
  defaultCompany, DEMO_MODE, demoCatalog,
  legacySeedClientNames, legacySeedProjectNames, libraryFolders, courses
} from './config/appConfig.js';
import { I18nProvider, useI18n } from './i18n/I18nContext.jsx';
import { ThemeProvider, useTheme } from './theme/ThemeContext.jsx';
import { useInstallPrompt } from './hooks/useInstallPrompt.js';
import './style.css';

if('serviceWorker' in navigator){
  // Registro diferido a 'load': no compite por ancho de banda/CPU con el
  // primer render de la SPA. Si falla (ej. entorno de desarrollo sin
  // HTTPS), no rompe la app -- el catch solo evita una promesa rechazada
  // sin manejar en consola.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
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
  /* Antes esto solo se consultaba al abrir el desplegable, asi que la insignia
     (siempre visible) no podia reflejar el estado real de Firebase/OpenAI/
     OneDrive: siempre mostraba el mismo texto generico. Ahora se consulta al
     montar, para que la etiqueta ya sea honesta desde el primer render. */
  useEffect(()=>{
    let alive=true;
    apiGetSafe('/api/status').then(data=>{ if(alive) setRemote(data); });
    if(firebaseReady && user?.uid){
      getCountFromServer(query(collection(db,'library'), where('ownerUid','==',user.uid)))
        .then(snap=>{ if(alive) setLibInfo({count:snap.data().count, checkedAt:new Date().toLocaleTimeString('es-MX')}); })
        .catch(()=>{ if(alive) setLibInfo(null); });
    }
    apiPost('/api/onedrive', { action:'status' }).then(data=>{ if(alive) setOneDrive(data); }).catch(()=>{ if(alive) setOneDrive(null); });
    return ()=>{ alive=false; };
  },[user?.uid]);
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
  /* Estado global real, no solo el de escritura de Firestore: considera
     Firebase, OpenAI y OneDrive juntos, con reglas explicitas:
     - sin internet -> "Sin conexión" (gris)
     - Firestore realmente fallando (escritura con error) -> "Trabajo local
       protegido" (los datos siguen a salvo en localStorage, rojo solo si la
       falla es critica de verdad)
     - Firebase/OpenAI bien pero OneDrive no conectado/configurado (o OpenAI no
       disponible) -> "Sincronización parcial" (ambar, nunca rojo por esto)
     - todo activo -> "Servicios conectados" (verde) */
  const firebaseCriticalError = st.status==='error';
  const openaiOk = remote?.openai==='ok';
  const oneDriveOk = Boolean(oneDrive?.connected);
  const googleDriveConfigured = Boolean(remote?.googleDriveConfigured);
  let mode, label;
  if(!online){ mode='off'; label='Sin conexión'; }
  else if(firebaseCriticalError){ mode='error'; label='Trabajo local protegido'; }
  else if(st.status==='saving'){ mode='saving'; label='Guardando en la nube...'; }
  else if(remote && !openaiOk){ mode='partial'; label='Sincronización parcial'; }
  else if(remote && !googleDriveConfigured){ mode='partial'; label='Sincronización parcial'; }
  else if(oneDrive && !oneDriveOk){ mode='partial'; label='Sincronización parcial'; }
  else { mode='ok'; label='Servicios conectados'; }
  const rows = [
    { key:'firebase', label:'Firebase / Firestore', ok: online && st.status!=='error',
      detail: !online ? 'Sin conexión a internet.' : st.status==='error' ? (st.message || 'No se pudo sincronizar.') : 'Conectado y sincronizando.' },
    { key:'library', label:'Biblioteca', ok: Boolean(libInfo),
      detail: !user?.uid ? 'Inicia sesión para ver tu biblioteca.' : libInfo ? `${libInfo.count} documento(s) · verificado a las ${libInfo.checkedAt}` : 'Consultando Firestore...' },
    { key:'openai', label:'OpenAI', ok: remote?.openai==='ok',
      detail: remote ? (remote.openai==='ok' ? 'Configurada y responde.' : 'No disponible en este entorno.') : 'No disponible aquí (revisa conexión).' },
    { key:'googledrive', label:'Google Drive', ok: googleDriveConfigured,
      detail: remote ? (googleDriveConfigured ? 'Configurado en el servidor.' : 'No configurado (repositorio técnico no disponible).') : 'No disponible aquí (revisa conexión).' },
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

function NotificationBell({user}){
  const [items,setItems]=useLocalState('zoemec-notif-history', [], user?.uid);
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

/* Aislamiento por proyecto: envuelve una lista guardada por usuario (apus,
   presupuestos, catalogo, budgetItems) para que se lea/escriba SOLO el
   subconjunto del proyecto activo, sin cambiar el almacenamiento real (sigue
   siendo una lista por usuario en Firestore/localStorage vía useCloudState).
   Cualquier item sin projectId propio se etiqueta con el proyecto activo al
   guardarse -- así ningún llamador existente (setApus([...]), setApus(prev=>...))
   tuvo que cambiar: siguen operando sobre la vista ya filtrada, y esta funcion
   la vuelve a fusionar con los items de los demás proyectos sin tocarlos. */
function useProjectScoped(list, setList, activeProjectId){
  const scopeKey = activeProjectId ?? null;
  const scoped = useMemo(() => scopedListView(list, scopeKey), [list, scopeKey]);
  const setScoped = (next) => {
    setList(prevList => {
      const prevScoped = scopedListView(prevList, scopeKey);
      const nextScoped = typeof next === 'function' ? next(prevScoped) : next;
      return mergeScopedUpdate(prevList, scopeKey, nextScoped);
    });
  };
  return [scoped, setScoped];
}

function App(){
  const [screen, setScreen] = useState('landing');
  const [module, setModule] = useState('inicio');
  /* Modo Build Week / Demo: Panel Admin ya no aparece en el menu lateral, pero
     sigue existiendo intacto. Un administrador puede llegar directo agregando
     #admin a la URL (ej. localhost:5173/#admin); si el usuario no es admin,
     el "module==='admin' && user.isAdmin" de mas abajo simplemente no renderiza
     nada, sin exponer la ruta a usuarios normales. */
  useEffect(() => {
    const checkAdminHash = () => {
      if(window.location.hash === '#admin') setModule('admin');
    };
    checkAdminHash();
    window.addEventListener('hashchange', checkAdminHash);
    return () => window.removeEventListener('hashchange', checkAdminHash);
  }, []);
  const [zoeContext, setZoeContext] = useState({ user: null, route: 'inicio', activeApu: null, budget: null, project: null, importedFile: null, library: [], alerts: [], history: [] });
  const [user, setUser] = useState(null);
  const [accounts, setAccounts] = useLocalState('zoemec-accounts', [], user?.uid);
  const [usage, setUsage] = useLocalState('zoemec-usage', {}, user?.uid);
  const [company, setCompany] = useCloudState(user, 'zoemec-company', defaultCompany);
  // Fase 7: Proyecto/APU ya no viven solo en el blob de useCloudState -- un
  // documento real por entidad, validado/auditado/versionado server-side
  // (ver src/hooks/useAuthoritativeProjects.js / useAuthoritativeApus.js).
  // Mismo contrato [value, setValue], el resto de este archivo no cambia.
  const [rawApus, setRawApus, linkApuToProject] = useAuthoritativeApus(user, []);
  const [clients, setClients] = useCloudState(user, 'zoemec-clients', []);
  const [rawBudgets, setRawBudgets] = useCloudState(user, 'zoemec-budgets', []);
  const [projects, setProjects] = useAuthoritativeProjects(user, []);
  const [rawCatalog, setRawCatalog] = useCloudState(user, 'zoemec-catalogo', []);
  const [rawBudgetItems, setRawBudgetItems] = useCloudState(user, 'zoemec-budget-items', [{concept:'Muro de block 15 cm',unit:'m²',qty:120,pu:825.39},{concept:'Piso cerámico 30x30 cm',unit:'m²',qty:86,pu:384.51}]);
  // activeProjectId: aislamiento real de datos por proyecto (seccion 13/1 del
  // sprint). apus/budgets/catalog/budgetItems que el resto de la app usa son
  // la vista YA filtrada al proyecto activo; el almacenamiento completo (todas
  // las obras del usuario) vive en raw* y nunca se expone directo a los modulos.
  const [activeProjectId, setActiveProjectId] = useLocalState('zoemec-active-project', null, user?.uid);
  useEffect(() => {
    if(activeProjectId && !projects.some(p => p.id === activeProjectId)){
      setActiveProjectId(projects[0]?.id || null);
    } else if(!activeProjectId && projects.length){
      setActiveProjectId(projects[0].id);
    }
  }, [projects, activeProjectId]);
  const [apus, setApus] = useProjectScoped(rawApus, setRawApus, activeProjectId);
  const [budgets, setBudgets] = useProjectScoped(rawBudgets, setRawBudgets, activeProjectId);
  const [catalog, setCatalog] = useProjectScoped(rawCatalog, setRawCatalog, activeProjectId);
  const [budgetItems, setBudgetItems] = useProjectScoped(rawBudgetItems, setRawBudgetItems, activeProjectId);
  useEffect(() => {
    const onAdd = (e) => { if(e?.detail) setBudgetItems(list => [...list, e.detail]); };
    window.addEventListener('zoemec-budget-add', onAdd);
    return () => window.removeEventListener('zoemec-budget-add', onAdd);
  }, [setBudgetItems]);
  useEffect(() => {
    const onContext = (e) => setZoeContext(prev => ({ ...prev, ...e.detail }));
    window.addEventListener('zoemec-zoe-context', onContext);
    return () => window.removeEventListener('zoemec-zoe-context', onContext);
  }, []);
  useEffect(() => {
    if(!DEMO_MODE) return;
    if(!projects.length){
      setProjects([{ id:'PRO-DEMO', name:'Demo: Proyecto demostrativo', client:'Constructora Demo', progress:72, budget:1250000, status:'En ejecución' }]);
    }
    if(!budgets.length){
      setBudgets([{ id:'PRE-DEMO', name:'Demo: Presupuesto demostrativo', client:'Constructora Demo', items:[{ concept:'Muro de block 15 cm', unit:'m²', qty:120, pu:825 }], total:99000, date:new Date().toLocaleDateString('es-MX') }]);
    }
    if(!catalog.length){
      setCatalog(demoCatalog.map(item => ({ ...item, desc: item.desc, unidad: item.unidad, precio: item.precio })));
    }
    if(!apus.length){
      setApus([{ id:'APU-DEMO', clave:'APU-DEMO', concept:'Muro de block 15 cm', unit:'m²', materials:[["Block hueco 15x20x40",12.5,'pza',16.5,3]], labor:[["Albañil oficial",0.35,'jor',380,1.85]], equipment:[["Andamio / equipo básico",0.05,'día',280]], ...APU_DEFAULT_FACTORS, family:'Albañileria', confidence:92, source:'exact_library', sourceFile:'Catálogo Demo', sourceSection:'Fila 1', rowNumber:1, traceability:[{file:'Catálogo Demo',sheet:'Hoja 1',row:1,source:'demo'}], assumptions:['Demo con trazabilidad técnica. Revisa precios, rendimiento y unidad.'], warnings:['Validación de trazabilidad pendiente'], aiNotes:['Demo con trazabilidad técnica. Revisa precios y rendimientos.'], date:new Date().toLocaleDateString('es-MX') }]);
    }
    if(!budgetItems.length){
      setBudgetItems([{ concept:'Muro de block 15 cm', unit:'m²', qty:120, pu:825.39 }, { concept:'Pintura vinílica en muros', unit:'m²', qty:86, pu:95.5 }]);
    }
  }, [DEMO_MODE, projects.length, budgets.length, catalog.length, apus.length, budgetItems.length, setProjects, setBudgets, setCatalog, setApus, setBudgetItems]);
  useEffect(() => {
    setZoeContext(prev => ({ ...prev, user, route: module, activeApu: apus[0] || prev.activeApu, budget: budgets[0] || prev.budget, project: projects[0] || prev.project, library: catalog, alerts: prev.alerts || [] }));
  }, [user, module, apus, budgets, projects, catalog]);
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
        setActiveUid(null);
        setUser(null);
        setScreen(current => current === 'app' ? 'landing' : current);
        return;
      }
      try{
        let profile;
        try{
          profile = await loadOrCreateProfile(fbUser);
        }catch(profileError){
          console.error(profileError);
          profile = fallbackProfile(fbUser);
        }
        const tokenResult = await fbUser.getIdTokenResult().catch(()=>null);
        const claims = tokenResult?.claims || null;
        if(!fbUser.emailVerified && !isAdminUser({ email:profile?.email, claims }, profile)){
          setActiveUid(null);
          setUser(null);
          return;
        }
        if(profile.active === false){
          await signOut(auth);
          setActiveUid(null);
          setUser(null);
          setScreen('landing');
          alert('Tu cuenta esta desactivada. Contacta al administrador de ZOEMEC.');
          return;
        }
        const session = buildSession(profile, fbUser, claims);
        setActiveUid(session.uid);
        setUser(session);
        setUsage(prev => ({...prev, [session.email]:{apusCreated:session.apusCreated || 0, deviceId:session.deviceId}}));
        /* Antes, si ya existia una sesion valida de Firebase (ej. al recargar
           la pagina), "screen" se quedaba en su valor por defecto ('landing')
           porque solo login()/loginWithGoogle() avanzaban a 'app'. Con eso, un
           usuario ya autenticado veia la landing publica en vez del Dashboard
           hasta volver a escribir su correo/contrasena. Ahora, si detectamos
           sesion valida y la pantalla sigue en landing/login/register, se
           avanza sola. */
        setScreen(current => (current === 'landing' || current === 'login' || current === 'register') ? 'app' : current);
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
      alert('El servicio de inicio de sesion no esta disponible en este momento. Intenta de nuevo mas tarde.');
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
        setActiveUid(null);
        setUser(null);
        setScreen('login');
        alert('Cuenta creada. Te enviamos un correo de verificacion. Confirma tu email y luego inicia sesion.');
        return true;
      }
      const credential = await signInWithEmailAndPassword(auth, cleanEmail, password);
      let profile;
      try{
        profile = await loadOrCreateProfile(credential.user);
      }catch(profileError){
        console.error(profileError);
        profile = fallbackProfile(credential.user, deviceId);
      }
      const tokenResult = await credential.user.getIdTokenResult().catch(()=>null);
      const claims = tokenResult?.claims || null;
      if(!credential.user.emailVerified && !isAdminUser({ email:profile?.email, claims }, profile)){
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
      const session = buildSession(profile, credential.user, claims);
      setUsage({...usage, [cleanEmail]:{apusCreated:session.apusCreated || 0, deviceId:session.deviceId}});
      setActiveUid(session.uid);
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
      alert('El servicio de inicio de sesion no esta disponible en este momento. Intenta de nuevo mas tarde.');
      return false;
    }
    const provider = new GoogleAuthProvider();
    const deviceId = getDeviceId();
    try{
      const credential = await signInWithPopup(auth, provider);
      const fbUser = credential.user;
      const userRef = doc(db, 'users', fbUser.uid);
      let profile;
      try{
        const snap = await getDoc(userRef);
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
      }catch(profileError){
        console.error(profileError);
        profile = fallbackProfile(fbUser, deviceId);
      }
      if(profile.active === false){
        await signOut(auth);
        alert('Tu cuenta esta desactivada. Contacta al administrador de ZOEMEC.');
        return false;
      }
      const tokenResult = await fbUser.getIdTokenResult().catch(()=>null);
      const session = buildSession(profile, fbUser, tokenResult?.claims || null);
      setUsage(prev => ({...prev, [session.email]:{apusCreated:session.apusCreated || 0, deviceId:session.deviceId}}));
      setActiveUid(session.uid);
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
    setActiveUid(null);
    setUser(null);
    setScreen('landing');
  };

  let content;
  const activeProject = projects.find(p => p.id === activeProjectId) || null;
  const needsProject = !projects.length;
  if(screen === 'landing') content = <Landing setScreen={setScreen} login={login} company={companyView} />;
  else if(screen === 'login') content = <Auth mode="login" setScreen={setScreen} login={login} loginWithGoogle={loginWithGoogle} company={companyView} />;
  else if(screen === 'register') content = <Auth mode="register" setScreen={setScreen} login={login} loginWithGoogle={loginWithGoogle} company={companyView} />;
  else if(!hasValidSession(user)) content = <Landing setScreen={setScreen} login={login} company={companyView} />;
  else content = <Shell user={user} logout={logout} module={module} setModule={setModule} company={companyView} apus={apus} clients={clients} projects={projects} activeProject={activeProject} activeProjectId={activeProjectId} setActiveProjectId={setActiveProjectId}>
    {module === 'inicio' && <Dashboard setModule={setModule} apus={apus} clients={clients} budgets={budgets} projects={projects} activeProject={activeProject} user={user} demoMode={DEMO_MODE} demoContext={DEMO_MODE ? createDemoContext() : null} />}
    {module === 'apu' && <APU company={companyView} user={user} usage={usage} setUsage={setUsage} apus={apus} setApus={setApus} budgets={budgets} setBudgets={setBudgets} catalog={catalog} setCatalog={setCatalog} projects={projects} rawApus={rawApus} linkApuToProject={linkApuToProject} activeProjectId={activeProjectId} activeProject={activeProject} onNeedProject={()=>setModule('cartera')} />}
    {module === 'presupuestos' && <Budgets company={companyView} budgets={budgets} setBudgets={setBudgets} items={budgetItems} setItems={setBudgetItems} activeProjectId={activeProjectId} onNeedProject={()=>setModule('cartera')} />}
    {module === 'cartera' && <ClientsProjects clients={clients} setClients={setClients} projects={projects} setProjects={setProjects} activeProjectId={activeProjectId} setActiveProjectId={setActiveProjectId} setModule={setModule} onDeleteProjectData={(pid)=>{ setRawApus(l=>l.filter(x=>(x?.projectId??null)!==pid)); setRawBudgets(l=>l.filter(x=>(x?.projectId??null)!==pid)); setRawCatalog(l=>l.filter(x=>(x?.projectId??null)!==pid)); setRawBudgetItems(l=>l.filter(x=>(x?.projectId??null)!==pid)); }} />}
    {module === 'biblioteca' && <Library user={user} catalog={catalog} setCatalog={setCatalog} setModule={setModule} />}
    {module === 'tecnico' && <TechnicalOffice company={companyView} setCompany={setCompany} catalog={catalog} setCatalog={setCatalog} needsProject={needsProject} onCreateProject={()=>setModule('cartera')} />}
    {module === 'visual' && <VisualAI user={user} setModule={setModule} />}
    {module === 'comunidad' && <Community />}
    {module === 'planes' && <PlansAccess user={user} />}
    {module === 'reportes' && <Reports clients={clients} apus={apus} budgets={budgets} />}
    {module === 'admin' && user.isAdmin && <AdminPanel user={user} />}
  </Shell>;
  return <><NoticeHost />{content}<Assistant context={zoeContext} setModule={setModule} /></>;
}

/* ---------- Mascota / asistente ZOEMIC ---------- */
function assistantReply(q, context={}){
  const t=q.toLowerCase();
  const r=(...m)=>m.filter(Boolean).join(' ');
  const activeApu = context.activeApu?.concept ? `${context.activeApu.concept} (${context.activeApu.family || 'familia no definida'})` : null;
  const project = context.project?.name || null;
  const libraryCount = Array.isArray(context.library) ? context.library.length : null;
  const projectLine = project ? `Proyecto activo: ${project}.` : 'Sin proyecto activo.';
  const apuLine = activeApu ? `APU activo: ${activeApu}.` : 'Genera tu primer APU para activar el gemelo digital.';
  const libraryLine = libraryCount !== null ? `Biblioteca con ${libraryCount} insumos.` : 'No hay biblioteca técnica cargada.';
  if(/hola|buenas|hey|saludos/.test(t)) return r('Hola. Soy ZOE, el asistente inteligente de ingeniería de costos de ZOEMEC.', projectLine, apuLine, libraryLine, 'Te apoyo con APU, validación, presupuesto, biblioteca y entrega de documentos auditable.');
  if(/fsr|salario real|fasar/.test(t)) return r('El FSR (Factor de Salario Real, Art. 191 RLOPSRM) convierte el salario base en salario real: Salario real = base × FSR.', 'Usa Centro Técnico para calcularlo con Tp (días pagados), Tl (días laborados) y Ps (cargas obrero-patronales).');
  if(/apu|precio unitario/.test(t)) return r('Para generar un APU sólido, ve a "APU Inteligente", pega el concepto y ejecuta la generación.', 'Después revisa insumos, unidades, herramienta menor, indirectos de campo/oficina, financiamiento, utilidad y cargos.');
  if(/excel|importar|catalogo|catálogo|precios/.test(t)) return r('Importa tu Excel de precios en Oficina Técnica o desde "Generar con IA".', 'Al generar el APU, uso tus precios reales cuando coinciden con insumos y te indico qué partidas requieren ajuste.');
  if(/pdf|exportar|excel de salida|descargar/.test(t)) return 'Desde el APU o Presupuestos usa "Descargar PDF" / "Descargar Excel": el archivo sale con el membrete de tu empresa y trazabilidad técnica si la configuras en Oficina Técnica.';
  if(/concreto|acero|block|pintura|excavaci|calculadora/.test(t)) return 'En Centro Técnico hay calculadoras para concreto, acero, block, pintura, impermeabilizante, excavación, FSR y más. Complementan los APUs con cantidades y costos editables.';
  if(/indirecto/.test(t)) return 'Los indirectos de campo y oficina se suman sobre el costo directo. Luego se aplican financiamiento, utilidad y cargos adicionales para llegar al P.U. sin IVA.';
  if(/presupuesto/.test(t)) return 'En Presupuestos capturas conceptos con P.U. sin IVA; el sistema calcula subtotal, IVA y total, y lo exportas a PDF/Excel con tu formato corporativo.';
  if(/riesgo|alerta|revisar|validar/.test(t)) return r('Reviso el APU en busca de alertas, unidades incompatibles y ausencia de evidencias.', projectLine, apuLine, libraryLine, 'Puedo recomendar qué ajustar antes de exportar o entregar.');
  if(/gemelo|centro de mando|dashboard|comando/.test(t)) return r('Este tablero es tu centro digital de costos.', projectLine, apuLine, libraryLine, 'Ahí ves estado de proyecto, IA, biblioteca, OneDrive, Firebase y entregables.');
  return r('Puedo orientarte sobre APU, FSR, validación de costos, biblioteca técnica, importación de Excel y exportación a PDF/Excel.', projectLine, apuLine, libraryLine, 'Si la IA real no está disponible, respondo con metodología de revisión técnica.');
}
async function assistantReplyReal(q, history=[], context={}){
  try{
    const response = await fetch('/api/assistant', {
      method:'POST',
      headers:await authHeaders(),
      body:JSON.stringify({question:q, history, context})
    });
    const data = await readJsonSafe(response);
    if(!response.ok) throw new Error(data?.error || 'IA no disponible');
    if(!data.answer) return {answer:assistantReply(q, context), source:'local'};
    return {answer:data.answer, source:'ai'};
  }catch{
    return {answer:assistantReply(q, context), source:'local'};
  }
}
const ZOE_SEED_MSG = {me:false,t:'Soy ZOE. Leo conceptos, APUs, costos y evidencia para ayudarte a decidir como ingeniero, no como chatbot generico.'};
const ZOE_VOICE_SUPPORTED = typeof window!=='undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
const ZOE_SPEECH_SUPPORTED = typeof window!=='undefined' && Boolean(window.speechSynthesis);
function Assistant({ context={}, setModule }){
  const { t: tr } = useI18n();
  const [open,setOpen]=useState(false);
  const zoeUid = context?.user?.uid;
  const zoeSeedMsg = {me:false, t:tr('zoe.seedMsg')};
  const [msgs,setMsgs]=useLocalState('zoemec-zoe-thread', [zoeSeedMsg], zoeUid);
  const [threads,setThreads]=useLocalState('zoemec-zoe-history', [], zoeUid);
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
    const {answer, source} = await assistantReplyReal(user, history, context);
    setMsgs(m=>[...m,{me:false,t:answer,source}]);
    setBusy(false);
    speak(answer);
  };
  const startNewConversation=()=>{
    if(msgs.length>1) setThreads(t=>[{id:'ZOE-'+uid(), startedAt:new Date().toLocaleString('es-MX'), msgs}, ...t].slice(0,20));
    setMsgs([zoeSeedMsg]);
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
  const prompts=tr('zoe.prompts');
  return <>
    <button className={'asst-fab'+(busy?' thinking':'')+(speaking?' speaking':'')} onClick={()=>setOpen(o=>!o)} title={tr('zoe.fabTitle')}>
      <img src="/images/zoemic-assistant-web.webp" alt={tr('zoe.fabTitle')}/>
    </button>
    {open && <div className="asst-panel">
      <div className="asst-head">
        <img className={'asst-avatar'+(busy?' thinking':'')+(speaking?' speaking':'')} src="/images/zoemic-assistant-web.webp" alt={tr('zoe.fabTitle')}/>
        <div>
          <b>{tr('zoe.fabTitle')}</b>
          <small><i className={busy?'pulse':''}></i> {busy?tr('zoe.thinking'):tr('zoe.onlineStatus')}</small>
        </div>
        <div className="asst-head-actions">
          {ZOE_SPEECH_SUPPORTED && <button className={'asst-icon-btn'+(speakOn?' active':'')} title={speakOn?tr('zoe.muteResponses'):tr('zoe.readResponses')} onClick={()=>{ setSpeakOn(v=>!v); if(speakOn) window.speechSynthesis.cancel(); }} aria-label={tr('zoe.toggleVoice')}><Icon name={speakOn?'speakerOn':'speakerOff'} size={16}/></button>}
          <button className="asst-icon-btn" title={tr('zoe.history')} onClick={()=>setShowHistory(v=>!v)} aria-label={tr('zoe.historyAria')}><Icon name="history" size={16}/></button>
          <button className="asst-x" onClick={()=>setOpen(false)} aria-label={tr('zoe.closeChat')}>×</button>
        </div>
      </div>
      <div className="asst-strip"><span>{tr('zoe.stripContext')}</span><span>{tr('zoe.stripApu')}</span><span>{tr('zoe.stripBim')}</span><span>{tr('zoe.stripDeliver')}</span></div>
      {showHistory ? <div className="asst-history">
        <button className="soft asst-new-thread" onClick={startNewConversation}>{tr('zoe.newConversation')}</button>
        {threads.length ? threads.map(th=><button key={th.id} className="asst-thread-item" onClick={()=>openThread(th)}>
          <b>{th.msgs.find(m=>m.me)?.t?.slice(0,48) || tr('zoe.untitledConversation')}</b><small>{th.startedAt} · {tr('zoe.messagesCount',{count:th.msgs.length})}</small>
        </button>) : <p className="asst-history-empty">{tr('zoe.noSavedConversations')}</p>}
      </div> : <>
        <div className="asst-body" ref={bodyRef}>
          {msgs.map((m,i)=><div key={i} className={'asst-msg'+(m.me?' me':'')}>{m.t}{!m.me && m.source==='local' && <em className="asst-offline-tag">{tr('zoe.offlineTag')}</em>}</div>)}
          {busy && <div className="asst-msg asst-thinking-msg"><span className="asst-dots"><i/><i/><i/></span></div>}
        </div>
        <div className="asst-suggestions">{prompts.map(p=><button key={p} onClick={()=>send(p)} disabled={busy}>{p}</button>)}</div>
        <div className="asst-input">
          <input value={q} placeholder={tr('zoe.inputPlaceholder')} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()}/>
          {ZOE_VOICE_SUPPORTED && <button className={'asst-icon-btn'+(listening?' active listening':'')} title={listening?tr('zoe.stopRecording'):tr('zoe.talkToZoe')} onClick={toggleListen} aria-label={tr('zoe.voiceInputAria')}><Icon name={listening?'micStop':'mic'} size={16}/></button>}
          <button onClick={()=>send()} disabled={busy}>{busy?tr('zoe.sending'):tr('zoe.send')}</button>
        </div>
        <div className="asst-note">{tr('zoe.note')}</div>
      </>}
    </div>}
  </>;
}


function Landing({setScreen, login, company}){
  const [step, setStep] = useState(0);
  // useI18n() ya expone t(); se alias a tr() para no chocar con la variable
  // local "t" (id del setInterval) del efecto de abajo -- distinta funcion,
  // mismo nombre corto, mejor no reusarlo y generar confusion al leer.
  const { t: tr, locale, setLocale } = useI18n();
  const pipeline = tr('panel.pipeline');
  useEffect(() => {
    const t = setInterval(() => setStep(s => (s + 1) % pipeline.length), 3200);
    return () => clearInterval(t);
  }, [pipeline.length]);
  const p = pipeline[step] || pipeline[0];
  const { theme, toggleTheme } = useTheme();
  const { canInstall, promptInstall, showIOSHint } = useInstallPrompt();
  return <div className="landing">
    <header className="nav-public">
      <div className="brand-mini"><ZoemecBrand variant="header"/></div>
      <nav><a>{tr('nav.plataforma')}</a><a>{tr('nav.gemeloDigital')}</a><a>{tr('nav.apuConIA')}</a><a>{tr('nav.entregables')}</a></nav>
      <div className="nav-actions">
        <div className="locale-segmented" role="group" aria-label={tr('toggle.langToggleLabel')}>
          <button className={'locale-segmented-btn'+(locale==='es'?' active':'')} onClick={()=>setLocale('es')} aria-pressed={locale==='es'}>ES</button>
          <button className={'locale-segmented-btn'+(locale==='en'?' active':'')} onClick={()=>setLocale('en')} aria-pressed={locale==='en'}>EN</button>
        </div>
        <button className="theme-toggle" onClick={toggleTheme} aria-label={tr('toggle.themeToggleLabel')} title={theme==='light'?tr('toggle.themeDark'):tr('toggle.themeLight')}>
          <Icon name={theme==='light'?'moon':'sun'} size={18}/>
        </button>
        {canInstall && <button className="install-btn" onClick={promptInstall}><Icon name="download" size={16}/><span>{tr('install.button')}</span></button>}
        {showIOSHint && <span className="ios-install-hint">{tr('install.iosHint')}</span>}
        <button className="ghost" onClick={()=>setScreen('login')}>{tr('nav.iniciarSesion')}</button>
        <button onClick={()=>setScreen('register')}>{tr('nav.comenzarGratis')}</button>
      </div>
    </header>
    <section className="hero-build">
      <div className="hero-copy">
        <span className="eyebrow">{tr('hero.eyebrow')}</span>
        <h1>{tr('hero.headlinePre')}<br/><span className="hl">{tr('hero.headlineHighlight')}</span></h1>
        <p>{tr('hero.subtitle')}</p>
        <div className="hero-capabilities">
          <div><Icon name="apu" size={22}/><b>{tr('capabilities.apus')}</b></div>
          <div><Icon name="search" size={22}/><b>{tr('capabilities.precios')}</b></div>
          <div><Icon name="presupuestos" size={22}/><b>{tr('capabilities.presupuestos')}</b></div>
          <div><Icon name="reportes" size={22}/><b>{tr('capabilities.entregables')}</b></div>
        </div>
        <div className="hero-actions"><button onClick={()=>setScreen('register')}>{tr('ctas.comenzarGratis')}</button><a className="secondary" href="#plataforma-preview">{tr('ctas.verPlataforma')}</a></div>
      </div>
      <div className="future-stage" aria-label={tr('panel.ariaLabel')}>
        <img className="stage-photo" src="/images/hero/zoemec-hero-web.webp" alt={tr('panel.heroAlt')} />
        <div className="stage-status">
          <span>{tr('panel.modeloCostos')}</span>
          <b>{tr('panel.titulo')}</b>
        </div>
        <div className="ai-console" key={step}>
          <div className="command-strip"><span>{p.head}</span><b>{p.metric}</b></div>
          <div className="command-flow">{p.flow.map((f,i)=><React.Fragment key={f}>{i>0 && <i/>}<span>{f}</span></React.Fragment>)}</div>
          <div className="command-table">
            {p.rows.map(r=><div key={r[0]}><b>{r[0]}</b><span>{r[1]}</span><em>{r[2]}</em><strong>{r[3]}</strong></div>)}
          </div>
          <div className="command-total"><span>{p.foot[0]}</span><b>{p.foot[1]}</b></div>
        </div>
        <div className="stage-tag">{tr('panel.vistaIlustrativa')}</div>
      </div>
    </section>
    <section className="trust-strip">
      <div><Icon name="link" size={22}/><div><b>{tr('trust.datosTitulo')}</b><span>{tr('trust.datosDesc')}</span></div></div>
      <div><Icon name="admin" size={22}/><div><b>{tr('trust.authTitulo')}</b><span>{tr('trust.authDesc')}</span></div></div>
      <div><Icon name="proyectos" size={22}/><div><b>{tr('trust.controlTitulo')}</b><span>{tr('trust.controlDesc')}</span></div></div>
      <div><Icon name="folder" size={22}/><div><b>{tr('trust.privacidadTitulo')}</b><span>{tr('trust.privacidadDesc')}</span></div></div>
    </section>
    <section className="landing-story">
      <div className="landing-story-head">
        <span className="eyebrow">{tr('story.eyebrow')}</span>
        <h2>{tr('story.titulo')}</h2>
      </div>
      <div className="story-steps">
        <div className="story-step"><b>01</b><h3>{tr('story.step1Titulo')}</h3><p>{tr('story.step1Desc')}</p></div>
        <div className="story-step"><b>02</b><h3>{tr('story.step2Titulo')}</h3><p>{tr('story.step2Desc')}</p></div>
        <div className="story-step"><b>03</b><h3>{tr('story.step3Titulo')}</h3><p>{tr('story.step3Desc')}</p></div>
      </div>
    </section>
    <section className="landing-preview" id="plataforma-preview">
      <div className="landing-story-head">
        <span className="eyebrow">{tr('preview.eyebrow')}</span>
        <h2>{tr('preview.titulo')}</h2>
      </div>
      <div className="preview-grid">
        <figure><img src="/images/dashboard/zoemec-dashboard-web.webp" alt={tr('preview.dashboardAlt')}/><figcaption>{tr('preview.dashboardCaption')}</figcaption></figure>
        <figure><img src="/images/screenshots/apu-matrix.png" alt={tr('preview.apuAlt')}/><figcaption>{tr('preview.apuCaption')}</figcaption></figure>
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
        <div className="hero-logo light"><ZoemecBrand variant="login"/></div>
        <h2>Ingeniería de costos, precisa y profesional.</h2>
        <p>Un asistente técnico que lee documentos, detecta conceptos, valida evidencia y convierte APUs en entregables listos para concurso y obra.</p>
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
        <h1>{mode==='login'?'Iniciar sesión':'Crear cuenta'}</h1>
        <p>{mode==='login'?'Accede con tu cuenta registrada.':'Empieza con 1 APU gratis por dispositivo.'}</p>
        {mode==='register' && <><label>Nombre completo</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="Tu nombre" /></>}
        <label>Correo electrónico</label>
        <input placeholder="correo@empresa.com" type="email" value={email} onChange={e=>setEmail(e.target.value)} />
        <label>Contraseña</label>
        <input placeholder="mínimo 6 caracteres" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
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

function Shell({children,user,logout,module,setModule,company,apus,clients,projects,activeProject,activeProjectId,setActiveProjectId}){
  const { theme, toggleTheme } = useTheme();
  const { t: tr, locale, setLocale } = useI18n();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const hamburgerRef = useRef(null);
  const drawerCloseRef = useRef(null);
  useEffect(() => { if(drawerOpen) drawerCloseRef.current?.focus(); }, [drawerOpen]);
  // Comunidad y Planes y acceso se ocultan temporalmente del menu principal
  // (fase de concurso: se mantienen en el codigo, solo no se muestran en la navegacion).
  const menu = [
    ['inicio','inicio',tr('shell.menu.inicio')],
    ['apu','apu',tr('shell.menu.apu')],
    ['presupuestos','presupuestos',tr('shell.menu.presupuestos')],
    ['cartera','clientes',tr('shell.menu.cartera'),tr('shell.menu.carteraDesc')],
    ['biblioteca','biblioteca',tr('shell.menu.biblioteca'),tr('shell.menu.bibliotecaDesc')],
    ['visual','render',tr('shell.menu.visual'),tr('shell.menu.visualDesc')],
    ['tecnico','tecnico',tr('shell.menu.tecnico'),tr('shell.menu.tecnicoDesc')],
    ['reportes','reportes',tr('shell.menu.reportes')],
    ...(user.isAdmin ? [['admin','admin',tr('shell.menu.admin'),tr('shell.menu.adminDesc')]] : [])
  ];
  const goTo = (m) => { setModule(m); setDrawerOpen(false); };
  // Escape cierra el drawer desde cualquier punto de la pantalla; el click
  // afuera lo maneja el overlay (.drawer-backdrop) directo en el DOM, mas
  // simple y confiable en movil que medir bounding boxes.
  useEffect(() => {
    if(!drawerOpen) return;
    const onKey = (e) => { if(e.key === 'Escape'){ setDrawerOpen(false); hamburgerRef.current?.focus(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);
  return <div className={'app-layout'+(drawerOpen?' drawer-open':'')}>
    {drawerOpen && <div className="drawer-backdrop" onClick={()=>setDrawerOpen(false)} aria-hidden="true"/>}
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand"><ZoemecBrand variant="sidebar" subtitle="Ingeniería y construcción"/></div>
        <button className="drawer-close" ref={drawerCloseRef} onClick={()=>{ setDrawerOpen(false); hamburgerRef.current?.focus(); }} aria-label={tr('shell.closeDrawer')}>×</button>
      </div>
      <div className="menu">{menu.map(m=><button key={m[0]} className={module===m[0]?'active':''} onClick={()=>goTo(m[0])}><span className="mi"><Icon name={m[1]}/></span><span className="menu-copy"><b>{m[2]}</b>{m[3] && <small>{m[3]}</small>}</span></button>)}</div>
      <button className="plan-box" onClick={()=>goTo('planes')}><b>{tr('shell.planBox.title')}</b><p>{tr('shell.planBox.desc')}</p><div><i style={{width:'68%'}}></i></div><small>{tr('shell.planBox.cta')}</small></button>
      <button className="logout-side" onClick={logout}>{tr('shell.logout')}</button>
    </aside>
    <main className="main">
      <header className="topbar">
        <button className="hamburger" ref={hamburgerRef} onClick={()=>setDrawerOpen(v=>!v)} aria-label={tr('shell.hamburger')} aria-expanded={drawerOpen}>
          <span/><span/><span/>
        </button>
        <TopSearch apus={apus} clients={clients} projects={projects} setModule={setModule}/>
        {projects.length>0 && <div className="project-switcher" title={tr('shell.projectSwitcher.title')}>
          <Icon name="proyectos" size={15}/>
          <select value={activeProjectId||''} onChange={e=>setActiveProjectId(e.target.value)} aria-label={tr('shell.projectSwitcher.ariaLabel')}>
            {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button type="button" className="ghost-up" onClick={()=>goTo('cartera')}>{tr('shell.projectSwitcher.new')}</button>
        </div>}
        <div className="user">
          <div className="locale-switch topbar-locale" role="group" aria-label={tr('toggle.langToggleLabel')}>
            <button className={locale==='es'?'active':''} onClick={()=>setLocale('es')} aria-pressed={locale==='es'}>ES</button>
            <button className={locale==='en'?'active':''} onClick={()=>setLocale('en')} aria-pressed={locale==='en'}>EN</button>
          </div>
          <button className="theme-toggle" onClick={toggleTheme} aria-label={tr('toggle.themeToggleLabel')} title={theme==='light'?tr('toggle.themeDark'):tr('toggle.themeLight')}><Icon name={theme==='light'?'moon':'sun'} size={17}/></button>
          <CloudBadge user={user}/><NotificationBell user={user}/><span className="avatar">{user.initials}</span><div><b>{user.name}</b><small>{user.isAdmin ? tr('shell.role.admin') : user.plan}</small></div><button onClick={logout}>{tr('shell.logout')}</button>
        </div>
      </header>
      {children}
    </main>
  </div>
}

function ProjectsPlaceholder({onCreate, onImport}){
  return <div className="placeholder-card">
    <div className="ph-illustration"><img src="/images/dashboard/project-illustration.webp" alt="Proyectos"/></div>
    <div className="ph-copy"><h3>Sin proyectos reales</h3><p>Importa un proyecto o crea el primero para activar el Gemelo Digital y el flujo de presupuestos.</p>
      <div className="ph-actions"><button onClick={onCreate}>Crear proyecto</button><button className="soft" onClick={onImport}>Importar</button></div>
    </div>
  </div>;
}

function ActivityPlaceholder({onCreateApu,onOpenLibrary}){
  return <div className="placeholder-activity">
    <h3>Activa tu espacio de trabajo</h3>
    <ol>
      <li>Importa un documento o crea un APU</li>
      <li>Valida y revisa con ZOE</li>
      <li>Genera presupuesto y exporta entregables</li>
    </ol>
    <div className="ph-actions"><button onClick={onCreateApu}>Crear APU</button><button className="soft" onClick={onOpenLibrary}>Abrir Biblioteca</button></div>
  </div>;
}

/* Un APU guardado puede ser v1 (confidence numerico) o v2/profesional
   (confidence.score desglosado): normaliza a un numero 0-100 en vez de
   dejar pasar el objeto crudo a un calculo aritmetico (produce NaN). */
function apuConfidenceScore(apu){
  const c = apu?.confidence;
  return typeof c === 'number' ? c : Number(c?.score) || 0;
}

/* Indicador de la lista "Como construyo ZOEMEC este APU": check verde para lo
   realizado, circulo hueco ambar para lo pendiente/por revisar -- nunca un
   guion ambiguo que no distingue "hecho" de "no aplica". */
function doneIcon(ok){
  return ok ? <span className="chk-ok" aria-hidden="true">✓</span> : <span className="chk-pending" aria-hidden="true">○</span>;
}

/* Vista compacta del APU activo dentro del panel "Gemelo digital" del Dashboard.
   Defensiva ante las dos formas de APU que pueden llegar en `apus` (v1 con
   renglones-arreglo y confidence numerico, o v2/profesional con renglones-objeto
   y confidence desglosado): nunca inventa un PU o confianza que no pueda calcular. */
function DigitalTwin({apu, compact, onOpen}){
  if(!apu){
    return <div className={`digital-twin-empty${compact ? ' compact' : ''}`}>
      <p>Genera tu primer APU para activar el gemelo digital del proyecto.</p>
      <button onClick={onOpen}>Generar APU con IA</button>
    </div>;
  }
  let pu = Number(apu.calculated?.pu);
  if(!Number.isFinite(pu) || pu <= 0){
    try{ pu = calcAPU(apu).pu; }catch{ pu = 0; }
  }
  const confidenceScore = apuConfidenceScore(apu);
  return <div className={`digital-twin${compact ? ' compact' : ''}`} onClick={onOpen} role="button" tabIndex={0}>
    <div className="dt-row"><small>Concepto activo</small><b>{apu.concept || apu.clave || 'APU sin concepto'}</b></div>
    <div className="dt-row"><small>Precio unitario</small><b>{pu > 0 ? money(pu) : '—'}</b><span>/ {apu.unit || 'u'}</span></div>
    <div className="dt-row"><small>Confianza</small><b>{Number.isFinite(confidenceScore) ? `${Math.round(confidenceScore)}%` : '—'}</b></div>
  </div>;
}

function Dashboard({setModule,apus,clients,budgets,projects,activeProject:activeProjectProp,user}){
  const { t: tr } = useI18n();
  const [remoteStatus,setRemoteStatus] = useState(null);
  const [oneDriveStatus,setOneDriveStatus] = useState(null);
  const [libraryCount,setLibraryCount] = useState(null);
  const [libraryRecent,setLibraryRecent] = useState(null);
  const [libraryError,setLibraryError] = useState('');
  const monto = budgets.reduce((a,b)=>a+(b.total||0),0);
  const pr = projects || [];
  const activeProject = activeProjectProp || pr[0] || null;
  const latestApu = apus[0] || null;
  const activeBudget = budgets[0] || null;
  const budgetCount = budgets.length;
  const projectCount = pr.length;
  const firebaseOk = remoteStatus?.firebase === 'ok';
  const openaiOk = remoteStatus?.openai === 'ok';
  const oneDriveOk = Boolean(oneDriveStatus?.connected);
  const missingPieces = [];
  if(!firebaseOk) missingPieces.push('Firebase');
  if(!openaiOk) missingPieces.push('OpenAI');
  if(libraryCount === 0) missingPieces.push('Biblioteca');
  if(!latestApu) missingPieces.push('APU activo');
  if(!budgetCount) missingPieces.push('Presupuesto');
  const healthSummary = missingPieces.length ? `Faltan: ${missingPieces.join(', ')}` : 'Todos los servicios esenciales están operativos.';
  const riskNotes = [];
  if(!activeProject) riskNotes.push(tr('dash.riskNoProject'));
  if(!latestApu) riskNotes.push(tr('dash.riskNoApu'));
  if(libraryCount === 0) riskNotes.push(tr('dash.riskNoLibrary'));
  if(!openaiOk) riskNotes.push(tr('dash.riskNoAi'));
  if(!firebaseOk) riskNotes.push(tr('dash.riskNoFirebase'));
  const estados = pr.reduce((m,p)=>{m[p.status]=(m[p.status]||0)+1;return m;},{});
  const palette = ['#9D6FD0','#2A1740','#C7A35C','#B8A4CC','#B54A62'];
  const segs = Object.keys(estados).map((k,i)=>({label:k,value:estados[k],color:palette[i%palette.length]}));
  const spark = budgets.length ? budgets.slice(-8).map((b,i)=>Math.max(1,(Number(b.total)||0)/1000+i)) : [0,0,0,0,0,0,0,0];
  const pipeline=[
    ['Doc','Excel / PDF',firebaseOk ? 'ready' : 'watch'],
    ['Extraer','Conceptos',libraryCount ? 'ready' : 'watch'],
    ['Clasificar','Especialidad',libraryCount ? 'ready' : 'watch'],
    ['Evidencia','Fuente técnica',libraryCount ? 'ready' : 'watch'],
    ['APU','Matriz editable',apus.length ? 'ready' : 'active'],
    ['Entregar','PDF / XLSX',budgetCount ? 'ready' : 'watch']
  ];
  useEffect(()=>{
    let alive=true;
    apiGetSafe('/api/status').then(data=>{ if(alive) setRemoteStatus(data); });
    if(!user?.uid){
      return () => { alive=false; };
    }
    /* Misma fuente que la pantalla Biblioteca: propios + globales, deduplicados
       por id de documento (antes el Dashboard solo contaba "ownerUid==uid" y
       Biblioteca ademas sumaba los documentos 'global', asi que el mismo usuario
       podia ver dos numeros distintos para "sus" documentos). */
    Promise.all([
      getDocs(query(collection(db,'library'), where('ownerUid','==',user.uid), limit(200))),
      getDocs(query(collection(db,'library'), where('visibility','==','global'), limit(200)))
    ]).then(([ownSnap, globalSnap])=>{
      if(!alive) return;
      const merged=new Map();
      [...ownSnap.docs, ...globalSnap.docs].forEach(d=>merged.set(d.id, {id:d.id, ...d.data()}));
      const docs=[...merged.values()];
      setLibraryCount(docs.length);
      setLibraryError('');
      docs.sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0));
      setLibraryRecent(docs.slice(0,4));
    }).catch(err=>{
      if(!alive) return;
      setLibraryCount(null);
      setLibraryRecent(null);
      setLibraryError(friendlyServiceError(err,'No se pudo consultar la biblioteca (permisos, indice o red).'));
    });
    apiPost('/api/onedrive', { action:'status' }).then(data=>{ if(alive) setOneDriveStatus(data); }).catch(()=>{ if(alive) setOneDriveStatus(null); });
    return ()=>{ alive=false; };
  }, [user]);
  return <section className="ai-os"><PageHead kicker={tr('modules.dashboard.kicker')} title={tr('modules.dashboard.title')} desc={tr('modules.dashboard.desc')} action={<button onClick={()=>setModule('apu')}>{tr('dash.ctaAskZoe')}</button>} />
    <div className="demo-hero">
      <h2>{tr('dash.heroTitle')}</h2>
      <p>{tr('dash.heroDesc')}</p>
      <div className="demo-hero-actions">
        <button onClick={()=>setModule('apu')}><Icon name="apu" size={17}/> {tr('dash.ctaGenerate')}</button>
        <button className="ghost-up" onClick={()=>setModule('apu')}><Icon name="presupuestos" size={17}/> {tr('dash.ctaImport')}</button>
      </div>
      <div className="demo-hero-steps">
        <div className="demo-hero-step"><b>1</b><span>{tr('dash.step1')}</span></div>
        <div className="demo-hero-step"><b>2</b><span>{tr('dash.step2')}</span></div>
        <div className="demo-hero-step"><b>3</b><span>{tr('dash.step3')}</span></div>
        <div className="demo-hero-step"><b>4</b><span>{tr('dash.step4')}</span></div>
        <div className="demo-hero-step"><b>5</b><span>{tr('dash.step5')}</span></div>
      </div>
    </div>
    <div className="kpi-row">
      <div className="kpi-tile"><small>{tr('dash.kpiProyectos')}</small><b>{projectCount}</b><span>{projectCount ? tr('dash.kpiProyectosSub',{count:projectCount}) : tr('dash.kpiProyectosEmpty')}</span></div>
      <div className="kpi-tile"><small>{tr('dash.kpiApus')}</small><b>{apus.length}</b><span>{apus.length ? tr('dash.kpiApusSub') : tr('dash.kpiApusEmpty')}</span></div>
      <div className="kpi-tile"><small>{tr('dash.kpiPresupuestos')}</small><b>{budgetCount}</b><span>{monto ? money(monto) : tr('dash.kpiPresupuestosEmpty')}</span></div>
      <div className="kpi-tile"><small>{tr('dash.kpiDocumentos')}</small><b>{libraryCount ?? '—'}</b><span>{tr('dash.kpiDocumentosSub')}</span></div>
    </div>
    <div className="os-grid">
      <div className="os-command">
        <div className="os-command-head"><span>{tr('dash.liveIntel')}</span><b>{monto ? money(monto) : tr('dash.noBudgetYet')}</b></div>
        <h2>{activeProject?.name || tr('dash.defaultWorkspace')}</h2>
        <p>{activeProject?.client || tr('dash.defaultClient')}</p>
        <p className="os-summary">{projectCount ? tr('dash.summaryActive',{projects:projectCount,budgets:budgetCount}) : tr('dash.summaryEmpty')}</p>
        <div className="os-prompt"><i>ZOE</i><span>{tr('dash.zoePrompt')}</span><button onClick={()=>setModule('apu')}>{tr('dash.zoeStart')}</button></div>
        <div className="os-pipeline">{pipeline.map((p,i)=><button key={p[0]} className={p[2]} onClick={()=>setModule(i<2?'biblioteca':i<5?'apu':'presupuestos')}><b>{p[0]}</b><span>{p[1]}</span></button>)}</div>
      </div>
      <div className="os-bim">
        <div className="twin-central">
          <h2>{tr('dash.twinTitle')}</h2>
          <div className="twin-flow" aria-hidden>
            {tr('dash.twinFlow').map((s,i)=>(
              <div key={s} className={`twin-step ${i===0? 'start':''}`}><span>{s}</span>{i<7 && <i className="arrow">→</i>}</div>
            ))}
          </div>
          <div className="twin-wrapper">
            <DigitalTwin apu={apus[0]} compact onOpen={()=>setModule('apu')}/>
          </div>
          <div className="twin-insights">
            <InfoCard title={tr('dash.twinProjectTitle')} value={activeProject?.name || '—'} subtitle={activeProject ? `${activeProject.progress || 0}% avance` : tr('dash.twinProjectEmpty')} actionLabel={activeProject ? tr('dash.twinProjectAction') : tr('dash.twinProjectActionCreate')} onAction={()=>setModule('cartera')}/>
            <InfoCard title={tr('dash.twinAiTitle')} value={apus.length? tr('dash.twinAiActive'): tr('dash.twinAiInactive')} subtitle={apus.length? tr('dash.twinAiSubActive',{count:apus.length}) : tr('dash.twinAiSubEmpty')} actionLabel={tr('dash.twinAiAction')} onAction={()=>setModule('apu')}/>
          </div>
        </div>
      </div>
      <div className="os-side">
        <div className="status-grid">
          <div className="status-card"><small>{tr('dash.statusProyecto')}</small><b>{activeProject?.name || '—'}</b><span>{activeProject ? `${activeProject.client || ''}` : tr('dash.statusProyectoEmpty')}</span></div>
          <div className="status-card"><small>{tr('dash.statusIa')}</small><b>{apus.length ? tr('dash.twinAiActive') : tr('dash.twinAiInactive')}</b><span>{apus.length ? tr('dash.statusIaSubActive',{pct:Math.round(apuConfidenceScore(apus[0])*100)/100}) : tr('dash.statusIaSubEmpty')}</span></div>
                  <div className="status-card"><small>{tr('dash.statusBiblioteca')}</small><b>{libraryCount !== null ? tr('dash.statusBibliotecaDocs',{count:libraryCount}) : '—'}</b><span>{libraryCount !== null ? (libraryCount > 0 ? tr('dash.statusBibliotecaSubOk') : tr('dash.statusBibliotecaSubEmpty')) : (libraryError || tr('dash.statusBibliotecaSubNoData'))}</span></div>
          <div className="status-card"><small>{tr('dash.statusOneDrive')}</small><b>{oneDriveOk ? tr('dash.statusOneDriveOn') : tr('dash.statusOneDriveOff')}</b><span>{oneDriveOk ? tr('dash.statusOneDriveSubOn') : tr('dash.statusOneDriveSubOff')}</span></div>
          <div className="status-card"><small>{tr('dash.statusFirebase')}</small><b>{firebaseOk ? tr('dash.statusFirebaseOn') : tr('dash.statusFirebaseOff')}</b><span>{firebaseOk ? tr('dash.statusFirebaseSubOn') : tr('dash.statusFirebaseSubOff')}</span></div>
          <div className="status-card"><small>{tr('dash.statusOpenAI')}</small><b>{openaiOk ? tr('dash.statusOpenAIOn') : tr('dash.statusOpenAIOff')}</b><span>{openaiOk ? tr('dash.statusOpenAISubOn') : tr('dash.statusOpenAISubOff')}</span></div>
          <div className="status-card"><small>{tr('dash.statusHealth')}</small><b>{missingPieces.length ? tr('dash.statusHealthMissing',{items:missingPieces.join(', ')}) : tr('dash.statusHealthAllOk')}</b><span>{tr('dash.statusHealthSub',{projects:projectCount,budgets:budgetCount})}</span></div>
        </div>
        {riskNotes.length ? <div className="risk-notes"><small>{tr('dash.riskTitle')}</small><ul>{riskNotes.map(note=><li key={note}>{note}</li>)}</ul></div> : null}
      </div>
    </div>
    <div className="quick os-actions"><button onClick={()=>setModule('apu')}><Icon name="apu"/> {tr('dash.quickGenerate')}</button><button onClick={()=>setModule('biblioteca')}><Icon name="biblioteca"/> {tr('dash.quickEvidence')}</button><button onClick={()=>setModule('cartera')}><Icon name="clientes"/> {tr('dash.quickProjects')}</button><button onClick={()=>setModule('presupuestos')}><Icon name="presupuestos"/> {tr('dash.quickDeliverables')}</button></div>
    <div className="dash-charts">
      <div className="panel future-panel">
        <h2>{tr('dash.chartCostTrend')}</h2>
        <Spark points={spark}/>
        <div className="chart-foot">
          <span>{budgets.length ? tr('dash.chartCostTrendSubData') : tr('dash.chartCostTrendSubEmpty')}</span>
          <b>{budgets.length ? tr('dash.chartCostTrendSynced') : tr('dash.chartCostTrendStandby')}</b>
        </div>
      </div>
      <div className="panel chart-donut future-panel">
        <h2>{tr('dash.chartProjectMap')}</h2>
        <Donut segments={segs} center={pr.length || 'IA'} sub="nodos"/>
        <div className="donut-legend">
          {segs.length ? segs.map(s=>
            <span key={s.label}><i style={{background:s.color}}/>{s.label} <b>{s.value}</b></span>
          ) : (
            <span><i style={{background:'#C7A35C'}}/>{tr('dash.chartProjectMapEmpty')}</span>
          )}
        </div>
      </div>
    </div>
    <div className="grid-3">
      <div className="panel">
        <h2>{tr('dash.recentProjects')}</h2>
        {pr.length ? pr.slice(0,4).map(p=>
          <div className="project-row" key={p.name}>
            <div><b>{p.name}</b><small>{p.client}</small></div>
            <span>{p.progress}%</span>
            <progress value={p.progress} max="100" />
          </div>
        ) : <EmptyState text={tr('dash.recentProjectsEmpty')}/>}
      </div>
      <div className="panel">
        <h2>{tr('dash.recentApus')}</h2>
        {apus.length ? apus.slice(0,4).map((a,i)=>
          <div className="mini-list-row" key={a.id||i}>
            <Icon name="apu" size={15}/>
            <b>{a.concept || a.clave || `APU ${i+1}`}</b>
            <span>{apuConfidenceScore(a) ? `${Math.round(apuConfidenceScore(a))}%` : '—'}</span>
          </div>
        ) : <EmptyState text={tr('dash.recentApusEmpty')} actionLabel={tr('dash.recentApusAction')} onAction={()=>setModule('apu')}/>}
      </div>
      <div className="panel">
        <h2>{tr('dash.recentBudgets')}</h2>
        {budgets.length ? budgets.slice(0,4).map((b,i)=>
          <div className="mini-list-row" key={b.id||i}>
            <Icon name="presupuestos" size={15}/>
            <b>{b.name || `Presupuesto ${i+1}`}</b>
            <span>{b.total ? money(b.total) : '—'}</span>
          </div>
        ) : <EmptyState text={tr('dash.recentBudgetsEmpty')} actionLabel={tr('dash.recentBudgetsAction')} onAction={()=>setModule('presupuestos')}/>}
      </div>
    </div>
    <div className="grid-2">
      <div className="panel">
        <h2>{tr('dash.recentDocs')}</h2>
        {libraryRecent === null ? <EmptyState text={libraryError || tr('dash.recentDocsNoData')}/> : libraryRecent.length ? libraryRecent.map(f=>
          <div className="mini-list-row" key={f.id}>
            <Icon name="doc" size={15}/>
            <b>{f.name || 'Documento'}</b>
            <span>{f.cat || f.ext || '—'}</span>
          </div>
        ) : <EmptyState text={tr('dash.recentDocsEmpty')} actionLabel={tr('dash.recentDocsAction')} onAction={()=>setModule('biblioteca')}/>}
      </div>
      <div className="panel">
        <h2>{tr('dash.recentActivity')}</h2>
        {apus.length || budgets.length || (libraryRecent||[]).length ? [
          ...(libraryRecent||[]).slice(0,2).map(f=>tr('dash.activityDocSynced',{name:f.name})),
          ...apus.slice(0,2).map(a=>tr('dash.activityApuCreated',{ref:a.clave || a.id || ''})),
          ...budgets.slice(0,2).map(b=>tr('dash.activityBudgetSaved',{name:b.name})),
        ].map((x,i)=><div className="activity" key={i}><Icon name="doc" size={15}/> {x}</div>) : <EmptyState text={tr('dash.recentActivityEmpty')}/>}
      </div>
    </div>
  </section>
}

/* Convierte los renglones-objeto del esquema v2 (ver src/domain/apuSchema.js)
   de vuelta al formato de arreglo posicional v1 [desc,cantidad,unidad,precio,merma|FSR].
   Se usa solo para mantener funcionando la compatibilidad v1 (totals=calcAPU(apu),
   "Guardar", "Agregar al presupuesto", MatrixTable legacy) cuando la IA responde
   en v2: el contenido rico (procedimiento, calidad, seguridad, fuentes, confianza
   desglosada) vive completo en apuV2/professionalApu, esto es solo el espejo v1. */
function v2RowsToLegacy(kind, rows){
  return (Array.isArray(rows) ? rows : []).map(r => {
    if(kind === 'materials') return [r.descripcion, Number(r.consumo || 0), r.unidad, Number(r.precioUnitario || 0), Number(r.desperdicioPct || 0)];
    if(kind === 'labor'){
      const qty = Number(r.rendimiento) > 0 && Number(r.cuadrilla) > 0 ? Number(r.cuadrilla) / Number(r.rendimiento) : Number(r.cantidad || 0);
      return [r.descripcion, qty, r.unidad, Number(r.salarioBase || 0), Number(r.fsr || 1)];
    }
    return [r.descripcion, Number(r.cantidad || 0), r.unidad, Number(r.tarifa || 0)];
  });
}
function legacyShimFromV2(v2, fallbackConcept, sourceFile){
  const dims = v2.confidence || {};
  const confidence = Math.round(((Number(dims.precios)||0) + (Number(dims.rendimientos)||0) + (Number(dims.cantidades)||0) + (Number(dims.composicion)||0)) / 4) || 0;
  return {
    id: 'APU-' + uid(),
    clave: v2.clave || ('APU-' + uid().slice(0, 4)),
    concept: v2.concept || fallbackConcept,
    unit: v2.unit || 'pza',
    materials: v2RowsToLegacy('materials', v2.materials),
    labor: v2RowsToLegacy('labor', v2.labor),
    equipment: v2RowsToLegacy('equipment', v2.equipment),
    herramienta: Number(v2.herramientaMenor?.porcentaje ?? APU_DEFAULT_FACTORS.herramienta),
    indCampo: Number(v2.factores?.indCampo ?? APU_DEFAULT_FACTORS.indCampo),
    indOficina: Number(v2.factores?.indOficina ?? APU_DEFAULT_FACTORS.indOficina),
    finance: Number(v2.factores?.finance ?? APU_DEFAULT_FACTORS.finance),
    utility: Number(v2.factores?.utility ?? APU_DEFAULT_FACTORS.utility),
    cargos: Number(v2.factores?.cargos ?? APU_DEFAULT_FACTORS.cargos),
    iva: Number(v2.factores?.iva ?? APU_DEFAULT_FACTORS.iva),
    family: 'APU generado con IA',
    confidence,
    sat: '72100000',
    sourceFile: sourceFile || 'OpenAI API',
    aiGenerated: true,
    templateGenerated: false,
    templateFallback: false,
    aiNotes: (v2.supuestos || []).map(s => s?.texto || s).filter(Boolean),
    date: new Date().toLocaleDateString('es-MX')
  };
}

const APU_STEPS = ['Concepto','IA','Análisis','Validación','Entregables'];
function ApuStepper({stepIndex}){
  return <div className="apu-stepper">{APU_STEPS.map((s,i)=><div key={s} className={`apu-step${i===stepIndex?' current':i<stepIndex?' done':''}`}><span className="apu-step-dot">{i<stepIndex?'✓':i+1}</span><span className="apu-step-label">{s}</span></div>)}</div>;
}

/* Progreso puramente presentacional durante la llamada IA (una sola peticion
   real a /api/generate-apu): NO afirma que cada etapa termino en el backend,
   solo orienta al usuario mientras espera. El estado real (aiStatus) se
   muestra aparte una vez que la llamada responde. */
function AIProgress({active}){
  const [i,setI]=useState(0);
  useEffect(()=>{
    if(!active){ setI(0); return; }
    const id=window.setInterval(()=>setI(v=>nextProgressIndex(v, AI_PROGRESS_STEPS.length)), 1100);
    return ()=>window.clearInterval(id);
  },[active]);
  if(!active) return null;
  return <div className="ai-progress">{AI_PROGRESS_STEPS.map((s,idx)=><div key={s} className={`ai-progress-row${idx===i?' current':idx<i?' past':''}`}><span className="ai-progress-dot"/><span>{s}</span></div>)}</div>;
}

/* Tarjetas compactas con los numeros reales del APU (calcAPUv2 vía
   finalizeProfessionalAPU): nunca valores inventados. Visibles antes del
   editor tanto en modo edicion como en modo resultado. */
function ExecutiveSummaryCards({apu,globalConfidence}){
  const hasContent = (apu?.materials?.length||0) + (apu?.labor?.length||0) > 0;
  if(!hasContent) return null;
  const t = apu.calculated || {};
  const direct = t.direct || 0;
  const segs = [['Materiales',t.mat,'#9D6FD0'],['Mano de obra',t.mo,'#2A1740'],['Equipo',t.equipo,'#B8A4CC'],['Herramienta',t.herramienta,'#C7A35C']];
  const validado = apu.validationStatus === 'VALIDADO';
  // Fuente unica de verdad del Confidence global (ver apuConfidence.js): el
  // llamador ya calculo runApuConfidence(apu) una sola vez (se comparte con
  // "Confianza del analisis" y la tarjeta legacy de abajo, para que las tres
  // superficies de esta misma pantalla muestren siempre el mismo numero).
  const gc = formatGlobalConfidence(globalConfidence);
  return <div className="exec-kpis">
    <div className="exec-kpi-card gold"><small>Precio unitario</small><b>{money(t.pu)}</b><span>/ {apu.unit || 'unidad'}</span></div>
    <div className="exec-kpi-card"><small>Costo directo</small><b>{money(direct)}</b><span>base del análisis</span></div>
    <div className="exec-kpi-card"><small>Cantidad</small><b>{num(apu.cantidadObra)}</b><span>{apu.unit || 'unidad'}</span></div>
    <div className="exec-kpi-card"><small>Importe</small><b>{money(t.importeTotal)}</b><span>sin IVA</span></div>
    <div className="exec-kpi-card"><small>Confianza global</small><b>{gc.scoreLabel}</b><span>{gc.score==null?'':gc.level}</span></div>
    <div className={`exec-kpi-card${validado?' ok':' warn'}`}><small>Estado</small><b>{validado?'Validado':'Revisión necesaria'}</b><span>{(apu.warnings||[]).length} observación(es)</span></div>
    <div className="exec-kpi-breakdown">{segs.map(([label,v,color])=><div key={label} className="exec-kpi-seg"><i style={{background:color}}/><span>{label}</span><b>{direct>0?Math.round((v||0)/direct*100):0}%</b></div>)}</div>
  </div>;
}

/* A. Encabezado ejecutivo: identifica el concepto activo de un vistazo
   (clave, concepto completo, unidad, cantidad, especialidad detectada y si
   la matriz viene de IA real o de la plantilla de contingencia). apuLegacy
   trae family/templateFallback/aiGenerated (solo existen en el objeto v1). */
function ApuExecHeader({apu,apuLegacy}){
  const origin = apuLegacy?.templateFallback
    ? {label:'Plantilla de contingencia',cls:'contingency',icon:'⚠'}
    : apuLegacy?.aiGenerated
    ? {label:'Generado con OpenAI',cls:'real',icon:'✨'}
    : {label:'Matriz base ZOEMEC',cls:'base',icon:'◆'};
  return <div className="apu-exec-header">
    <div className="apu-exec-header-top">
      <span className="apu-exec-clave">{apu.clave || 'Sin clave'}</span>
      <span className={`apu-exec-origin ${origin.cls}`}><span aria-hidden="true">{origin.icon}</span> {origin.label}</span>
    </div>
    <h2 className="apu-exec-concept">{apu.concept || 'Concepto sin definir'}</h2>
    <div className="apu-exec-header-meta">
      <span><small>Unidad</small><b>{apu.unit || '—'}</b></span>
      <span><small>Cantidad</small><b>{num(apu.cantidadObra)}</b></span>
      <span><small>Especialidad</small><b>{apuLegacy?.family || 'General'}</b></span>
    </div>
  </div>;
}

/* C. Recursos: conteo + importe real por categoria (mismos totales que
   calcAPUv2 usa para el costo directo), para entender de un vistazo que
   trae la matriz antes de abrir el detalle en la seccion D. */
const RESOURCE_CARD_DEFS=[['labor','👷','Mano de obra','mo'],['materials','🧱','Materiales','mat'],['tools','🔧','Herramienta','herramienta'],['equipment','🚜','Equipo','equipo'],['seguridad','🦺','Seguridad','seguridad']];
function ResourceCards({apu}){
  const t=apu.calculated||{};
  return <div className="apu-resource-cards">
    {RESOURCE_CARD_DEFS.map(([key,icon,label,calcKey])=>{
      const count=key==='tools' ? (apu.herramientaMenor?.detalle?.length||0) : (apu[key]?.length||0);
      return <div className="apu-resource-card" key={key}>
        <span className="apu-resource-icon" aria-hidden="true">{icon}</span>
        <div><b>{label}</b><span>{count} recurso{count===1?'':'s'} · {money(t[calcKey]||0)}</span></div>
      </div>;
    })}
  </div>;
}

function APU({company,user,usage,setUsage,apus,setApus,budgets,setBudgets,catalog,setCatalog,projects,rawApus,linkApuToProject,activeProjectId,activeProject,onNeedProject}){
  const { t: tr } = useI18n();
  const requireProject=()=>{
    if(activeProjectId) return true;
    if(confirm('Para guardar necesitas un proyecto activo (asi tus APUs quedan asociados a una obra y nunca se mezclan con otra). ¿Crear o seleccionar un proyecto ahora?')) onNeedProject?.();
    return false;
  };
  const [concept,setConcept]=useState('');
  // Unidad/Cantidad explicitas (opcionales): parseConceptText adivina unidad y
  // cantidad del texto pegado, pero un concepto en lenguaje natural puede traer
  // numeros que no son la cantidad (ej. "tuberia de 3 a 6 pulgadas" hace que el
  // parser tome "3" en vez de la cantidad real). Si el usuario captura estos
  // campos, tienen prioridad sobre lo que el parser adivino.
  const [aiUnit,setAiUnit]=useState('');
  const [aiQty,setAiQty]=useState('');
  const [apu,setApu]=useState(()=>makeEmptyAPU());
  const [apuV2,setApuV2]=useState(()=>finalizeProfessionalAPU(migrateLegacyApuToV2(makeEmptyAPU())));
  // stableApuId (Fase 8 Parte 2, fix de identidad): apuV2.id cambia cada vez
  // que se regenera el desarrollo (generate()/generateAI() minan un id
  // fresco cada vez -- ver apuGeneration.js#makeAPUFromConcept -- eso es
  // intencional para esos flujos y NO se toca). Pero para la persistencia
  // autoritativa (Fase 7: saveVersion/dossier) esa inestabilidad causaba un
  // 404 real: la segunda vez que se guardaba tras "Actualizar desarrollo",
  // el id ya no era el mismo que el servidor conocia. stableApuId es una
  // identidad SEPARADA que solo cambia cuando de verdad es otra APU (Limpiar,
  // o "Abrir" un guardado distinto) -- se estampa sobre professionalApu mas
  // abajo, sin tocar generate()/generateAI() ni el efecto de migracion v1->v2.
  const [stableApuId,setStableApuId]=useState(()=>apuV2.id);
  // skipMigrateIdRef: cuando generateAI ya construyo un apuV2 rico (procedimiento,
  // calidad, seguridad, fuentes, confianza real desde el esquema v2), este efecto
  // NO debe pisarlo con la migracion vacia de apuV1->v2 solo porque apu.id cambio.
  const skipMigrateIdRef=useRef(null);
  useEffect(()=>{
    if(skipMigrateIdRef.current === apu.id){ skipMigrateIdRef.current = null; return; }
    setApuV2(finalizeProfessionalAPU(migrateLegacyApuToV2(apu)));
  },[apu.id]);
  const [showExecutive,setShowExecutive]=useState(false);
  const [aiOpen,setAiOpen]=useState(false);
  const [excelInfo,setExcelInfo]=useState(null);
  const [aiStatus,setAiStatus]=useState('');
  const [conceptBatch,setConceptBatch]=useState(null);
  // IDs de los APUs creados por el ULTIMO lote de catalogo generado (RC4):
  // "Limpiar trabajo" los retira de la lista del proyecto para que un
  // catalogo nuevo nunca herede resultados del anterior. Nunca incluye APUs
  // guardados por otras vias (concepto suelto, sesiones previas), solo los
  // que produjo generateSelectedBatch la ultima vez.
  const [lastBatchApuIds,setLastBatchApuIds]=useState([]);
  /* Cola robusta de generacion masiva (endurecimiento): activeJob es el
     estado EN VIVO del lote que se esta procesando ahora mismo (o null si no
     hay ninguno); resumableJob es un lote anterior sin terminar que se
     detecto al montar el componente (recarga de pagina / nueva sesion) y que
     el usuario aun no decidio reanudar o descartar. cancelRequestedRef es la
     senal cooperativa de cancelacion: el lazo del lote la revisa ENTRE
     lanzamientos de items, nunca interrumpe una llamada ya en vuelo (para no
     corromper un resultado a medio calcular). */
  const [activeJob,setActiveJob]=useState(null);
  const [resumableJob,setResumableJob]=useState(null);
  const cancelRequestedRef=useRef(false);
  useEffect(()=>{
    if(!firebaseReady || !user?.uid) return;
    let alive = true;
    (async () => {
      try{
        const activeBatchId = await getActiveBatchId(db, user.uid);
        if(!activeBatchId || !alive) return;
        const job = await loadJob(db, user.uid, activeBatchId);
        if(job && alive && !isJobComplete(job)) setResumableJob(job);
      }catch{ /* sin lote activo o sin permisos: no hay nada que reanudar */ }
    })();
    return () => { alive = false; };
  }, [user?.uid]);
  /* RC4 Fase 2 (Planos IA / Takeoff): recoge la semilla de concepto dejada por
     PlanoTakeoff (toApuSeed de un elemento VALIDADO_POR_USUARIO) y precarga el
     panel "Generar con IA". No dispara la generacion por su cuenta: el
     usuario sigue teniendo que revisar y pulsar "Generar APU con IA real" el
     mismo, igual que con cualquier otro concepto pegado a mano. */
  useEffect(()=>{
    let raw;
    try{ raw = localStorage.getItem('zoemec-pending-plano-seed'); }catch{ raw = null; }
    if(!raw) return;
    try{ localStorage.removeItem('zoemec-pending-plano-seed'); }catch{}
    try{
      const seed = JSON.parse(raw);
      if(seed?.concept){
        setConcept(seed.concept);
        setAiUnit(seed.unit || '');
        setAiQty(seed.qty != null ? String(seed.qty) : '');
        setAiOpen(true);
        window.zoemecNotify?.('Concepto precargado desde Takeoff de planos (elemento validado). Revisa y pulsa "Generar con IA" cuando estes listo.', 'info');
      }
    }catch{}
  },[]);
  const [batchAPUs,setBatchAPUs]=useState([]);
  const [batchBusy,setBatchBusy]=useState(false);
  // Revision de duplicados del catalogo Excel (seccion 3/12 del sprint): en vez
  // de una pared de N renglones, se agrupan por conceptApuKey (mismo criterio
  // que ya usaba buildBatchAPUs para reusar APUs) y solo el primero de cada
  // grupo queda preseleccionado. batchSelection=null significa "sin catalogo
  // cargado todavia"; una vez cargado, siempre es un Set (aunque este vacio).
  const [batchSelection,setBatchSelection]=useState(null);
  const [batchSearch,setBatchSearch]=useState('');
  const [batchResult,setBatchResult]=useState(null);
  const priceCatalogInputRef = useRef(null);
  const fullExcelInputRef = useRef(null);
  const conceptCatalogInputRef = useRef(null);
  const mainExcelInputRef = useRef(null);
  const conceptCardRef = useRef(null);
  const conceptTextareaRef = useRef(null);
  const clearFileInputs = () => [priceCatalogInputRef, fullExcelInputRef, conceptCatalogInputRef, mainExcelInputRef].forEach(ref => { if(ref.current) ref.current.value = ''; });
  const resetAPUForm = () => {
    clearFileInputs();
    const empty = emptyApuWorkspaceState();
    setConcept(empty.concept);
    setAiUnit(empty.aiUnit);
    setAiQty(empty.aiQty);
    const freshApu = makeEmptyAPU();
    setApu(freshApu);
    // Limpiar/Crear manualmente es el unico momento (junto con "Abrir" otro
    // guardado) en que de verdad es OTRA identidad -- ver stableApuId arriba.
    setStableApuId(freshApu.id);
    setAiOpen(empty.aiOpen);
    setExcelInfo(empty.excelInfo);
    setConceptBatch(empty.conceptBatch);
    setBatchAPUs(empty.batchAPUs);
    setAiStatus(empty.aiStatus);
    setBatchBusy(empty.batchBusy);
    setShowExecutive(empty.showExecutive);
    setBatchSelection(empty.batchSelection);
    setBatchSearch(empty.batchSearch);
    setBatchResult(empty.batchResult);
  };
  /* "Limpiar trabajo" (independiente de "Crear manualmente / Limpiar"):
     restablece TODO el estado de trabajo de este modulo -- catalogo de
     precios cargado, archivo Excel actual, conceptos detectados/
     seleccionados, duplicados, progreso y resultado de la ultima
     generacion, y los APUs que produjo el ULTIMO lote (nunca APUs
     guardados por otra via ni de sesiones anteriores, ver removeBatchApus)
     -- para que cargar un catalogo nuevo nunca herede nada del anterior. No
     toca Biblioteca, proyectos, usuarios ni presupuestos ya guardados.

     RC7 -- aclaracion explicita (reporte real: usuario esperaba que esto
     tambien vaciara la Bandeja de revision tecnica del proyecto y no
     entendio por que seguian ahi 52 conceptos): esto es COMPORTAMIENTO
     INTENCIONAL, no un defecto -- "Limpiar trabajo" nunca toco APUs ya
     guardados del proyecto (de sesiones anteriores, importaciones previas,
     etc.), solo el lote que se acaba de generar en ESTA sesion. Para vaciar
     el proyecto completo (todos sus APUs guardados) existe ahora la accion
     separada "Vaciar proyecto" (ver emptyActiveProject), con su propia
     confirmacion explicita -- nunca se combinan en un mismo boton. */
  const clearWorkspace = () => {
    if(!window.confirm('¿Limpiar todo el trabajo actual de APU Inteligente?\n\nSe perdera: el catalogo cargado, el archivo Excel actual, los conceptos detectados y seleccionados, los duplicados, el progreso y los APUs generados en este lote.\n\nNo se borra Biblioteca, proyectos, usuarios, presupuestos ni APUs YA GUARDADOS en este proyecto (para eso usa "Vaciar proyecto").\n\nEsta accion no se puede deshacer.')) return;
    // Si hay un lote de la cola corriendo, se cancela primero (cooperativo:
    // deja terminar la llamada en vuelo, nunca la corta a medias) -- de lo
    // contrario quedaria un lazo "zombie" escribiendo en Firestore/apus
    // despues de que el usuario ya creyo haber limpiado todo.
    if(activeJob && !isJobComplete(activeJob)) cancelRequestedRef.current = true;
    setActiveJob(null);
    if(firebaseReady && user?.uid) clearActiveBatchId(db, user.uid).catch(() => {});
    setApus(prev => removeBatchApus(prev, lastBatchApuIds));
    setLastBatchApuIds([]);
    setCatalog([]);
    resetAPUForm();
  };
  /* "Vaciar proyecto" (RC7, causa raiz del reporte "Limpiar trabajo no
     limpia el proyecto activo"): accion EXPLICITA y separada de "Limpiar
     trabajo" para borrar TODOS los APUs guardados del proyecto activo (la
     Bandeja de revision tecnica completa), no solo el ultimo lote.

     Fuente de verdad real de los APUs mostrados en la Bandeja: rawApus
     (useCloudState(user,'zoemec-apus',[]) en App) -- persistido en
     localStorage al instante y en Firestore (users/{uid}/state/zoemec-apus)
     con debounce de 1.2s, ver src/cloud.js. `apus`/`setApus` (los que usa
     este componente y RevisionBandeja) ya son la VISTA filtrada al proyecto
     activo via useProjectScoped -- setApus([]) escribe sobre esa misma
     fuente de verdad (nunca un setState solo visual): useProjectScoped funde
     el arreglo vacio con mergeScopedUpdate, que reemplaza en rawApus SOLO
     los items con projectId===activeProjectId y preserva intactos los de
     cualquier otro proyecto (ver src/domain/apuWorkspace.js). Por eso
     "despues de F5 siguen los 52" NUNCA puede pasar con esta funcion: al
     recargar, useCloudState relee localStorage (ya vacio, escrito de forma
     sincrona) y luego reconcilia con Firestore por updatedAt.

     Nunca toca: catalogo de precios, presupuestos, biblioteca, clientes,
     proyectos ni usuarios -- solo la coleccion de APUs del proyecto activo. */
  const emptyActiveProject = () => {
    if(!activeProjectId){ alert('No hay un proyecto activo que vaciar.'); return; }
    const nombreProyecto = activeProject?.name || 'este proyecto';
    if(!window.confirm(`¿Seguro que deseas eliminar los APUs y conceptos de este proyecto? Esta acción no se puede deshacer.\n\nSe eliminarán TODOS los APUs y conceptos guardados del proyecto "${nombreProyecto}" (la Bandeja de revisión técnica completa).\n\nNO se elimina: el proyecto en sí, la Biblioteca técnica, el catálogo de precios, los clientes ni ningún otro proyecto.`)) return;
    if(activeJob && !isJobComplete(activeJob)) cancelRequestedRef.current = true;
    setActiveJob(null);
    if(firebaseReady && user?.uid) clearActiveBatchId(db, user.uid).catch(() => {});
    setApus([]);
    setLastBatchApuIds([]);
    resetAPUForm();
    setAiStatus('Proyecto vaciado: se eliminaron todos los APUs y conceptos guardados de este proyecto.');
  };
  // Agrupacion de duplicados y preseleccion: logica pura en
  // src/domain/apuWorkspace.js (duplicateGroupKey/groupConceptsByDuplicateKey/
  // defaultBatchSelection), para que la UI y las pruebas de integracion usen
  // exactamente la misma regla -- ver Test RC6 de seleccion/generacion.
  const batchGroups = useMemo(() => groupConceptsByDuplicateKey(conceptBatch?.concepts), [conceptBatch]);
  useEffect(() => {
    if(!conceptBatch?.concepts?.length){ setBatchSelection(null); return; }
    setBatchSelection(defaultBatchSelection(conceptBatch.concepts));
    setBatchResult(null);
  }, [conceptBatch]);
  const batchDuplicateRows = conceptBatch?.concepts ? conceptBatch.concepts.length - batchGroups.size : 0;
  const batchFilteredRows = useMemo(() => {
    const list = conceptBatch?.concepts || [];
    const q = batchSearch.trim().toLowerCase();
    return list
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !q || String(item.concept||'').toLowerCase().includes(q) || String(item.code||'').toLowerCase().includes(q));
  }, [conceptBatch, batchSearch]);
  const toggleBatchRow = (index) => setBatchSelection(prev => { const n = new Set(prev); n.has(index) ? n.delete(index) : n.add(index); return n; });
  const selectAllBatchRows = () => setBatchSelection(new Set((conceptBatch?.concepts||[]).map((_,i)=>i)));
  const selectUniqueBatchRows = () => setBatchSelection(defaultBatchSelection(conceptBatch?.concepts));
  const selectNoBatchRows = () => setBatchSelection(new Set());
  const generateSelectedBatch = async () => {
    if(!conceptBatch?.concepts?.length || batchBusy) return;
    // resolveBatchSelection (src/domain/apuWorkspace.js) es la UNICA fuente
    // de verdad de "que se genera vs que se excluye" -- generateSelectedBatch,
    // exportConceptBatch y exportConceptBatchPDF la comparten, para que los 3
    // caminos nunca puedan dar resultados distintos entre si (Fase "consistencia
    // de contadores" del reporte RC6). excludedConcepts nunca se descarta en
    // silencio: se muestra siempre que exista, ver batchResult.excludedConcepts.
    const { selectedList, excludedConcepts } = resolveBatchSelection(conceptBatch.concepts, batchSelection);
    if(!selectedList.length){ alert('Selecciona al menos un concepto valido (con descripcion) para generar.'); return; }
    if(!requireProject()) return;
    // FIX Fase 9 (hallazgo F-006, P1): este camino de generacion por lote
    // nunca habia llamado requireApuAccess()/markApuUsed() -- una cuenta
    // Gratis podia generar CUALQUIER cantidad de APUs reales pegando varios
    // conceptos a la vez, evadiendo por completo el limite de "1 APU
    // gratis" que si aplica al camino de un solo concepto (ver save()/
    // requireApuAccess() mas abajo). Mismo candado, mismo mensaje.
    if(!requireApuAccess()) return;
    setBatchBusy(true);
    setBatchResult(null);
    cancelRequestedRef.current = false;
    try{
      const job = createBatchJob({
        batchId: 'BATCH-' + uid(),
        fileName: conceptBatch.fileName,
        items: selectedList,
        catalogFingerprint: fingerprintCatalog(conceptBatch.fileName, selectedList)
      });
      const finished = await runQueueJob(job);
      const apuList = finished.items.filter(it => it.apu).map(it => it.apu);
      // RC8: runQueueJob (cola robusta) nunca poblaba batchAPUs (solo lo
      // hacia buildBatchAPUs, la generacion no robusta) -- sin esto,
      // "Descargar Excel profesional"/"PDF profesional por concepto"
      // NUNCA reusaban lo que se acababa de generar aqui: volvian a llamar
      // a la IA desde cero (batchAPUs.length=0 != list.length), duplicando
      // el costo y arriesgando que WEB/Excel/PDF mostraran resultados
      // distintos entre si. Con esto, si el usuario exporta justo despues
      // de generar el mismo lote completo, se reusan estos APUs reales.
      setBatchAPUs(apuList);
      if(apuList.length) markApuUsed();
      const items = apuList.map(a => ({ concept: a.concept, unit: a.unit, qty: Number(a.cantidadObra ?? a.sourceQty ?? 1) || 1, pu: a.calculated?.pu ?? calcAPU(a).pu }));
      const subtotal = items.reduce((s, it) => s + Number(it.qty) * Number(it.pu), 0);
      const iva = subtotal * DEFAULT_IVA_RATE / 100;
      const sourceName=String(conceptBatch.fileName||'catálogo Excel').replace(/\.(xlsx|xls|csv)$/i,'');
      const budget = { id:'PRE-'+uid(), name:`Presupuesto ${sourceName}`, client:'Cliente por definir', items, ivaRate:DEFAULT_IVA_RATE, total:subtotal+iva, date:new Date().toLocaleDateString('es-MX') };
      if(items.length) setBudgets(prev => [budget, ...prev]);
      const summary = summarizeJob(finished);
      setBatchResult({ conceptsTotal: conceptBatch.concepts.length, selected: selectedList.length, generated: apuList.length, review: summary.requiere_revision, errors: summary.error, cancelled: finished.cancelled, budget, excludedConcepts });
      setAiStatus(finished.cancelled
        ? `Lote cancelado: ${summary.done} de ${summary.total} conceptos procesados antes de cancelar.`
        : `Lote terminado: ${summary.terminado} listos, ${summary.requiere_revision} con observaciones, ${summary.error} con error.`);
    }catch(error){
      alert(`No se pudo generar el lote seleccionado: ${error?.message || 'error desconocido'}.`);
    }finally{
      setBatchBusy(false);
    }
  };
  const totals=calcAPU(apu);
  // id/projectId estampados aqui (Fase 8 Parte 2, fix de identidad y de
  // "APU nace sin proyecto"): professionalApu es el UNICO objeto que ven
  // ProfessionalApuEditor/saveVersion/el dossier -- apuV2.id sigue
  // cambiando internamente como siempre (generate()/generateAI() no se
  // tocan), pero lo que la persistencia ve es siempre stableApuId. Igual
  // con projectId: nunca se rellena despues, nace ya con el proyecto activo
  // si existe uno (activeProjectId, ya trackeado mas arriba).
  const professionalApu=useMemo(()=>finalizeProfessionalAPU({...apuV2,id:stableApuId,projectId:apuV2.projectId||activeProjectId||null,cantidadObra:Number(apuV2.cantidadObra||excelInfo?.qty||apu.sourceQty||1)}),[apuV2,stableApuId,activeProjectId,excelInfo?.qty,apu.sourceQty]);
  // Fuente unica de verdad del Confidence global (ver src/domain/apuConfidence.js
  // #runApuConfidence -- auditoria JUDGE READY): se calcula UNA vez por render
  // aqui y se comparte entre ExecutiveSummaryCards, "Confianza del analisis" y
  // la tarjeta legacy de abajo, para que las tres superficies de esta misma
  // pantalla (y Excel/PDF, que llaman a runApuConfidence de forma independiente
  // sobre el mismo apu finalizado) muestren siempre el mismo numero.
  const globalConfidence=useMemo(()=>runApuConfidence(professionalApu),[professionalApu]);
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
      const data = await readJsonSafe(res);
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
  /* 1 concepto de entrada = 1 concepto normalizado = 1 APU independiente,
     tambien cuando el catalogo llega pegado a mano en el textarea (no solo
     por Excel): si el texto trae mas de un renglon reconocible como
     concepto (numerado "1-"/"1."/"01 " o uno por salto de linea), se
     redirige al MISMO panel de revision de lote y motor de cola
     (runQueueJob/apuBatchQueue.js) que ya usa el catalogo de Excel -- nunca
     se concatena todo en un solo concepto ni se inventa un pipeline
     paralelo. Con 0 o 1 concepto detectado no hace nada: el llamador sigue
     el camino de concepto suelto exactamente como antes. */
  const routeIfMultipleConcepts=()=>{
    const segmented=parseConceptListText(concept);
    if(segmented.concepts.length<=1) return false;
    setConceptBatch(segmented);
    setAiStatus(`Se detectaron ${segmented.concepts.length} conceptos en el texto pegado (uno por renglón). Revisa la lista y genera el lote: cada uno se procesa como un APU independiente.`);
    setAiOpen(true);
    return true;
  };
  const generate=()=>{
    if(!requireApuAccess()) return;
    if(!concept.trim()){ alert('Pega o sube un concepto real para generar el APU.'); return; }
    if(routeIfMultipleConcepts()) return;
    const parsed=parseConceptText(concept);
    if(aiUnit.trim()) parsed.unit=aiUnit.trim();
    if(Number(aiQty)>0) parsed.qty=Number(aiQty);
    const next=standardAPUForConcept({concept:parsed.concept, unit:parsed.unit, qty:parsed.qty, referencePU:parsed.referencePU, variables:conceptVariablesFromParsed(parsed)}, catalog, 0, 'Texto pegado');
    setConcept(parsed.concept);
    setApu(next);
    setExcelInfo(parsed.referencePU ? {fileName:'Texto pegado',concept:parsed.concept,unit:next.unit,qty:parsed.qty,referencePU:parsed.referencePU,catalog:[]} : null);
    setAiStatus('APU estandarizado desde catalogo base ZOEMEC.');
    setShowExecutive(true);
  };
  const [aiBusy,setAiBusy]=useState(false);
  // requestSeq: guarda contra respuestas tardias (Prueba 5 del sprint: usuario
  // dispara una generacion, cambia de concepto/sale del modulo antes de que
  // responda, y la respuesta tardia NO debe contaminar el desarrollo activo).
  const aiRequestSeqRef=useRef(0);
  // Material & Price Intelligence 2.1: contexto de budget/telemetry/
  // single-flight COMPARTIDO entre todos los conceptos de UNA corrida de
  // lote (creado al inicio de buildBatchAPUs/runQueueJob, reutilizado por
  // cada llamada a generateBatchAPU dentro de esa corrida) -- asi 20
  // conceptos con el mismo insumo dentro del mismo lote deduplican de
  // verdad (1 busqueda real, no 20). El cache en si es un singleton de
  // sesion (ver intelligence2Runtime.js#getSharedPriceCache), no vive aqui.
  const batchIntelligence2ContextRef=useRef(null);
  // Cambiar de proyecto activo mientras este componente sigue montado (el
  // usuario no sale de "APU Inteligente", solo cambia el selector de proyecto)
  // debe limpiar el borrador en pantalla e invalidar cualquier generacion de
  // IA en curso: si no, el resultado de esa IA (o el borrador visible)
  // apareceria sobre el proyecto equivocado al terminar de responder.
  const activeProjectIdRef=useRef(activeProjectId);
  useEffect(()=>{
    if(activeProjectIdRef.current === activeProjectId) return;
    activeProjectIdRef.current = activeProjectId;
    aiRequestSeqRef.current++;
    setAiBusy(false);
    resetAPUForm();
  },[activeProjectId]);
  const generateAI=async()=>{
    if(!requireApuAccess()) return;
    // Guard puro (src/domain/aiGenerationProgress.js): mismo criterio de
    // siempre (concepto real + no estar ya generando), ahora testeable sin
    // renderizar el componente. Evita que un doble clic / doble Enter
    // dispare una segunda llamada real a /api/generate-apu mientras la
    // primera sigue en curso.
    const guard = canStartAiGeneration({aiBusy, concept});
    if(!guard.allowed){
      if(guard.reason==='empty_concept') alert('Pega o sube un concepto real para generar con IA.');
      return;
    }
    if(routeIfMultipleConcepts()) return;
    const requestId = ++aiRequestSeqRef.current;
    setAiBusy(true);
    setAiStatus('Analizando el alcance del concepto...');
    const parsed=parseConceptText(concept);
    if(aiUnit.trim()) parsed.unit=aiUnit.trim();
    if(Number(aiQty)>0) parsed.qty=Number(aiQty);
    // Un intento = una llamada con su propio timeout de 45 s; hasta 3 intentos
    // en total, con espera mayor si OpenAI responde 429 (limite de tasa).
    const attemptGenerate = async () => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 45000);
      try{
        const res = await fetch(aiServerUrl('/api/generate-apu'), {
          method:'POST',
          headers:await authHeaders(),
          body:JSON.stringify({concept:parsed.concept,catalog,schema:'v2',referencePU:parsed.referencePU||0}),
          signal:controller.signal
        });
        const data = await res.json().catch(()=>({}));
        if(!res.ok){ const err = new Error(data?.error || 'No se pudo generar con IA.'); err.status = res.status; throw err; }
        return data;
      }finally{
        window.clearTimeout(timer);
      }
    };
    try{
      setAiStatus('Generando recursos: mano de obra, materiales, herramienta y equipo...');
      let data=null, lastAttemptError=null;
      for(let tryNum=0; tryNum<3 && !data; tryNum++){
        try{
          if(tryNum>0){
            setAiStatus(`Reintentando generación con IA (intento ${tryNum+1} de 3)...`);
            await new Promise(r=>setTimeout(r, lastAttemptError?.status===429 ? 6000*tryNum : 2500*tryNum));
          }
          data = await attemptGenerate();
        }catch(error){ lastAttemptError = error; }
      }
      if(!data) throw lastAttemptError || new Error('No se pudo generar con IA.');
      if(requestId !== aiRequestSeqRef.current) return; // respuesta tardia de un intento anterior: se descarta
      const draft = {
        ...data.apu,
        proyecto: apuV2.proyecto || '', cliente: apuV2.cliente || '', ubicacion: apuV2.ubicacion || '', moneda: apuV2.moneda || 'MXN',
        cantidadObra: Number(parsed.qty || 1) || 1,
        referencePU: Number(parsed.referencePU || 0) || 0,
        variables: conceptVariablesFromParsed(parsed)
      };
      // Material & Price Intelligence 2.1 (integracion final): mismo
      // orquestador que el flujo de lote (generateBatchAPU) -- proteccion de
      // unidad/cantidad/concepto capturados por el usuario (UNIT_WARNING si
      // la IA propone algo distinto, nunca se sobreescribe en silencio),
      // Material Origin por recurso, cache+budget+single-flight, y solo
      // entonces busqueda real de precio de mercado (mismo endpoint
      // /api/price-intelligence de siempre, ver src/domain/intelligence2Runtime.js).
      // Si falla por completo, el borrador conserva los precios ESTIMADO_IA
      // de la IA (igual que antes).
      let enrichedDraft = draft;
      try{
        setAiStatus('Buscando precios de mercado reales y validando equivalencia tecnica...');
        const runContext = createIntelligence2RunContext({ location: activeProject?.ubicacion || '', dateBase: draft.fechaBase });
        const result = await enrichApuWithIntelligence2({
          aiApu: draft, userInput: { concept: parsed.concept, unit: parsed.unit, qty: parsed.qty },
          concept: parsed.concept, ...runContext
        });
        enrichedDraft = result.apu;
        if(result.unitWarning) console.warn('[Material & Price Intelligence 2.1] UNIT_WARNING:', result.unitWarning);
      }catch{ /* Price Intelligence caida por completo: se sigue con el borrador de la IA */ }
      setAiStatus('Calculando rendimientos, seguridad, procedimiento y medicion...');
      const v2 = finalizeProfessionalAPU(enrichedDraft);
      const shim = legacyShimFromV2(v2, parsed.concept, 'OpenAI API');
      setAiStatus('Validando resultado...');
      skipMigrateIdRef.current = shim.id;
      setConcept(v2.concept || shim.concept);
      setApu(shim);
      setApuV2({ ...v2, id: shim.id });
      setExcelInfo({fileName:'OpenAI API',concept:shim.concept,unit:shim.unit,qty:parsed.qty,referencePU:parsed.referencePU,catalog});
      setAiStatus(`IA lista: ${formatGlobalConfidence(runApuConfidence(v2)).fullLabel} de confianza global`);
      setAiOpen(false);
      setShowExecutive(true);
      alert('APU generado correctamente');
    }catch(err){
      if(requestId !== aiRequestSeqRef.current) return;
      const reason = err?.name==='AbortError' ? 'la IA tardo demasiado en responder' : friendlyServiceError(err,'servidor no disponible');
      const next = templateFallbackAPU({concept:parsed.concept, unit:parsed.unit, qty:parsed.qty, referencePU:parsed.referencePU, variables:conceptVariablesFromParsed(parsed)}, catalog, 0, 'Plantilla tecnica ZOEMEC', reason);
      setConcept(next.concept);
      setApu(next);
      setExcelInfo({fileName:'Plantilla tecnica ZOEMEC',concept:next.concept,unit:next.unit,qty:parsed.qty,referencePU:parsed.referencePU,catalog});
      setAiStatus(`Plantilla tecnica aplicada (IA no disponible): ${next.family}`);
      setAiOpen(false);
      setShowExecutive(true);
    }finally{
      if(requestId === aiRequestSeqRef.current) setAiBusy(false);
    }
  };
  const importExcel=async(file)=>{ if(!file) return; if(/\.xls$/i.test(file.name)){alert('Este lector trabaja con .xlsx o .csv. Abre tu archivo en Excel y guárdalo como .xlsx.');return;} try{ const cat=await parseExcelToCatalog(file); if(!cat.length){alert('No detecté columnas de descripción y precio en el Excel. Revisa que tenga encabezados como "Descripción" y "Precio".');return;} setCatalog(cat); alert(`Catálogo importado: ${cat.length} insumos con precio. Al generar el APU usaré tus precios reales cuando coincidan.`); }catch(err){ alert(`No pude leer el archivo: ${err?.message || 'formato no compatible'}. Usa .xlsx o .csv.`); } };
  const importFullExcel=async(file)=>{
    if(!file) return;
    if(/\.xls$/i.test(file.name)){
      alert('Ese archivo parece .xls antiguo. Guárdalo como .xlsx desde Excel y vuelve a subirlo.');
      return;
    }
    // El diagnostico real de por que no se reconocio un catalogo de
    // conceptos (hoja, fila candidata, que columna si/no se detecto) nunca
    // debe perderse aunque el segundo intento (un solo APU) tambien falle --
    // por eso se guarda aqui en vez de descartarse en el catch.
    let batchDiagnosticMessage = null;
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
    }catch(batchErr){
      // Si no es presupuesto/catalogo de conceptos, intenta leerlo como un
      // solo APU -- pero conserva el diagnostico por si tambien falla.
      batchDiagnosticMessage = batchErr?.message || null;
    }
    try{
      const data=await parseExcelToAPU(file,catalog);
      // Nunca convertir la ACCION de importar en un concepto: si no se pudo
      // identificar un catalogo de renglones NI un concepto tecnico real en
      // este archivo, "Concepto importado desde Excel" es un marcador vacio,
      // no una descripcion de obra -- generar un APU con IA a partir de eso
      // termina inventando trabajo generico (p. ej. "Auxiliar administrativo
      // para importacion de datos"). Mejor un error honesto (con el
      // diagnostico real, hoja por hoja) que un concepto fabricado.
      if(!data.concept || data.concept === 'Concepto importado desde Excel'){
        alert(batchDiagnosticMessage || 'No pude identificar un catálogo de conceptos ni un concepto técnico único en este Excel. Revisa el archivo o pega el concepto manualmente.');
        return;
      }
      setCatalog(data.mergedCatalog);
      setConcept(data.concept);
      const next=standardAPUForConcept({concept:data.concept, unit:data.unit, qty:data.qty, referencePU:data.referencePU}, data.mergedCatalog, 0, data.fileName);
      setApu(next);
      setExcelInfo(data);
      setAiOpen(true);
    }catch(err){
      alert(batchDiagnosticMessage || `No pude leer el Excel completo: ${err?.message || 'formato no compatible'}. Usa .xlsx o .csv, o pega el renglón del concepto y presiona Actualizar desarrollo.`);
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
      alert(err?.message || 'No pude leer la lista de conceptos. Usa .xlsx o .csv.');
    }
  };
  /* Desarrolla UN concepto del catalogo en su matriz APU v2 completa (mano de
     obra con cuadrilla/rendimiento/FSR, materiales, herramienta, equipo,
     seguridad, procedimiento constructivo, control de calidad, medicion,
     confianza desglosada): mismo motor generateAPUv2 que ya usa "Generar APU
     con IA real" para un concepto suelto, aqui aplicado por cada renglon del
     lote. La IA solo propone recursos tecnicos -- applyConceptMetadataV2
     fuerza clave/descripcion/unidad/cantidad/P.U. de referencia desde el
     renglon original del Excel despues, nunca antes; el motor v2
     (calcAPUv2, via finalizeProfessionalAPU) es quien calcula los importes,
     nunca el LLM. */
  const generateBatchAPU=async(item, index)=>{
    const conceptForAI = [
      item.code ? `Clave: ${item.code}` : '',
      `Concepto: ${item.concept}`,
      `Unidad: ${item.unit}`,
      item.referencePU ? `PU base de Excel: ${money(item.referencePU)}` : '',
      item.section ? `Partida: ${item.section}` : ''
    ].filter(Boolean).join('\n');
    const sourceFile = conceptBatch?.fileName || 'Catalogo de conceptos';
    /* Un intento = una llamada con su propio timeout de 45 s (el reloj arranca
       cuando la petición sale de verdad, ya no mientras espera en cola). */
    const attempt = async () => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 45000);
      try{
        const res=await fetch(aiServerUrl('/api/generate-apu'),{method:'POST',headers:await authHeaders(),body:JSON.stringify({concept:conceptForAI,catalog,company,mode:'batch-concept',preserveOriginal:true,schema:'v2'}),signal:controller.signal});
        const data=await readJsonSafe(res);
        if(!res.ok){ const err=new Error(data?.error || 'No fue posible generar con IA'); err.status=res.status; throw err; }
        return data;
      }finally{
        window.clearTimeout(timer);
      }
    };
    let data=null, lastError=null;
    for(let tryNum=0; tryNum<3 && !data; tryNum++){
      try{
        if(tryNum>0){
          // 429 (limite de tasa) espera mas que un error de red/timeout comun.
          const backoff = lastError?.status===429 ? 6000*tryNum : 2500*tryNum;
          await new Promise(r=>setTimeout(r, backoff));
        }
        data = await attempt();
      }catch(error){ lastError = error; }
    }
    if(data){
      const withMeta = applyConceptMetadataV2(data.apu, item, index, sourceFile);
      // Material & Price Intelligence 2.1 (integracion final): mismo
      // orquestador que la generacion individual (generateAI) -- proteccion
      // de unidad/cantidad/clave/concepto capturados por el usuario en el
      // catalogo de conceptos (UNIT_WARNING si la IA propone otra unidad,
      // nunca se sobreescribe en silencio), Material Origin por recurso,
      // cache+budget+single-flight COMPARTIDOS entre los conceptos del
      // mismo lote (20 conceptos con el mismo insumo -> 1 busqueda real, no
      // 20), y solo entonces busqueda real de precio de mercado. Si falla
      // por completo, el renglon conserva su precio ESTIMADO_IA original
      // (nunca bloquea la generacion del APU).
      let enriched = withMeta;
      try{
        setAiStatus(`Buscando precios de mercado reales para "${item.concept?.slice(0,60) || 'concepto'}"...`);
        const result = await enrichApuWithIntelligence2({
          aiApu: withMeta, userInput: { concept: item.concept, unit: item.unit, qty: item.qty, clave: item.code },
          concept: item.concept, ...batchIntelligence2ContextRef.current
        });
        enriched = result.apu;
        if(result.unitWarning) console.warn(`[Material & Price Intelligence 2.1] UNIT_WARNING (${item.code || item.concept}):`, result.unitWarning);
      }catch{ /* si Price Intelligence falla por completo, se sigue con el APU tal cual la IA lo genero */ }
      const v2 = finalizeProfessionalAPU(enriched);
      v2.aiGenerated = true;
      v2.templateFallback = false;
      v2.family = data.apu?.family || v2.family;
      return v2;
    }
    const reason = lastError?.name === 'AbortError' ? 'tiempo agotado' : lastError?.status===429 ? 'limite de tasa de OpenAI (429) tras reintentos' : (lastError?.message || 'sin detalle');
    const fallbackV1 = templateFallbackAPU(item, catalog, index, sourceFile, `IA externa no respondio tras 3 intentos: ${reason}`);
    const v2Fallback = finalizeProfessionalAPU(applyConceptMetadataV2(migrateLegacyApuToV2(fallbackV1), item, index, sourceFile));
    v2Fallback.aiGenerated = false;
    v2Fallback.templateFallback = true;
    v2Fallback.family = fallbackV1.family;
    return v2Fallback;
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
    batchIntelligence2ContextRef.current = createIntelligence2RunContext({ location: activeProject?.ubicacion || '' });
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
    const sourceFile = conceptBatch?.fileName || 'Catalogo de conceptos';
    const byKey = new Map(generated.map((apu, index) => [conceptApuKey(groupList[index].item), apu]));
    // Renglones duplicados reusan la misma matriz IA (mismo grupo/P.U.), pero cada
    // uno conserva su propia clave/cantidad reales via applyConceptMetadataV2 --
    // por eso se vuelve a finalizar (importeTotal depende de cantidadObra por renglon).
    const out = list.map((item, index) => {
      const base = byKey.get(conceptApuKey(item));
      const v2 = finalizeProfessionalAPU(applyConceptMetadataV2(base, item, index, sourceFile));
      v2.aiGenerated = Boolean(base?.aiGenerated);
      v2.templateFallback = Boolean(base?.templateFallback);
      v2.family = base?.family || v2.family;
      return v2;
    });
    const repeated = list.length - groups.size;
    setBatchAPUs(out);
    const first=out[0];
    if(first){
      const shim = {...legacyShimFromV2(first, first.concept, sourceFile), id:first.id, aiGenerated:Boolean(first.aiGenerated), templateFallback:Boolean(first.templateFallback), family:first.family||'APU generado con IA'};
      skipMigrateIdRef.current = shim.id;
      setApu(shim);
      setApuV2({...first, id: shim.id});
      setConcept(first.concept);
    }
    setAiStatus(`Desarrollo listo: ${out.length} conceptos (${groups.size} únicos, ${repeated} repetidos reutilizados).`);
    return out;
  };

  /* Cola robusta de generacion masiva (endurecimiento RC4): a diferencia de
     buildBatchAPUs (arriba, que espera TODO el lote antes de devolver nada),
     esta funcion persiste el resultado de CADA concepto apenas termina
     (checkpoint real en Firestore, ver apuBatchQueueCloud.js) y nunca deja
     que el fallo de un concepto tumbe a los demas: cada item se procesa de
     forma independiente, con su propia identidad hoja+fila+clave, y un error
     de uno solo lo marca ERROR sin tocar el resto. Concurrencia limitada a 4
     a la vez (mismo limite que el motor ya usaba). Cancelacion cooperativa:
     entre cada tanda de 4, revisa cancelRequestedRef -- nunca interrumpe una
     llamada ya en curso, para no dejar un resultado a medio calcular. */
  const CONCEPT_CONCURRENCY = 4;
  const runQueueJob = async (initialJob) => {
    batchIntelligence2ContextRef.current = createIntelligence2RunContext({ location: activeProject?.ubicacion || '' });
    let job = initialJob;
    setActiveJob(job);
    const persist = firebaseReady && Boolean(user?.uid);
    if(persist){
      await saveJobMeta(db, user.uid, job).catch(() => {});
      await setActiveBatchId(db, user.uid, job.batchId).catch(() => {});
    }
    const sourceFile = job.fileName || 'Catalogo de conceptos';
    while(!isJobComplete(job)){
      if(cancelRequestedRef.current){
        job = cancelJob(job);
        setActiveJob(job);
        if(persist) await markJobCancelled(db, user.uid, job.batchId).catch(() => {});
        break;
      }
      const batch = selectNextBatch(job, CONCEPT_CONCURRENCY, new Set());
      if(!batch.length) break;
      batch.forEach(entry => { job = markItemStatus(job, entry.itemKey, ITEM_STATUS.ANALIZANDO); });
      setActiveJob(job);
      await Promise.all(batch.map(async (entry) => {
        try{
          job = markItemStatus(job, entry.itemKey, ITEM_STATUS.BUSCANDO_RECURSOS);
          const v2 = await generateBatchAPU(entry.item, entry.index);
          job = markItemStatus(job, entry.itemKey, ITEM_STATUS.VALIDANDO);
          const requiresReview = Boolean(v2.templateFallback) || v2.validationStatus === 'REQUIERE REVISION' || conceptNeedsReviewFlag(entry.item);
          job = markItemDone(job, entry.itemKey, v2, { requiresReview });
          const finishedEntry = job.items.find(it => it.itemKey === entry.itemKey);
          if(persist) await saveItemState(db, user.uid, job.batchId, finishedEntry).catch(() => {});
          // FIX Fase 9 (hallazgo F-010, P0): `clave` es solo un rotulo de
          // posicion DENTRO de un lote ("CON-001", "CON-002"...) que
          // apuSchema.js reinicia en cada corrida -- nunca es unico entre
          // lotes distintos. Filtrar solo por `clave` (sin `batchId`) hacia
          // que generar un SEGUNDO lote en el MISMO proyecto archivara en
          // silencio los APUs del primer lote cuyo CON-00N coincidiera con
          // el nuevo (confirmado real: 2 de 3 APUs previos desaparecian del
          // proyecto sin aviso al pegar un segundo lote de 2 conceptos).
          // `id` no sirve como llave alterna: generateBatchAPU/
          // applyConceptMetadataV2 le asigna un id NUEVO en cada intento,
          // incluso al reintentar el MISMO item dentro del MISMO lote -- por
          // eso el dedup real es (clave + batchId): reemplaza un reintento
          // del mismo item en ESTE lote, nunca un item de un lote anterior.
          const tagged = { ...v2, projectId: activeProjectId, batchId: job.batchId };
          setApus(prev => [tagged, ...prev.filter(x => x.clave !== tagged.clave || x.batchId !== tagged.batchId)]);
          setLastBatchApuIds(prev => [...prev, tagged.id]);
        }catch(error){
          job = markItemError(job, entry.itemKey, error);
          const finishedEntry = job.items.find(it => it.itemKey === entry.itemKey);
          if(persist) await saveItemState(db, user.uid, job.batchId, finishedEntry).catch(() => {});
        }
        setActiveJob(job);
        const summary = summarizeJob(job);
        setAiStatus(`Procesando lote "${sourceFile}": ${summary.done} de ${summary.total} conceptos (${summary.terminado} listos, ${summary.requiere_revision} con observaciones, ${summary.error} con error).`);
      }));
    }
    if(persist && isJobComplete(job) && !job.cancelled){
      await clearActiveBatchId(db, user.uid).catch(() => {});
    }
    return job;
  };

  const cancelActiveJob = () => { cancelRequestedRef.current = true; };

  const retryFailedInActiveJob = async () => {
    if(!activeJob || batchBusy) return;
    setBatchBusy(true);
    cancelRequestedRef.current = false;
    try{
      const retried = retryFailedItems(activeJob);
      setActiveJob(retried);
      const finished = await runQueueJob(retried);
      const summary = summarizeJob(finished);
      setBatchResult(prev => prev ? { ...prev, generated: finished.items.filter(it => it.apu).length, review: summary.requiere_revision, errors: summary.error, cancelled: finished.cancelled } : prev);
      setAiStatus(finished.cancelled
        ? `Reintento cancelado: ${summary.done} de ${summary.total} conceptos procesados.`
        : `Reintento terminado: ${summary.terminado} listos, ${summary.requiere_revision} con observaciones, ${summary.error} con error.`);
    }finally{
      setBatchBusy(false);
    }
  };

  const resumeActiveJob = async () => {
    if(!resumableJob || batchBusy) return;
    setBatchBusy(true);
    cancelRequestedRef.current = false;
    const job = resumableJob;
    setResumableJob(null);
    setConceptBatch({ fileName: job.fileName, concepts: job.items.map(it => it.item) });
    try{
      await runQueueJob(job);
    }finally{
      setBatchBusy(false);
    }
  };

  const discardResumableJob = async () => {
    if(!resumableJob) return;
    if(firebaseReady && user?.uid) await deleteQueueJob(db, user.uid, resumableJob).catch(() => {});
    setResumableJob(null);
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
      // RC10: la fuente PERSISTENTE (apus del proyecto, buscados por clave)
      // manda sobre el cache de sesion batchAPUs -- ver resolveBatchExportApus
      // en src/domain/apuWorkspace.js. Si ninguna fuente cubre el lote
      // completo, se regenera; y si aun asi no alcanza, assertExpectedExportCount
      // aborta con un error explicito en vez de exportar un archivo parcial.
      let apuList = resolveBatchExportApus({ concepts: list, persistedApus: apus, cachedApus: batchAPUs });
      if(!apuList) apuList = await buildBatchAPUs(list);
      assertExpectedExportCount(list.length, apuList.length);
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
      // Mismo criterio que exportConceptBatch (RC10): fuente persistente
      // primero, guard de cantidad esperada antes de escribir cualquier archivo.
      let apuList = resolveBatchExportApus({ concepts: list, persistedApus: apus, cachedApus: batchAPUs });
      if(!apuList) apuList = await buildBatchAPUs(list);
      assertExpectedExportCount(list.length, apuList.length);
      await exportConceptsAPUPdfIndividual(list, catalog, apuList);
      setAiStatus(`PDF generado: ${list.length} conceptos, un PDF individual por concepto.`);
    }catch(error){
      alert(`No pude descargar el PDF por concepto: ${error?.message || 'error desconocido'}.`);
    }finally{
      setBatchBusy(false);
    }
  };
  // PDF maestro (spec 19-26): UN SOLO PDF con portada + resumen general +
  // control de revision + el desarrollo completo (A-F) de cada uno de los N
  // APUs, cada uno arrancando en pagina nueva -- ver exportAPUPdfMaster en
  // src/lib/apuExportV2.js. No reemplaza el boton de PDF individual de
  // arriba (exportConceptBatchPDF): son dos entregables distintos, mismo
  // criterio RC10 de resolucion/guard que los otros dos botones de lote.
  const exportConceptBatchPdfMaster=async()=>{
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
      let apuList = resolveBatchExportApus({ concepts: list, persistedApus: apus, cachedApus: batchAPUs });
      if(!apuList) apuList = await buildBatchAPUs(list);
      assertExpectedExportCount(list.length, apuList.length);
      await exportConceptsAPUPdfMasterFile(list, catalog, company, apuList);
      setAiStatus(`PDF maestro generado: ${list.length} conceptos en un solo documento.`);
    }catch(error){
      alert(`No pude descargar el PDF maestro: ${error?.message || 'error desconocido'}.`);
    }finally{
      setBatchBusy(false);
    }
  };
  const markApuUsed=()=>{
    if(user?.isAdmin) return;
    const nextCount = (userUsage.apusCreated||0)+1;
    setUsage({...usage,[user.email]:{...userUsage,apusCreated:nextCount,deviceId:user.deviceId}});
    if(firebaseReady && user?.uid){
      setDoc(doc(db, 'users', user.uid), { apusCreated:nextCount, updatedAt:serverTimestamp() }, { merge:true }).catch(console.error);
    }
  };
  const save=()=>{ if(!requireApuAccess()) return; if(!requireProject()) return; setApus([apu,...apus.filter(x=>x.id!==apu.id)]); markApuUsed(); alert(tr('apu.savedApu'));};
  const addBudget=()=>{ if(!requireApuAccess()) return; if(!requireProject()) return; setBudgets([{id:'PRE-'+uid(), name:'Presupuesto desde APU', client:'Cliente por definir', items:[{concept:apu.concept, unit:apu.unit, qty:1, pu:totals.pu}], total:totals.pu, date:new Date().toLocaleDateString('es-MX')},...budgets]); markApuUsed(); alert(tr('apu.addedToBudget'));};
  // Nota: la exportacion masiva por catalogo (multiples APUs) ya no pasa por
  // aqui -- vive en el panel de revision de duplicados (generateSelectedBatch
  // + los botones propios de "PRESUPUESTO GENERADO"), para que el usuario
  // siempre vea y controle que conceptos se estan generando/exportando en
  // lote, en vez de que "Descargar PDF/Excel" del APU activo cambie de
  // comportamiento en silencio solo porque alguna vez se subio un catalogo.
  const [exportBusy,setExportBusy]=useState(false);
  // Defecto real (medido): con un catalogo de N conceptos cargado, este boton
  // de UN SOLO APU (siempre el concepto previsualizado, nunca el lote) se
  // confunde facilmente con "Excel completo por concepto (N hojas)" -- ambos
  // se leen igual para el usuario. Nunca cambia lo que exporta (ver nota
  // arriba: sigue siendo solo el APU activo, por diseno), pero si el
  // catalogo tiene mas de 1 concepto, se confirma antes para que la
  // reduccion N->1 nunca sea silenciosa.
  const confirmSingleExportIfAmbiguous=()=>{
    const warning = describeAmbiguousSingleExport(conceptBatch, professionalApu?.concept);
    if(warning) return window.confirm(warning);
    return true;
  };
  const exportPDF=async()=>{
    // Bug reportado (auditoria JUDGE READY): "Descargar PDF de este APU" no
    // descargaba nada ni mostraba error visible en varios intentos reales.
    // El exportador (exportAPUPdfV2) no esta roto -- probado directo, genera
    // un PDF real y valido. La causa real vive aqui, en el handler: este
    // candado de plan gratis usaba alert() nativo, exactamente igual que
    // exportExcel de abajo. Un alert() bloqueante es facil de perder de
    // vista (queda detras de otra ventana, un navegador con dialogos
    // suprimidos lo descarta en silencio, o simplemente no se nota que es un
    // dialogo del navegador y no un fallo de la app) -- indistinguible de
    // "el boton no hace nada". Se reemplaza por window.zoemecNotify, el
    // mismo mecanismo de error visible y persistente que ya usa el resto de
    // la app (ver OneDrive/Google Drive mas abajo en este archivo) en vez de
    // un dialogo nativo que puede pasar inadvertido.
    if(isFree && userUsage.apusCreated>=1){ window.zoemecNotify?.('La exportación ilimitada requiere plan activo.', 'error'); return; }
    if(!confirmSingleExportIfAmbiguous()) return;
    setExportBusy(true);
    try{ await exportAPUPdfV2(professionalApu); }
    catch(error){ window.zoemecNotify?.(error?.message || 'No se pudo generar el PDF.', 'error'); return; }
    finally{ setExportBusy(false); }
    if(isFree) markApuUsed();
  };
  const exportExcel=async()=>{
    // Mismo candado que exportPDF de arriba, mismo tratamiento (ver
    // comentario ahi): el boton ya queda deshabilitado antes del clic
    // (exportBlocked, ProfessionalApuEditor.jsx) cuando este guard bloquearia
    // -- esto queda como respaldo si igual se dispara onExcel por otra via.
    if(isFree && userUsage.apusCreated>=1){ window.zoemecNotify?.('La exportación ilimitada requiere plan activo.', 'error'); return; }
    if(!confirmSingleExportIfAmbiguous()) return;
    setExportBusy(true);
    try{ await exportAPUExcelV2(professionalApu); }
    catch(error){ window.zoemecNotify?.(error?.message || 'No se pudo generar el Excel.', 'error'); return; }
    finally{ setExportBusy(false); }
    if(isFree) markApuUsed();
  };
  const findV2Prices=async(current)=>{
    const resources=['materials','labor','equipment'].flatMap(kind=>(current[kind]||[]).map((row,index)=>({kind,index,row})));
    const found=await Promise.all(resources.map(async({kind,index,row})=>{
      try{const res=await fetch('/api/market-price',{method:'POST',headers:await authHeaders(),body:JSON.stringify({description:row.descripcion,unit:row.unidad,kind})});const data=await readJsonSafe(res);const q=data?.quote;if(!res.ok||!(Number(q?.price)>0))return null;const currentPrice=Number(row.precioUnitario??row.salarioBase??row.tarifa??0);return {kind,index,resource:row.descripcion,current:currentPrice,priceRecord:makePriceRecord({description:row.descripcion,price:q.price,unit:row.unidad,originalUnit:q.originalUnit||row.unidad,currency:q.currency||current.moneda||'MXN',supplier:q.supplier||null,sourceName:q.source||null,sourceUrl:q.url||null,sourceType:'ESTIMATED',priceDate:q.date||null,consultedAt:new Date().toISOString(),confidence:q.confidence||0,verified:false})};}catch{return null;}
    }));return found.filter(Boolean);
  };

  const hasApuContent = (professionalApu.materials?.length||0) + (professionalApu.labor?.length||0) > 0;
  const apuStepIndex = aiBusy ? 1 : showExecutive ? 3 : hasApuContent ? 2 : concept.trim() ? 1 : 0;

  return <section className="apu-workspace"><PageHead kicker={tr('modules.apu.kicker')} title={tr('modules.apu.title')} desc={tr('modules.apu.desc')} />
    <ApuStepper stepIndex={apuStepIndex}/>
    <div className="apu-project-status">
      {activeProject
        ? <span className="apu-project-pill"><Icon name="proyectos" size={13}/> {activeProject.name}</span>
        : <span className="apu-project-pill muted">{tr('apu.noProjectPill')} · <a onClick={onNeedProject}>{tr('apu.noProjectLink')}</a></span>}
    </div>
    {isFree && <div className="trial-banner"><b>{tr('apu.trialBannerLabel')}</b> {tr('apu.trialBannerText',{n:Math.max(0,1-(userUsage.apusCreated||0))})}</div>}
    {resumableJob && (() => { const s = summarizeJob(resumableJob); return <div className="trial-banner resume-banner">
      <div><b>{tr('apu.resumeBannerLabel')}</b> "{resumableJob.fileName || tr('apu.resumeCatalogFallback')}" — {tr('apu.resumeBannerCounts',{done:s.done,total:s.total,terminado:s.terminado,revision:s.requiere_revision,error:s.error,pendiente:s.pendiente})}</div>
      <div className="resume-banner-actions">
        <button type="button" onClick={resumeActiveJob} disabled={batchBusy}>{tr('apu.resume')}</button>
        <button type="button" className="soft" onClick={discardResumableJob} disabled={batchBusy}>{tr('apu.discard')}</button>
      </div>
    </div>; })()}
    {/* H. Generacion: inicio natural del flujo, siempre visible arriba */}
    <div className="panel ai-panel" ref={conceptCardRef}>
      <div className="ai-panel-head"><HardHat size={36}/><div><b>{tr('apu.panelTitle')}</b><small className="muted">{tr('apu.panelDesc')}</small></div></div>
      <textarea ref={conceptTextareaRef} className="ai-concept" value={concept} onChange={e=>setConcept(e.target.value)} placeholder={tr('apu.conceptPlaceholder')}/>
      <div className="ai-unit-qty-row">
        <label>{tr('apu.unitLabel')}<input value={aiUnit} onChange={e=>setAiUnit(e.target.value)} placeholder={tr('apu.unitPlaceholder')}/></label>
        <label>{tr('apu.qtyLabel')}<input type="number" min="0" step="any" value={aiQty} onChange={e=>setAiQty(e.target.value)} placeholder={tr('apu.qtyPlaceholder')}/></label>
        <small className="muted">{tr('apu.unitQtyHint')}</small>
      </div>
      <div className="ai-panel-primary-action">
        <button className="ai-btn" onClick={generateAI} disabled={aiBusy} aria-busy={aiBusy}><Icon name="apu" size={17}/> {aiBusy?tr('apu.generatingAI'):tr('apu.generateAIBtn')}</button>
      </div>
      <div className="ai-panel-foot">
        <label className="up-btn ghost-up">{tr('apu.importPriceCatalog')}<input ref={priceCatalogInputRef} type="file" accept=".xlsx,.csv" hidden onChange={e=>importExcel(e.target.files[0])}/></label>
        <label className="up-btn ghost-up">{tr('apu.generateFromExcel')}<input ref={fullExcelInputRef} type="file" accept=".xlsx,.csv" hidden onChange={e=>importFullExcel(e.target.files[0])}/></label>
        <label className="up-btn ghost-up">{tr('apu.uploadConceptCatalog')}<input ref={conceptCatalogInputRef} type="file" accept=".xlsx,.csv" hidden onChange={e=>importConceptCatalog(e.target.files[0])}/></label>
        {catalog.length>0 && <span className="cat-badge"><Icon name="presupuestos" size={14}/> {tr('apu.catalogBadge',{count:catalog.length})}</span>}
        <button className="soft" type="button" onClick={resetAPUForm}>{tr('apu.createManualClear')}</button>
        <button className="soft danger" type="button" onClick={clearWorkspace} title={tr('apu.clearWorkspaceTitle')}>{tr('apu.clearWorkspace')}</button>
        {activeProjectId && <button className="danger-solid" type="button" onClick={emptyActiveProject} title={tr('apu.emptyProjectTitle')}>{tr('apu.emptyProject')}</button>}
      </div>
      <button type="button" className="link-inline" onClick={generate}>{tr('apu.preferMatrixLink')}</button>
      {aiBusy && <>
        {/* Nota real (no decorativa): aiStatus refleja el paso real que esta
            ejecutando generateAI() en este momento (analizando, buscando
            precios, calculando rendimientos...), nunca un porcentaje
            inventado. Se muestra en .ai-note-busy (patron ya usado para el
            loader de Google Drive) porque esa clase trae su propio fondo
            claro y por lo tanto es visible sin depender del contraste de
            .ai-panel. */}
        <div className="ai-note-busy"><span className="asst-dots"><i/><i/><i/></span><b>{resolveBusyLabel(aiStatus)}</b></div>
        <AIProgress active={aiBusy}/>
      </>}
      {aiStatus && !aiBusy && <div className="ai-note"><b>{aiStatus}</b></div>}
      {excelInfo && <div className="excel-preview">
        <div><small>{tr('apu.excelFile')}</small><b>{excelInfo.fileName}</b></div>
        <div><small>{tr('apu.excelConcept')}</small><b>{excelInfo.concept}</b></div>
        <div><small>{tr('apu.excelUnitQty')}</small><b>{excelInfo.unit} - {num(excelInfo.qty)}</b></div>
        <div><small>{tr('apu.excelPU')}</small><b>{excelInfo.referencePU ? money(excelInfo.referencePU) : tr('apu.notDetected')}</b></div>
      </div>}
      <div className="ai-note">{tr('apu.aiFooterNote')}</div>
      {conceptBatch?.concepts?.length>0 && !batchResult && <div className="batch-review">
        <div className="batch-review-head">
          <b>{tr('apu.batchHeadLabel',{total:conceptBatch.concepts.length,unique:batchGroups.size,dupSuffix:batchDuplicateRows>0?tr('apu.batchDupSuffix',{count:batchDuplicateRows}):''})}</b>
          <p className="muted">{tr('apu.batchHeadDesc')}</p>
        </div>
        <div className="batch-review-toolbar">
          <input className="batch-search" value={batchSearch} onChange={e=>setBatchSearch(e.target.value)} placeholder={tr('apu.batchSearchPlaceholder')}/>
          <button type="button" className="soft" onClick={selectAllBatchRows}>{tr('apu.selectAll')}</button>
          <button type="button" className="soft" onClick={selectUniqueBatchRows}>{tr('apu.selectUnique')}</button>
          <button type="button" className="soft" onClick={selectNoBatchRows}>{tr('apu.selectNone')}</button>
          <span className="batch-count">{tr('apu.selectedCount',{selected:batchSelection?.size||0,total:conceptBatch.concepts.length})}</span>
        </div>
        <div className="batch-review-table">
          <table className="data-table">
            <thead><tr><th></th><th>{tr('apu.colKey')}</th><th>{tr('apu.colConcept')}</th><th>{tr('apu.colUnit')}</th><th>{tr('apu.colQty')}</th><th>{tr('apu.colRefPu')}</th></tr></thead>
            <tbody>{batchFilteredRows.map(({item,index})=>{
              const group = batchGroups.get(duplicateGroupKey(item)) || [];
              const isDuplicate = group.length>1;
              const isFirstOfGroup = group[0]===index;
              return <tr key={index} className={isDuplicate && !isFirstOfGroup ? 'batch-row-duplicate' : ''}>
                <td><input type="checkbox" checked={batchSelection?.has(index)||false} onChange={()=>toggleBatchRow(index)}/></td>
                <td>{item.code || `CON-${index+1}`}</td>
                <td>{item.concept}{isDuplicate && <span className="dup-badge">{isFirstOfGroup?tr('apu.matches',{count:group.length}):tr('apu.duplicate')}</span>}</td>
                <td>{item.unit||'—'}</td>
                <td>{num(item.qty||1)}</td>
                <td>{item.referencePU?money(item.referencePU):'—'}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <div className="batch-review-actions">
          <button onClick={generateSelectedBatch} disabled={batchBusy || !batchSelection?.size}>{batchBusy?tr('apu.generatingBatch'):tr('apu.generateBatchBtn',{count:batchSelection?.size||0})}</button>
          {batchBusy && activeJob && <button type="button" className="soft danger" onClick={cancelActiveJob}>{tr('apu.cancelBatch')}</button>}
        </div>
        {activeJob && <div className="batch-progress">
          {(() => { const s = summarizeJob(activeJob); return <>
            <b>{tr('apu.progressLabel',{done:s.done,total:s.total})}</b>
            <span>{tr('apu.progressDetail',{terminado:s.terminado,revision:s.requiere_revision,error:s.error,enProceso:s.enProceso?` · ${s.enProceso} procesando`:'',cancelado:s.cancelado?` · ${s.cancelado} cancelados`:''})}</span>
          </>; })()}
        </div>}
      </div>}
      {batchResult && <div className="batch-result">
        <b>{batchResult.cancelled ? tr('apu.batchCancelled') : tr('apu.batchGenerated')}</b>
        <div className="batch-result-grid">
          <span>{tr('apu.resultConcepts')} <b>{batchResult.conceptsTotal}</b></span>
          <span>{tr('apu.resultSelected')} <b>{batchResult.selected}</b></span>
          <span>{tr('apu.resultGenerated')} <b>{batchResult.generated}</b></span>
          <span>{tr('apu.resultReview')} <b>{batchResult.review}</b></span>
          <span>{tr('apu.resultErrors')} <b>{batchResult.errors}</b></span>
          <span>{tr('apu.resultSubtotal')} <b>{money(batchResult.budget.items.reduce((s,it)=>s+Number(it.qty)*Number(it.pu),0))}</b></span>
          <span>{tr('apu.resultTotalIva')} <b>{money(batchResult.budget.total)}</b></span>
        </div>
        {batchResult.excludedConcepts?.length>0 && <div className="batch-review-head" style={{borderColor:'#B54A62'}}>
          <b>{tr('apu.excludedHead',{count:batchResult.excludedConcepts.length})}</b>
          <ul>{batchResult.excludedConcepts.map((c,i)=><li key={i}>{c}</li>)}</ul>
          <p className="muted">{tr('apu.excludedHint')}</p>
        </div>}
        <div className="batch-result-actions">
          {batchResult.errors>0 && <button className="soft danger" onClick={retryFailedInActiveJob} disabled={batchBusy}>{batchBusy?tr('apu.retrying'):tr('apu.retryFailed',{count:batchResult.errors})}</button>}
          {/* Entregable profesional (RESUMEN + CONTROL_REVISION + 1 hoja APU
              completa por concepto -- exportConceptBatch -> exportAPUExcelV2,
              sin tocar): boton principal, primero y sin la clase "soft" que
              lo hacia ver secundario frente al presupuesto de 1 sola hoja. */}
          {conceptBatch?.concepts?.length>0 && <button onClick={exportConceptBatch} disabled={batchBusy} title={tr('apu.downloadProfessionalExcelTitle')}>{batchBusy?tr('apu.generatingSheets'):tr('apu.downloadProfessionalExcel')}</button>}
          {conceptBatch?.concepts?.length>0 && <button onClick={exportConceptBatchPDF} disabled={batchBusy} title={tr('apu.pdfPerConceptTitle')}>{tr('apu.pdfPerConcept')}</button>}
          {conceptBatch?.concepts?.length>0 && <button onClick={exportConceptBatchPdfMaster} disabled={batchBusy} title={tr('apu.downloadMasterPdfTitle')}>{tr('apu.downloadMasterPdf')}</button>}
          {/* Cotizacion rapida de 1 hoja (Concepto/Unidad/Cantidad/P.U./Importe):
              opcion secundaria, nunca el entregable principal de ZOEMEC. */}
          <button className="soft" onClick={()=>exportBudgetExcel(batchResult.budget.items, batchResult.budget.total/(1+batchResult.budget.ivaRate/100), batchResult.budget.total-batchResult.budget.total/(1+batchResult.budget.ivaRate/100), batchResult.budget.ivaRate)}>{tr('apu.excelSummary')}</button>
          <button className="soft" onClick={()=>exportBudgetPDF(batchResult.budget.items, batchResult.budget.total/(1+batchResult.budget.ivaRate/100), batchResult.budget.total-batchResult.budget.total/(1+batchResult.budget.ivaRate/100), company, batchResult.budget.ivaRate)}>{tr('apu.pdfSummary')}</button>
          <button className="soft" onClick={resetAPUForm}>{tr('apu.close')}</button>
        </div>
      </div>}
    </div>

    <RevisionBandeja apus={apus} user={user} onUpdateApu={saved => { if(!requireProject()) return; setApus([saved, ...apus.filter(x => x.id !== saved.id)]); if(saved.id===professionalApu.id) setApuV2(saved); }} />

    {hasApuContent && <>
      {/* A. Encabezado ejecutivo */}
      <ApuExecHeader apu={professionalApu} apuLegacy={apu}/>
      {/* B. Resultado economico: PU protagonista + desglose */}
      <ExecutiveSummaryCards apu={professionalApu} globalConfidence={globalConfidence}/>
      <div className="apu-breakdown-detail">
        <Cost label="Indirectos" v={professionalApu.calculated.indirect}/>
        <Cost label="Financiamiento" v={professionalApu.calculated.finance}/>
        <Cost label="Utilidad" v={professionalApu.calculated.utility}/>
        <Cost label="Cargos adicionales" v={professionalApu.calculated.cargos}/>
      </div>
      {/* C. Recursos */}
      <ResourceCards apu={professionalApu}/>
      {showExecutive
        ? <div className="panel exec-detail">
          <div className="exec-confidence">
            <b>{tr('apu.confidenceLabel',{label:formatGlobalConfidence(globalConfidence).fullLabel})}</b>
            <small>{(() => {
              const rows = ['materials','labor','equipment'].flatMap(k => professionalApu[k] || []);
              const needsReview = rows.filter(r => !r.fuente?.proveedor || r.fuente?.estado === 'ESTIMADO_IA' || r.fuente?.estado === 'REQUIERE_VALIDACION').length;
              return rows.length === 0 ? tr('apu.noResourcesEval') : needsReview > 0 ? tr('apu.reviewNeeded',{needsReview,total:rows.length}) : tr('apu.allSourced');
            })()}</small>
          </div>
          <div className="exec-validation">
            <b>{tr('apu.technicalValidation')}</b>
            <span>{professionalApu.warnings.length === 0 ? tr('apu.noObservations') : tr('apu.verificationsNeeded',{count:professionalApu.warnings.length})}</span>
            {professionalApu.warnings.length > 0 && <ul>{professionalApu.warnings.slice(0,6).map((w,i) => <li key={i}>{w.message}</li>)}</ul>}
          </div>
          <div className="exec-explain">
            <b>{tr('apu.howBuilt')}</b>
            <ul className="exec-checklist">
              <li>{doneIcon(Boolean(professionalApu.concept))} {tr('apu.stepScope')}</li>
              <li>{doneIcon((professionalApu.labor||[]).length > 0)} {tr('apu.stepLabor',{count:(professionalApu.labor||[]).length})}</li>
              <li>{doneIcon((professionalApu.materials||[]).length > 0)} {tr('apu.stepMaterials',{count:(professionalApu.materials||[]).length})}</li>
              <li>{doneIcon((professionalApu.equipment||[]).length > 0 || (professionalApu.herramientaMenor?.detalle||[]).length > 0 || Number(professionalApu.herramientaMenor?.porcentaje) > 0)} {tr('apu.stepTools')}</li>
              <li>{doneIcon((professionalApu.labor||[]).some(r => Number(r.rendimiento) > 0))} {tr('apu.stepYield')}</li>
              <li>{doneIcon((professionalApu.seguridad||[]).length > 0)} {tr('apu.stepSafety')}</li>
              <li>{doneIcon((professionalApu.procedimientoConstructivo||[]).length > 0)} {tr('apu.stepProcedure')}</li>
              <li>{doneIcon(Boolean(professionalApu.criterioMedicion?.unidadMedicion))} {tr('apu.stepMeasurement')}</li>
              <li>{doneIcon(true)} {tr('apu.stepEngine')}</li>
            </ul>
            {(professionalApu.supuestos||[]).length > 0 && <><b>{tr('apu.assumptionsUsed')}</b><ul>{professionalApu.supuestos.map((s,i) => <li key={i}>{s.texto || s}</li>)}</ul></>}
          </div>
          <button type="button" className="link-inline" onClick={()=>setShowExecutive(false)}>{tr('apu.hideDetail')}</button>
        </div>
        : <button type="button" className="link-inline exec-detail-toggle" onClick={()=>setShowExecutive(true)}>{tr('apu.showDetail')}</button>}
    </>}

    <ProfessionalApuEditor apu={professionalApu} onChange={setApuV2} user={user} onSave={saved=>{
      if(!requireProject()) return;
      // FIX Fase 9 (hallazgo F-006b, P1): "Guardar version" del editor
      // moderno nunca llamaba requireApuAccess()/markApuUsed() -- el camino
      // real de persistencia desde Fase 7 no tenia NINGUN candado de plan
      // Gratis. Solo se cuenta contra el limite al CREAR un APU nuevo
      // (id que todavia no existe en la lista) -- volver a guardar una
      // version de un APU ya propio nunca deberia costar otro "APU gratis".
      const isNew = !apus.some(x=>x.id===saved.id);
      if(isNew && !requireApuAccess()) return;
      setApus([saved,...apus.filter(x=>x.id!==saved.id)]);
      if(isNew) markApuUsed();
    }} onFindPrices={findV2Prices} onExcel={exportExcel} onPdf={exportPDF} exportBlocked={isFree && userUsage.apusCreated>=1} exportBlockedReason={tr('apu.exportBlockedReason')}/>
    <div className="apu-grid legacy-editor-compat">
      <div className="panel">
        <label>{tr('apu.conceptLabel')}</label>
        <textarea value={concept} onChange={e=>setConcept(e.target.value)} />
        <div className="inline-tools">
          <label className="up-btn ghost-up">{tr('apu.uploadFullExcel')}<input ref={mainExcelInputRef} type="file" accept=".xlsx,.csv" hidden onChange={e=>importFullExcel(e.target.files[0])}/></label>
          <button className="soft" onClick={generate}>{tr('apu.updateDevelopment')}</button>
          <button className="soft" onClick={generateAI} disabled={aiBusy}>{aiBusy?tr('apu.generatingShort'):tr('apu.aiReal')}</button><button className="soft" type="button" onClick={resetAPUForm}>{tr('apu.clear')}</button>
          {apu.referencePU>0 && <span className="cat-badge">{tr('apu.excelPuBadge',{value:money(apu.referencePU)})}</span>}
          {conceptBatch?.concepts?.length>0 && <button className="soft" onClick={exportConceptBatch} disabled={batchBusy} title={tr('apu.downloadProfessionalExcelTitle')}>{batchBusy?tr('apu.generatingSheets'):tr('apu.downloadProfessionalExcel')}</button>}
          {conceptBatch?.concepts?.length>0 && <button className="soft" onClick={exportConceptBatchPDF} disabled={batchBusy} title={tr('apu.pdfPerConceptTitle')}>{tr('apu.pdfPerConcept')}</button>}
          {conceptBatch?.concepts?.length>0 && <button className="soft" onClick={exportConceptBatchPdfMaster} disabled={batchBusy} title={tr('apu.downloadMasterPdfTitle')}>{tr('apu.downloadMasterPdf')}</button>}
        </div>
        <div className="apu-detect">
          <div><small>{tr('apu.familyDetected')}</small><b>{apu.family || tr('apu.familyGeneric')}</b></div>
          <div><small>{tr('apu.aiConfidence')}</small><b>{formatGlobalConfidence(globalConfidence).scoreLabel}</b></div>
          <div><small>{tr('apu.satKeySuggested')}</small><b>{apu.sat || '72100000'}</b></div>
          <div><small>{tr('apu.origin')}</small><b>{apu.templateFallback ? tr('apu.originTemplate') : apu.aiGenerated ? tr('apu.originAI') : tr('apu.originBase')}</b></div>
        </div>
        {apu.templateFallback && <div className="fallback-banner"><b>{tr('apu.fallbackBannerLabel')}</b> {tr('apu.fallbackBannerText')}</div>}
        {apu.aiNotes?.length>0 && <div className="ai-decisions">{apu.aiNotes.map((n,i)=><span key={i}>{n}</span>)}</div>}
        <div className="form-row"><input value={apu.clave} onChange={e=>setApu({...apu,clave:e.target.value})} placeholder={tr('apu.clavePlaceholder')}/><input value={apu.unit} onChange={e=>setApu({...apu,unit:e.target.value})} placeholder={tr('apu.unitPlaceholderShort')}/></div>

        <h2>{tr('apu.materialsTitle')} <small className="hint">{tr('apu.materialsHint')}</small></h2>
        <MatrixTable kind="materials" rows={apu.materials} updateRow={updateRow} removeRow={removeRow} onMarketPrice={marketPrice} priceBusy={priceBusy}/>
        <button className="soft" onClick={()=>addRow('materials')}>{tr('apu.addMaterial')}</button>

        <h2>{tr('apu.laborTitle')} <small className="hint">{tr('apu.laborHint')}</small></h2>
        <MatrixTable kind="labor" rows={apu.labor} updateRow={updateRow} removeRow={removeRow} onMarketPrice={marketPrice} priceBusy={priceBusy}/>
        <button className="soft" onClick={()=>addRow('labor')}>{tr('apu.addLabor')}</button>

        <h2>{tr('apu.equipmentTitle')} <small className="hint">{tr('apu.equipmentHint')}</small></h2>
        <MatrixTable kind="equipment" rows={apu.equipment} updateRow={updateRow} removeRow={removeRow} onMarketPrice={marketPrice} priceBusy={priceBusy}/>
        <button className="soft" onClick={()=>addRow('equipment')}>{tr('apu.addEquipment')}</button>

        <h2>{tr('apu.overcostsTitle')}</h2>
        <div className="params-grid">
          <Param label={tr('apu.paramTool')} v={apu.herramienta} on={v=>setParam('herramienta',v)}/>
          <Param label={tr('apu.paramFieldIndirect')} v={apu.indCampo} on={v=>setParam('indCampo',v)}/>
          <Param label={tr('apu.paramOfficeIndirect')} v={apu.indOficina} on={v=>setParam('indOficina',v)}/>
          <Param label={tr('apu.paramFinance')} v={apu.finance} on={v=>setParam('finance',v)}/>
          <Param label={tr('apu.paramUtility')} v={apu.utility} on={v=>setParam('utility',v)}/>
          <Param label={tr('apu.paramCargos')} v={apu.cargos} on={v=>setParam('cargos',v)}/>
        </div>
      </div>

      <div className="panel sticky">
        <h2>{tr('apu.integrationTitle')}</h2>
        <Cost label={tr('apu.costMaterials')} v={totals.mat}/>
        <Cost label={tr('apu.costLabor')} v={totals.mo}/>
        <Cost label={tr('apu.costEquipment')} v={totals.equipo}/>
        <Cost label={tr('apu.costTool',{pct:num(apu.herramienta)})} v={totals.herramienta}/>
        <div className="cost subtotal"><span>{tr('apu.directCost')}</span><b>{money(totals.direct)}</b></div>
        <Cost label={tr('apu.costIndirect',{total:num(Number(apu.indCampo)+Number(apu.indOficina)),campo:num(apu.indCampo),oficina:num(apu.indOficina)})} v={totals.indirect}/>
        <Cost label={tr('apu.costFinance',{pct:num(apu.finance)})} v={totals.finance}/>
        <Cost label={tr('apu.costUtility',{pct:num(apu.utility)})} v={totals.utility}/>
        <Cost label={tr('apu.costCargos',{pct:num(apu.cargos)})} v={totals.cargos}/>
        <div className="grand"><span>{tr('apu.unitPrice')}</span><b>{money(totals.pu)}</b></div>
        <div className="cost iva-note"><span>{tr('apu.ivaNote',{pct:num(apu.iva)})}</span><b>{money(totals.iva)}</b></div>
        <Incidence t={totals}/>
        <div className="actions-col">
          <button onClick={save}>{tr('apu.btnSave')}</button>
          <button onClick={addBudget}>{tr('apu.btnAddBudget')}</button>
          <button onClick={exportPDF} disabled={exportBusy || batchBusy}>{exportBusy ? tr('apu.generatingPdf') : tr('apu.downloadPdfFormatted')}</button>
          <button onClick={exportExcel} disabled={exportBusy || batchBusy}>{exportBusy ? tr('apu.generatingExcel') : tr('apu.downloadExcel')}</button>
        </div>
      </div>
    </div>

    {(rawApus||[]).some(a=>a.projectLinkRequired) && <div className="panel" style={{marginTop:16}}>
      <h2>{tr('apu.unlinkedTitle')} <small className="hint">({(rawApus||[]).filter(a=>a.projectLinkRequired).length})</small></h2>
      <div className="saved-grid">{(rawApus||[]).filter(a=>a.projectLinkRequired).map(a=>{
        let selectedProjectId='';
        return <div className="saved-card" key={a.id}>
          <div className="sc-concept">{a.concept||a.clave||a.id}</div>
          <div className="sc-actions">
            <select onChange={e=>{selectedProjectId=e.target.value;}} defaultValue="">
              <option value="" disabled>{tr('apu.chooseProject')}</option>
              {(projects||[]).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button onClick={async ()=>{ if(selectedProjectId) await linkApuToProject(a.id,selectedProjectId); }}>{tr('apu.link')}</button>
          </div>
        </div>;
      })}</div>
    </div>}

    {apus.length>0 && <div className="panel" style={{marginTop:16}}>
      <h2>{tr('apu.savedTitle')} <small className="hint">({apus.length})</small></h2>
      <div className="saved-grid">{apus.map(a=>{const pu=a.calculated?.pu ?? calcAPU(a).pu;return <div className="saved-card" key={a.id}>
        <div className="sc-clave">{a.clave} - {a.unit} - {a.date}</div>
        <div className="sc-concept">{a.concept}</div>
        <div className="sc-pu">{money(pu)} <small>/ {a.unit}</small></div>
        <div className="sc-actions"><button onClick={()=>{
          if(a.schemaVersion===2){
            const shim={...legacyShimFromV2(a,a.concept,a.sourceFile||'Guardado'),id:a.id,aiGenerated:Boolean(a.aiGenerated),templateFallback:Boolean(a.templateFallback),family:a.family||'APU generado con IA'};
            skipMigrateIdRef.current=shim.id;
            setApu(shim);
            setApuV2({...a,id:shim.id});
          } else {
            setApu(a);
          }
          // "Abrir" SI es otra identidad real -- adopta el id verdadero del
          // guardado (ver stableApuId).
          setStableApuId(a.id);
          setShowExecutive(false);
        }}>{tr('apu.open')}</button><button className="del" onClick={()=>setApus(apus.filter(x=>x.id!==a.id))}>{tr('apu.delete')}</button></div>
      </div>;})}</div>
    </div>}
  </section>
}

function Incidence({t}){
  const { t: tr } = useI18n();
  const d = t.direct || 1;
  const segs = [['m',tr('matrixTable.segMaterials'),t.mat,'#9D6FD0'],['o',tr('matrixTable.segLabor'),t.mo,'#2A1740'],['e',tr('matrixTable.segEquipment'),t.equipo,'#B8A4CC'],['h',tr('matrixTable.segTools'),t.herramienta,'#C7A35C']];
  const pct = v => Math.max(0, v/d*100);
  return <div className="incid">
    <small className="hint">{tr('matrixTable.incidenceHint')}</small>
    <div className="incid-bar">{segs.map(s=><i key={s[0]} className={s[0]} style={{width:pct(s[2])+'%'}}/>)}</div>
    <div className="incid-legend">{segs.map(s=><span key={s[0]}><i style={{background:s[3]}}/>{s[1]} <b className="incid-num">{num(pct(s[2]))}%</b></span>)}</div>
  </div>;
}

function MatrixTable({kind,rows,updateRow,removeRow,onMarketPrice,priceBusy}){
  const { t: tr } = useI18n();
  const headers = kind==='materials'
    ? [tr('matrixTable.colDesc'),tr('matrixTable.colQty'),tr('matrixTable.colUnit'),tr('matrixTable.colBasePrice'),tr('matrixTable.colWaste'),tr('matrixTable.colAmount'),'$','']
    : kind==='labor'
    ? [tr('matrixTable.colDesc'),tr('matrixTable.colDays'),tr('matrixTable.colUnit'),tr('matrixTable.colBaseSalary'),tr('matrixTable.colFsr'),tr('matrixTable.colAmount'),'$','']
    : [tr('matrixTable.colDesc'),tr('matrixTable.colQty'),tr('matrixTable.colUnit'),tr('matrixTable.colHourlyCost'),tr('matrixTable.colAmount'),'$',''];
  const editIdx = kind==='equipment' ? [0,1,2,3] : [0,1,2,3,4];
  return <div className="apu-table-scroll"><table className="data-table apu-table">
    <thead><tr>{headers.map((h,hi)=><th key={hi}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((r,i)=><tr key={i}>
      {editIdx.map(k=><td key={k}><input value={r[k]} onChange={e=>updateRow(kind,i,k,e.target.value)} /></td>)}
      <td className="imp">{money(rowImporte(kind,r))}</td>
      <td className="del">{onMarketPrice ? <button className="row-del" title={tr('matrixTable.findMarketPrice')} aria-label={tr('matrixTable.findMarketPriceAria')} disabled={priceBusy===`${kind}-${i}`} onClick={()=>onMarketPrice(kind,i)}>{priceBusy===`${kind}-${i}` ? '…' : '$'}</button> : null}</td>
      <td className="del"><button className="row-del" title={tr('matrixTable.delete')} aria-label={tr('matrixTable.deleteRowAria')} onClick={()=>removeRow(kind,i)}>×</button></td>
    </tr>)}</tbody>
  </table></div>
}


// isExportableConceptItem / conceptNeedsReviewFlag / resolveBatchSelection:
// logica pura, movida a src/domain/apuWorkspace.js (RC6) para que sea
// testeable sin arnes de React y compartida sin duplicarse entre
// generateSelectedBatch/exportConceptBatch/exportConceptBatchPDF -- ver el
// comentario de causa raiz alli.

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
/* Libro profesional con Portada (RESUMEN) + una hoja completa por concepto,
   nunca solo el presupuesto: preparedAPUs ya viene v2 (buildBatchAPUs usa
   generateAPUv2 + Motor APU v2), asi que solo hace falta re-aplicar la
   metadata del renglon (por si el orden no coincide 1:1) sin volver a pasar
   por migrateLegacyApuToV2 -- eso destruiria los renglones-objeto v2. Si
   preparedAPUs[idx] no existe (llamado sin generar antes) se arma desde el
   catalogo base ZOEMEC como respaldo, tambien en v2. */
async function exportConceptsAPUWorkbook(concepts, catalog, company, preparedAPUs=[]){
  const limited = concepts.filter(isExportableConceptItem);
  const professional = limited.map((item, idx) => {
    const base = preparedAPUs[idx] || makeAPUFromConcept(item.concept, catalog);
    const v2Base = base?.schemaVersion === 2 ? base : migrateLegacyApuToV2(base);
    const sourceFile = base?.sourceFile || 'Catalogo de conceptos';
    const withMeta = applyConceptMetadataV2(v2Base, item, idx, sourceFile);
    return finalizeProfessionalAPU({...withMeta, proyecto:company?.name||withMeta.proyecto||'', cliente:company?.client||withMeta.cliente||''});
  });
  if(!professional.length){
    alert('No hay conceptos para exportar.');
    return;
  }
  return await exportAPUExcelV2(professional,{fileName:'APU-POR-CONCEPTO-ZOEMEC.xlsx',company});
}

/* PDF por concepto: un PDF individual completo (misma plantilla que "Descargar
   PDF" de un APU suelto) por cada concepto del lote -- no el resumen v1
   antiguo de exportConceptsAPUPDF, que no entiende renglones-objeto v2. */
async function exportConceptsAPUPdfIndividual(concepts, catalog, preparedAPUs=[]){
  const limited = concepts.filter(isExportableConceptItem);
  if(!limited.length){ alert('No hay conceptos para exportar.'); return; }
  limited.forEach((item, idx) => {
    const base = preparedAPUs[idx] || makeAPUFromConcept(item.concept, catalog);
    const v2Base = base?.schemaVersion === 2 ? base : migrateLegacyApuToV2(base);
    const sourceFile = base?.sourceFile || 'Catalogo de conceptos';
    const withMeta = applyConceptMetadataV2(v2Base, item, idx, sourceFile);
    const professional = finalizeProfessionalAPU(withMeta);
    exportAPUPdfV2(professional, {fileName:`${professional.clave || 'APU-'+(idx+1)}-APU-PROFESIONAL-ZOEMEC.pdf`});
  });
}

/* PDF MAESTRO por catalogo completo (spec 19-26): UN SOLO PDF con portada +
   resumen general + control de revision + los N APUs completos -- ver
   exportAPUPdfMaster en src/lib/apuExportV2.js. Misma preparacion de datos
   que exportConceptsAPUWorkbook (XLSX) y exportConceptsAPUPdfIndividual
   (PDF individual): una sola fuente de verdad, tres renderizadores. */
async function exportConceptsAPUPdfMasterFile(concepts, catalog, company, preparedAPUs=[]){
  const limited = concepts.filter(isExportableConceptItem);
  const professional = limited.map((item, idx) => {
    const base = preparedAPUs[idx] || makeAPUFromConcept(item.concept, catalog);
    const v2Base = base?.schemaVersion === 2 ? base : migrateLegacyApuToV2(base);
    const sourceFile = base?.sourceFile || 'Catalogo de conceptos';
    const withMeta = applyConceptMetadataV2(v2Base, item, idx, sourceFile);
    return finalizeProfessionalAPU({...withMeta, proyecto:company?.name||withMeta.proyecto||'', cliente:company?.client||withMeta.cliente||''});
  });
  if(!professional.length){
    alert('No hay conceptos para exportar.');
    return;
  }
  return exportAPUPdfMaster(professional,{fileName:'APU-MAESTRO-ZOEMEC.pdf',company});
}

function Budgets({company,budgets,setBudgets,items,setItems,activeProjectId,onNeedProject}){
  const { t: tr } = useI18n();
  // Antes el 16% estaba repetido como literal en 3 lugares (calculo, export
  // Excel, export PDF) y no leia el campo "iva" de ningun APU. Ahora hay una
  // sola tasa configurable por presupuesto (arranca en DEFAULT_IVA_RATE, la
  // misma fuente unica que usa el motor APU) y se guarda con el presupuesto
  // para que quede fija en su historial aunque el default cambie despues.
  const [ivaRate,setIvaRate]=useState(DEFAULT_IVA_RATE);
  const total=items.reduce((a,i)=>a+Number(i.qty)*Number(i.pu),0);
  const safeIvaRate=toSafeNonNegativeNumber(ivaRate);
  const iva=total*safeIvaRate/100;
  const update=(i,k,v)=>setItems(items.map((r,idx)=>idx===i?{...r,[k]:v}:r));
  const removeRow=(i)=>setItems(items.filter((_,idx)=>idx!==i));
  const save=()=>{ if(!activeProjectId){ if(confirm(tr('budget.confirmNeedProject'))) onNeedProject?.(); return; } setBudgets([{id:'PRE-'+uid(),name:'Presupuesto ejecutivo',client:'Cliente por definir',items,ivaRate:safeIvaRate,total:total+iva,date:new Date().toLocaleDateString('es-MX')},...budgets]); alert(tr('budget.savedAlert'));};
  const openSaved=(b)=>{ setItems(b.items||[]); setIvaRate(Number(b.ivaRate ?? DEFAULT_IVA_RATE)); window.scrollTo({top:0,behavior:'smooth'}); };
  const removeSaved=(id)=>{ if(!confirm(tr('budget.confirmDelete'))) return; setBudgets(budgets.filter(b=>b.id!==id)); };
  const downloadSaved=(b,kind)=>{
    const bItems=b.items||[];
    const bTotal=bItems.reduce((a,i)=>a+Number(i.qty)*Number(i.pu),0);
    const bIvaRate=toSafeNonNegativeNumber(b.ivaRate ?? DEFAULT_IVA_RATE);
    const bIva=bTotal*bIvaRate/100;
    kind==='pdf' ? exportBudgetPDF(bItems,bTotal,bIva,company,bIvaRate) : exportBudgetExcel(bItems,bTotal,bIva,bIvaRate);
  };
  return <section><PageHead kicker={tr('modules.presupuestos.kicker')} title={tr('modules.presupuestos.title')} desc={tr('modules.presupuestos.desc')} action={<button onClick={save}>{tr('budget.save')}</button>} />
    {!activeProjectId && <div className="panel" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap',padding:'14px 18px'}}>
      <p className="muted" style={{margin:0}}>{tr('budget.needProjectBanner')}</p>
      <button onClick={onNeedProject}>{tr('budget.createProject')}</button>
    </div>}
    <div className="panel"><div className="apu-table-scroll"><table className="budget-table"><thead><tr><th>{tr('budget.colConcept')}</th><th>{tr('budget.colUnit')}</th><th>{tr('budget.colQty')}</th><th>{tr('budget.colPu')}</th><th>{tr('budget.colAmount')}</th><th></th></tr></thead><tbody>{items.map((it,i)=><tr key={i}><td><input value={it.concept} onChange={e=>update(i,'concept',e.target.value)}/></td><td><input value={it.unit} onChange={e=>update(i,'unit',e.target.value)}/></td><td><input type="number" value={it.qty} onChange={e=>update(i,'qty',e.target.value)}/></td><td><input type="number" value={it.pu} onChange={e=>update(i,'pu',e.target.value)}/></td><td>{money(it.qty*it.pu)}</td><td><a className="row-del" title={tr('budget.deleteConceptTitle')} onClick={()=>removeRow(i)}>✕</a></td></tr>)}</tbody></table></div><button className="soft" onClick={()=>setItems([...items,{concept:'Nuevo concepto',unit:'m²',qty:1,pu:0}])}>{tr('budget.addConcept')}</button><div className="totals"><Cost label={tr('budget.subtotal')} v={total}/><div className="iva-rate-row"><label htmlFor="budget-iva-rate">{tr('budget.ivaRateLabel')}</label><input id="budget-iva-rate" type="number" min="0" step="0.5" value={ivaRate} onChange={e=>setIvaRate(e.target.value)}/></div><Cost label={tr('budget.ivaLabel',{rate:num(safeIvaRate)})} v={iva}/><div className="grand"><span>{tr('budget.total')}</span><b>{money(total+iva)}</b></div></div><div className="export-row"><button onClick={()=>exportBudgetExcel(items,total,iva,safeIvaRate)}>{tr('budget.exportExcel')}</button><button onClick={()=>exportBudgetPDF(items,total,iva,company,safeIvaRate)}>{tr('budget.exportPdf')}</button></div></div>
    {budgets.length>0 && <div className="panel" style={{marginTop:16}}>
      <h2>{tr('budget.savedTitle')} <small className="hint">({budgets.length})</small></h2>
      <div className="saved-grid">{budgets.map(b=>{
        const bItems=b.items||[];
        const bTotal=bItems.reduce((a,i)=>a+Number(i.qty)*Number(i.pu),0);
        const bIvaRate=toSafeNonNegativeNumber(b.ivaRate ?? DEFAULT_IVA_RATE);
        const bWithIva=bTotal*(1+bIvaRate/100);
        return <div className="saved-card" key={b.id}>
          <div className="sc-clave">{b.name||'Presupuesto'} · {b.date}</div>
          <div className="sc-concept">{tr('budget.conceptCount',{count:bItems.length})} · {b.client||'Cliente por definir'}</div>
          <div className="sc-pu">{money(bWithIva)} <small>{tr('budget.withIva')}</small></div>
          <div className="sc-actions">
            <button onClick={()=>openSaved(b)}>{tr('budget.open')}</button>
            <button onClick={()=>downloadSaved(b,'pdf')}>{tr('budget.pdf')}</button>
            <button onClick={()=>downloadSaved(b,'excel')}>{tr('budget.excel')}</button>
            <button className="del" onClick={()=>removeSaved(b.id)}>{tr('budget.delete')}</button>
          </div>
        </div>;
      })}</div>
    </div>}
  </section>
}

function ClientsProjects({clients,setClients,projects,setProjects,activeProjectId,setActiveProjectId,setModule,onDeleteProjectData}){
  const { t: tr } = useI18n();
  return <section><PageHead kicker={tr('projects.centerKicker')} title={tr('projects.centerTitle')} desc={tr('projects.centerDesc')} />
    <div className="combined-stack">
      <Projects projects={projects} setProjects={setProjects} activeProjectId={activeProjectId} setActiveProjectId={setActiveProjectId} setModule={setModule} onDeleteProjectData={onDeleteProjectData} embedded />
      <Clients clients={clients} setClients={setClients} embedded />
    </div>
  </section>;
}

function Projects({projects,setProjects,activeProjectId,setActiveProjectId,setModule,onDeleteProjectData,embedded=false}){
  const { t: tr } = useI18n();
  const list = projects || [];
  useEffect(()=>{
    const cleaned=list.filter(p=>!(p?.name==='Nuevo proyecto' && p?.client==='Cliente por definir' && Number(p?.budget||0)===0 && Number(p?.progress||0)===0));
    if(cleaned.length!==list.length) setProjects(cleaned);
  }, []);
  const [showForm,setShowForm]=useState(false);
  const [startPrompt,setStartPrompt]=useState(false);
  const [draft,setDraft]=useState({name:'',client:'',ubicacion:'',moneda:'MXN',budget:'',progress:0,status:'Anteproyecto'});
  // Antes, un Cliente vacio hacia que "Crear y comenzar" no hiciera nada
  // visible: el unico aviso era un alert() -- globalmente convertido en un
  // toast que se autodesaparece (ver NoticeHost) -- facil de perder. El
  // requisito de Cliente NO cambia (sigue obligatorio, igual que Nombre):
  // solo se vuelve visible con un estado de error persistente por campo,
  // borde rojo y foco automatico en el primer campo faltante.
  const [formErrors,setFormErrors]=useState({});
  const nameInputRef=useRef(null);
  const clientInputRef=useRef(null);
  const add = () => setShowForm(true);
  const clearDraft = () => { setDraft({name:'',client:'',ubicacion:'',moneda:'MXN',budget:'',progress:0,status:'Anteproyecto'}); setFormErrors({}); };
  const save = (e) => {
    e?.preventDefault?.();
    const errors=validateProjectDraft(draft);
    if(Object.keys(errors).length){
      setFormErrors(errors);
      (errors.name ? nameInputRef : clientInputRef).current?.focus();
      return;
    }
    setFormErrors({});
    const next={id:'PRO-'+uid(),name:draft.name.trim(),client:draft.client.trim(),ubicacion:draft.ubicacion.trim(),moneda:draft.moneda||'MXN',progress:Number(draft.progress)||0,budget:Number(draft.budget)||0,status:draft.status||'Anteproyecto'};
    setProjects([next, ...list]);
    // Proyecto nuevo = espacio realmente vacio y activo de inmediato (seccion 15
    // del sprint): sin esto, el usuario creaba el proyecto pero seguia viendo
    // los APUs/presupuesto del proyecto que tuviera activo antes.
    setActiveProjectId?.(next.id);
    clearDraft();
    setShowForm(false);
    setStartPrompt(true);
  };
  const update = (i,k,v) => setProjects(list.map((p,idx)=>idx===i?{...p,[k]:v}:p));
  // Dossier de Proyecto (Fase 8 Parte 2): reusa tal cual exportProjectDossierPdf/
  // exportProjectDossierExcel (apuProjectDossierPdf.js/apuProjectDossierXlsx.js),
  // que ya resuelven server-side (GET /api/apus?projectId=) los APUs reales
  // del proyecto -- este boton nunca envia un arreglo de APUs del cliente.
  const [dossierState,setDossierState]=useState(null); // {projectId, format, status:'generating'|'error', message}
  const generateProjectDossier = async (projectId, format) => {
    setDossierState({projectId, format, status:'generating'});
    try{
      const run = format==='PDF' ? exportProjectDossierPdf : exportProjectDossierExcel;
      await run({projectId});
      setDossierState(null);
    }catch(err){
      setDossierState({projectId, format, status:'error', message:err.message});
    }
  };
  const remove = (i) => {
    const removed=list[i];
    if(!confirm(tr('projects.confirmDelete',{name:removed?.name||tr('projects.defaultProjectName')}))) return;
    setProjects(list.filter((_,idx)=>idx!==i));
    if(removed?.id) onDeleteProjectData?.(removed.id);
    if(removed && removed.id===activeProjectId) setActiveProjectId?.(list.find((p,idx)=>idx!==i)?.id || null);
  };
  return <section>
    {!embedded && <PageHead kicker={tr('projects.kicker')} title={tr('projects.title')} desc={tr('projects.desc')} action={<button onClick={add}>{tr('projects.newProject')}</button>} />}
    {embedded && <div className="module-subhead"><div><small>{tr('projects.kicker')}</small><h2>{tr('projects.subheadTitle')}</h2></div><button onClick={add}>{tr('projects.newProject')}</button></div>}
    {showForm && <div className="record-modal" role="dialog" aria-modal="true">
      <div className="record-backdrop" onClick={()=>setShowForm(false)}></div>
      <div className="panel record-form project-form">
        <div className="record-form-head">
          <div><span>{tr('projects.formEyebrow')}</span><h2>{tr('projects.formTitle')}</h2></div>
          <button type="button" className="secondary" onClick={()=>setShowForm(false)}>{tr('projects.cancel')}</button>
        </div>
        <form onSubmit={save} noValidate>
          <div className="field-grid">
            <div className={`nf${formErrors.name?' has-error':''}`}>
              <label>{tr('projects.fieldName')}</label>
              <input ref={nameInputRef} value={draft.name} onChange={e=>{setDraft({...draft,name:e.target.value}); if(formErrors.name) setFormErrors({...formErrors,name:undefined});}} placeholder={tr('projects.fieldNamePlaceholder')} aria-required="true" aria-invalid={!!formErrors.name}/>
              {formErrors.name && <span className="nf-error-msg">{formErrors.name}</span>}
            </div>
            <div className={`nf${formErrors.client?' has-error':''}`}>
              <label>{tr('projects.fieldClient')}</label>
              <input ref={clientInputRef} value={draft.client} onChange={e=>{setDraft({...draft,client:e.target.value}); if(formErrors.client) setFormErrors({...formErrors,client:undefined});}} placeholder={tr('projects.fieldClientPlaceholder')} aria-required="true" aria-invalid={!!formErrors.client}/>
              {formErrors.client && <span className="nf-error-msg">{formErrors.client}</span>}
            </div>
            <div className="nf"><label>{tr('projects.fieldLocation')}</label><input value={draft.ubicacion} onChange={e=>setDraft({...draft,ubicacion:e.target.value})} placeholder={tr('projects.fieldLocationPlaceholder')}/></div>
            <div className="nf"><label>{tr('projects.fieldCurrency')}</label><select value={draft.moneda} onChange={e=>setDraft({...draft,moneda:e.target.value})}><option>MXN</option><option>USD</option></select></div>
            <div className="nf"><label>{tr('projects.fieldBudget')}</label><input type="number" value={draft.budget} onChange={e=>setDraft({...draft,budget:e.target.value})} placeholder="0.00"/></div>
            <div className="nf"><label>{tr('projects.fieldStatus')}</label><select value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value})}><option>Anteproyecto</option><option>Cotizacion</option><option>En ejecucion</option><option>Pausado</option><option>Cerrado</option></select></div>
            <div className="nf wide"><label>{tr('projects.fieldProgress',{pct:draft.progress})}</label><input type="range" min="0" max="100" value={draft.progress} onChange={e=>setDraft({...draft,progress:e.target.value})}/></div>
          </div>
          <div className="form-actions"><button type="button" className="secondary" onClick={clearDraft}>{tr('projects.clear')}</button><button type="submit">{tr('projects.createAndStart')}</button></div>
        </form>
      </div>
    </div>}
    {startPrompt && <div className="record-modal" role="dialog" aria-modal="true">
      <div className="record-backdrop" onClick={()=>setStartPrompt(false)}></div>
      <div className="panel record-form" style={{maxWidth:420,textAlign:'center'}}>
        <h2>{tr('projects.createdTitle')}</h2>
        <p className="muted">{tr('projects.createdDesc')}</p>
        <div className="form-actions" style={{justifyContent:'center'}}>
          <button onClick={()=>{setStartPrompt(false);setModule?.('apu');}}>{tr('projects.pasteConcept')}</button>
          <button className="secondary" onClick={()=>{setStartPrompt(false);setModule?.('apu');}}>{tr('projects.importExcel')}</button>
        </div>
      </div>
    </div>}
    {list.length ? <div className="cards-3">{list.map((p,i)=>
      <div className={`project-card${p.id===activeProjectId?' active':''}`} key={p.id||i}>
        {p.id===activeProjectId && <span className="project-active-badge">{tr('projects.activeBadge')}</span>}
        <span>{p.status}</span>
        <h2><input value={p.name} onChange={e=>update(i,'name',e.target.value)} /></h2>
        <p><input value={p.client} onChange={e=>update(i,'client',e.target.value)} /></p>
        <b>{money(p.budget)}</b>
        <progress value={p.progress} max="100"/>
        <small>{tr('projects.progressLabel',{pct:p.progress})} - <a onClick={()=>remove(i)} style={{color:'var(--danger)'}}>{tr('projects.delete')}</a></small>
        {p.id!==activeProjectId && <button className="soft" onClick={()=>setActiveProjectId?.(p.id)}>{tr('projects.useProject')}</button>}
        {p.id===activeProjectId && <div className="sc-actions">
          <button className="soft" disabled={dossierState?.projectId===p.id && dossierState?.status==='generating'} onClick={()=>generateProjectDossier(p.id,'PDF')}>{dossierState?.projectId===p.id && dossierState?.format==='PDF' && dossierState?.status==='generating' ? tr('projects.generatingPdf') : tr('projects.dossierPdf')}</button>
          <button className="soft" disabled={dossierState?.projectId===p.id && dossierState?.status==='generating'} onClick={()=>generateProjectDossier(p.id,'XLSX')}>{dossierState?.projectId===p.id && dossierState?.format==='XLSX' && dossierState?.status==='generating' ? tr('projects.generatingExcel') : tr('projects.dossierExcel')}</button>
          {dossierState?.projectId===p.id && dossierState?.status==='error' && <small style={{color:'var(--danger)'}}>{dossierState.message}</small>}
        </div>}
      </div>
    )}</div> : <div className="panel"><EmptyState icon="proyectos" title={tr('projects.emptyTitle')} text={tr('projects.emptyText')} actionLabel={tr('projects.newProject')} onAction={add}/></div>}
  </section>
}
function Clients({clients,setClients,embedded=false}){
  const { t: tr } = useI18n();
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
      alert(tr('clients.requiredFieldsAlert'));
      return;
    }
    const next={id:'CLI-'+uid(),name:draft.name.trim(),type:draft.type,contact:draft.contact.trim(),phone:draft.phone.trim(),email:draft.email.trim(),rfc:draft.rfc.trim().toUpperCase(),projects:0,budgets:0,amount:0,status:draft.status};
    setClients([next,...clients]);
    setDraft({name:'',type:'Empresa',contact:'',phone:'',email:'',rfc:'',status:'Prospecto'});
    setShowForm(false);
  };
  return <section>
    {!embedded && <PageHead kicker={tr('clients.kicker')} title={tr('clients.title')} desc={tr('clients.desc')} action={<button onClick={()=>setShowForm(true)}>{tr('clients.newClient')}</button>} />}
    {embedded && <div className="module-subhead"><div><small>{tr('clients.title')}</small><h2>{tr('clients.kicker')}</h2></div><button onClick={()=>setShowForm(true)}>{tr('clients.newClient')}</button></div>}
    {showForm && <div className="record-modal" role="dialog" aria-modal="true">
      <div className="record-backdrop" onClick={()=>setShowForm(false)}></div>
      <div className="panel record-form client-form">
        <div className="record-form-head">
          <div><span>{tr('clients.formEyebrow')}</span><h2>{tr('clients.formTitle')}</h2></div>
          <button className="secondary" onClick={()=>setShowForm(false)}>{tr('projects.cancel')}</button>
        </div>
        <div className="field-grid">
          <div className="nf"><label>{tr('clients.fieldName')}</label><input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} placeholder={tr('clients.fieldNamePlaceholder')}/></div>
          <div className="nf"><label>{tr('clients.fieldType')}</label><select value={draft.type} onChange={e=>setDraft({...draft,type:e.target.value})}><option>Empresa</option><option>Gobierno</option><option>Particular</option><option>Proveedor</option></select></div>
          <div className="nf"><label>{tr('clients.fieldContact')}</label><input value={draft.contact} onChange={e=>setDraft({...draft,contact:e.target.value})} placeholder={tr('clients.fieldContactPlaceholder')}/></div>
          <div className="nf"><label>{tr('clients.fieldPhone')}</label><input value={draft.phone} onChange={e=>setDraft({...draft,phone:e.target.value})} placeholder={tr('clients.fieldPhonePlaceholder')}/></div>
          <div className="nf"><label>{tr('clients.fieldEmail')}</label><input type="email" value={draft.email} onChange={e=>setDraft({...draft,email:e.target.value})} placeholder={tr('clients.fieldEmailPlaceholder')}/></div>
          <div className="nf"><label>{tr('clients.fieldRfc')}</label><input value={draft.rfc} onChange={e=>setDraft({...draft,rfc:e.target.value})} placeholder={tr('clients.fieldRfcPlaceholder')}/></div>
          <div className="nf"><label>{tr('clients.fieldStatus')}</label><select value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value})}><option>Prospecto</option><option>Activo</option><option>En seguimiento</option><option>Inactivo</option></select></div>
        </div>
        <div className="form-actions"><button className="secondary" onClick={()=>setDraft({name:'',type:'Empresa',contact:'',phone:'',email:'',rfc:'',status:'Prospecto'})}>{tr('projects.clear')}</button><button onClick={save}>{tr('clients.save')}</button></div>
      </div>
    </div>}
    <div className="panel clients-panel">
      <input className="search" placeholder={tr('clients.searchPlaceholder')} value={q} onChange={e=>setQ(e.target.value)}/>
      <div className="client-grid">{filtered.map(c=>
        <div className="client-card" key={c.id}>
          <div className="client-avatar">{(c.name||'C')[0]}</div>
          <div>
            <h2>{c.name}</h2>
            <p>{c.type} - {c.contact}</p>
            <small>{c.email || c.phone || tr('clients.noContact')}</small>
            <small>RFC: {c.rfc || tr('clients.rfcPending')}</small>
            <div className="client-stats"><span>{tr('clients.statProjects',{count:c.projects})}</span><span>{tr('clients.statBudgets',{count:c.budgets})}</span><b>{money(c.amount)}</b></div>
          </div>
          <em>{c.status}</em>
        </div>
      )}</div>
      {!filtered.length && !clients.length && <EmptyState icon="clientes" title={tr('clients.emptyTitle')} text={tr('clients.emptyText')} actionLabel={tr('clients.newClient')} onAction={()=>setShowForm(true)}/>}
      {!filtered.length && clients.length>0 && <EmptyState text={tr('clients.noSearchResults')}/>}
    </div>
  </section>
}

function GoogleDrivePanel({user, onImported}){
  const { t: tr } = useI18n();
  const [path,setPath]=useState([]); // breadcrumb: [{id,name}]
  const [items,setItems]=useState(null);
  const [loading,setLoading]=useState(false);
  const [selected,setSelected]=useState(()=>new Set());
  const [fileStatus,setFileStatus]=useState({});
  const [importingAll,setImportingAll]=useState(false);
  const [notConfigured,setNotConfigured]=useState(false);
  const [loadError,setLoadError]=useState('');

  /* Antes, cualquier falla (backend no alcanzable, error de red, etc.) caia en
     el mismo catch que "no configurado" y terminaba mostrando "esta carpeta
     esta vacia" — indistinguible de una carpeta real sin archivos. Ahora se
     distinguen los 3 casos: no configurado, error real (se muestra tal cual,
     sin fingir una carpeta vacia) y exito con 0 elementos. */
  const load=async(folderId)=>{
    setLoading(true); setItems(null); setLoadError('');
    try{
      const data=await apiPost('/api/google-drive', folderId ? { action:'list', folderId } : { action:'list' });
      setItems(data.items||[]);
      setNotConfigured(false);
    }catch(err){
      if(/no est[aá] configurado/i.test(err.message||'')){
        setNotConfigured(true);
      }else{
        setNotConfigured(false);
        setLoadError(friendlyServiceError(err,tr('gdrive.connectFailMsg')));
        window.zoemecNotify?.(err.message || tr('gdrive.listFailMsg'), 'error');
      }
    }finally{ setLoading(false); }
  };
  useEffect(()=>{ load(null); },[]);

  const openFolder=(folder)=>{ setPath(p=>[...p,{id:folder.id,name:folder.name}]); setSelected(new Set()); load(folder.id); };
  const goToCrumb=(index)=>{ const next=path.slice(0,index+1); setPath(next); setSelected(new Set()); load(next.length?next[next.length-1].id:null); };
  const goRoot=()=>{ setPath([]); setSelected(new Set()); load(null); };
  const toggleSelect=(id)=>setSelected(s=>{ const next=new Set(s); if(next.has(id)) next.delete(id); else next.add(id); return next; });

  const importOne=async(item)=>{
    setFileStatus(s=>({...s,[item.id]:'importando'}));
    try{
      const data=await apiPost('/api/google-drive', { action:'import', fileId:item.id });
      // ZIP y archivos >15MB regresan refOnly:true (RC4): se registran como
      // REFERENCIA EXTERNA sin descargarse, nunca como "listo" (que implica
      // contenido ya copiado/indexado).
      setFileStatus(s=>({...s,[item.id]: data.refOnly ? 'referencia' : 'listo'}));
      onImported?.();
    }catch(err){
      setFileStatus(s=>({...s,[item.id]:'error'}));
      window.zoemecNotify?.(tr('gdrive.importFailMsg',{name:item.name,reason:err.message || tr('gdrive.importFailFallback')}), 'error');
    }
  };
  const importSelected=async()=>{
    setImportingAll(true);
    for(const id of [...selected]){
      const item=(items||[]).find(it=>it.id===id);
      if(item && !item.isFolder) await importOne(item);
    }
    setImportingAll(false);
    setSelected(new Set());
  };

  const folders=(items||[]).filter(it=>it.isFolder);
  const files=(items||[]).filter(it=>!it.isFolder);
  const doneCount=Object.values(fileStatus).filter(s=>s==='listo').length;
  const statusLabel={ importando:tr('gdrive.statusImporting'), listo:tr('gdrive.statusReady'), referencia:tr('gdrive.statusExternalRef'), error:tr('gdrive.statusError') };

  return <div className="panel lib-gdrive">
    <div className="admin-panel-head"><h2>Google Drive</h2><button className="soft" onClick={()=>load(path.length?path[path.length-1].id:null)}>{tr('gdrive.refresh')}</button></div>
    {notConfigured && <div className="od-local-ok">
      <Icon name="biblioteca" size={18}/>
      <div><b>{tr('gdrive.notConfiguredTitle')}</b><p>{tr('gdrive.notConfiguredText')}</p></div>
      <button className="soft" onClick={()=>window.zoemecNotify?.(user?.isAdmin ? tr('gdrive.configureAdminMsg') : tr('gdrive.configureUserMsg'), 'info')}>{tr('gdrive.configureBtn')}</button>
    </div>}
    {!notConfigured && loadError && !loading && <EmptyState icon="admin" title={tr('gdrive.connectFailTitle')} text={loadError}/>}
    {!notConfigured && !loadError && <>
      <div className="gdrive-breadcrumb">
        <button className="soft" onClick={goRoot}>{tr('gdrive.repoRoot')}</button>
        {path.map((p,i)=><React.Fragment key={p.id}><span>/</span><button className="soft" onClick={()=>goToCrumb(i)}>{p.name}</button></React.Fragment>)}
      </div>
      {loading ? <div className="ai-note-busy"><span className="asst-dots"><i/><i/><i/></span><b>{tr('gdrive.loading')}</b></div> : <>
        <div className="gdrive-toolbar">
          <span className="muted">{tr('gdrive.foldersFilesCount',{folders:folders.length,files:files.length})}{doneCount ? tr('gdrive.importedSuffix',{count:doneCount}) : ''}</span>
          <button onClick={importSelected} disabled={!selected.size || importingAll}>{importingAll ? tr('gdrive.importing') : tr('gdrive.importSelected',{count:selected.size})}</button>
        </div>
        <div className="od-file-list">
          {folders.map(f=><div className="od-file-row gdrive-folder" key={f.id} onClick={()=>openFolder(f)}>
            <div><b><Icon name="folder" size={15}/> {f.name}</b><small>{tr('gdrive.folder')}</small></div>
            <small>{tr('gdrive.explore')}</small>
            <button className="soft" onClick={(e)=>{e.stopPropagation(); openFolder(f);}}>{tr('gdrive.open')}</button>
          </div>)}
          {files.map(f=>{
            const st=fileStatus[f.id];
            return <div className="od-file-row" key={f.id}>
              <label className="gdrive-check" onClick={e=>e.stopPropagation()}><input type="checkbox" checked={selected.has(f.id)} onChange={()=>toggleSelect(f.id)}/><b>{f.name}</b></label>
              <small className={'gdrive-status '+(st||'pendiente')}>{statusLabel[st] || tr('gdrive.statusPending')}</small>
              <button className="soft" disabled={st==='importando'} onClick={()=>importOne(f)}>{st==='listo' ? tr('gdrive.reimport') : tr('gdrive.import')}</button>
            </div>;
          })}
          {!folders.length && !files.length && <p className="muted">{tr('gdrive.emptyFolder')}</p>}
        </div>
      </>}
    </>}
  </div>;
}

function OneDrivePanel({user, onImported}){
  const { t: tr } = useI18n();
  const [status,setStatus]=useState(null);
  const [items,setItems]=useState(null);
  const [folderPath,setFolderPath]=useState(null); // null = todavia no se conoce (viene de status)
  const [folderNotFound,setFolderNotFound]=useState(false);
  const [loadingList,setLoadingList]=useState(false);
  const [importingId,setImportingId]=useState(null);
  const refreshStatus=async()=>{
    try{ const data=await apiPost('/api/onedrive',{action:'status'}); setStatus(data); if(folderPath==null) setFolderPath(data.folderPath); }
    catch(err){ setStatus({error:friendlyServiceError(err,tr('onedrive.statusFailMsg'))}); }
  };
  useEffect(()=>{ refreshStatus(); },[]);
  // Navegacion de subcarpetas (Prioridad 5, fase de correccion): por
  // defecto la carpeta configurable de Biblioteca ZOEMEC (folderPath, ver
  // api/onedrive.mjs#DEFAULT_FOLDER_PATH), no solo la raiz -- listFolder
  // acepta cualquier ruta, asi que "descender" a una subcarpeta es solo
  // volver a llamarlo con folderPath + '/' + nombre.
  const listFiles=async(path)=>{
    const target=path||folderPath;
    setLoadingList(true); setItems(null); setFolderNotFound(false);
    try{
      const data=await apiPost('/api/onedrive',{action:'listFolder', folderPath:target});
      if(data.notFound){ setFolderNotFound(true); setFolderPath(data.folderPath); setItems([]); return; }
      setFolderPath(data.folderPath);
      setItems(data.items||[]);
    }catch(err){ window.zoemecNotify?.(err.message || tr('onedrive.listFailMsg'), 'error'); setItems([]); }
    finally{ setLoadingList(false); }
  };
  const createFolder=async()=>{
    setLoadingList(true);
    try{
      const data=await apiPost('/api/onedrive',{action:'ensureFolder', folderPath});
      window.zoemecNotify?.(tr('onedrive.folderReadyMsg',{path:data.folderPath}),'info');
      await listFiles(data.folderPath);
    }catch(err){ window.zoemecNotify?.(err.message || tr('onedrive.createFolderFailMsg'), 'error'); }
    finally{ setLoadingList(false); }
  };
  const importFile=async(item)=>{
    setImportingId(item.id);
    try{
      const data=await apiPost('/api/onedrive',{action:'importFile', id:item.id, name:item.name});
      window.zoemecNotify?.(data.sinCambios ? tr('onedrive.alreadySyncedMsg',{name:item.name}) : (data.actualizado?tr('onedrive.updatedMsg',{name:item.name}):tr('onedrive.importedMsg',{name:item.name})),'info');
      onImported?.();
    }catch(err){ window.zoemecNotify?.(err.message || tr('onedrive.importFileFailMsg'), 'error'); }
    finally{ setImportingId(null); }
  };
  const connected = Boolean(status?.connected);
  const configured = isOneDriveConfigured();
  const folders=(items||[]).filter(it=>it.folder);
  const files=(items||[]).filter(it=>!it.folder);
  /* El detalle tecnico (que variable exacta falta) vive solo en Panel Admin ->
     OneDrive. Aqui, para cualquier usuario, el mensaje es honesto pero nunca
     alarmista: la biblioteca local sigue funcionando aunque OneDrive no este
     activado en este entorno. */
  return <div className="panel lib-onedrive">
    <div className="admin-panel-head"><h2>OneDrive</h2><button className="soft" onClick={refreshStatus}>{tr('onedrive.refreshStatus')}</button></div>
    {!configured && <div className="od-local-ok">
      <Icon name="biblioteca" size={18}/>
      <div><b>{tr('onedrive.localAvailableTitle')}</b><p>{tr('onedrive.localAvailableText')}</p></div>
      <button className="soft" onClick={()=>window.zoemecNotify?.(user?.isAdmin ? tr('onedrive.configureAdminMsg') : tr('onedrive.configureUserMsg'), 'info')}>{tr('onedrive.configureBtn')}</button>
    </div>}
    {configured && status?.error && <EmptyState icon="admin" title={tr('onedrive.queryFailTitle')} text={status.error}/>}
    {configured && status && !status.error && <>
      <p className="muted">{connected ? tr('onedrive.connectedAs',{account:status.account || tr('onedrive.yourMsAccount')}) : tr('onedrive.connectPrompt')}</p>
      {connected && <p className="muted" style={{fontSize:'.78rem'}}>{tr('onedrive.folderLabel')} <b>{folderPath||status.folderPath}</b>{status.lastSyncedAt ? tr('onedrive.lastSync',{date:new Date(status.lastSyncedAt._seconds?status.lastSyncedAt._seconds*1000:status.lastSyncedAt).toLocaleString('es-MX')}) : tr('onedrive.neverSynced')}</p>}
      <div className="visual-actions" style={{flexWrap:'wrap',gap:8}}>
        {!connected
          ? <button onClick={()=>connectOneDrive()}>{tr('onedrive.connect')}</button>
          : <>
            <button className="soft" onClick={()=>listFiles(folderPath)} disabled={loadingList}>{loadingList?tr('onedrive.listing'):tr('onedrive.listZoemecFolder')}</button>
            <button className="soft" onClick={()=>listFiles('/')} disabled={loadingList}>{tr('onedrive.viewRoot')}</button>
            {folderNotFound && <button onClick={createFolder} disabled={loadingList}>{tr('onedrive.createFolder',{path:folderPath})}</button>}
          </>}
      </div>
    </>}
    {configured && folderNotFound && <p className="muted">{tr('onedrive.folderNotExistText',{path:folderPath})}</p>}
    {configured && items && <>
      {folders.length>0 && <div className="od-file-list">{folders.map(f=><div className="od-file-row" key={f.id}>
          <div><b>📁 {f.name}</b></div>
          <button className="soft" onClick={()=>listFiles(`${folderPath}/${f.name}`)}>{tr('onedrive.open')}</button>
        </div>)}</div>}
      {files.length ? <div className="od-file-list">{files.map(it=><div className="od-file-row" key={it.id}>
          <div><b>{it.name}</b><small>{((it.size||0)/1048576).toFixed(2)} MB</small></div>
          <small>OneDrive</small>
          <button className="soft" disabled={importingId===it.id} onClick={()=>importFile(it)}>{importingId===it.id?tr('onedrive.importing'):tr('onedrive.importToLibrary')}</button>
        </div>)}</div> : !folderNotFound && <p className="muted">{tr('onedrive.noFilesFound')}</p>}
    </>}
  </div>;
}

/* Datos de ejemplo, SEPARADOS de la biblioteca real: solo se muestran cuando
   Firebase no esta configurado en este entorno, nunca se mezclan con "files"
   ni se cuentan en ningun contador real. */
const LIBRARY_DEMO_SEED = [
  { name:'Catálogo demo CMIC 2024.xlsx', cat:'Costos', family:'Catálogo', size:'1.20 MB' },
  { name:'Matriz APU demo — Muro de block.pdf', cat:'Matrices APU', family:'Albañilería', size:'0.35 MB' },
  { name:'Rendimientos de mano de obra (demo).xlsx', cat:'Mano de obra', family:'Referencia', size:'0.80 MB' }
];

function Library({user, catalog, setCatalog, setModule}){
  const { t: tr } = useI18n();
  const fileInputRef=useRef(null);
  const [files,setFiles]=useLocalState('zoemec-biblioteca',[],user?.uid);
  const [uploading,setUploading]=useState(false);
  const [q,setQ]=useState('');
  const [type,setType]=useState('Todos');
  const [selected,setSelected]=useState(null);
  const [view,setView]=useState('tabla');
  const [page,setPage]=useState(1);
  const [syncing,setSyncing]=useState(false);
  const [lastSync,setLastSync]=useState(null);
  const [syncKey,setSyncKey]=useState(0);
  const [syncError,setSyncError]=useState('');
  /* Antes esta lista solo salia de localStorage: cada subida escribia en Firestore
     pero nunca se volvia a leer de ahi, asi que el Panel Admin (que si lee Firestore)
     y esta pantalla mostraban datos distintos para el mismo usuario. Ahora Firestore
     es la fuente real; localStorage sigue siendo el cache de arranque instantaneo, y
     se conservan solo los archivos que de verdad nunca se sincronizaron (sin docId,
     ej. subidos sin sesion o sin Storage disponible). syncKey permite forzar un
     refresco manual (por ejemplo, tras importar un archivo desde OneDrive).
     El catch antes era silencioso: un permiso o indice fallido en Firestore se
     veia identico a "no hay documentos" (0 sin explicacion). Ahora el error real
     queda en syncError y se muestra, en vez de esconderse detras de un contador
     en cero. */
  useEffect(()=>{
    if(!firebaseReady || !user?.uid) return;
    let alive=true;
    setSyncing(true); setSyncError('');
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
            // RC4 (Biblioteca real): referencia externa, ruta de origen y
            // resultado de extraccion/revision humana. Sin estos campos la
            // ficha tecnica no puede mostrar insumos ni permitir validarlos.
            refOnly:Boolean(data.refOnly), driveParentPath:data.driveParentPath || [],
            driveWebViewLink:data.driveWebViewLink || '', contentInsumos:data.contentInsumos || [],
            insumosReview:data.insumosReview || [], extraction:data.extraction || null,
            docId:d.id
          });
        });
        if(!alive) return;
        setFiles(current=>{
          const localOnly=current.filter(f=>!f.docId);
          return [...remote.values(), ...localOnly];
        });
        setLastSync(new Date().toLocaleTimeString('es-MX'));
      }catch(err){ if(alive) setSyncError(friendlyServiceError(err,'No se pudo sincronizar con Firestore (permisos, indice o red).')); }
      finally{ if(alive) setSyncing(false); }
    })();
    return ()=>{ alive=false; };
  },[user?.uid, syncKey]);
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
  /* La subida ya no va directo del navegador a Firebase Storage (eso es lo que
     disparaba el bloqueo de CORS en consola: preflight/cross-origin rechazado
     por el bucket). Ahora el archivo viaja como base64 dentro de un POST JSON
     a /api/upload-library, y el servidor (Firebase Admin SDK, sin navegador de
     por medio) hace la subida real. Ver api/upload-library.mjs. */
  const readFileAsBase64=(file)=>new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(reader.error);
    reader.readAsDataURL(file);
  });
  const add=async(fl)=>{
    if(!fl||!fl.length) return;
    const picked=[...fl];
    setUploading(true);
    try{
      const arr=[];
      const errors=[];
      for(const f of picked){
        if(firebaseReady && user?.uid){
          try{
            const dataBase64=await readFileAsBase64(f);
            const visibility=user.isAdmin ? 'global' : 'private';
            const data=await apiPost('/api/upload-library', { fileName:f.name, mimeType:f.type, dataBase64, visibility });
            arr.push({
              name:data.name, size:data.size, ext:data.type, when:data.date,
              cat:data.cat, family:data.family, tags:[], status:'Subido e indexado', uses:0,
              docId:data.id, ownerUid:user.uid, visibility, downloadURL:data.url, indexed:false
            });
          }catch(err){
            errors.push(`${f.name}: ${friendlyServiceError(err,'no se pudo subir')}`);
          }
        }else{
          const meta=enrichLibraryMeta({name:cleanText(f.name),size:(f.size/1048576).toFixed(2)+' MB',ext:(f.name.split('.').pop()||'').toUpperCase(),when:new Date().toLocaleDateString('es-MX'),cat:classify(f.name),status:'Pendiente de indice',uses:0}, classify);
          arr.push(meta);
        }
      }
      if(arr.length){ setFiles([...arr,...files]); setSelected(arr[0]); }
      if(errors.length){
        alert(tr('library.uploadErrorsMsg',{ok:arr.length,total:picked.length,errors:errors.join('\n')}));
      }else{
        alert(firebaseReady && user?.uid ? tr('library.uploadedCloudMsg',{count:arr.length}) : tr('library.uploadedLocalMsg',{count:arr.length}));
      }
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
      alert(tr('library.deleteCloudFailMsg',{reason:err?.message || 'revisa permisos.'}));
    }
  };
  /* RC4 -- Biblioteca real: extraccion, busqueda por contenido, matrices
     similares y revision humana. Todo pasa por /api/upload-library (mismo
     endpoint, acciones nuevas) para no sumar funciones serverless. */
  const [busyAction,setBusyAction]=useState('');
  const [similarResults,setSimilarResults]=useState(null);
  const [contentSearch,setContentSearch]=useState(null);
  const patchFileByDocId=(docId,patch)=>{
    setFiles(prev=>prev.map(f=>f.docId===docId?{...f,...patch}:f));
    setSelected(prev=>prev && prev.docId===docId ? {...prev,...patch} : prev);
  };
  const handleExtractInsumos=async(f)=>{
    if(!f?.docId){ window.zoemecNotify?.(tr('library.notSyncedMsg'),'error'); return; }
    if(f.refOnly){ window.zoemecNotify?.(tr('library.externalRefNoExtractMsg'),'error'); return; }
    setBusyAction('extract:'+f.docId);
    try{
      const data=await apiPost('/api/upload-library', { action:'extractInsumos', docId:f.docId });
      patchFileByDocId(f.docId, { contentInsumos:data.contentInsumos||[], insumosReview:data.insumosReview||[], indexed:data.extraction?.status==='done' });
      window.zoemecNotify?.(data.contentInsumos?.length ? tr('library.extractedMsg',{count:data.contentInsumos.length}) : tr('library.noInsumosExtractedMsg',{reason:data.extraction?.error || 'formato no soportado'}), data.contentInsumos?.length ? 'info' : 'error');
    }catch(err){
      window.zoemecNotify?.(err.message || 'No se pudo extraer el contenido.', 'error');
    }finally{ setBusyAction(''); }
  };
  /* Revision humana (Fase 3/5): SOLO cambia el estado de un insumo puntual.
     Nunca decide precios ni toca el catalogo por si sola. */
  const handleReviewInsumo=async(f,index,state)=>{
    if(!f?.docId) return;
    setBusyAction(`review:${f.docId}:${index}`);
    try{
      const data=await apiPost('/api/upload-library', { action:'confirmInsumos', docId:f.docId, decisions:[{index,state}] });
      patchFileByDocId(f.docId, { insumosReview:data.insumosReview||[] });
    }catch(err){
      window.zoemecNotify?.(err.message || tr('library.reviewUpdateFailMsg'), 'error');
    }finally{ setBusyAction(''); }
  };
  /* Puente Biblioteca -> APU (regla critica): SOLO los insumos en estado
     VALIDADO (extractValidatedCatalogRows los filtra) se fusionan con el
     catalogo real que ya consume findCatalogMatches()/matchPrice()/
     domain/apuGeneration.js -- el mismo mecanismo que hoy usa el Excel de
     precios importado en Oficina Tecnica. Ningun motor nuevo, ningun insumo
     PROPUESTO/RECHAZADO llega aqui jamas.

     mergeCatalogRows (antes: un Set por texto exacto de `desc` que hacia
     `.map(({traceability,...row})=>row)`) corrige un bug real: la fusion
     anterior TIRABA la trazabilidad (fuente/fecha/quien valido) del insumo
     antes de guardarlo en el catalogo de trabajo. Ahora se conserva. */
  const handleUseValidatedInApu=(f)=>{
    const rows=extractValidatedCatalogRows(f);
    if(!rows.length){
      window.zoemecNotify?.(tr('library.noValidatedInDocMsg'), 'error');
      return;
    }
    const before=(catalog||[]).length;
    const merged=mergeCatalogRows(catalog, rows);
    setCatalog?.(merged);
    window.zoemecNotify?.(tr('library.validatedAddedMsg',{count:merged.length-before,name:f.name}), 'info');
    setModule?.('apu');
  };
  /* Sincroniza TODOS los documentos de Biblioteca visibles (no solo el que
     el usuario abrio) -- punto 1 de la Biblioteca Inteligente del spec del
     usuario ("consultar biblioteca local" antes de generar cualquier APU,
     no solo cuando alguien elige un documento a la vez). */
  const handleSyncAllValidatedToApu=()=>{
    const rows=extractAllValidatedCatalogRows(files);
    if(!rows.length){
      window.zoemecNotify?.(tr('library.noValidatedAnywhereMsg'), 'error');
      return;
    }
    const before=(catalog||[]).length;
    const merged=mergeCatalogRows(catalog, rows);
    setCatalog?.(merged);
    window.zoemecNotify?.(tr('library.catalogSyncedMsg',{count:merged.length-before,total:files.length}), 'info');
  };
  const handleSimilarMatrices=async(f)=>{
    if(!f?.docId){ window.zoemecNotify?.(tr('library.notSyncedMsg'),'error'); return; }
    setBusyAction('similar:'+f.docId);
    try{
      const data=await apiPost('/api/upload-library', { action:'similarMatrices', docId:f.docId });
      setSimilarResults({ forDoc:f.name, results:data.results||[] });
    }catch(err){
      window.zoemecNotify?.(err.message || tr('library.similarSearchFailMsg'), 'error');
    }finally{ setBusyAction(''); }
  };
  const handleContentSearch=async()=>{
    if(!q.trim()){ setContentSearch(null); return; }
    setBusyAction('search');
    try{
      const data=await apiPost('/api/upload-library', { action:'search', query:q });
      setContentSearch({ query:q, results:data.results||[], method:data.method });
    }catch(err){
      window.zoemecNotify?.(err.message || tr('library.contentSearchFailMsg'), 'error');
    }finally{ setBusyAction(''); }
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
    alert(tr('library.indexUpdatedMsg',{count:visible.length}));
  };
  const suggestions=['muro block 15','loseta porcelanato','rendimiento albanil','PTR lavabo','tablaroca durock','indirectos oficina'];
  if(!canUse(user,'library')){
    const libPlans=[[tr('library.planInicial'),tr('library.planInicialDesc'),tr('library.planInicialTag')],[tr('library.planPro'),tr('library.planProDesc'),tr('library.planProTag')],[tr('library.planEmpresa'),tr('library.planEmpresaDesc'),tr('library.planEmpresaTag')]];
    return <section><PageHead kicker={tr('library.lockedKicker')} title={tr('library.lockedTitle')} desc={tr('library.lockedDesc')} />
      <div className="locked-panel panel"><Icon name="biblioteca" size={42}/><div><h2>{tr('library.lockedHeading')}</h2><p>{tr('library.lockedText')}</p><button onClick={()=>{ const msg=tr('library.activatePlanMsg',{email:defaultCompany.email}); window.zoemecNotify ? window.zoemecNotify(msg, 'info') : alert(msg); }}>{tr('library.activatePlan')}</button></div></div>
      <div className="library-grid">{libPlans.map(f=><div className="folder" key={f[0]}><b>{f[0]}</b><p>{f[1]}</p><span>{f[2]}</span></div>)}</div>
    </section>;
  }
  return <section><PageHead kicker={tr('modules.biblioteca.kicker')} title={tr('modules.biblioteca.title')} desc={tr('modules.biblioteca.desc')} />
    <div className="lib-hero panel">
      <div><small>{tr('library.heroKicker')}</small><h2>{files.length ? tr('library.heroTitleReady',{count:files.length}) : tr('library.heroTitleEmpty')}</h2><p>{tr('library.heroDesc')}</p></div>
      <div className="lib-hero-actions"><button className="secondary" onClick={()=>{ if(user?.isAdmin) setModule('admin'); else window.zoemecNotify?.(tr('library.cloudStatusMsg'), 'info'); }}>{tr('library.cloudStatus')}</button><label className="up-btn">{uploading?tr('library.uploading'):tr('library.uploadBatch')}<input ref={fileInputRef} type="file" multiple onChange={e=>add(e.target.files)} hidden disabled={uploading}/></label></div>
    </div>
    {syncError && <div className="od-config-warning"><Icon name="alerta" size={18}/><div><b>{tr('library.syncErrorLabel')}</b> {syncError} {tr('library.syncErrorSuffix')}</div></div>}
    {!firebaseReady && <div className="panel lib-demo-mode">
      <div className="admin-panel-head"><h2>{tr('library.demoTitle')}</h2><small className="hint">{tr('library.demoHint')}</small></div>
      <p className="muted">{tr('library.demoText')}</p>
      <div className="od-file-list">{LIBRARY_DEMO_SEED.map(f=><div className="od-file-row" key={f.name}><div><b>{f.name}</b><small>{f.cat} · {f.family} · {f.size}</small></div><small>{tr('library.example')}</small><button className="soft" disabled>{tr('library.example')}</button></div>)}</div>
    </div>}
    <div className="lib-cloud panel">
      {[[tr('library.step1Title'),tr('library.step1Desc')],[tr('library.step2Title'),tr('library.step2Desc')],[tr('library.step3Title'),tr('library.step3Desc')]].map(x=><div key={x[0]}><b>{x[0]}</b><p>{x[1]}</p></div>)}
    </div>
    <GoogleDrivePanel user={user} onImported={()=>setSyncKey(k=>k+1)}/>
    <OneDrivePanel user={user} onImported={()=>setSyncKey(k=>k+1)}/>
    <div className="library-dashboard"><div className="lib-stat"><small>{tr('library.statDocs')}</small><b>{files.length}</b><span>{tr('library.statDocsSub',{mb:totalMb.toFixed(2)})}</span></div><div className="lib-stat"><small>{tr('library.statCategories')}</small><b>{counts.filter(x=>x[1]>0).length}</b><span>{type === 'Todos' ? tr('library.statCategoriesAllView') : type}</span></div><div className="lib-stat"><small>{tr('library.statSelected')}</small><b>{batch.length}</b><span>{tr('library.statSelectedSub')}</span></div></div>
    <div className="lib-console panel">
      <div className="lib-searchbar"><input className="search" placeholder={tr('library.searchPlaceholder')} value={q} onChange={e=>{setQ(e.target.value);setPage(1);setContentSearch(null)}}/><button disabled={busyAction==='search'} onClick={handleContentSearch}>{busyAction==='search'?tr('library.searching'):tr('library.searchByContent')}</button></div>
      <div className="lib-suggestions">{suggestions.map(s=><button key={s} onClick={()=>{setQ(s);setPage(1);setContentSearch(null)}}>{s}</button>)}</div>
      {contentSearch && <div className="panel lib-content-search">
        <div className="admin-panel-head"><h2>{tr('library.contentSearchTitle',{query:contentSearch.query})}</h2><small className="hint">{tr('library.contentSearchHint')}</small></div>
        {contentSearch.results.length ? <div className="od-file-list">{contentSearch.results.map(r=><div className="od-file-row" key={r.id}>
            <div><b>{r.name}</b><small>{r.cat} · {r.family || 'General'} · {r.status}{r.driveParentPath?.length?` · ${r.driveParentPath.join(' / ')}`:''}</small></div>
            <small>{tr('library.scoreLabel',{score:r.score,terms:r.matchedTerms.join(', ') || '—'})}{r.matchedInsumos.length?tr('library.insumosSuffix',{count:r.matchedInsumos.length}):''}</small>
            <button className="soft" onClick={()=>setSelected(files.find(f=>f.docId===r.id))}>{tr('library.viewSheet')}</button>
          </div>)}</div> : <p className="muted">{tr('library.noContentMatches')}</p>}
      </div>}
      <div className="lib-toolbar pro"><div className="lib-tabs">{types.map(t=><button key={t} className={type===t?'active':''} onClick={()=>setFilterType(t)}>{t}</button>)}</div><div className="seg"><button className={view==='tabla'?'active':''} onClick={()=>setView('tabla')}>{tr('library.tabTable')}</button><button className={view==='tablero'?'active':''} onClick={()=>setView('tablero')}>{tr('library.tabCards')}</button></div></div>
      <div className="lib-bulkbar"><b>{visible.length}</b><span>{tr('library.documentsFound')}</span><em>{tr('library.pageLabel',{page:safePage,pages})}</em><label className="soft file-soft">{tr('library.massUpload')}<input type="file" multiple hidden onChange={e=>add(e.target.files)} disabled={uploading}/></label><button className="soft" onClick={indexVisible}>{tr('library.indexVisible')}</button></div>
      <div className="lib-workbench">
        <aside className="lib-folders">{counts.map(([name,count])=><button key={name} onClick={()=>setFilterType(name)} className={type===name?'active':''}><Icon name="folder" size={15}/><span>{name}</span><b>{count}</b></button>)}</aside>
        <div className={view==='tablero'?'lib-board':'lib-table'}>
          {pageItems.length ? pageItems.map((f)=>{ const i=f.__idx ?? files.indexOf(f); const cat=f.cat||classify(f.name); const isActive=active?.name===f.name && active?.when===f.when; return <div className={'lib-file '+(isActive?'active':'')} key={i} onClick={()=>setSelected(f)}><span className="lib-ext">{f.ext||'DOC'}</span><div className="lib-meta"><b>{f.name}</b><small>{cat} - {f.family || 'General'} - {f.size} - {f.when}</small><em>{(f.tags||[]).length ? (f.tags||[]).slice(0,5).join(' · ') : cat==='Matrices APU'?'Puede alimentar APUs':cat==='Mano de obra'?'Rendimientos y cuadrillas':cat==='Costos'?'Precios y catalogos':'Consulta tecnica'}</em></div><div className="lib-actions"><button className="soft" onClick={(e)=>{e.stopPropagation(); f.downloadURL ? window.open(f.downloadURL,'_blank') : setSelected(f)}}>{f.downloadURL?tr('library.open'):tr('library.view')}</button><button className="row-del" onClick={(e)=>{e.stopPropagation();del(i)}}>x</button></div></div>}) : (files.length===0 ? <EmptyState icon="biblioteca" title={tr('library.emptyTitle')} text={tr('library.emptyText')} actionLabel={tr('library.uploadBatch')} onAction={()=>fileInputRef.current?.click()}/> : <div className="lib-empty">{tr('library.noFilterMatches')}</div>)}
          {visible.length > pageSize && <div className="lib-pager"><button className="soft" disabled={safePage<=1} onClick={()=>setPage(safePage-1)}>{tr('library.prev')}</button><span>{(safePage-1)*pageSize+1}-{Math.min(safePage*pageSize,visible.length)} de {visible.length}</span><button className="soft" disabled={safePage>=pages} onClick={()=>setPage(safePage+1)}>{tr('library.next')}</button></div>}
        </div>
        <aside className="lib-preview pro">
          <small>{tr('library.techSheet')}</small><h2>{active?.name || tr('library.noFileSelected')}</h2>
          <p>{active ? (active.cat || classify(active.name))+' - '+(active.family || 'General')+' - '+(active.ext || 'DOC')+' - '+active.size : tr('library.uploadDocsHint')}</p>
          {active?.refOnly && <p className="muted"><b>{tr('library.externalRefLabel')}</b> {tr('library.externalRefText')}{active.driveWebViewLink && <> <a href={active.driveWebViewLink} target="_blank" rel="noreferrer">{tr('library.openInDrive')}</a></>}</p>}
          {active?.driveParentPath?.length ? <p className="muted">{tr('library.sourcePath')} {active.driveParentPath.join(' / ')}</p> : null}
          {active?.tags?.length ? <div className="lib-tags-mini">{active.tags.map(t=><span key={t}>{t}</span>)}</div> : null}
          <div className="lib-ai-card">
            <b>{tr('library.realActions')}</b>
            <button disabled={!active || active.refOnly || busyAction==='extract:'+active?.docId} onClick={()=>handleExtractInsumos(active)}>{busyAction==='extract:'+active?.docId?tr('library.extracting'):tr('library.extractInsumos')}</button>
            <button disabled={!active || busyAction==='similar:'+active?.docId} onClick={()=>handleSimilarMatrices(active)}>{busyAction==='similar:'+active?.docId?tr('library.searchingSimilar'):tr('library.searchSimilarMatrices')}</button>
            <button disabled={!active || !(active.contentInsumos||[]).length} onClick={()=>handleUseValidatedInApu(active)}>{tr('library.useValidatedInApu')}</button>
            <button disabled={!files?.length} onClick={handleSyncAllValidatedToApu} title={tr('library.syncAllToCatalogTitle')}>{tr('library.syncAllToCatalog')}</button>
            <button onClick={indexVisible}>{tr('library.createIndex')}</button>
          </div>
          {active?.contentInsumos?.length ? <div className="lib-insumos-review">
            <b>{tr('library.proposedInsumos',{count:active.contentInsumos.length})}</b>
            <table className="mini-table"><thead><tr><th>{tr('library.colDesc')}</th><th>{tr('library.colUnit')}</th><th>{tr('library.colPrice')}</th><th>{tr('library.colRow')}</th><th>{tr('library.colConfidence')}</th><th>{tr('library.colState')}</th><th></th></tr></thead>
              <tbody>{active.contentInsumos.map((ins,idx)=>{
                const review=(active.insumosReview||[]).find(r=>r.index===idx) || {state:INSUMO_STATES.PROPUESTO};
                const busy=busyAction===`review:${active.docId}:${idx}`;
                return <tr key={idx} className={'insumo-'+review.state.toLowerCase()}>
                  <td>{ins.desc}</td><td>{ins.unidad||'—'}</td><td>${Number(ins.precio).toFixed(2)}</td><td>{ins.rowRef ?? idx+1}</td><td>{ins.confidence}%</td>
                  <td><b>{review.state}</b>{review.validatedBy ? <small> · {review.validatedBy}</small> : null}</td>
                  <td>
                    <button className="soft" disabled={busy} onClick={()=>handleReviewInsumo(active,idx,INSUMO_STATES.VALIDADO)}>{tr('library.validate')}</button>
                    <button className="row-del" disabled={busy} onClick={()=>handleReviewInsumo(active,idx,INSUMO_STATES.RECHAZADO)}>{tr('library.reject')}</button>
                  </td>
                </tr>;
              })}</tbody>
            </table>
          </div> : null}
          {similarResults && <div className="lib-similar-results">
            <b>{tr('library.similarTo',{name:similarResults.forDoc})}</b>
            {similarResults.results.length ? <ul>{similarResults.results.map(r=><li key={r.id}><b>{r.name}</b> — {r.cat} · score {r.score} · coincide: {r.matchedTerms.join(', ') || '—'}</li>)}</ul> : <p className="muted">{tr('library.noSimilar')}</p>}
          </div>}
          <div className="lib-trace"><span>{tr('library.traceState')}</span><b>{active?.status || tr('library.tracePending')}</b><span>{tr('library.tracePermission')}</span><b>{user?.isAdmin?tr('library.traceAdmin'):tr('library.traceProPlan')}</b><span>{tr('library.traceConfidence')}</span><b>{active ? `${active.confidence || 50}%` : tr('library.traceNoSource')}</b></div>
        </aside>
      </div>
    </div>
    <AcademyPanel />
    <div className="panel"><h2>{tr('library.recommendedFlow')}</h2><div className="library-grid">{[[tr('library.flow1Title'),tr('library.flow1Desc'),tr('library.flow1Tag')],[tr('library.flow2Title'),tr('library.flow2Desc'),tr('library.flow2Tag')],[tr('library.flow3Title'),tr('library.flow3Desc'),tr('library.flow3Tag')],[tr('library.flow4Title'),tr('library.flow4Desc'),tr('library.flow4Tag')]].map(f=><div className="folder" key={f[0]}><b><Icon name="folder" size={17}/> {f[0]}</b><p>{f[1]}</p><span>{f[2]}</span></div>)}</div></div>
  </section>
}

function AcademyPanel(){
  const { t: tr } = useI18n();
  const [list,setList]=useLocalState('zoemec-cursos', []);
  const [t,setT]=useState(''); const [d,setD]=useState(''); const [link,setLink]=useState('');
  const add=()=>{ if(!t.trim()) return; setList([{t:t.trim(),d:d.trim()||'Curso nuevo',p:0,link:link.trim()},...list]); setT(''); setD(''); setLink(''); };
  const del=(i)=>setList(list.filter((_,idx)=>idx!==i));
  const avg=Math.round(list.reduce((a,c)=>a+(Number(c.p)||0),0)/(list.length||1));
  return <div className="library-academy">
    <div className="academy-hero panel"><div><small>{tr('academy.kicker')}</small><h2>{tr('academy.title')}</h2><p>{tr('academy.desc')}</p></div><div className="academy-meter"><b>{avg}%</b><span>{tr('academy.avgProgress')}</span></div></div>
    <div className="academy-path">{[tr('academy.pathStep1'),tr('academy.pathStep2'),tr('academy.pathStep3'),tr('academy.pathStep4'),tr('academy.pathStep5')].map((x,i)=><div key={x} className={i<2?'done':''}><span>{i+1}</span><b>{x}</b></div>)}</div>
    <div className="panel course-new pro"><div className="cn-fields"><div className="nf"><label>{tr('academy.courseTitle')}</label><input value={t} onChange={e=>setT(e.target.value)} placeholder={tr('academy.courseTitlePlaceholder')}/></div><div className="nf"><label>{tr('academy.courseDesc')}</label><input value={d} onChange={e=>setD(e.target.value)} placeholder={tr('academy.courseDescPlaceholder')}/></div></div><div className="nf"><label>{tr('academy.videoLink')}</label><input value={link} onChange={e=>setLink(e.target.value)} placeholder="https://..."/></div><div className="cn-foot"><label className="up-btn ghost-up">{tr('academy.uploadVideo')}<input type="file" accept="video/*" hidden onChange={()=>alert(tr('academy.uploadVideoMsg'))}/></label><button onClick={add}>{tr('academy.createCourse')}</button></div></div>
    <div className="cards-3 academy-grid">{list.map((c,i)=><div className="course-card pro" key={i}><div className="thumb"><button className="thumb-play" onClick={()=>c.link ? window.open(c.link,'_blank') : alert(tr('academy.playVideoMsg'))}><Icon name="play" size={30}/></button></div><div className="cc-body"><small className="course-pill">{tr('academy.module',{n:i+1})}</small><h2>{c.t}</h2><p>{c.d}</p>{c.link && <a className="cc-link" href={c.link} target="_blank" rel="noreferrer">{tr('academy.viewVideo')}</a>}<progress value={c.p} max="100"/><div className="cc-foot"><input type="range" min="0" max="100" value={c.p} onChange={e=>setList(list.map((x,idx)=>idx===i?{...x,p:+e.target.value}:x))}/><small>{c.p}%</small></div><a className="cc-del" onClick={()=>del(i)}>{tr('academy.delete')}</a></div></div>)}</div>
  </div>;
}

function TechnicalOffice({company,setCompany,catalog,setCatalog,needsProject,onCreateProject}){
  const { t: tr } = useI18n();
  return <section><PageHead kicker={tr('config.kicker')} title={tr('config.title')} desc={tr('config.desc')} />
    <div className="combined-stack">
      {needsProject && <div className="panel" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap',padding:'14px 18px'}}>
        <p className="muted" style={{margin:0}}>{tr('config.needProjectBanner')}</p>
        <button onClick={onCreateProject}>{tr('config.createProject')}</button>
      </div>}
      <Office company={company} setCompany={setCompany} catalog={catalog} setCatalog={setCatalog} embedded />
      <TechnicalCenter embedded />
    </div>
  </section>;
}

function Office({company,setCompany,catalog,setCatalog,embedded=false}){
  const { t: tr } = useI18n();
  const uploadLogo=(file)=>{if(!file)return;const r=new FileReader();r.onload=()=>setCompany({...company,logo:r.result});r.readAsDataURL(file)};
  const importExcel=async(file)=>{
    if(!file) return;
    if(/\.xls$/i.test(file.name)){ alert(tr('config.invalidXlsAlert')); return; }
    try{
      const cat=await parseExcelToCatalog(file);
      if(!cat.length){ alert(tr('config.noColumnsAlert')); return; }
      setCatalog(cat);
      alert(tr('config.importedAlert',{count:cat.length}));
    }catch(err){
      alert(tr('config.importErrorAlert',{msg:err?.message || tr('config.importErrorDefault')}));
    }
  };
  return <section>
    {!embedded && <PageHead kicker={tr('config.kicker')} title={tr('config.officeTitle')} desc={tr('config.officeDesc')} />}
    {embedded && <div className="module-subhead"><div><small>{tr('config.kicker')}</small><h2>{tr('config.officeTitle')}</h2></div></div>}
    <div className="grid-2">
      <div className="panel form">
        <label>{tr('config.logoLabel')}</label>
        <img className="logo-preview" src={company.logo}/>
        <input type="file" accept="image/*" onChange={e=>uploadLogo(e.target.files[0])}/>
        <label>{tr('config.companyLabel')}</label>
        <input value={company.name} onChange={e=>setCompany({...company,name:e.target.value})}/>
        <label>{tr('config.rfcLabel')}</label>
        <input value={company.rfc} onChange={e=>setCompany({...company,rfc:e.target.value})}/>
        <label>{tr('config.phoneLabel')}</label>
        <input value={company.phone} onChange={e=>setCompany({...company,phone:e.target.value})}/>
        <label>{tr('config.emailLabel')}</label>
        <input value={company.email} onChange={e=>setCompany({...company,email:e.target.value})}/>
      </div>
      <div className="panel">
        <h2>{tr('config.templatesTitle')}</h2>
        {tr('config.templates').map(x=><div className="activity" key={x}><Icon name="doc" size={16}/> {x}</div>)}
        <h2>{tr('config.myCatalogTitle')}</h2>
        <label className="up-btn ghost-up" style={{display:'inline-block',marginTop:4}}>
          {tr('config.importCatalogBtn')}
          <input type="file" accept=".xlsx,.csv" hidden onChange={e=>importExcel(e.target.files[0])}/>
        </label>
        {catalog&&catalog.length>0 && <p className="muted" style={{marginTop:10}}>{tr('config.catalogLoadedText',{count:catalog.length})}</p>}
        <p className="muted">{tr('config.autoDetectText')}</p>
      </div>
    </div>
  </section>;
}

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


const VISUAL_REPORT_SECTIONS = [
  { keys:['analisis tecnico','analisis técnico','diagnostico'], label:'Análisis técnico', icon:'search' },
  { keys:['propuesta constructiva','propuesta'], label:'Propuesta constructiva', icon:'apu' },
  { keys:['mejoras'], label:'Mejoras', icon:'reportes' },
  { keys:['materiales'], label:'Materiales', icon:'block' },
  { keys:['estructura'], label:'Estructura', icon:'concreto' },
  { keys:['acabados'], label:'Acabados', icon:'pintura' },
  { keys:['riesgos'], label:'Riesgos', icon:'alerta' },
  { keys:['presupuesto aproximado','presupuesto'], label:'Presupuesto aproximado', icon:'presupuestos' },
  { keys:['recomendaciones','siguientes pasos'], label:'Recomendaciones', icon:'link' }
];
/* El backend (api/visual-ai.mjs) pide a OpenAI Responses que devuelva encabezados
   "## Seccion" por cada rubro. Esto separa la salida en tarjetas legibles y deja
   la puerta abierta a otros modelos de vision futuros que respeten el mismo
   contrato de texto, sin acoplar el frontend a un proveedor especifico. */
function parseVisualReport(text){
  if(!text) return null;
  const blocks = String(text).split(/\n(?=#{1,3}\s*[^\n]+)/g).map(b=>b.trim()).filter(Boolean);
  const sections = [];
  blocks.forEach(block=>{
    const headMatch = block.match(/^#{1,3}\s*(.+)$/);
    if(!headMatch) return;
    const heading = headMatch[1].replace(/[:*]/g,'').trim();
    const headingKey = libKey(heading);
    const body = block.slice(headMatch[0].length).trim();
    if(!body) return;
    const known = VISUAL_REPORT_SECTIONS.find(s=>s.keys.some(k=>headingKey.includes(libKey(k))));
    sections.push({ label: known?.label || heading, icon: known?.icon || 'doc', text: body });
  });
  return sections.length ? sections : null;
}

function VisualAI({user, setModule}){
  const { t: tr } = useI18n();
  const [subview,setSubview]=useState('propuesta');
  const [image,setImage]=useState('');
  const [fileName,setFileName]=useState('');
  const [mode,setMode]=useState('fachada');
  const [prompt,setPrompt]=useState('Modernizar fachada con estilo contemporaneo, materiales aparentes, iluminacion arquitectonica y propuesta viable para obra.');
  const [result,setResult]=useState('');
  const [generatedImage,setGeneratedImage]=useState('');
  const [loading,setLoading]=useState(false);
  /* Documentos reales de la Biblioteca (Firestore) para que la IA los use como
     evidencia/contexto: antes Visual IA no leia nada de la biblioteca, asi que
     su analisis nunca podia referenciar catalogos, normas o matrices ya
     subidas por el usuario. Se manda solo nombre+categoria (nunca el archivo
     completo) para no inflar el payload. */
  const [libraryDocs,setLibraryDocs]=useState([]);
  useEffect(()=>{
    if(!firebaseReady || !user?.uid) return;
    let alive=true;
    Promise.all([
      getDocs(query(collection(db,'library'), where('ownerUid','==',user.uid), limit(15))),
      getDocs(query(collection(db,'library'), where('visibility','==','global'), limit(15)))
    ]).then(([ownSnap, globalSnap])=>{
      if(!alive) return;
      const merged=new Map();
      [...ownSnap.docs, ...globalSnap.docs].forEach(d=>{
        const data=d.data();
        merged.set(d.id, { name:data.name||'Documento', cat:data.cat||'Documentos', family:data.family||'' });
      });
      setLibraryDocs([...merged.values()].slice(0,20));
    }).catch(()=>{ if(alive) setLibraryDocs([]); });
    return ()=>{ alive=false; };
  },[user?.uid]);
  const load=(file)=>{
    if(!file) return;
    const reader = new FileReader();
    reader.onload=()=>{ setImage(reader.result); setFileName(file.name); };
    reader.readAsDataURL(file);
  };
  const localBrief=()=>{
    const modes = {
      fachada:'Conservar estructura principal, proponer paleta de materiales, iluminacion, herreria, canceleria, textura, jardineria y mejoras de acceso.',
      plano:'Interpretar areas, volumenes, alturas aproximadas, circulaciones, estilo arquitectonico, materialidad y sugerir una volumetria inicial.',
      interior:'Proponer distribucion, mobiliario, acabados, iluminacion, plafones, colores y puntos criticos de ejecucion.',
      obra:'Detectar riesgos visuales, pendientes, seguridad, limpieza, avance y recomendaciones para reporte fotografico.'
    };
    return `## Analisis tecnico\n${modes[mode]}\n\n## Propuesta constructiva\nInstruccion capturada: ${prompt}\n\n## Materiales\nSin datos: vuelve a generar con IA para esta seccion.\n\n## Estructura\nSin datos: vuelve a generar con IA para esta seccion.\n\n## Acabados\nSin datos: vuelve a generar con IA para esta seccion.\n\n## Riesgos\nEsta es una vista previa sin conexion a IA en este momento. Intenta de nuevo en unos minutos.\n\n## Presupuesto aproximado\nSin datos: vuelve a generar con IA para obtener un rango estimado.\n\n## Recomendaciones\nSube una imagen y genera con IA para recomendaciones concretas.`;
  };
  const generate=async()=>{
    setLoading(true);
    try{
      const data=await apiPost('/api/visual-ai', { image, fileName, mode, prompt, uid:user?.uid, email:user?.email, libraryDocs });
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
  const tabs=<div className="visual-modes" style={{marginBottom:14}}>
    <button className={subview==='propuesta'?'active':''} onClick={()=>setSubview('propuesta')}>{tr('visualAi.tabProposal')}</button>
    <button className={subview==='takeoff'?'active':''} onClick={()=>setSubview('takeoff')}>{tr('visualAi.tabTakeoff')}</button>
  </div>;
  if(subview==='takeoff') return <section><PageHead kicker={tr('modules.takeoff.kicker')} title={tr('modules.takeoff.title')} desc={tr('modules.takeoff.desc')} />{tabs}<PlanoTakeoff user={user} setModule={setModule}/></section>;
  return <section><PageHead kicker={tr('visualAi.kicker')} title={tr('visualAi.title')} desc={tr('visualAi.desc')} action={<button onClick={generate}>{tr('visualAi.generateProposal')}</button>} />
    {tabs}
    <div className="visual-grid">
      <div className="panel visual-uploader">
        <label className="visual-drop">
          {image ? <img src={image} alt={tr('visualAi.refAlt')}/> : <div><Icon name="play" size={42}/><b>{tr('visualAi.dropLabel')}</b><span>{tr('visualAi.dropHint')}</span></div>}
          <input type="file" accept="image/*" hidden onChange={e=>load(e.target.files[0])}/>
        </label>
        <div className="visual-meta"><b>{fileName || tr('visualAi.noFileLoaded')}</b><span>{image ? tr('visualAi.previewReady') : tr('visualAi.uploadHint')}</span></div>
        <p className="muted" style={{fontSize:'.78rem',marginTop:'8px'}}>{libraryDocs.length ? tr('visualAi.libraryDocsAvailable',{count:libraryDocs.length}) : tr('visualAi.noLibraryDocs')}</p>
      </div>
      <div className="panel visual-form">
        <h2>{tr('visualAi.whatToGenerate')}</h2>
        <div className="visual-modes">{[['fachada',tr('visualAi.modeFacade')],['plano',tr('visualAi.modePlan')],['interior',tr('visualAi.modeInterior')],['obra',tr('visualAi.modeSite')]].map(x=><button key={x[0]} className={mode===x[0]?'active':''} onClick={()=>setMode(x[0])}>{x[1]}</button>)}</div>
        <label>{tr('visualAi.instructionsLabel')}</label>
        <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder={tr('visualAi.instructionsPlaceholder')} />
        <div className="visual-actions"><button onClick={generate} disabled={loading}>{loading?tr('visualAi.generating'):tr('visualAi.generateBrief')}</button></div>
      </div>
      <div className="panel visual-result">
        <h2>{tr('visualAi.technicalOutput')}</h2>
        {generatedImage && <img className="visual-generated" src={generatedImage} alt={tr('visualAi.generatedAlt')}/>}
        {!result && <p className="muted">{tr('visualAi.outputHint')}</p>}
      </div>
      {result && (()=>{ const sections=parseVisualReport(result); return sections
        ? <div className="visual-report">{sections.map((s,i)=><div className="vr-card" key={i}><b><i><Icon name={s.icon} size={13}/></i>{s.label}</b><p>{s.text}</p></div>)}</div>
        : <div className="panel visual-result" style={{gridColumn:'1/3'}}><pre>{result}</pre></div>; })()}
    </div>
    <div className="visual-flow">{[tr('visualAi.flow1'),tr('visualAi.flow2'),tr('visualAi.flow3'),tr('visualAi.flow4'),tr('visualAi.flow5')].map((x,i)=><div key={x}><b>{i+1}</b><span>{x}</span></div>)}</div>
  </section>
}

/* RC4 Fase 2 -- Planos IA / Takeoff asistido. Reutiliza /api/visual-ai
   (action:'takeoff'/'reviewElement') y /api/upload-library
   (action:'similarMatrices'), ambos ya existentes: sin funciones serverless
   nuevas. No dibuja overlays ni bounding boxes (el modelo no da coordenadas
   fiables): solo pagina + evidencia textual, tal como se aprobo. */
function PlanoTakeoff({user, setModule}){
  const { t: tr } = useI18n();
  const [fileName,setFileName]=useState('');
  const [mimeType,setMimeType]=useState('');
  const [dataBase64,setDataBase64]=useState('');
  const [analyzing,setAnalyzing]=useState(false);
  const [result,setResult]=useState(null);
  const [refDesc,setRefDesc]=useState('');
  const [refMedida,setRefMedida]=useState('');
  const [refUnidad,setRefUnidad]=useState('m');
  const [edits,setEdits]=useState({});
  const [busyIndex,setBusyIndex]=useState(-1);
  const [similarByIndex,setSimilarByIndex]=useState({});
  // Persistencia de takeoff manual (Prioridad 4, fase de correccion): mismo
  // patron de localStorage con scope por usuario que ya usa el resto de la
  // app (ver zoemec-biblioteca). Al recargar, PlanoManualMeasure reconstruye
  // el trazo/calibracion/medicion desde aqui -- nunca hay que volver a
  // dibujar el poligono.
  const [takeoffRecords,setTakeoffRecords]=useLocalState('zoemec-plano-takeoff-manual',[],user?.uid);

  const loadFile=(file)=>{
    if(!file) return;
    const reader=new FileReader();
    reader.onload=()=>{ setDataBase64(reader.result); setFileName(file.name); setMimeType(file.type); setResult(null); };
    reader.readAsDataURL(file);
  };

  const analyze=async()=>{
    if(!dataBase64){ window.zoemecNotify?.(tr('takeoff.uploadPlanFirstMsg'),'error'); return; }
    setAnalyzing(true);
    try{
      const referenciaUsuario = (refDesc.trim() && refMedida) ? { descripcion:refDesc.trim(), medida:Number(refMedida), unidad:refUnidad } : undefined;
      const data=await apiPost('/api/visual-ai', { action:'takeoff', fileName, mimeType, dataBase64, referenciaUsuario });
      setResult(data);
      setEdits({});
      setSimilarByIndex({});
    }catch(err){
      window.zoemecNotify?.(friendlyServiceError(err,tr('takeoff.analyzeFailMsg')), 'error');
    }finally{ setAnalyzing(false); }
  };

  const setEdit=(index,patch)=>setEdits(prev=>({...prev,[index]:{...prev[index],...patch}}));

  const reviewElement=async(index,state)=>{
    if(!result?.visualRequestId) return;
    setBusyIndex(index);
    try{
      const e=edits[index]||{};
      const decision={
        state,
        cantidadCorregida: e.cantidad!==undefined && e.cantidad!=='' ? Number(e.cantidad) : undefined,
        unidadCorregida: e.unidad || undefined,
        descripcionCorregida: e.descripcion || undefined,
        motivo: e.motivo || undefined
      };
      const data=await apiPost('/api/visual-ai', { action:'reviewElement', visualRequestId:result.visualRequestId, elementIndex:index, decision });
      setResult(prev=>{
        const elementos=[...prev.elementos];
        elementos[index]=data.elemento;
        return {...prev, elementos};
      });
    }catch(err){
      window.zoemecNotify?.(friendlyServiceError(err,tr('takeoff.reviewUpdateFailMsg')), 'error');
    }finally{ setBusyIndex(-1); }
  };

  const handleSimilar=async(index,elemento)=>{
    setBusyIndex(index);
    try{
      const concept=edits[index]?.descripcion || elemento.descripcionCorregida || elemento.descripcion;
      const data=await apiPost('/api/upload-library', { action:'similarMatrices', concept });
      setSimilarByIndex(prev=>({...prev,[index]:{ forDoc:elemento.descripcion, results:data.results||[] }}));
    }catch(err){
      window.zoemecNotify?.(friendlyServiceError(err,tr('takeoff.similarFailMsg')), 'error');
    }finally{ setBusyIndex(-1); }
  };

  const handleUseInApu=(elemento)=>{
    const seed=toApuSeed(elemento);
    if(!seed){
      window.zoemecNotify?.(tr('takeoff.notValidatedMsg'), 'error');
      return;
    }
    try{ localStorage.setItem('zoemec-pending-plano-seed', JSON.stringify(seed)); }catch{}
    window.zoemecNotify?.(tr('takeoff.readyForApuMsg',{concept:seed.concept,qty:seed.qty,unit:seed.unit}), 'info');
    setModule?.('apu');
  };

  const estadoLabel={ PROPUESTO_POR_IA:tr('takeoff.stateProposedAI'), REQUIERE_REVISION:tr('takeoff.stateNeedsReview'), VALIDADO_POR_USUARIO:tr('takeoff.stateValidated'), RECHAZADO:tr('takeoff.stateRejected') };

  return <div className="plano-takeoff">
    <div className="panel visual-uploader">
      <label className="visual-drop">
        <div><Icon name="doc" size={42}/><b>{fileName || tr('takeoff.uploadPlan')}</b><span>{tr('takeoff.uploadHint')}</span></div>
        <input type="file" accept="application/pdf,image/jpeg,image/png" hidden onChange={e=>loadFile(e.target.files[0])}/>
      </label>
      <div className="visual-actions"><button onClick={analyze} disabled={analyzing || !dataBase64}>{analyzing?tr('takeoff.analyzing'):tr('takeoff.analyzePlan')}</button></div>
      <div className="grid-2" style={{marginTop:12}}>
        <div><label>{tr('takeoff.refMeasureLabel')}</label><input value={refDesc} onChange={e=>setRefDesc(e.target.value)} placeholder={tr('takeoff.refMeasurePlaceholder')}/></div>
        <div style={{display:'flex',gap:8}}>
          <input type="number" step="any" value={refMedida} onChange={e=>setRefMedida(e.target.value)} placeholder="0.90" style={{flex:1}}/>
          <input value={refUnidad} onChange={e=>setRefUnidad(e.target.value)} placeholder="m" style={{width:70}}/>
        </div>
      </div>
      <p className="muted" style={{fontSize:'.78rem',marginTop:8}}>{tr('takeoff.refHint')}</p>
    </div>

    {mimeType.startsWith('image/') && dataBase64
      ? <PlanoManualMeasure imageDataUrl={dataBase64} fileName={fileName} mimeType={mimeType} setModule={setModule} takeoffRecords={takeoffRecords} setTakeoffRecords={setTakeoffRecords} user={user}/>
      : dataBase64 ? <p className="muted" style={{fontSize:'.78rem'}}>{tr('takeoff.manualOnlyImageHint')}</p> : null}

    {result && <div className="panel">
      <div className="admin-panel-head"><h2>{tr('takeoff.analysisResult')}</h2><small className="hint">{tr('takeoff.pagesElements',{pages:result.numPages,count:result.elementos.length})}{result.resultadoParcial ? tr('takeoff.partialResult',{count:result.elementosDescartados}) : ''}{result.elementosInvalidos?.length ? tr('takeoff.invalidDiscarded',{count:result.elementosInvalidos.length}) : ''}</small></div>
      <div className="visual-meta" style={{marginBottom:10}}>
        <b>{result.fileName || fileName}</b>
        {result.fileStored && result.downloadURL
          ? <button className="soft" onClick={()=>window.open(result.downloadURL,'_blank')}>{tr('takeoff.openOriginalPlan')}</button>
          : <span className="muted" style={{fontSize:'.78rem'}}>{result.storageError ? tr('takeoff.planNotStored',{reason:result.storageError}) : tr('takeoff.planNotStoredPlain')}</span>}
      </div>
      {result.resumenAnalisis && <p className="muted">{result.resumenAnalisis}</p>}
      <table className="mini-table"><thead><tr><th>{tr('takeoff.colType')}</th><th>{tr('takeoff.colDesc')}</th><th>{tr('takeoff.colQty')}</th><th>{tr('takeoff.colUnit')}</th><th>{tr('takeoff.colPage')}</th><th>{tr('takeoff.colAiConfidence')}</th><th>{tr('takeoff.colScaleSource')}</th><th>{tr('takeoff.colState')}</th><th>{tr('takeoff.colEvidence')}</th><th></th></tr></thead>
        <tbody>{result.elementos.map((el,index)=>{
          const busy=busyIndex===index;
          const e=edits[index]||{};
          const canEditQty = el.estado!=='RECHAZADO';
          return <React.Fragment key={index}>
            <tr className={'plano-el-'+el.estado.toLowerCase()}>
              <td>{el.tipo}</td>
              <td><input value={e.descripcion ?? el.descripcionCorregida ?? el.descripcion} onChange={ev=>setEdit(index,{descripcion:ev.target.value})} disabled={!canEditQty}/></td>
              <td><input type="number" step="any" style={{width:80}} value={e.cantidad ?? (el.cantidadCorregida ?? el.cantidadPropuesta ?? '')} onChange={ev=>setEdit(index,{cantidad:ev.target.value})} disabled={!canEditQty} placeholder={el.cantidadPropuesta==null?tr('takeoff.qtyPending'):''}/></td>
              <td><input style={{width:60}} value={e.unidad ?? (el.unidadCorregida || el.unidad)} onChange={ev=>setEdit(index,{unidad:ev.target.value})} disabled={!canEditQty}/></td>
              <td>{el.pagina}</td>
              <td>{el.confianzaIA}%</td>
              <td>{el.fuenteEscala}</td>
              <td><b>{estadoLabel[el.estado]}</b>{el.validatedBy ? <small> · {el.validatedBy}</small> : null}</td>
              <td className="muted" style={{maxWidth:220,fontSize:'.75rem'}}>{el.evidencia}</td>
              <td>
                <button className="soft" disabled={busy} onClick={()=>reviewElement(index,'VALIDADO_POR_USUARIO')}>{tr('takeoff.validate')}</button>
                <button className="row-del" disabled={busy} onClick={()=>reviewElement(index,'RECHAZADO')}>{tr('takeoff.reject')}</button>
                <button className="soft" disabled={busy} onClick={()=>handleSimilar(index,el)}>{tr('takeoff.similarMatrices')}</button>
                <button disabled={el.estado!=='VALIDADO_POR_USUARIO'} onClick={()=>handleUseInApu(el)}>{tr('takeoff.useInApu')}</button>
              </td>
            </tr>
            {similarByIndex[index] && <tr><td colSpan={10}>
              <div className="lib-similar-results">
                <b>{tr('takeoff.similarMatricesTitle')}</b>
                {similarByIndex[index].results.length ? <ul>{similarByIndex[index].results.map(r=><li key={r.id}><b>{r.name}</b> — {r.cat} · score {r.score} · coincide: {r.matchedTerms.join(', ')||'—'}</li>)}</ul> : <p className="muted">{tr('takeoff.noSimilarFound')}</p>}
              </div>
            </td></tr>}
          </React.Fragment>;
        })}</tbody>
      </table>
    </div>}
  </div>;
}

/* Cuantificacion 2D desde plano (puntos 16-17 del spec): trazo manual sobre
   la imagen ya cargada (canvas superpuesto, escalado 1:1 con la imagen via
   naturalWidth/naturalHeight -- ver toNaturalPoint) + calibracion de escala
   explicita por el usuario, usando src/domain/planoMeasurement.js (puro,
   testeado por separado). Alcance de esta fase: JPG/PNG unicamente -- un PDF
   requeriria renderizar la pagina a canvas con pdfjs-dist en el cliente, lo
   cual no se agrega en este pase (limitacion real, documentada, no
   simulada). El elemento resultante se valida y convierte a semilla de APU
   con el MISMO motor que Planos IA (applyPlanoElementReview/toApuSeed,
   planoReview.js) -- ningun motor nuevo. */
function PlanoManualMeasure({imageDataUrl, fileName, mimeType, setModule, takeoffRecords, setTakeoffRecords, user}){
  const { t: tr } = useI18n();
  const canvasRef=useRef(null);
  const imgRef=useRef(null);
  const [mode,setMode]=useState(null); // 'calibrate' | 'area' | 'length'
  const [calibPoints,setCalibPoints]=useState([]);
  const [points,setPoints]=useState([]);
  const [scale,setScale]=useState(null);
  const [calibDistance,setCalibDistance]=useState('');
  const [calibUnit,setCalibUnit]=useState('m');
  const [tipo,setTipo]=useState('otro');
  const [descripcion,setDescripcion]=useState('');
  const [pendingElement,setPendingElement]=useState(null);
  const [cantidadFinal,setCantidadFinal]=useState('');
  const [recordId,setRecordId]=useState(null);
  const restoredForKey=useRef(null);

  // Identidad real del archivo cargado (bug reportado: dos archivos con el
  // MISMO nombre pero contenido distinto compartian estado por error --
  // escala, trazo y medicion de uno se filtraban al otro). El nombre solo
  // ya NO es la identidad: se combina con un hash del contenido real (ver
  // hashFileContent, planoTakeoffStore.js) para que cada imagen realmente
  // distinta tenga su propia clave de restauracion, aunque comparta nombre.
  const fileHash=useMemo(()=>imageDataUrl?hashFileContent(imageDataUrl):null,[imageDataUrl]);
  const restoreKey=fileName?`${fileName}::${fileHash||''}`:null;

  // Reconstruccion al cambiar de archivo (Prioridad 4, fase de correccion +
  // fix de aislamiento 2026-08-27): SIEMPRE se resuelve el estado completo
  // de ESTE archivo (identificado por restoreKey) -- si existe una medicion
  // persistida se restaura completa (calibracion+trazo+medicion+concepto);
  // si NO existe, se resetea todo explicitamente, nunca se deja el estado
  // en memoria del archivo anterior. Corre una vez por identidad distinta
  // (restoredForKey evita pisar lo que el usuario esta trazando ahora mismo
  // con cada re-render), y vuelve a correr si se regresa a un archivo ya
  // visitado antes (A -> B -> A), porque restoreKey vuelve a cambiar.
  useEffect(()=>{
    if(!restoreKey || restoredForKey.current===restoreKey) return;
    restoredForKey.current=restoreKey;
    // Estado transitorio de trazo en curso: nunca debe sobrevivir un cambio
    // de archivo, exista o no un registro persistido para el nuevo.
    setMode(null);
    setCalibPoints([]);
    const existing=findLatestTakeoffForFile(takeoffRecords,fileName,fileHash);
    if(!existing){
      // Archivo sin estado persistido: reset completo, nunca hereda datos
      // del archivo anterior (calibracion, puntos, medicion, concepto,
      // corrección manual ni cualquier dato derivado).
      setRecordId(null);
      setScale(null);
      setCalibDistance('');
      setCalibUnit('m');
      setPoints([]);
      setTipo('otro');
      setDescripcion('');
      setCantidadFinal('');
      setPendingElement(null);
      return;
    }
    setRecordId(existing.id);
    if(existing.calibracion?.scaleUnitsPerPixel){
      setScale(existing.calibracion.scaleUnitsPerPixel);
      setCalibUnit(existing.calibracion.unit||'m');
      setCalibDistance(String(existing.calibracion.realDistance??''));
    } else {
      setScale(null);
      setCalibUnit('m');
      setCalibDistance('');
    }
    setPoints(existing.trazo?.points||[]);
    setTipo(existing.medicion?.tipo||'otro');
    setDescripcion(existing.medicion?.descripcionCorregida||existing.medicion?.descripcion||'');
    setCantidadFinal(String(existing.medicion?.cantidadCorregida ?? existing.medicion?.cantidadPropuesta ?? ''));
    setPendingElement({
      tipo: existing.medicion?.tipo, descripcion: existing.medicion?.descripcion,
      unidad: existing.medicion?.unidad, cantidadPropuesta: existing.medicion?.cantidadPropuesta,
      fuenteEscala: existing.medicion?.fuenteEscala, origenMedicion: existing.medicion?.origenMedicion,
      confianzaIA: existing.medicion?.confianzaIA, estado: existing.medicion?.estado
    });
    window.zoemecNotify?.(tr('takeoffManual.restoredMsg',{name:fileName}),'info');
  },[restoreKey,fileName,fileHash,takeoffRecords]);

  const redraw=()=>{
    const canvas=canvasRef.current, img=imgRef.current;
    if(!canvas || !img || !img.naturalWidth) return;
    if(canvas.width!==img.naturalWidth) canvas.width=img.naturalWidth;
    if(canvas.height!==img.naturalHeight) canvas.height=img.naturalHeight;
    const ctx=canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const drawPath=(pts,color,close)=>{
      if(!pts.length) return;
      ctx.strokeStyle=color; ctx.fillStyle=color; ctx.lineWidth=Math.max(2,canvas.width/400);
      ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]);
      pts.slice(1).forEach(p=>ctx.lineTo(p[0],p[1]));
      if(close && pts.length>2) ctx.closePath();
      ctx.stroke();
      pts.forEach(p=>{ ctx.beginPath(); ctx.arc(p[0],p[1],Math.max(3,canvas.width/250),0,Math.PI*2); ctx.fill(); });
    };
    drawPath(calibPoints,'#1578B7',false);
    drawPath(points,mode==='area'?'#2F7D3A':'#B5263D',mode==='area');
  };
  useEffect(redraw,[points,calibPoints,mode,imageDataUrl]);

  const toNaturalPoint=(e)=>{
    const canvas=canvasRef.current;
    const rect=canvas.getBoundingClientRect();
    return [ (e.clientX-rect.left)/rect.width*canvas.width, (e.clientY-rect.top)/rect.height*canvas.height ];
  };

  const handleCanvasClick=(e)=>{
    const p=toNaturalPoint(e);
    if(mode==='calibrate'){ setCalibPoints(prev=>[...prev,p].slice(-2)); return; }
    if(mode==='area' || mode==='length'){ setPoints(prev=>[...prev,p]); }
  };

  const startMode=(next)=>{ setMode(next); setPoints([]); if(next==='calibrate') setCalibPoints([]); };

  const confirmCalibration=()=>{
    if(calibPoints.length!==2){ window.zoemecNotify?.(tr('takeoffManual.calibratePointsMsg'),'error'); return; }
    if(!(Number(calibDistance)>0)){ window.zoemecNotify?.(tr('takeoffManual.calibrateDistanceMsg'),'error'); return; }
    const [[x1,y1],[x2,y2]]=calibPoints;
    const pixelDistance=Math.hypot(x2-x1,y2-y1);
    const s=calibrateScale(pixelDistance,Number(calibDistance));
    if(!s){ window.zoemecNotify?.(tr('takeoffManual.calibrateFailMsg'),'error'); return; }
    setScale(s); setMode(null); setCalibPoints([]);
    window.zoemecNotify?.(tr('takeoffManual.calibratedMsg',{scale:s.toFixed(5),unit:calibUnit}),'info');
  };

  const finishMeasure=()=>{
    if(!scale){ window.zoemecNotify?.(tr('takeoffManual.calibrateFirstMsg'),'error'); return; }
    const need=mode==='area'?3:2;
    if(points.length<need){ window.zoemecNotify?.(tr('takeoffManual.needPointsMsg',{count:need}),'error'); return; }
    const el=measureElement({points,mode,scaleUnitsPerPixel:scale,unit:calibUnit,tipo,descripcion,fileName});
    setPendingElement(el);
    setCantidadFinal(el.cantidadPropuesta!=null?String(el.cantidadPropuesta):'');
    setMode(null);
    // Persistencia (Prioridad 4): el trazo/calibracion/medicion se guardan
    // en cuanto existen, ANTES de "usar en APU" -- si el usuario recarga
    // sin llegar a confirmar, el trazo no se pierde (ver restauracion arriba).
    const record=createTakeoffRecord({
      fileName, mimeType, fileDataUrl: imageDataUrl, fileHash,
      mode, points, calibration:{pixelDistance:null,realDistance:Number(calibDistance)||null,scale,unit:calibUnit},
      elemento: el
    });
    setRecordId(record.id);
    setTakeoffRecords(prev=>upsertTakeoffRecord(prev,record));
  };

  const useInApu=()=>{
    if(!pendingElement) return;
    const cantidadEditada=cantidadFinal!==''?Number(cantidadFinal):null;
    const huboCorreccion=cantidadEditada!=null && cantidadEditada!==pendingElement.cantidadPropuesta;
    const reviewed=applyPlanoElementReview(pendingElement,{
      state:'VALIDADO_POR_USUARIO', validatedBy:user?.email||'usuario',
      cantidadCorregida: huboCorreccion?cantidadEditada:undefined,
      descripcionCorregida: descripcion && descripcion!==pendingElement.descripcion?descripcion:undefined
    });
    const seed=toApuSeed(reviewed);
    if(!seed){ window.zoemecNotify?.(tr('takeoffManual.noValidQtyMsg'),'error'); return; }
    // Persiste la correccion manteniendo el historial (cantidad ORIGINAL del
    // trazo nunca se pierde -- ver planoTakeoffStore.js#applyManualCorrection).
    if(recordId){
      setTakeoffRecords(prev=>prev.map(r=>r.id!==recordId?r:applyManualCorrection(r,{
        cantidadCorregida: huboCorreccion?cantidadEditada:null,
        descripcionCorregida: reviewed.descripcionCorregida,
        validatedBy: user?.email||'usuario'
      })));
    }
    try{ localStorage.setItem('zoemec-pending-plano-seed', JSON.stringify(seed)); }catch{}
    window.zoemecNotify?.(tr('takeoffManual.readyForApuMsg',{concept:seed.concept,qty:seed.qty,unit:seed.unit}), 'info');
    setModule?.('apu');
  };

  return <div className="panel plano-manual-measure">
    <div className="admin-panel-head"><h2>{tr('takeoffManual.title')}</h2><small className="hint">{tr('takeoffManual.hint')}</small></div>
    <div style={{position:'relative',display:'inline-block',maxWidth:'100%'}}>
      <img ref={imgRef} src={imageDataUrl} alt={tr('takeoffManual.imgAlt')} style={{maxWidth:'100%',display:'block'}} onLoad={redraw}/>
      <canvas ref={canvasRef} onClick={handleCanvasClick} style={{position:'absolute',inset:0,width:'100%',height:'100%',cursor:mode?'crosshair':'default'}}/>
    </div>
    <div className="visual-actions" style={{marginTop:10,flexWrap:'wrap',gap:8}}>
      <button className={mode==='calibrate'?'active':'soft'} onClick={()=>startMode('calibrate')}>{tr('takeoffManual.calibrateScale')}</button>
      <input type="number" step="any" style={{width:90}} value={calibDistance} onChange={e=>setCalibDistance(e.target.value)} placeholder={tr('takeoffManual.realDistancePlaceholder')} disabled={mode!=='calibrate'}/>
      <input style={{width:60}} value={calibUnit} onChange={e=>setCalibUnit(e.target.value)} placeholder="m"/>
      {mode==='calibrate' && <button onClick={confirmCalibration}>{tr('takeoffManual.confirmCalibration',{count:calibPoints.length})}</button>}
      <span className="muted" style={{fontSize:'.78rem'}}>{scale ? tr('takeoffManual.activeScale',{scale:scale.toFixed(5),unit:calibUnit}) : tr('takeoffManual.noScale')}</span>
    </div>
    <div className="visual-actions" style={{marginTop:6,flexWrap:'wrap',gap:8}}>
      <button className={mode==='area'?'active':'soft'} disabled={!scale} onClick={()=>startMode('area')}>{tr('takeoffManual.measureArea')}</button>
      <button className={mode==='length'?'active':'soft'} disabled={!scale} onClick={()=>startMode('length')}>{tr('takeoffManual.measureLength')}</button>
      <select value={tipo} onChange={e=>setTipo(e.target.value)}>{['piso','muro','losa','puerta','ventana','columna','trabe','plafon','otro'].map(t=><option key={t} value={t}>{t}</option>)}</select>
      <input value={descripcion} onChange={e=>setDescripcion(e.target.value)} placeholder={tr('takeoffManual.descPlaceholder')} style={{flex:1,minWidth:180}}/>
      {(mode==='area'||mode==='length') && <button onClick={finishMeasure}>{tr('takeoffManual.finishTrace',{count:points.length})}</button>}
    </div>
    {pendingElement && <div className="lib-insumos-review" style={{marginTop:10}}>
      <b>{tr('takeoffManual.proposedMeasurement')}</b>
      <p>{pendingElement.descripcion || tr('takeoffManual.noDescription')} — {pendingElement.cantidadPropuesta != null ? tr('takeoffManual.originalTraceLabel',{qty:pendingElement.cantidadPropuesta,unit:pendingElement.unidad}) : tr('takeoffManual.needsValidation')}</p>
      <p className="muted" style={{fontSize:'.78rem'}}>{tr('takeoffManual.originLabel',{origin:pendingElement.origenMedicion,source:pendingElement.fuenteEscala})}</p>
      {pendingElement.cantidadPropuesta!=null && <div className="grid-2">
        <div><label>{tr('takeoffManual.finalQtyLabel')}</label><input type="number" step="any" value={cantidadFinal} onChange={e=>setCantidadFinal(e.target.value)}/></div>
      </div>}
      <button disabled={pendingElement.cantidadPropuesta==null} onClick={useInApu}>{tr('takeoffManual.validateAndUse')}</button>
    </div>}
  </div>;
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
    ['Autenticacion', 'Inicio de sesion seguro con correo o Google, y permisos por rol de usuario.'],
    ['Base de datos', 'Almacenamiento en la nube para APUs, presupuestos, biblioteca, foro, planes y permisos.'],
    ['Archivos', 'Almacenamiento seguro en la nube para Excel, PDF, cursos y documentos pesados.'],
    ['Cobro', 'Pasarela de pago con confirmacion automatica para activar el plan.'],
    ['IA segura', 'La generacion con IA corre en un servidor seguro; la llave de IA nunca viaja al navegador del usuario.'],
    ['Control de uso', 'Contadores mensuales por plan: APUs, tokens IA, descargas y usuarios.']
  ];
  const payPlan=async(plan, method='Mercado Pago')=>{
    if(plan === 'Admin'){
      alert('El plan Admin se asigna manualmente por el equipo ZOEMEC para cuentas internas.');
      return;
    }
    if(method === 'Transferencia'){
      alert(`Realiza el deposito y envia tu comprobante a ${defaultCompany.email}. Un administrador de ZOEMEC activara tu plan una vez validado el pago.`);
      return;
    }
    if(!user?.uid){
      alert('Inicia sesion para crear un checkout.');
      return;
    }
    setPaying(`${method}-${plan}`);
    try{
      // uid/email/name ya no se mandan: el servidor toma la identidad del ID
      // token verificado (ver api/create-checkout.mjs), nunca de este body.
      const data=await apiPost('/api/create-checkout', { plan, method });
      if(data.url) window.location.href=data.url;
      else alert('No pudimos iniciar el pago. Intenta de nuevo o contacta a soporte.');
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
      <div className="payment-head"><div><small>Cobro real</small><h2>Metodos de pago</h2><p>El pago se procesa en un servidor seguro. Tus datos de pago nunca se exponen en el navegador.</p></div><button onClick={()=>alert('Tus datos de pago se procesan y protegen del lado del servidor, nunca en el navegador.')}>Como protegemos tu pago</button></div>
      <div className="payment-grid">{payments.map(m=><div className="payment-card" key={m.name}>
        <span>{m.tag}</span><h3>{m.name}</h3><p>{m.desc}</p>
        <button onClick={()=>payPlan('Profesional',m.name)} disabled={Boolean(paying)}>{paying.startsWith(m.name)?'Conectando...':m.action}</button>
      </div>)}</div>
      <div className="pay-flow">{['Usuario elige plan','Checkout seguro','Pago confirmado','Permisos activados','ZOEMEC libera funciones'].map((x,i)=><div key={x}><b>{i+1}</b><span>{x}</span></div>)}</div>
    </div>
    <div className="panel plan-matrix"><h2>Accesos por plan</h2><table><thead><tr><th>Funcion</th><th>Inicial</th><th>Profesional</th><th>Empresa</th></tr></thead><tbody>{features.map(r=><tr key={r[0]}>{r.map((c,i)=><td key={i}>{c}</td>)}</tr>)}</tbody></table></div>
    <div className="prod-grid">{production.map(([t,d])=><div className="prod-step" key={t}><b>{t}</b><p>{d}</p><small>Protegido con controles de seguridad y permisos por usuario</small></div>)}</div>
  </section>
}
function Reports({clients,apus,budgets}){
  const total=budgets.reduce((a,b)=>a+(b.total||0),0);
  const hasData = Boolean(clients.length || apus.length || budgets.length);
  const segs=hasData ? [{label:'Presupuestos',value:budgets.length,color:'#9D6FD0'},{label:'APUs',value:apus.length,color:'#2A1740'},{label:'Clientes',value:clients.length,color:'#C7A35C'}].filter(s=>s.value>0) : [];
  const bars=[['Presupuestos enviados',Math.min(100,budgets.length*10),'#9D6FD0'],['APU creados',Math.min(100,apus.length*10),'#2A1740'],['Clientes nuevos',Math.min(100,clients.length*10),'#C7A35C']];
  const alerts=hasData ? [...apus.slice(0,2).map(a=>`APU ${a.clave || a.id} disponible para revisar`), ...budgets.slice(0,2).map(b=>`Presupuesto ${b.name} en cartera`)] : [];
  return <section><PageHead kicker="Reportes" title="Tablero ejecutivo" desc="Ventas, presupuestos, clientes, APUs, avances, utilidad y rendimiento de la oficina." action={<button onClick={()=>window.print()}>Exportar reporte</button>} /><div className="report-hero"><div><small>Venta potencial</small><b>{money(total)}</b><span>acumulado</span></div><div><small>Pipeline</small><b>{budgets.length ? 'Activo' : '0%'}</b><span>tasa de cierre</span></div><div><small>Productividad</small><b>{apus.length}</b><span>APU generados</span></div><div><small>Clientes</small><b>{clients.length}</b><span>activos</span></div></div><div className="dash-charts report-grid"><div className="panel"><h2>Cotizacion mensual</h2><Spark points={budgets.length ? budgets.slice(-8).map(b=>Math.max(1,(Number(b.total)||0)/1000)) : [0,0,0,0,0,0,0,0]} h={110}/><div className="chart-foot"><span>{budgets.length ? 'Presupuestos reales' : 'Sin datos reales'}</span><b>{budgets.length ? 'Actualizado' : '0% acumulado'}</b></div></div><div className="panel chart-donut"><h2>Cartera por tipo de obra</h2><Donut segments={segs} center={hasData ? '100%' : '0%'} sub="cartera"/><div className="donut-legend">{segs.length ? segs.map(s=><span key={s.label}><i style={{background:s.color}}/>{s.label} <b>{s.value}</b></span>) : <EmptyState text="Sin datos para graficar."/>}</div></div></div><div className="report-bottom"><div className="panel"><h2>Resumen mensual</h2>{bars.map(([label,val,color])=><div className="bar-row" key={label}><span>{label}</span><i><b style={{width:val+'%',background:color}}></b></i><em className="bar-val">{val}%</em></div>)}</div><div className="panel"><h2>Alertas ejecutivas</h2>{alerts.length ? alerts.map(a=><div className="activity" key={a}><Icon name="bell" size={15}/> {a}</div>) : <EmptyState text="Sin alertas hasta que existan movimientos reales."/>}</div></div></section>
}

createRoot(document.getElementById('root')).render(
  <I18nProvider>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </I18nProvider>
);
