import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import jsPDF from 'jspdf';
import readXlsxFile from 'read-excel-file/browser';
import writeXlsxFile from 'write-excel-file/browser';
import './style.css';

const money = (n) => Number(n || 0).toLocaleString('es-MX', { style:'currency', currency:'MXN' });
const num = (n) => Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits:2, maximumFractionDigits:2 });
const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();

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
  play:<><path d="M6 4l14 8-14 8z"/></>
};
function Icon({name,size=20}){return <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]||ICONS.doc}</svg>;}

const defaultCompany = {
  name: 'ZOEMEC', rfc: 'RFC pendiente', phone: '55 0000 0000', email: 'contacto@zoemec.mx', address: 'México', logo: '/logo.png?v=zoemec-2026'
};
const sampleClients = [
  { id:'CLI-001', name:'Municipio de Tlalmanalco', type:'Gobierno', contact:'Dirección de Obras', phone:'55 1234 5678', email:'obras@municipio.gob.mx', rfc:'MTL000000XXX', projects:4, budgets:12, amount:18250000, status:'Activo' },
  { id:'CLI-002', name:'Grupo Residencial Volcanes', type:'Empresa', contact:'Arq. Laura Sánchez', phone:'55 9876 5432', email:'contacto@volcanes.mx', rfc:'GRV240101AB1', projects:2, budgets:7, amount:6840000, status:'Activo' },
  { id:'CLI-003', name:'Cliente particular', type:'Particular', contact:'Juan García', phone:'55 2222 1111', email:'juan@email.com', rfc:'XAXX010101000', projects:1, budgets:2, amount:1280000, status:'Prospecto' }
];
const sampleProjects = [
  { name:'Local comercial', client:'Grupo Residencial Volcanes', progress:72, budget:2450000, status:'En ejecución' },
  { name:'Rehabilitación de plaza', client:'Municipio de Tlalmanalco', progress:38, budget:5120000, status:'Cotización' },
  { name:'Casa habitación 180 m²', client:'Cliente particular', progress:16, budget:1850000, status:'Anteproyecto' }
];
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
  const save = (next) => { const v = typeof next === 'function' ? next(value) : next; setValue(v); localStorage.setItem(key, JSON.stringify(v)); };
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
  return Boolean(user?.email && user?.deviceId && user?.plan);
}
const PLAN_LIMITS = {
  Gratis:{ apus:1, library:false, ai:false, exports:false, label:'Gratis - 1 APU' },
  Inicial:{ apus:10, library:'limitada', ai:false, exports:true, label:'Inicial' },
  Profesional:{ apus:999, library:true, ai:true, exports:true, label:'Profesional' },
  Empresa:{ apus:9999, library:true, ai:true, exports:true, label:'Empresa' }
};
function canUse(user, feature, used=0){
  const plan = PLAN_LIMITS[user?.plan || 'Gratis'] || PLAN_LIMITS.Gratis;
  if(feature === 'apu') return used < plan.apus;
  return Boolean(plan[feature]);
}

function App(){
  const [screen, setScreen] = useState(()=>hasValidSession(readLocal('zoemec-user', null)) ? 'app' : 'landing');
  const [module, setModule] = useState('inicio');
  const [user, setUser] = useLocalState('zoemec-user', null);
  const [accounts, setAccounts] = useLocalState('zoemec-accounts', []);
  const [usage, setUsage] = useLocalState('zoemec-usage', {});
  const [company, setCompany] = useLocalState('zoemec-company', defaultCompany);
  const [apus, setApus] = useLocalState('zoemec-apus', []);
  const [clients, setClients] = useLocalState('zoemec-clients', sampleClients);
  const [budgets, setBudgets] = useLocalState('zoemec-budgets', []);
  const [projects, setProjects] = useLocalState('zoemec-projects', sampleProjects);
  const [catalog, setCatalog] = useLocalState('zoemec-catalogo', []);
  const companyView = company?.logo === '/logo.png' ? {...company, logo:'/logo.png?v=zoemec-2026'} : company;

  const login = (name='Usuario ZOEMEC', email='', password='', mode='login') => {
    const cleanEmail = email.trim().toLowerCase();
    if(!cleanEmail || !password || password.length < 6){
      alert('Captura un correo valido y una contrasena de minimo 6 caracteres.');
      return false;
    }
    const deviceId = getDeviceId();
    const existing = accounts.find(a=>a.email===cleanEmail);
    if(mode === 'register'){
      if(existing){ alert('Ese correo ya esta registrado. Inicia sesion.'); return false; }
      if(accounts.some(a=>a.deviceId===deviceId && a.plan==='Gratis')){
        alert('Este dispositivo ya uso la cuenta gratis. Para evitar cuentas duplicadas, solicita un plan o usa tu cuenta existente.');
        return false;
      }
      const displayName = (name || cleanEmail.split('@')[0] || 'Usuario ZOEMEC').trim();
      const account = { name:displayName, email:cleanEmail, password, plan:'Gratis', deviceId, createdAt:new Date().toISOString(), verified:false };
      setAccounts([account, ...accounts]);
      setUsage({...usage, [cleanEmail]:{apusCreated:0, deviceId}});
      setUser({ name:displayName, email:cleanEmail, plan:'Gratis', initials:displayName.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase(), deviceId });
      setScreen('app'); setModule('apu');
      return true;
    }
    if(!existing || existing.password !== password){
      alert('Correo o contrasena incorrectos.');
      return false;
    }
    const displayName = existing.name || cleanEmail.split('@')[0] || 'Usuario ZOEMEC';
    setUser({ name:displayName, email:cleanEmail, plan:existing.plan || 'Gratis', initials:displayName.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase(), deviceId });
    setScreen('app');
    setModule('inicio');
    return true;
  };
  const logout = () => { setUser(null); setScreen('landing'); };

  if(screen === 'landing') return <Landing setScreen={setScreen} login={login} company={companyView} />;
  if(screen === 'login') return <Auth mode="login" setScreen={setScreen} login={login} company={companyView} />;
  if(screen === 'register') return <Auth mode="register" setScreen={setScreen} login={login} company={companyView} />;
  if(!hasValidSession(user)) return <Landing setScreen={setScreen} login={login} company={companyView} />;
  return <Shell user={user} logout={logout} module={module} setModule={setModule} company={companyView}>
    {module === 'inicio' && <Dashboard setModule={setModule} apus={apus} clients={clients} budgets={budgets} projects={projects} />}
    {module === 'apu' && <APU company={companyView} user={user} usage={usage} setUsage={setUsage} apus={apus} setApus={setApus} budgets={budgets} setBudgets={setBudgets} catalog={catalog} setCatalog={setCatalog} />}
    {module === 'presupuestos' && <Budgets company={companyView} budgets={budgets} setBudgets={setBudgets} />}
    {module === 'proyectos' && <Projects projects={projects} setProjects={setProjects} />}
    {module === 'clientes' && <Clients clients={clients} setClients={setClients} />}
    {module === 'biblioteca' && <Library user={user} />}
    {module === 'tecnico' && <TechnicalCenter />}
    {module === 'oficina' && <Office company={companyView} setCompany={setCompany} catalog={catalog} setCatalog={setCatalog} />}
    {module === 'comunidad' && <Community />}
    {module === 'academia' && <Academy />}
    {module === 'planes' && <PlansAccess />}
    {module === 'reportes' && <Reports clients={clients} apus={apus} budgets={budgets} />}
  </Shell>;
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
function Spark({points,h=72,color='var(--teal)'}){
  const w=300, max=Math.max(...points), min=Math.min(...points), rng=(max-min)||1, step=w/(points.length-1);
  const pts=points.map((p,i)=>`${i*step},${h-((p-min)/rng)*(h-14)-7}`).join(' ');
  return <svg viewBox={`0 0 ${w} ${h}`} className="spark" preserveAspectRatio="none" width="100%" height={h}>
    <polygon points={`0,${h} ${pts} ${w},${h}`} fill="var(--mint)"/>
    <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
  </svg>;
}

/* ---------- Importación real de Excel + emparejado de precios ---------- */
function tokenize(s){return (s||'').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(/[^a-z0-9]+/).filter(w=>w.length>2);}
function jaccard(a,b){const A=new Set(a),B=new Set(b);let inter=0;A.forEach(x=>{if(B.has(x))inter++;});const uni=new Set([...a,...b]).size||1;return inter/uni;}
function matchPrice(desc,catalog){ if(!catalog||!catalog.length) return null; const dt=tokenize(desc); let best=null,bs=0; for(const it of catalog){const s=jaccard(dt,tokenize(it.desc)); if(s>bs){bs=s;best=it;}} return bs>=0.34?best:null; }
function parseExcelToCatalog(file){
  const name=(file?.name||'').toLowerCase();
  if(name.endsWith('.csv')){
    return file.text().then(text=>parseCatalogRows(parseCSV(text)));
  }
  return readXlsxFile(file).then(parseCatalogRows);
}
async function readSpreadsheetRows(file){
  const name=(file?.name||'').toLowerCase();
  if(name.endsWith('.csv')) return normalizeSpreadsheetRows(parseCSV(await file.text()));
  return readXlsxFile(file).then(normalizeSpreadsheetRows);
}
function normalizeSpreadsheetRows(rows){
  const source = Array.isArray(rows) ? rows : [];
  const expanded = [];
  source.forEach(row => {
    if(Array.isArray(row)){
      expanded.push(row);
      return;
    }
    if(row && Array.isArray(row.data)){
      row.data.forEach(inner => expanded.push(Array.isArray(inner) ? inner : [inner]));
      return;
    }
    if(row && typeof row === 'object'){
      expanded.push(Object.values(row));
      return;
    }
    expanded.push([row]);
  });
  return expanded
    .map(row => row.map(cell => cell == null ? '' : cell));
}
function cleanText(v){
  return String(v ?? '')
    .replace(/mÃ‚Â²|mÂ²/g, 'm²')
    .replace(/mÃ‚Â³|mÂ³/g, 'm³')
    .replace(/dÃƒÂ­a|dÃ­a/g, 'día')
    .replace(/Ã¡/g, 'á').replace(/Ã©/g, 'é').replace(/Ã­/g, 'í').replace(/Ã³/g, 'ó').replace(/Ãº/g, 'ú')
    .replace(/Ã±/g, 'ñ').replace(/Ã/g, 'Á').replace(/Ã‰/g, 'É').replace(/Ã/g, 'Í').replace(/Ã“/g, 'Ó').replace(/Ãš/g, 'Ú')
    .replace(/Ã‘/g, 'Ñ');
}
function normalizeUnitLabel(v){
  const raw = cleanText(v).trim();
  if(/^(m2|m²)$/i.test(raw)) return 'm²';
  if(/^(m3|m³)$/i.test(raw)) return 'm³';
  if(/^dia$/i.test(raw)) return 'día';
  if(/^pza$/i.test(raw)) return 'pza';
  if(/^ml$/i.test(raw)) return 'ml';
  return raw || 'u';
}
async function parseExcelToAPU(file, currentCatalog=[]){
  const rows = await readSpreadsheetRows(file);
  const catalog = parseCatalogRows(rows);
  const flatRows = normalizeSpreadsheetRows(rows)
    .map((row, index)=>({ index, cells:(row||[]).map(v=>v==null?'':String(v).trim()).filter(Boolean) }))
    .filter(r=>r.cells.length);
  const conceptRow = flatRows.find(r=>/concepto|descripci[oó]n|partida/.test(r.cells.join(' ').toLowerCase()))
    || flatRows.find(r=>r.cells.join(' ').length > 35)
    || flatRows[0];
  const numeric = (value)=>{
    const raw=String(value ?? '').trim();
    if(/^(m2|m²|m3|m³|kg|pza|pieza|ml|l|lote|jgo|hr)$/i.test(raw)) return NaN;
    return parseFloat(raw.replace(/[^0-9.\-]/g,''));
  };
  const conceptCells = conceptRow?.cells || [];
  const unit = conceptCells.find(c=>/^(m2|m²|m3|m³|kg|pza|pieza|ml|l|lote|jgo|hr)$/i.test(c)) || '';
  const nums = conceptCells.map(numeric).filter(n=>!Number.isNaN(n) && n>0);
  const rawConcept = conceptCells
    .filter(c=>Number.isNaN(numeric(c)) && !/^(m2|m²|m3|m³|kg|pza|pieza|ml|l|lote|jgo|hr)$/i.test(c))
    .join(' ')
    .replace(/concepto|descripci[oó]n|partida/ig,'')
    .replace(/\s+/g,' ')
    .trim();
  const merged = mergeCatalogs(currentCatalog, catalog);
  return {
    rows,
    catalog,
    mergedCatalog: merged,
    concept: rawConcept || 'Concepto importado desde Excel',
    unit: unit || 'm²',
    qty: nums[0] || 1,
    referencePU: nums.length>1 ? nums[nums.length-1] : 0,
    fileName: file?.name || 'Excel importado'
  };
}
async function parseExcelConcepts(file){
  const rows = await readSpreadsheetRows(file);
  const normalized = normalizeSpreadsheetRows(rows);
  let header = -1;
  let cCode = -1, cConcept = -1, cUnit = -1, cQty = -1, cPU = -1, cImporte = -1;
  const clean = (v) => String(v ?? '').trim();
  const asNumber = (v) => {
    if(v == null || v === '') return 0;
    if(typeof v === 'number') return v;
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g,''));
    return Number.isFinite(n) ? n : 0;
  };
  for(let i=0;i<Math.min(normalized.length,60);i++){
    const r = normalized[i].map(v=>clean(v).toLowerCase());
    const conceptIdx = r.findIndex(x=>/concepto|descripci[oó]n/.test(x));
    const unitIdx = r.findIndex(x=>/^(und\.?|unidad|u\.m\.?)$/.test(x));
    const qtyIdx = r.findIndex(x=>/cantidad|cant\.?/.test(x));
    const puIdx = r.findIndex(x=>/^(p\.?u\.?|precio unitario|precio|p u)$/.test(x));
    const importeIdx = r.findIndex(x=>/importe|total/.test(x));
    if(conceptIdx>-1 && unitIdx>-1 && qtyIdx>-1){
      header = i;
      cConcept = conceptIdx;
      cUnit = unitIdx;
      cQty = qtyIdx;
      cPU = puIdx;
      cImporte = importeIdx;
      cCode = r.findIndex(x=>/codigo|c[oó]digo|clave/.test(x));
      break;
    }
  }
  if(header < 0) throw new Error('No detecte encabezados de catalogo con Concepto, Unidad y Cantidad.');
  const concepts = [];
  for(let i=header+1;i<normalized.length;i++){
    const row = normalized[i] || [];
    const code = clean(row[cCode]);
    const concept = clean(row[cConcept]);
    const unit = clean(row[cUnit]).replace(/^M2$/i,'m²').replace(/^M3$/i,'m³') || 'u';
    const qty = asNumber(row[cQty]) || 1;
    let pu = cPU>-1 ? asNumber(row[cPU]) : 0;
    const importe = cImporte>-1 ? asNumber(row[cImporte]) : 0;
    if(!pu && importe && qty) pu = importe / qty;
    const looksLikeSection = !code && concept && concept.length < 50 && concept === concept.toUpperCase();
    if(!concept || looksLikeSection) continue;
    if(concept.length < 12 || !unit) continue;
    concepts.push({
      code: code || `CON-${String(concepts.length+1).padStart(3,'0')}`,
      concept,
      unit,
      qty,
      referencePU: pu,
      importe
    });
  }
  if(!concepts.length) throw new Error('No encontre conceptos validos debajo del encabezado.');
  return { fileName:file?.name || 'Catalogo importado', rows:normalized, concepts };
}
async function parseRobustConceptCatalog(file){
  const rows = await readSpreadsheetRows(file);
  const normalized = normalizeSpreadsheetRows(rows);
  const clean = (v) => cleanText(v).trim();
  const norm = (v) => clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const unitRe = /^(m2|mÂ²|m²|m3|mÂ³|m³|kg|pza|pieza|pzas|ml|m|l|lt|lote|jgo|hr|hora|dia|dÃ­a|día|jor|jornal)$/i;
  const normalizeUnit = (v) => {
    const raw = clean(v);
    if(/^m2$/i.test(raw)) return 'mÂ²';
    if(/^m3$/i.test(raw)) return 'mÂ³';
    if(/^dia$/i.test(raw)) return 'dÃ­a';
    return raw || 'u';
  };
  const asNumber = (v) => {
    if(v == null || v === '') return 0;
    if(typeof v === 'number') return v;
    let raw = String(v).trim();
    if(!raw || raw.startsWith('=')) return 0;
    raw = raw.replace(/[^0-9,.\-]/g,'');
    if(raw.includes(',') && !raw.includes('.')) raw = raw.replace(',', '.');
    else raw = raw.replace(/,/g, '');
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : 0;
  };
  const isNoiseConcept = (text) => {
    const value = norm(text).replace(/\s+/g,' ').trim();
    if(!value) return true;
    if(/^(presupuesto|catalogo|catalogo de conceptos|cedula|analisis|analisis de precio unitario|total|subtotal|gran total|importe|concepto|descripcion|clave|codigo|unidad|cantidad|precio unitario|pu|p u)$/.test(value)) return true;
    if(/^(materiales|mano de obra|equipo|herramienta|maquinaria|resumen|notas|familia|partida)$/.test(value)) return true;
    if(/^(total|subtotal|gran total)\b/.test(value)) return true;
    if(/\b(total partida|total zona|total area|total capitulo|total capitulo|subtotal partida|gran total)\b/.test(value)) return true;
    return false;
  };
  const addConcept = (list, item) => {
    const concept = clean(item.concept).replace(/\s+/g,' ');
    if(isNoiseConcept(concept) || concept.length < 12) return;
    const rawUnit = clean(item.unit);
    if(!unitRe.test(rawUnit)) return;
    const rawQty = Number(item.qty) || 0;
    if(rawQty <= 0) return;
    const unit = normalizeUnitLabel(normalizeUnit(rawUnit));
    const qty = rawQty;
    let referencePU = Number(item.referencePU) || 0;
    const importe = Number(item.importe) || 0;
    const derivedPU = importe && qty ? importe / qty : 0;
    if(derivedPU && (!referencePU || referencePU <= 1 || referencePU < derivedPU * 0.25)) referencePU = derivedPU;
    list.push({
      code: clean(item.code) || `CON-${String(list.length+1).padStart(3,'0')}`,
      concept,
      unit,
      qty,
      referencePU,
      importe
    });
  };
  let header = -1;
  let cCode = -1, cConcept = -1, cUnit = -1, cQty = -1, cPU = -1, cImporte = -1;
  for(let i=0;i<Math.min(normalized.length,120);i++){
    const row = normalized[i].map(norm);
    const conceptIdx = row.findIndex(x=>/concepto|descripcion|descrip/.test(x));
    const unitIdx = row.findIndex(x=>/^(und\.?|unidad|u\.?m\.?|um)$/.test(x));
    const qtyIdx = row.findIndex(x=>/cantidad|cant\.?/.test(x));
    const puIdx = row.findIndex(x=>/^(p\.?u\.?|pu|precio unitario|precio|p u)$/.test(x));
    const importeIdx = row.findIndex(x=>/importe|total/.test(x));
    if(conceptIdx > -1 && (unitIdx > -1 || qtyIdx > -1)){
      header = i;
      cConcept = conceptIdx;
      cUnit = unitIdx;
      cQty = qtyIdx;
      cPU = puIdx;
      cImporte = importeIdx;
      cCode = row.findIndex(x=>/codigo|clave/.test(x));
      break;
    }
  }
  const concepts = [];
  if(header >= 0){
    for(let i=header+1;i<normalized.length;i++){
      const row = normalized[i] || [];
      const concept = cConcept > -1 ? clean(row[cConcept]) : '';
      const code = cCode > -1 ? clean(row[cCode]) : '';
      const unit = cUnit > -1 ? clean(row[cUnit]) : '';
      const qty = cQty > -1 ? asNumber(row[cQty]) : 0;
      const pu = cPU > -1 ? asNumber(row[cPU]) : 0;
      const importe = cImporte > -1 ? asNumber(row[cImporte]) : 0;
      const looksLikeSection = !code && concept && concept.length < 50 && concept === concept.toUpperCase();
      if(looksLikeSection) continue;
      addConcept(concepts, { code, concept, unit, qty, referencePU:pu, importe });
    }
  }
  if(!concepts.length){
    for(let i=0;i<normalized.length;i++){
      const row = normalized[i] || [];
      for(let j=0;j<row.length;j++){
        const concept = clean(row[j]);
        if(isNoiseConcept(concept) || concept.length < 18) continue;
        const lookAhead = row.slice(j+1, Math.min(row.length, j+12));
        const relUnit = lookAhead.findIndex(v=>unitRe.test(clean(v)));
        if(relUnit < 0) continue;
        const unitIndex = j + 1 + relUnit;
        let qtyIndex = -1;
        for(let k=unitIndex+1;k<Math.min(row.length, unitIndex+6);k++){
          if(asNumber(row[k]) > 0){ qtyIndex = k; break; }
        }
        if(qtyIndex < 0) continue;
        let pu = 0;
        let importe = 0;
        for(let k=qtyIndex+1;k<Math.min(row.length, qtyIndex+7);k++){
          const n = asNumber(row[k]);
          if(n > 0 && !pu) pu = n;
          else if(n > 0 && !importe) importe = n;
        }
        const previous = row.slice(Math.max(0,j-4), j).map(clean).filter(Boolean);
        const code = previous.find(v=>/^[A-Z0-9][A-Z0-9._\-\/]{1,20}$/i.test(v)) || '';
        addConcept(concepts, { code, concept, unit:row[unitIndex], qty:asNumber(row[qtyIndex]), referencePU:pu, importe });
        break;
      }
    }
  }
  const seen = new Set();
  const unique = concepts.filter(item=>{
    const key = `${norm(item.code)}|${norm(item.concept).slice(0,140)}`;
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if(!unique.length) throw new Error('No encontre conceptos validos con descripcion, unidad y cantidad.');
  return { fileName:file?.name || 'Catalogo importado', rows:normalized, concepts:unique };
}
function mergeCatalogs(base=[], incoming=[]){
  const map=new Map();
  [...base,...incoming].forEach(item=>{
    const key=tokenize(item.desc).join('|') || item.desc;
    if(key) map.set(key,item);
  });
  return [...map.values()];
}
function parseCatalogRows(rows){
  rows = normalizeSpreadsheetRows(rows);
  let hi=-1,cD=-1,cU=-1,cP=-1;
  for(let i=0;i<Math.min(rows.length,10);i++){
    const r=(rows[i]||[]).map(x=>(x==null?'':x).toString().toLowerCase());
    const d=r.findIndex(x=>/descrip|concepto|insumo|material/.test(x));
    const p=r.findIndex(x=>/precio|costo|unitario|importe|p\.?u/.test(x));
    if(d>-1&&p>-1){hi=i;cD=d;cP=p;cU=r.findIndex(x=>/unidad|u\.m|^u$/.test(x));break;}
  }
  const out=[]; const start=hi>-1?hi+1:0;
  for(let i=start;i<rows.length;i++){
    const r=rows[i]||[]; let desc,unidad,precio;
    if(cD>-1){desc=r[cD];unidad=cU>-1?r[cU]:'';precio=r[cP];}
    else{desc=r[0];unidad=r[1];precio=r.find((v,idx)=>idx>0&&!isNaN(parseFloat(v)));}
    precio=parseFloat((precio==null?'':precio).toString().replace(/[^0-9.\-]/g,''));
    if(desc&&!isNaN(precio)&&precio>0) out.push({desc:desc.toString().trim(),unidad:(unidad||'').toString().trim(),precio});
  }
  return out;
}
function parseCSV(text){
  const rows=[]; let row=[], cell='', q=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i], next=text[i+1];
    if(ch==='"' && q && next==='"'){ cell+='"'; i++; }
    else if(ch==='"'){ q=!q; }
    else if(ch===',' && !q){ row.push(cell); cell=''; }
    else if((ch==='\n'||ch==='\r') && !q){ if(ch==='\r'&&next==='\n') i++; row.push(cell); if(row.some(x=>String(x).trim())) rows.push(row); row=[]; cell=''; }
    else cell+=ch;
  }
  row.push(cell); if(row.some(x=>String(x).trim())) rows.push(row);
  return rows;
}
function parseConceptText(input){
  const text=(input||'').replace(/\s+/g,' ').trim();
  const unitMatch=text.match(/\b(m2|m²|m3|m³|kg|pza|pieza|ml|lote|jgo|hr)\b/i);
  const moneyMatches=[...text.matchAll(/\$?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)/g)]
    .map(m=>({raw:m[0], value:parseFloat(m[1].replace(/,/g,'')), index:m.index ?? 0}))
    .filter(x=>!Number.isNaN(x.value));
  const unitIndex=unitMatch?.index ?? -1;
  const afterUnit=unitIndex>=0 ? moneyMatches.filter(n=>n.index>unitIndex) : moneyMatches;
  const qty=afterUnit[0]?.value || 1;
  const referencePU=afterUnit.length>1 ? afterUnit[afterUnit.length-1].value : 0;
  let concept=text;
  if(unitIndex>=0) concept=text.slice(0,unitIndex).trim();
  concept=concept
    .replace(/^(concepto|descripci[oó]n|partida)\s*[:\-]?\s*/i,'')
    .replace(/\s+/g,' ')
    .trim();
  return {
    concept: concept || text || 'Concepto nuevo',
    unit: unitMatch ? unitMatch[1].replace(/m2/i,'m²').replace(/m3/i,'m³') : 'm²',
    qty,
    referencePU
  };
}
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
  subtitle:{fontWeight:'bold', color:'#6F3FA7', backgroundColor:'#F2ECF8'},
  head:{fontWeight:'bold', color:'#ffffff', backgroundColor:'#2A1740', align:'center'},
  section:{fontWeight:'bold', color:'#2A1740', backgroundColor:'#EDE3F6'},
  total:{fontWeight:'bold', color:'#2A1740', backgroundColor:'#F6F0FB'},
  grand:{fontWeight:'bold', color:'#ffffff', backgroundColor:'#2A1740'},
  label:{fontWeight:'bold', color:'#2A1740', backgroundColor:'#F7F2FA'},
  note:{color:'#6D6078', backgroundColor:'#FBF8FD', wrap:true},
  calc:{backgroundColor:'#F7F2FA', format:'$#,##0.00'},
  formula:{color:'#6D6078', backgroundColor:'#FBF8FD', wrap:true},
  money:{format:'$#,##0.00'},
  pct:{format:'0.00%'}
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
    return await result;
  }catch(error){
    const flat = sheets.flatMap(sheet => [[sheet.sheet], ...sheet.rows, []]);
    exportRowsCSV(flat, safeName.replace(/\.xlsx$/i, '.csv'));
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
  if(/hola|buenas|hey|saludos/.test(t)) return 'Hola. Soy ZOEMIC, asistente tecnico de costos y obra. Te ayudo con APU, FSR, rendimientos, catalogos, presupuestos, explosiones de insumos y programa de obra.';
  if(/fsr|salario real|fasar/.test(t)) return r('El FSR (Factor de Salario Real, Art. 191 RLOPSRM) convierte el salario base en salario real: Salario real = base × FSR.','Calcúlalo en Centro Técnico con Tp (días pagados), Tl (días laborados) y Ps (cargas obrero-patronales). Suele andar entre 1.6 y 1.9.');
  if(/apu|precio unitario/.test(t)) return r('Para un APU: ve a "APU Inteligente", pega tu concepto y pulsa "Generar desarrollo".','Edita insumos, ajusta indirectos de campo/oficina, utilidad y cargos, y exporta a PDF o Excel. La herramienta menor se calcula como % de la mano de obra.');
  if(/excel|importar|catalogo|catálogo|precios/.test(t)) return r('Importa tu Excel de precios en Oficina Técnica o desde "Generar con IA".','Detecto las columnas de descripción, unidad y precio, y al generar un APU uso tus precios reales cuando coinciden con los insumos.');
  if(/pdf|exportar|excel de salida|descargar/.test(t)) return 'Desde el APU o el Presupuesto usa "Descargar PDF" / "Descargar Excel": salen con el membrete y datos de tu empresa (configúralos en Oficina Técnica).';
  if(/concreto|acero|block|pintura|excavaci|calculadora/.test(t)) return 'En Centro Técnico tienes calculadoras de concreto, acero, block, pintura, impermeabilizante, excavación y FSR. Te dan cantidades y costo al instante con precios editables.';
  if(/indirecto/.test(t)) return 'Los indirectos van separados en campo y oficina; ambos % se suman y se aplican sobre el costo directo. Luego siguen financiamiento, utilidad y cargos adicionales hasta el P.U.';
  if(/presupuesto/.test(t)) return 'En Presupuestos capturas conceptos con su P.U. (sin IVA); el sistema suma subtotal, IVA y total, y lo exportas a PDF/Excel con tu membrete.';
  return r('Puedo orientarte sobre APU, FSR, indirectos, calculadoras, importar tu Excel o exportar formatos.','Para produccion conviene conectarme a OpenAI desde una funcion segura en Vercel o Firebase, nunca desde el navegador.');
}
async function assistantReplyReal(q){
  try{
    const response = await fetch('http://127.0.0.1:8787/api/assistant', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({question:q})
    });
    const data = await response.json();
    if(!response.ok) throw new Error(data?.error || 'IA no disponible');
    return data.answer || assistantReply(q);
  }catch{
    return assistantReply(q);
  }
}
function Assistant(){
  const [open,setOpen]=useState(false);
  const [msgs,setMsgs]=useState([{me:false,t:'Hola. Soy ZOEMIC, asistente tecnico de costos y obra. Preguntame sobre APU, FSR, catalogos, Excel, presupuestos o programa de obra.'}]);
  const [q,setQ]=useState('');
  const send=async()=>{ if(!q.trim()) return; const user=q.trim(); setQ(''); setMsgs(m=>[...m,{me:true,t:user},{me:false,t:'Analizando...'}]); const answer=await assistantReplyReal(user); setMsgs(m=>[...m.slice(0,-1),{me:false,t:answer}]); };
  return <>
    <button className="asst-fab" onClick={()=>setOpen(o=>!o)} title="Asistente ZOEMIC"><img src="/zoemic-assistant.png" alt="ZOEMIC asistente"/></button>
    {open && <div className="asst-panel">
      <div className="asst-head"><img className="asst-avatar" src="/zoemic-assistant.png" alt="ZOEMIC asistente"/><div><b>ZOEMIC</b><small>Asistente técnico real</small></div><button className="asst-x" onClick={()=>setOpen(false)}>×</button></div>
      <div className="asst-body">{msgs.map((m,i)=><div key={i} className={'asst-msg'+(m.me?' me':'')}>{m.t}</div>)}</div>
      <div className="asst-input"><input value={q} placeholder="Escribe tu pregunta…" onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()}/><button onClick={send}>Enviar</button></div>
      <div className="asst-note">Responde con IA si el servidor esta activo; si no, usa guia tecnica local.</div>
    </div>}
  </>;
}

function Landing({setScreen, login, company}){
  return <div className="landing">
    <header className="nav-public">
      <div className="brand-mini"><img src={company?.logo || '/logo.png'} onError={(e)=>e.currentTarget.style.display='none'} /><b>ZOEMEC</b></div>
      <nav><a>Funciones</a><a>Cómo funciona</a><a>Planes</a><a>Contacto</a></nav>
      <div className="nav-actions"><button className="ghost" onClick={()=>setScreen('login')}>Iniciar sesión</button><button onClick={()=>setScreen('register')}>Comenzar gratis</button></div>
    </header>
    <section className="hero-build">
      <div className="hero-copy">
        <span className="eyebrow">Precios unitarios · APU · Presupuestos · Ingeniería</span>
        <h1>La plataforma inteligente para arquitectos, ingenieros y constructoras.</h1>
        <p>Genera APUs con IA, usa tu propio Excel, agrega tu logo, crea presupuestos profesionales, cuantificaciones, cálculos técnicos y reportes desde un solo lugar.</p>
        <div className="hero-actions"><button onClick={()=>setScreen('register')}>Crear cuenta gratis</button><button className="secondary" onClick={()=>setScreen('login')}>Entrar al sistema</button></div>
      </div>
      <div className="hero-apu-card">
        <span>Cédula · Análisis de P.U.</span>
        <h2>Muro de block de 15 cm</h2>
        <div className="apu-mini-row"><p>Materiales</p><b>$258.40</b></div>
        <div className="apu-mini-row"><p>Mano de obra · FSR</p><b>$334.97</b></div>
        <div className="apu-mini-row"><p>Indirectos + utilidad</p><b>$112.18</b></div>
        <div className="apu-mini-total"><p>Precio unitario</p><b>$947.74</b></div>
      </div>
      <div className="hero-benefits">
        <div><Icon name="apu" size={28}/><b>IA para ingeniería</b><span>APUs en segundos</span></div>
        <div><Icon name="doc" size={28}/><b>100% personalizable</b><span>Usa tu Excel y tu logo</span></div>
        <div><Icon name="biblioteca" size={28}/><b>Seguro y confiable</b><span>Protección de datos avanzada</span></div>
        <div><Icon name="clientes" size={28}/><b>Soporte especializado</b><span>Acompañamiento real</span></div>
      </div>
    </section>
  </div>
}

function Auth({mode,setScreen,login,company}){
  const [name,setName]=useState('');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const submit=()=>{
    if(!email.trim() || !password.trim()){
      alert('Captura correo y contraseña para continuar.');
      return;
    }
    login(name, email.trim(), password, mode);
  };
  return <div className="auth-split">
    <div className="auth-brand">
      <Backdrop/>
      <div className="auth-brand-inner">
        <div className="hero-logo light"><img src={company?.logo || '/logo.png'} onError={(e)=>e.currentTarget.style.display='none'} /><span>ZOEMEC</span></div>
        <h2>Ingeniería de costos, precisa y profesional.</h2>
        <p>APU con metodología mexicana, presupuestos, calculadoras de obra y biblioteca técnica — en una sola plataforma.</p>
        <div className="auth-points">
          <span><Icon name="apu" size={18}/> APU con FSR e indirectos de campo y oficina</span>
          <span><Icon name="tecnico" size={18}/> Calculadoras de concreto, acero y más</span>
          <span><Icon name="presupuestos" size={18}/> Exporta PDF y Excel con tu membrete</span>
        </div>
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
        <button onClick={submit}>{mode==='login'?'Entrar':'Crear cuenta'}</button>
        <div className="auth-or"><span>o</span></div>
        <button className="google" onClick={()=>alert('Google Login se activa al conectar Firebase Auth. Por ahora usa correo y contrasena.')}><Icon name="clientes" size={18}/> Continuar con Google</button>
        {mode==='register' && <div className="auth-warning"><b>Cuenta gratis:</b> 1 APU sin costo. Se registra el dispositivo para evitar multiples correos gratis.</div>}
        <small>{mode==='login'?'¿No tienes cuenta? ':'¿Ya tienes cuenta? '}<a onClick={()=>setScreen(mode==='login'?'register':'login')}>{mode==='login'?'Regístrate':'Inicia sesión'}</a></small>
        <a className="back" onClick={()=>setScreen('landing')}>← Volver al inicio</a>
      </div>
    </div>
  </div>
}

function Shell({children,user,logout,module,setModule,company}){
  const menu = [
    ['inicio','inicio','Inicio'], ['apu','apu','APU Inteligente'], ['presupuestos','presupuestos','Presupuestos'], ['proyectos','proyectos','Proyectos'], ['clientes','clientes','Clientes'], ['biblioteca','biblioteca','Biblioteca ZOEMEC'], ['tecnico','tecnico','Centro Técnico'], ['oficina','oficina','Oficina Técnica'], ['comunidad','comunidad','Comunidad'], ['academia','academia','Academia'], ['planes','fsr','Planes y acceso'], ['reportes','reportes','Reportes']
  ];
  return <div className="app-layout">
    <aside className="sidebar">
      <div className="brand"><img src={company.logo || '/logo.png'} onError={(e)=>e.currentTarget.style.display='none'} /><div><b>ZOEMEC</b><span>Ingeniería y construcción</span></div></div>
      <div className="menu">{menu.map(m=><button key={m[0]} className={module===m[0]?'active':''} onClick={()=>setModule(m[0])}><span className="mi"><Icon name={m[1]}/></span>{m[2]}</button>)}</div>
      <button className="plan-box" onClick={()=>setModule('planes')}><b>Plan Profesional</b><p>APU, PDF, Excel, IA y biblioteca técnica.</p><div><i style={{width:'68%'}}></i></div><small>Ver permisos y cobro</small></button>
      <button className="logout-side" onClick={logout}>Salir</button>
    </aside>
    <main className="main">
      <header className="topbar"><div><b>Buscar concepto, cliente o proyecto...</b></div><div className="user"><span className="bell"><Icon name="bell" size={19}/></span><span className="avatar">{user.initials}</span><div><b>{user.name}</b><small>{user.plan}</small></div><button onClick={logout}>Salir</button></div></header>
      {children}
    </main>
    <Assistant/>
  </div>
}

function PageHead({kicker,title,desc,action}){return <div className="page-head"><div><span>{kicker}</span><h1>{title}</h1><p>{desc}</p></div>{action}</div>}
function Stat({label,value,sub}){return <div className="stat-card"><p>{label}</p><b>{value}</b><small>{sub}</small></div>}

function Dashboard({setModule,apus,clients,budgets,projects}){
  const monto = budgets.reduce((a,b)=>a+(b.total||0),0);
  const pr = projects||sampleProjects;
  const estados = pr.reduce((m,p)=>{m[p.status]=(m[p.status]||0)+1;return m;},{});
  const palette = ['#9D6FD0','#2A1740','#C7A35C','#B8A4CC','#B54A62'];
  const segs = Object.keys(estados).map((k,i)=>({label:k,value:estados[k],color:palette[i%palette.length]}));
  return <section><PageHead kicker="Panel ejecutivo" title="Buenos días, Diany" desc="Controla tus proyectos, APUs, presupuestos y biblioteca técnica desde un solo lugar." />
    <div className="stats"><Stat label="Clientes" value={clients.length} sub="Cartera activa"/><Stat label="APU creados" value={apus.length || 24} sub="Este mes"/><Stat label="Presupuestos" value={budgets.length || 8} sub="En seguimiento"/><Stat label="Monto cotizado" value={money(monto || 18450240)} sub="Acumulado"/></div>
    <div className="quick"><button onClick={()=>setModule('apu')}><Icon name="apu"/> Crear APU</button><button onClick={()=>setModule('presupuestos')}><Icon name="presupuestos"/> Nuevo presupuesto</button><button onClick={()=>setModule('clientes')}><Icon name="clientes"/> Nuevo cliente</button><button onClick={()=>setModule('tecnico')}><Icon name="tecnico"/> Calculadoras</button></div>
    <div className="dash-charts">
      <div className="panel"><h2>Tendencia de cotización</h2><Spark points={[6.4,7.1,6.8,8.3,9.6,11.2,10.4,12.8]}/><div className="chart-foot"><span>Últimos 8 meses</span><b>+18% vs. periodo anterior</b></div></div>
      <div className="panel chart-donut"><h2>Estado de proyectos</h2><Donut segments={segs} center={pr.length} sub="obras"/><div className="donut-legend">{segs.map(s=><span key={s.label}><i style={{background:s.color}}/>{s.label} <b>{s.value}</b></span>)}</div></div>
    </div>
    <div className="grid-2"><div className="panel"><h2>Proyectos recientes</h2>{pr.slice(0,4).map(p=><div className="project-row" key={p.name}><div><b>{p.name}</b><small>{p.client}</small></div><span>{p.progress}%</span><progress value={p.progress} max="100" /></div>)}</div><div className="panel"><h2>Actividad reciente</h2>{['APU muro de block exportado en PDF','Cliente Municipio actualizado','Presupuesto Local comercial guardado','Excel de precios importado'].map(x=><div className="activity" key={x}><Icon name="doc" size={15}/> {x}</div>)}</div></div>
  </section>
}

/* ====================================================================
   MOTOR APU - Metodología mexicana (RLOPSRM Art. 191, 220)
   Estructura de fila por insumo:
     materials : [descripción, cantidad, unidad, precioBase, merma%]
     labor     : [descripción, jornadas, unidad, salarioBase, FSR]
     equipment : [descripción, cantidad, unidad, costoHorario]
   ==================================================================== */

function makeAPUFromConcept(concept, catalog){
  const c = concept || 'Muro de block hueco de concreto de 15 cm asentado con mortero cemento-arena';
  const t = c.toLowerCase();
  let tipo;
  if(/escalera|barandal|herrer|ptr|perfil tubular|estructura metal|soldadur|acero.*calibre|bastidor.*acero/.test(t)) tipo='estructura_metalica';
  else if(/plaf|fald|tablaroca|durock|tablacemento|trasdosado|cajillo|enchape|panel.*yeso|yeso|antimoho|anti moho/.test(t)) tipo='tablaroca';
  else if(/marmol|granito|cubierta|barra lavamanos/.test(t)) tipo='marmol_granito';
  else if(/registro|tapa de acceso|tapa registro|paso de instalaciones/.test(t)) tipo='registro';
  else if(/aplanado|repellado|enjarre|plaster|uniblock|resane|emboquillado|chukum/.test(t)) tipo='aplanado';
  else if(/pintura|pintar|esmalte|vinil|acril|epox|primario|sellador vin/.test(t)) tipo='pintura';
  else if(/plaf|fald|tablaroca|durock|tablacemento|trasdosado|cajillo|enchape|panel.*yeso|yeso|antimoho|anti moho/.test(t)) tipo='tablaroca';
  else if(/porcelanato|loseta|azulejo|cer[aÃ¡]mic|lambr|piso|zoclo|boquilla|sardinel/.test(t)) tipo='piso';
  else if(/marmol|m[aÃ¡]rmol|granito|cubierta|barra lavamanos/.test(t)) tipo='marmol_granito';
  else if(/aplanado|repellado|enjarre|plaster|uniblock|resane|emboquillado|chukum/.test(t)) tipo='aplanado';
  else if(/sellado|sello|silicon|silic[oÃ³]n|calafate|junta|espuma/.test(t)) tipo='sello';
  if(!tipo){
  if(/lavabo|durock|ptr|mueble.*bañ|mueble.*ban|base.*lavabo|cer[aá]mico/.test(t)) tipo='lavabo_ptr';
  else if(/estructura met[aá]lica|astm|a500|fy\s*=?\s*46|soldadur|perfil de acero|placa.*acero|grout|primario anticorrosivo|montaje.*estructura|fabricaci[oó]n.*estructura/.test(t)) tipo='estructura_metalica';
  else if(/acero|varilla|castillo|cadena|armad|fierro|malla/.test(t)) tipo='acero';
  else if(/concreto|losa|zapata|firme|cimentaci|colado|columna de conc/.test(t)) tipo='concreto';
  else if(/block|tabique|tabic[oó]n|muro|partici[oó]n|mamposter|junteo/.test(t)) tipo='block';
  else if(/pintura|pintar|esmalte|vinil/.test(t)) tipo='pintura';
  else if(/impermeabiliz/.test(t)) tipo='imper';
  else if(/aplanado|repellado|enjarre|yeso|resane/.test(t)) tipo='aplanado';
  else if(/piso|cer[aá]mic|loseta|porcelanato|azulejo/.test(t)) tipo='piso';
  else if(/excavaci|zanja|despalme/.test(t)) tipo='excavacion';
  else tipo='block';

  }
  const TPL = {
    lavabo_ptr:{ unit:'m',
      materials:[['Perfil PTR de acero de 2" x 2" cal. 14',1.15,'m',92,0],['Tablero de cemento Durock 12.7 mm',0.65,'m²',210,0],['Anclajes, fijaciones, tornillería y soldadura',1,'lote',25,0],['Pasta, cinta y malla para juntas',0.18,'jgo',85,3],['Pintura anticorrosiva / primario',0.08,'L',98,3],['Materiales misceláneos de ajuste y protección',0.04,'jgo',120,0]],
      labor:[['Cuadrilla de herrero + ayudante',0.035,'jor',1400,1],['Trazo, nivelación y presentación',0.015,'jor',700,1],['Resanes, cortes y adecuaciones',0.02,'jor',700,1],['Limpieza, retiro y protección del área',0.02,'jor',470,1]],
      equipment:[['Equipo de protección y andamios (5% de M.O.)',0.05,'(%MO)',49],['Soldadora y herramienta de corte',0.03,'día',120]] },
    tablaroca:{ unit:'mÂ²',
      materials:[['Panel de yeso / tablacemento 12.7 mm segun especificacion',1.05,'mÂ²',210,5],['Poste o canal metalico galvanizado',1.25,'m',38,5],['Canal de amarre y refuerzos',0.55,'m',32,5],['Tornilleria, taquetes y fijaciones',0.18,'jgo',85,3],['Cinta y compuesto para juntas',0.22,'kg',42,5],['Pasta / sellador de acabado',0.12,'L',70,5],['Materiales miscelaneos y proteccion',0.04,'jgo',120,0]],
      labor:[['Instalador de panel (oficial)',0.12,'jor',420,1.85],['Ayudante instalador',0.12,'jor',285,1.82],['Trazo, plomeo y nivelacion',0.025,'jor',420,1.85],['Tratamiento de juntas y resanes',0.05,'jor',380,1.85],['Limpieza y retiro de desperdicio',0.035,'jor',258,1.82]],
      equipment:[['Andamio / escalera de trabajo',0.04,'dÃ­a',120],['Herramienta electrica de corte y fijacion',0.03,'dÃ­a',150],['Equipo de seguridad personal',0.02,'dÃ­a',90]] },
    sello:{ unit:'ml',
      materials:[['Sellador elastomerico / silicon anti hongos',0.12,'cartucho',95,5],['Primer o limpiador de superficie',0.03,'L',85,3],['Cinta de respaldo o espuma de poliuretano',0.08,'m',18,5],['Material de limpieza y proteccion',0.03,'jgo',60,0]],
      labor:[['Oficial aplicador de sellos',0.035,'jor',380,1.85],['Ayudante',0.025,'jor',258,1.82],['Preparacion, limpieza y retiro',0.02,'jor',258,1.82]],
      equipment:[['Pistola calafateadora y herramienta menor',0.02,'dÃ­a',60],['Escalera / andamio proporcional',0.02,'dÃ­a',120]] },
    marmol_granito:{ unit:'mÂ²',
      materials:[['Adhesivo flexible para piedra natural',0.22,'bulto',220,5],['Boquilla / resina de junta',0.28,'kg',85,5],['Anclajes, separadores y niveladores',0.12,'jgo',120,3],['Material de limpieza y proteccion',0.05,'jgo',90,0]],
      labor:[['Colocador especializado en marmol/granito',0.16,'jor',520,1.85],['Ayudante colocador',0.16,'jor',285,1.82],['Trazo, cortes y ajuste de piezas',0.06,'jor',520,1.85],['Limpieza final y proteccion',0.04,'jor',258,1.82]],
      equipment:[['Cortadora con disco diamantado',0.05,'dÃ­a',180],['Pulidora / herramienta menor',0.04,'dÃ­a',150],['Equipo de izaje o apoyo proporcional',0.02,'dÃ­a',200]] },
    registro:{ unit:'pza',
      materials:[['Marco y tapa de registro segun medida especificada',1,'pza',480,3],['Canal / perfil galvanizado para soporte',1.2,'m',38,5],['Tornilleria, taquetes y fijaciones',0.12,'jgo',85,3],['Panel de cierre o placa de ajuste',0.35,'mÂ²',210,5],['Pasta, cinta y resane perimetral',0.15,'kg',42,5],['Material de limpieza y proteccion',0.03,'jgo',60,0]],
      labor:[['Oficial instalador',0.18,'jor',420,1.85],['Ayudante instalador',0.18,'jor',285,1.82],['Trazo, nivelacion y ajuste de vano',0.04,'jor',420,1.85],['Resane y limpieza final',0.04,'jor',258,1.82]],
      equipment:[['Herramienta electrica de corte y fijacion',0.05,'dÃ­a',150],['Escalera / andamio proporcional',0.03,'dÃ­a',120],['Equipo de seguridad personal',0.02,'dÃ­a',90]] },
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
      materials:[['Pintura vinílica',0.2,'L',85,5],['Sellador 5x1',0.06,'L',70,5],['Lija / consumibles',0.05,'jgo',18,0]],
      labor:[['Pintor (oficial)',0.06,'jor',360,1.85],['Ayudante',0.03,'jor',258,1.82]],
      equipment:[['Andamio / rodillo',0.04,'día',120]] },
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
      equipment:[['Andamio / equipo básico',0.05,'día',280],['Revolvedora 1 saco',0.04,'hr',95],['Herramienta de corte y ajuste',0.02,'día',90]] }
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
  return {
    id:'APU-'+uid(), clave:'APU-'+uid().slice(0,4), concept:cleanText(c), unit:normalizeUnitLabel(tpl.unit),
    materials, labor, equipment,
    herramienta:3, indCampo:8, indOficina:7, finance:2, utility:10, cargos:0.5, iva:16,
    family: tipo === 'lavabo_ptr' ? 'Mobiliario metálico ligero / base PTR con Durock' : tipo === 'estructura_metalica' ? 'Estructura metálica / fabricación y montaje' : tipo,
    confidence: tipo === 'lavabo_ptr' ? 98 : tipo === 'estructura_metalica' ? 97 : 88,
    sat: tipo === 'lavabo_ptr' ? '72101500' : tipo === 'estructura_metalica' ? '72101700' : '72100000',
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
    ['Financiamiento', `Costo directo + indirectos x ${num(apu.finance)}%`, totals.finance],
    ['Utilidad', `Costo directo + indirectos + financiamiento x ${num(apu.utility)}%`, totals.utility],
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
function aiServerUrl(path=''){
  const host = window.location.hostname === 'localhost' ? 'localhost' : '127.0.0.1';
  return `http://${host}:8787${path}`;
}

function APU({company,user,usage,setUsage,apus,setApus,budgets,setBudgets,catalog,setCatalog}){
  const [concept,setConcept]=useState('Muro de block hueco de concreto de 15 cm asentado con mortero cemento-arena');
  const [apu,setApu]=useState(()=>makeAPUFromConcept('Muro de block hueco de concreto de 15 cm asentado con mortero cemento-arena'));
  const [aiOpen,setAiOpen]=useState(false);
  const [excelInfo,setExcelInfo]=useState(null);
  const [aiStatus,setAiStatus]=useState('');
  const [conceptBatch,setConceptBatch]=useState(null);
  const totals=calcAPU(apu);
  const userUsage = usage?.[user?.email] || {apusCreated:0};
  const isFree = (user?.plan || 'Gratis') === 'Gratis';
  const requireApuAccess = () => {
    if(canUse(user, 'apu', userUsage.apusCreated)) return true;
    alert('Tu APU gratis ya fue usado. Para generar, guardar y exportar mas APUs activa un plan.');
    return false;
  };

  const updateRow=(kind,i,k,v)=>setApu({...apu,[kind]:apu[kind].map((r,idx)=>idx===i?r.map((x,j)=>j===k?v:x):r)});
  const addRow=(kind)=>{
    const blank = kind==='materials' ? ['Nuevo material',1,'pza',0,0] : kind==='labor' ? ['Nuevo oficio',0,'jor',0,1.85] : ['Nuevo equipo',0,'hr',0];
    setApu({...apu,[kind]:[...apu[kind],blank]});
  };
  const removeRow=(kind,i)=>setApu({...apu,[kind]:apu[kind].filter((_,idx)=>idx!==i)});
  const setParam=(k,v)=>setApu({...apu,[k]:v});
  const generate=()=>{
    if(!requireApuAccess()) return;
    const parsed=parseConceptText(concept);
    const next=makeAPUFromConcept(parsed.concept, catalog);
    setConcept(parsed.concept);
    setApu({...next,unit:parsed.unit || next.unit, sourceQty:parsed.qty, referencePU:parsed.referencePU});
    setExcelInfo(parsed.referencePU ? {fileName:'Texto pegado',concept:parsed.concept,unit:parsed.unit,qty:parsed.qty,referencePU:parsed.referencePU,catalog:[]} : null);
  };
  const generateAI=async()=>{
    if(!requireApuAccess()) return;
    const parsed=parseConceptText(concept);
    setAiStatus('Generando APU con IA...');
    try{
      const res=await fetch(aiServerUrl('/api/generate-apu'),{
        method:'POST',
        mode:'cors',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({concept:parsed.concept,catalog})
      });
      const data=await res.json();
      if(!res.ok) throw new Error(data?.error || 'No se pudo generar con IA.');
      const next=normalizeAIAPU(data.apu, parsed.concept);
      setConcept(next.concept);
      setApu({...next, sourceQty:parsed.qty, referencePU:parsed.referencePU});
      setExcelInfo({fileName:'OpenAI API',concept:next.concept,unit:next.unit,qty:parsed.qty,referencePU:parsed.referencePU,catalog});
      setAiStatus(`IA lista: ${next.family} (${next.confidence}%)`);
      setAiOpen(false);
    }catch(err){
      setAiStatus('');
      alert(`No pude conectar con la IA: ${err?.message || 'servidor no disponible'}.\n\nArranca primero: npm run ai\nY revisa que .env tenga OPENAI_API_KEY.`);
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
        const next = makeAPUFromConcept(first.concept, catalog);
        setConcept(first.concept);
        setApu({...next, clave:first.code, unit:first.unit || next.unit, sourceQty:first.qty, referencePU:first.referencePU, sourceFile:batch.fileName});
        setExcelInfo({fileName:batch.fileName, concept:first.concept, unit:first.unit, qty:first.qty, referencePU:first.referencePU, catalog});
        setAiStatus(batch.concepts.length > 1
          ? `Excel completo leido: ${batch.concepts.length} conceptos. Se exportara CATALOGO + una hoja APU por concepto.`
          : 'Concepto leido desde Excel. Puedes generar el APU y exportarlo con formato.');
        setAiOpen(true);
        return;
      }
    }catch(_batchErr){
      // Si no es presupuesto/cat?logo de conceptos, intenta leerlo como un solo APU.
    }
    try{
      const data=await parseExcelToAPU(file,catalog);
      setCatalog(data.mergedCatalog);
      setConcept(data.concept);
      const next=makeAPUFromConcept(data.concept,data.mergedCatalog);
      setApu({...next,unit:data.unit || next.unit, sourceQty:data.qty, referencePU:data.referencePU, sourceFile:data.fileName});
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
        const next = makeAPUFromConcept(first.concept, catalog);
        setConcept(first.concept);
        setApu({...next, clave:first.code, unit:first.unit || next.unit, sourceQty:first.qty, referencePU:first.referencePU});
        setExcelInfo({fileName:data.fileName, concept:first.concept, unit:first.unit, qty:first.qty, referencePU:first.referencePU, catalog});
      }
      setAiStatus(`Catálogo leído: ${data.concepts.length} conceptos listos para exportar en hojas separadas.`);
      setAiOpen(true);
    }catch(err){
      alert(`No pude leer la lista de conceptos: ${err?.message || 'formato no compatible'}. Revisa que tenga columnas Codigo, Concepto, Unidad, Cantidad y P.U.`);
    }
  };
  const exportConceptBatch=()=>{
    if(!conceptBatch?.concepts?.length){
      alert('Primero sube el catálogo de conceptos.');
      return;
    }
    exportConceptsAPUWorkbook(conceptBatch.concepts, catalog, company);
  };
  const exportConceptBatchPDF=()=>{
    if(!conceptBatch?.concepts?.length){
      alert('Primero sube el catalogo de conceptos.');
      return;
    }
    exportConceptsAPUPDF(conceptBatch.concepts, catalog, company);
  };
  const markApuUsed=()=>setUsage({...usage,[user.email]:{...userUsage,apusCreated:(userUsage.apusCreated||0)+1,deviceId:user.deviceId}});
  const save=()=>{ if(!requireApuAccess()) return; setApus([apu,...apus.filter(x=>x.id!==apu.id)]); markApuUsed(); alert('APU guardado');};
  const addBudget=()=>{ if(!requireApuAccess()) return; setBudgets([{id:'PRE-'+uid(), name:'Presupuesto desde APU', client:'Cliente por definir', items:[{concept:apu.concept, unit:apu.unit, qty:1, pu:totals.pu}], total:totals.pu, date:new Date().toLocaleDateString('es-MX')},...budgets]); markApuUsed(); alert('Agregado a presupuestos (PU sin IVA)');};
  const exportPDF=()=>{ if(isFree && userUsage.apusCreated>=1){ alert('La exportacion ilimitada requiere plan activo.'); return; } exportAPUPDFPro(apu,totals,company); if(isFree) markApuUsed(); };
  const exportExcel=()=>{ if(isFree && userUsage.apusCreated>=1){ alert('La exportacion ilimitada requiere plan activo.'); return; } exportAPUExcel(apu,totals,company); if(isFree) markApuUsed(); };

  return <section><PageHead kicker="APU Inteligente" title="Análisis de Precio Unitario" desc="Metodología RLOPSRM: salario real con FSR, herramienta menor sobre mano de obra, indirectos de campo y oficina, financiamiento, utilidad y cargos adicionales." action={<div className="head-actions"><button className="secondary" onClick={generate}>Generar desarrollo</button><button className="ai-btn" onClick={()=>setAiOpen(o=>!o)}><Icon name="apu" size={17}/> Generar con IA</button></div>} />
    {isFree && <div className="trial-banner"><b>Plan gratis activo:</b> tienes {Math.max(0,1-(userUsage.apusCreated||0))} APU disponible. Para exportar y crear mas APUs activa un plan.</div>}
    {aiOpen && <div className="panel ai-panel">
      <div className="ai-panel-head"><HardHat size={36}/><div><b>Generar con IA</b><small className="muted">Pega tu concepto y/o importa tu Excel de precios. Usaré tus precios reales donde coincidan los insumos.</small></div></div>
      <textarea className="ai-concept" value={concept} onChange={e=>setConcept(e.target.value)} placeholder="Pega aquí el concepto, ej. Muro de tabique rojo recocido asentado con mortero…"/>
      <div className="ai-panel-foot">
        <label className="up-btn ghost-up">Importar catálogo de precios<input type="file" accept=".xlsx,.csv" hidden onChange={e=>importExcel(e.target.files[0])}/></label>
        <label className="up-btn">Generar desde Excel completo<input type="file" accept=".xlsx,.csv" hidden onChange={e=>importFullExcel(e.target.files[0])}/></label>
        <label className="up-btn ghost-up">Subir cat?logo de conceptos<input type="file" accept=".xlsx,.csv" hidden onChange={e=>importConceptCatalog(e.target.files[0])}/></label>
        {catalog.length>0 && <span className="cat-badge"><Icon name="presupuestos" size={14}/> Catálogo: {catalog.length} insumos</span>}
        <button onClick={generateAI}>Generar APU con IA real</button>
        {conceptBatch?.concepts?.length>0 && <button onClick={exportConceptBatch}>Descargar Excel: {conceptBatch.concepts.length} hojas APU</button>}
        {conceptBatch?.concepts?.length>0 && <button onClick={exportConceptBatchPDF}>Descargar PDF: {conceptBatch.concepts.length} APUs</button>}
      </div>
      {aiStatus && <div className="ai-note"><b>{aiStatus}</b></div>}
      {excelInfo && <div className="excel-preview">
        <div><small>Archivo</small><b>{excelInfo.fileName}</b></div>
        <div><small>Concepto detectado</small><b>{excelInfo.concept}</b></div>
        <div><small>Unidad / cantidad</small><b>{excelInfo.unit} · {num(excelInfo.qty)}</b></div>
        <div><small>P.U. referencia</small><b>{excelInfo.referencePU ? money(excelInfo.referencePU) : 'No detectado'}</b></div>
      </div>}
      <div className="ai-note">El desarrollo se arma con tus precios importados + plantillas de metodología. La generación 100% automática (IA leyendo todo tu catálogo) se activa con Firebase AI Logic.</div>
    </div>}
    <div className="apu-grid">
      <div className="panel">
        <label>Concepto</label>
        <textarea value={concept} onChange={e=>setConcept(e.target.value)} />
        <div className="inline-tools">
          <label className="up-btn ghost-up">Subir Excel completo<input type="file" accept=".xlsx,.csv" hidden onChange={e=>importFullExcel(e.target.files[0])}/></label>
          <button className="soft" onClick={generate}>Actualizar desarrollo</button>
          <button className="soft" onClick={generateAI}>IA real</button>
          {apu.referencePU>0 && <span className="cat-badge">P.U. Excel: {money(apu.referencePU)}</span>}
          {conceptBatch?.concepts?.length>0 && <button className="soft" onClick={exportConceptBatch}>Excel por concepto ({conceptBatch.concepts.length})</button>}
          {conceptBatch?.concepts?.length>0 && <button className="soft" onClick={exportConceptBatchPDF}>PDF por concepto ({conceptBatch.concepts.length})</button>}
        </div>
        <div className="apu-detect">
          <div><small>Familia detectada</small><b>{apu.family || 'APU general'}</b></div>
          <div><small>Confianza IA</small><b>{apu.confidence || 88}%</b></div>
          <div><small>Clave SAT sugerida</small><b>{apu.sat || '72100000'}</b></div>
        </div>
        {apu.aiNotes?.length>0 && <div className="ai-decisions">{apu.aiNotes.map((n,i)=><span key={i}>{n}</span>)}</div>}
        <div className="form-row"><input value={apu.clave} onChange={e=>setApu({...apu,clave:e.target.value})} placeholder="Clave"/><input value={apu.unit} onChange={e=>setApu({...apu,unit:e.target.value})} placeholder="Unidad"/></div>

        <h2>Materiales <small className="hint">(incluye merma % puesto en obra)</small></h2>
        <MatrixTable kind="materials" rows={apu.materials} updateRow={updateRow} removeRow={removeRow}/>
        <button className="soft" onClick={()=>addRow('materials')}>+ Material</button>

        <h2>Mano de obra <small className="hint">(salario real = base × FSR · Art. 191)</small></h2>
        <MatrixTable kind="labor" rows={apu.labor} updateRow={updateRow} removeRow={removeRow}/>
        <button className="soft" onClick={()=>addRow('labor')}>+ Oficio</button>

        <h2>Equipo / maquinaria <small className="hint">(costo horario × cantidad)</small></h2>
        <MatrixTable kind="equipment" rows={apu.equipment} updateRow={updateRow} removeRow={removeRow}/>
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
          <button onClick={exportPDF}>Descargar PDF con formato</button>
          {conceptBatch?.concepts?.length>0 && <button onClick={exportConceptBatchPDF}>PDF por concepto ({conceptBatch.concepts.length})</button>}
          <button onClick={exportExcel}>Descargar Excel</button>
        </div>
      </div>
    </div>

    {apus.length>0 && <div className="panel" style={{marginTop:16}}>
      <h2>Mis APU guardados <small className="hint">({apus.length})</small></h2>
      <div className="saved-grid">{apus.map(a=>{const tt=calcAPU(a);return <div className="saved-card" key={a.id}>
        <div className="sc-clave">{a.clave} · {a.unit} · {a.date}</div>
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

function MatrixTable({kind,rows,updateRow,removeRow}){
  const headers = kind==='materials'
    ? ['Descripción','Cant.','Unidad','P. base','Merma %','Importe','']
    : kind==='labor'
    ? ['Descripción','Jornadas','Unidad','Salario base','FSR','Importe','']
    : ['Descripción','Cant.','Unidad','Costo horario','Importe',''];
  const editIdx = kind==='equipment' ? [0,1,2,3] : [0,1,2,3,4];
  return <table className="data-table apu-table">
    <thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((r,i)=><tr key={i}>
      {editIdx.map(k=><td key={k}><input value={r[k]} onChange={e=>updateRow(kind,i,k,e.target.value)} /></td>)}
      <td className="imp">{money(rowImporte(kind,r))}</td>
      <td className="del"><button className="row-del" title="Eliminar" onClick={()=>removeRow(kind,i)}>×</button></td>
    </tr>)}</tbody>
  </table>
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
  if(!/^(m2|mÂ²|m²|m3|mÂ³|m³|kg|pza|pieza|pzas|ml|m|l|lt|lote|jgo|hr|hora|dia|dÃ­a|día|jor|jornal)$/i.test(unit)) return false;
  if(/^(total|subtotal|gran total)\b/.test(concept)) return false;
  if(/\b(total partida|total zona|total area|total capitulo|subtotal partida|gran total)\b/.test(concept)) return false;
  return true;
}

function exportConceptsAPUPDF(concepts, catalog, company){
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
    const apuBase = makeAPUFromConcept(item.concept, catalog);
    const apu = {
      ...apuBase,
      clave: item.code || apuBase.clave,
      unit: item.unit || apuBase.unit,
      sourceQty: item.qty,
      referencePU: item.referencePU
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

    doc.setFont('helvetica','normal');
    doc.setFontSize(7.3);
    doc.setTextColor(120);
    doc.text(`Concepto ${index+1} de ${list.length} | Generado por ZOEMEC IA`, M, H-8);
    doc.text(`Pagina ${doc.internal.getNumberOfPages()}`, W-M, H-8, {align:'right'});
  });
  doc.save('APU-POR-CONCEPTO-ZOEMEC.pdf');
}

function exportAPUPDF(apu, totals, company){
  const doc = new jsPDF(); let y=16;
  doc.setFontSize(16); doc.text(company.name || 'ZOEMEC', 14, y); doc.setFontSize(10); doc.text(company.address || 'México', 14, y+6); doc.text(company.email || '', 14, y+12);
  doc.setFontSize(13); doc.text('CÉDULA DE ANÁLISIS DE PRECIO UNITARIO', 14, y+24); y += 34;
  doc.setFontSize(9); doc.text(`Clave: ${apu.clave}`,14,y); doc.text(`Unidad: ${apu.unit}`,75,y); doc.text(`Fecha: ${apu.date}`,140,y); y+=7;
  doc.text(`Familia: ${apu.family || 'APU general'}`,14,y); doc.text(`SAT: ${apu.sat || '72100000'}`,120,y); doc.text(`Confianza IA: ${apu.confidence || 88}%`,158,y); y+=7;
  doc.text(`Concepto: ${apu.concept}`,14,y,{maxWidth:182}); y+=14;
  const head=(t)=>{doc.setFillColor(6,55,59); doc.setTextColor(255); doc.rect(14,y,182,7,'F'); doc.text(t,16,y+5); doc.setTextColor(20); y+=11;};
  const code=(prefix,i)=>`${prefix}-${String(i+1).padStart(3,'0')}`;
  const line=(codeText,cols)=>{doc.text(codeText,16,y); doc.text(String(cols[0]).slice(0,40),34,y); doc.text(String(cols[1]),98,y,{align:'right'}); doc.text(String(cols[2]),106,y); doc.text(money(cols[3]),150,y,{align:'right'}); doc.text(money(cols[4]),190,y,{align:'right'}); y+=6; if(y>268){doc.addPage(); y=18;}};
  head('MATERIALES'); apu.materials.forEach((r,i)=>line(code('MAT',i),[r[0]+(Number(r[4])?` (+${r[4]}% merma)`:''),r[1],r[2],r[3],rowImporte('materials',r)]));
  y+=2; head('MANO DE OBRA  (salario real = base x FSR)'); apu.labor.forEach((r,i)=>line(code('MO',i),[`${r[0]}  FSR ${r[4]}`,r[1],r[2],Number(r[3])*Number(r[4]),rowImporte('labor',r)]));
  y+=2; head('EQUIPO / MAQUINARIA'); apu.equipment.forEach((r,i)=>line(code('EQ',i),[r[0],r[1],r[2],r[3],rowImporte('equipment',r)]));
  y+=4; doc.setFontSize(10);
  const tot=(l,v,bold)=>{ if(bold){doc.setFont(undefined,'bold');} doc.text(l,110,y); doc.text(money(v),190,y,{align:'right'}); if(bold){doc.setFont(undefined,'normal');} y+=7; if(y>270){doc.addPage(); y=18;} };
  tot(`Herramienta menor (${apu.herramienta}% M.O.)`, totals.herramienta);
  tot('Costo directo', totals.direct, true);
  tot(`Indirectos (campo ${apu.indCampo}% + oficina ${apu.indOficina}%)`, totals.indirect);
  tot(`Financiamiento (${apu.finance}%)`, totals.finance);
  tot(`Utilidad (${apu.utility}%)`, totals.utility);
  tot(`Cargos adicionales (${apu.cargos}%)`, totals.cargos);
  tot('PRECIO UNITARIO (sin IVA)', totals.pu, true);
  tot(`IVA ${apu.iva}% (informativo)`, totals.iva);
  y+=4; doc.setFontSize(8); doc.text('Generado por ZOEMEC IA · Versión 2.0 · Revisión técnica editable por el usuario',14,286);
  doc.save(`${apu.clave}-APU-ZOEMEC.pdf`);
}

function buildCompleteAPUSheet(apu, totals, company, audit){
  const rows = [];
  const widths = [13,48,12,12,14,12,30,16,24];
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

  add(span(company.name || 'ZOEMEC', XLS.title));
  add(span('CEDULA DE ANALISIS DE PRECIO UNITARIO', XLS.subtitle));
  add([xcell('Clave', XLS.label), apu.clave, xcell('Unidad', XLS.label), apu.unit, xcell('Fecha', XLS.label), apu.date, xcell('Confianza IA', XLS.label), `${apu.confidence || 88}%`]);
  add([xcell('Familia', XLS.label), apu.family || 'APU general', xcell('Clave SAT', XLS.label), apu.sat || '72100000', xcell('Cantidad base', XLS.label), Number(apu.sourceQty || 1) || 1, xcell('P.U. referencia', XLS.label), Number(apu.referencePU || 0) || 0]);
  add(span('CONCEPTO ANALIZADO', XLS.label));
  add([xcell(apu.concept, {...XLS.note, columnSpan:widths.length}), ...Array(widths.length-1).fill(null)]);
  add([]);

  section('MATERIALES');
  header();
  const matStart = rows.length + 1;
  audit.materials.forEach(r => {
    const n = rows.length + 1;
    add([r.code,r.desc,r.unit,r.qty,r.base,r.factor,xcell(`=D${n}*E${n}*(1+F${n}/100)`, XLS.formula),moneyFormula(`=D${n}*E${n}*(1+F${n}/100)`),r.source]);
  });
  const matEnd = rows.length;
  const matTotalRow = add([null,xcell('SUBTOTAL MATERIALES', XLS.total),null,null,null,null,null,moneyFormula(`=SUM(H${matStart}:H${matEnd})`),null]);
  add([]);

  section('MANO DE OBRA  (salario real = salario base x FSR)');
  header();
  const laborStart = rows.length + 1;
  audit.labor.forEach(r => {
    const n = rows.length + 1;
    add([r.code,r.desc,r.unit,r.qty,r.base,r.factor,xcell(`=D${n}*E${n}*F${n}`, XLS.formula),moneyFormula(`=D${n}*E${n}*F${n}`),r.source]);
  });
  const laborEnd = rows.length;
  const laborTotalRow = add([null,xcell('SUBTOTAL MANO DE OBRA', XLS.total),null,null,null,null,null,moneyFormula(`=SUM(H${laborStart}:H${laborEnd})`),null]);
  add([]);

  section('EQUIPO / MAQUINARIA');
  header();
  const eqStart = rows.length + 1;
  audit.equipment.forEach(r => {
    const n = rows.length + 1;
    add([r.code,r.desc,r.unit,r.qty,r.base,null,xcell(`=D${n}*E${n}`, XLS.formula),moneyFormula(`=D${n}*E${n}`),r.source]);
  });
  const eqEnd = rows.length;
  const eqTotalRow = add([null,xcell('SUBTOTAL EQUIPO', XLS.total),null,null,null,null,null,moneyFormula(`=SUM(H${eqStart}:H${eqEnd})`),null]);
  add([]);

  section('INTEGRACION DEL PRECIO UNITARIO');
  const hmRow = add([null,'Herramienta menor',null,null,`${apu.herramienta}% M.O.`,null,null,moneyFormula(`=H${laborTotalRow}*${Number(apu.herramienta || 0)}/100`),null]);
  const directRow = add([null,xcell('COSTO DIRECTO', XLS.total),null,null,null,null,xcell('Materiales + Mano de obra + Equipo + Herramienta', XLS.formula),moneyFormula(`=H${matTotalRow}+H${laborTotalRow}+H${eqTotalRow}+H${hmRow}`),null]);
  const indirectRow = add([null,'Indirectos',null,null,`${apu.indCampo}% campo + ${apu.indOficina}% oficina`,null,null,moneyFormula(`=H${directRow}*${Number(apu.indCampo || 0)+Number(apu.indOficina || 0)}/100`),null]);
  const financeRow = add([null,'Financiamiento',null,null,`${apu.finance}%`,null,null,moneyFormula(`=(H${directRow}+H${indirectRow})*${Number(apu.finance || 0)}/100`),null]);
  const utilityRow = add([null,'Utilidad',null,null,`${apu.utility}%`,null,null,moneyFormula(`=(H${directRow}+H${indirectRow}+H${financeRow})*${Number(apu.utility || 0)}/100`),null]);
  const chargesRow = add([null,'Cargos adicionales',null,null,`${apu.cargos}%`,null,null,moneyFormula(`=(H${directRow}+H${indirectRow}+H${financeRow}+H${utilityRow})*${Number(apu.cargos || 0)}/100`),null]);
  const puRow = add([null,xcell('PRECIO UNITARIO SIN IVA', XLS.grand),null,null,null,null,null,fcell(`=SUM(H${directRow}:H${chargesRow})`, XLS.grand),null]);
  add([null,'IVA informativo',null,null,`${apu.iva}%`,null,null,moneyFormula(`=H${puRow}*${Number(apu.iva || 0)}/100`),null]);
  add([]);

  section('ANALISIS DE CUADRILLAS Y FSR');
  add(styleHeader(['Oficio','Jornadas','Unidad','Salario base','FSR','Salario real','Importe','','']));
  audit.labor.forEach(r => add([r.desc,r.qty,r.unit,r.base,r.factor,fcell(`=D${rows.length+1}*E${rows.length+1}`, XLS.money),fcell(`=B${rows.length+1}*D${rows.length+1}*E${rows.length+1}`, XLS.money),null,null]));
  add([]);

  section('EXPLOSION DE INSUMOS DEL CONCEPTO');
  add(styleHeader(['Codigo','Descripcion','Unidad','Cantidad por unidad','Cantidad concepto','P.U.','Importe','Fuente','']));
  audit.explosion.forEach(r => add([r.code,r.desc,r.unit,r.qtyUnit,r.qtyTotal,r.pu,r.importeTotal,r.source,null]));
  add([]);
  add([xcell('Notas de auditoria', XLS.label), xcell('Las celdas de importe contienen formulas visibles. Cada cantidad, merma, FSR y sobrecosto puede revisarse y editarse.', {...XLS.note, columnSpan:8}), ...Array(7).fill(null)]);
  return { sheet:`APU-${apu.clave}`.slice(0,31), rows, widths, stickyRowsCount:9 };
}

function exportAPUExcel(apu, totals, company){
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
  exportWorkbookExcel(sheets, `${apu.clave}-APU-AUDITABLE-ZOEMEC.xlsx`).catch(()=>alert('No pude generar el Excel. Inténtalo de nuevo.'));
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
    [xcell('CATALOGO DE CONCEPTOS', XLS.title), null, null, null, null, null],
    [xcell('El cliente puede subir el Excel completo. Esta hoja conserva el listado base y las hojas siguientes desarrollan un APU por concepto.', {...XLS.note, columnSpan:6}), null, null, null, null, null],
    [],
    styleHeader(['No.','Clave','Concepto','Unidad','Cantidad','P.U. referencia','Importe referencia'])
  ];
  concepts.forEach((item, index) => {
    const row = rows.length + 1;
    rows.push([
      index + 1,
      item.code || `CON-${String(index+1).padStart(3,'0')}`,
      item.concept,
      item.unit || 'u',
      Number(item.qty || 1) || 1,
      Number(item.referencePU || 0) || 0,
      item.importe ? Number(item.importe) : fcell(`=E${row}*F${row}`, XLS.money)
    ]);
  });
  rows.push([]);
  rows.push([null,null,null,null,xcell('TOTAL REFERENCIA', XLS.grand), null, fcell(`=SUM(G5:G${rows.length-1})`, XLS.grand)]);
  return { sheet:'CATALOGO', rows, widths:[10,16,72,12,14,18,18], stickyRowsCount:4 };
}
function exportConceptsAPUWorkbook(concepts, catalog, company){
  const used = new Set();
  const limited = concepts.filter(isExportableConceptItem);
  const sheets = [buildConceptCatalogSheet(limited), ...limited.map((item, idx) => {
    const base = makeAPUFromConcept(item.concept, catalog);
    const apu = {
      ...base,
      clave: String(item.code || base.clave || `APU-${idx+1}`).slice(0,24),
      concept: item.concept,
      unit: item.unit || base.unit,
      sourceQty: Number(item.qty || 1) || 1,
      referencePU: Number(item.referencePU || 0) || 0,
      sourceFile: 'Catalogo de conceptos'
    };
    const totals = calcAPU(apu);
    const audit = buildAuditModel(apu, totals);
    const sheet = buildCompleteAPUSheet(apu, totals, company, audit);
    sheet.sheet = uniqueSheetName(apu.clave || `APU-${idx+1}`, used);
    return sheet;
  })];
  if(!sheets.length){
    alert('No hay conceptos para exportar.');
    return;
  }
  exportWorkbookExcel(sheets, `APU-POR-CONCEPTO-ZOEMEC.xlsx`).catch(()=>alert('No pude generar el Excel por conceptos. Inténtalo de nuevo.'));
}

function Budgets({company,budgets,setBudgets}){
  const [items,setItems]=useState([{concept:'Muro de block 15 cm',unit:'m²',qty:120,pu:825.39},{concept:'Piso cerámico 30x30 cm',unit:'m²',qty:86,pu:384.51}]);
  const total=items.reduce((a,i)=>a+Number(i.qty)*Number(i.pu),0), iva=total*.16;
  const update=(i,k,v)=>setItems(items.map((r,idx)=>idx===i?{...r,[k]:v}:r));
  const save=()=>{setBudgets([{id:'PRE-'+uid(),name:'Presupuesto ejecutivo',client:'Cliente por definir',items,total:total+iva,date:new Date().toLocaleDateString('es-MX')},...budgets]); alert('Presupuesto guardado');};
  return <section><PageHead kicker="Presupuestos" title="Presupuesto profesional" desc="Captura conceptos con su precio unitario (sin IVA), calcula totales con IVA y exporta con membrete." action={<button onClick={save}>Guardar presupuesto</button>} />
    <div className="panel"><table className="budget-table"><thead><tr><th>Concepto</th><th>Unidad</th><th>Cantidad</th><th>P.U. (sin IVA)</th><th>Importe</th></tr></thead><tbody>{items.map((it,i)=><tr key={i}><td><input value={it.concept} onChange={e=>update(i,'concept',e.target.value)}/></td><td><input value={it.unit} onChange={e=>update(i,'unit',e.target.value)}/></td><td><input type="number" value={it.qty} onChange={e=>update(i,'qty',e.target.value)}/></td><td><input type="number" value={it.pu} onChange={e=>update(i,'pu',e.target.value)}/></td><td>{money(it.qty*it.pu)}</td></tr>)}</tbody></table><button className="soft" onClick={()=>setItems([...items,{concept:'Nuevo concepto',unit:'m²',qty:1,pu:0}])}>+ Agregar concepto</button><div className="totals"><Cost label="Subtotal" v={total}/><Cost label="IVA 16%" v={iva}/><div className="grand"><span>Total</span><b>{money(total+iva)}</b></div></div><div className="export-row"><button onClick={()=>exportBudgetExcel(items,total,iva)}>Exportar Excel</button><button onClick={()=>exportBudgetPDF(items,total,iva,company)}>Exportar PDF</button></div></div>
  </section>
}
function exportBudgetExcel(items,total,iva){const rows=[['PRESUPUESTO'],['Concepto','Unidad','Cantidad','P.U. (sin IVA)','Importe'],...items.map(i=>[i.concept,i.unit,i.qty,i.pu,Number(i.qty)*Number(i.pu)]),[],['Subtotal',total],['IVA 16%',iva],['Total',total+iva]];exportRowsExcel(rows,'Presupuesto-ZOEMEC.xlsx').catch(()=>alert('No pude generar el Excel. Inténtalo de nuevo.'));}
function exportBudgetPDF(items,total,iva,company){const doc=new jsPDF();let y=16;doc.setFontSize(16);doc.text(company.name||'ZOEMEC',14,y);doc.setFontSize(13);doc.text('PRESUPUESTO EJECUTIVO',14,y+14);y+=28;items.forEach(i=>{doc.text(i.concept,14,y,{maxWidth:100});doc.text(i.unit,118,y);doc.text(String(i.qty),135,y);doc.text(money(i.pu),152,y);doc.text(money(i.qty*i.pu),174,y);y+=10;if(y>270){doc.addPage();y=18;}});y+=6;doc.text('Subtotal',130,y);doc.text(money(total),170,y);y+=8;doc.text('IVA 16%',130,y);doc.text(money(iva),170,y);y+=8;doc.text('Total',130,y);doc.text(money(total+iva),170,y);doc.save('Presupuesto-ZOEMEC.pdf');}

function Projects({projects,setProjects}){
  const list = projects || sampleProjects;
  const add = () => setProjects([{name:'Nuevo proyecto', client:'Cliente por definir', progress:0, budget:0, status:'Anteproyecto'}, ...list]);
  const update = (i,k,v) => setProjects(list.map((p,idx)=>idx===i?{...p,[k]:v}:p));
  const remove = (i) => setProjects(list.filter((_,idx)=>idx!==i));
  return <section><PageHead kicker="Proyectos" title="Control de obra y proyectos" desc="Vista ejecutiva de obras, avance, presupuesto, cliente y estado." action={<button onClick={add}>+ Nuevo proyecto</button>} />
    <div className="cards-3">{list.map((p,i)=><div className="project-card" key={i}>
      <span>{p.status}</span>
      <h2><input value={p.name} onChange={e=>update(i,'name',e.target.value)} style={{fontFamily:'var(--display)',fontWeight:700,border:0,padding:0,background:'transparent'}}/></h2>
      <p><input value={p.client} onChange={e=>update(i,'client',e.target.value)} style={{border:0,padding:0,background:'transparent',color:'var(--muted)'}}/></p>
      <b>{money(p.budget)}</b>
      <progress value={p.progress} max="100"/>
      <small>{p.progress}% de avance · <a onClick={()=>remove(i)} style={{color:'var(--danger)'}}>eliminar</a></small>
    </div>)}</div></section>
}
function Clients({clients,setClients}){const [q,setQ]=useState('');const filtered=clients.filter(c=>c.name.toLowerCase().includes(q.toLowerCase()));return <section><PageHead kicker="CRM de obra" title="Clientes" desc="Cartera profesional con proyectos, presupuestos, contactos, RFC e historial." action={<button onClick={()=>setClients([{id:'CLI-'+uid(),name:'Nuevo cliente',type:'Empresa',contact:'Contacto',phone:'',email:'',rfc:'',projects:0,budgets:0,amount:0,status:'Prospecto'},...clients])}>+ Nuevo cliente</button>} /><div className="panel"><input className="search" placeholder="Buscar cliente..." value={q} onChange={e=>setQ(e.target.value)}/><div className="client-grid">{filtered.map(c=><div className="client-card" key={c.id}><div className="client-avatar">{c.name[0]}</div><div><h2>{c.name}</h2><p>{c.type} · {c.contact}</p><small>RFC: {c.rfc}</small><div className="client-stats"><span>{c.projects} proyectos</span><span>{c.budgets} presupuestos</span><b>{money(c.amount)}</b></div></div><em>{c.status}</em></div>)}</div></div></section>}

function Library({user}){
  const [files,setFiles]=useLocalState('zoemec-biblioteca',[]);
  const [q,setQ]=useState('');
  const [type,setType]=useState('Todos');
  const [selected,setSelected]=useState(null);
  const classify=(name='')=>{
    const n=name.toLowerCase();
    if(/matriz|matrices|precio unitario|analisis|apu/.test(n)) return 'Matrices APU';
    if(/rendimiento|mano de obra|mo |destajo|cuadrilla/.test(n)) return 'Mano de obra';
    if(/base|precio|costo|catalogo|cat[a?]logo|opus|neodata/.test(n)) return 'Costos';
    if(/norma|sct|cfe|conagua|reglamento|ntc/.test(n)) return 'Normas';
    if(/formato|generador|estimacion|presupuesto|plantilla/.test(n)) return 'Formatos';
    if(/curso|video|capacitacion/.test(n)) return 'Academia';
    return 'Documentos';
  };
  const add=(fl)=>{ if(!fl||!fl.length) return; const arr=[...fl].map(f=>({name:f.name,size:(f.size/1048576).toFixed(2)+' MB',ext:(f.name.split('.').pop()||'').toUpperCase(),when:new Date().toLocaleDateString('es-MX'),cat:classify(f.name),status:'Indexado',uses:0})); setFiles([...arr,...files]); setSelected(arr[0]); };
  const del=(i)=>setFiles(files.filter((_,idx)=>idx!==i));
  const types=['Todos','Costos','Matrices APU','Mano de obra','Normas','Formatos','Academia','Documentos'];
  const visible=files.filter(f=>(type==='Todos'||(f.cat||classify(f.name))===type) && f.name.toLowerCase().includes(q.toLowerCase()));
  const totalMb=files.reduce((a,f)=>a+(parseFloat(f.size)||0),0);
  const counts=types.slice(1).map(t=>[t,files.filter(f=>(f.cat||classify(f.name))===t).length]);
  const active=selected || visible[0] || files[0];
  const suggestions=['muro block 15','loseta porcelanato','rendimiento albanil','PTR lavabo','tablaroca durock','indirectos oficina'];
  if(!canUse(user,'library')){
    return <section><PageHead kicker="Biblioteca ZOEMEC" title="Centro inteligente de costos" desc="La biblioteca tecnica es una funcion premium porque permite consultar bases, matrices, documentos y fuentes para IA." />
      <div className="locked-panel panel"><Icon name="biblioteca" size={42}/><div><h2>Biblioteca bloqueada para plan gratis</h2><p>Tu cuenta gratis incluye 1 APU. Para subir bases, indexar documentos, consultar matrices y usar la biblioteca como fuente de IA necesitas plan Inicial, Profesional o Empresa.</p><button onClick={()=>alert('Aqui se conectara Stripe o Mercado Pago para activar el plan automaticamente.')}>Activar plan</button></div></div>
      <div className="library-grid">{[['Inicial','Biblioteca limitada y 10 APUs/mes','Para probar'],['Profesional','Biblioteca completa, IA y exportaciones','Recomendado'],['Empresa','Usuarios, permisos y biblioteca privada','Equipos']].map(f=><div className="folder" key={f[0]}><b>{f[0]}</b><p>{f[1]}</p><span>{f[2]}</span></div>)}</div>
    </section>;
  }
  return <section><PageHead kicker="Biblioteca ZOEMEC" title="Centro inteligente de costos" desc="Sube bases, matrices, rendimientos, normas y formatos. ZOEMEC los clasifica para busqueda tecnica e IA." />
    <div className="library-dashboard"><div className="lib-stat"><small>Documentos</small><b>{files.length}</b><span>{totalMb.toFixed(2)} MB cargados</span></div><div className="lib-stat"><small>Fuentes utiles</small><b>{counts.filter(x=>x[1]>0).length}</b><span>Clasificacion automatica</span></div><div className="lib-stat"><small>Motor IA</small><b>Indice</b><span>Listo para busqueda semantica</span></div></div>
    <div className="lib-up panel"><div className="lib-up-drop pro"><Icon name="biblioteca" size={30}/><div><b>Subida masiva inteligente</b><small className="muted">Excel, PDF, Word, ZIP y video. ZOEMEC detecta familia, tipo, fuente y uso para APU.</small></div><label className="up-btn">Subir archivos<input type="file" multiple onChange={e=>add(e.target.files)} hidden/></label></div><div className="lib-searchbar"><input className="search" placeholder="Buscar: muro block, loseta, rendimiento, matriz, norma..." value={q} onChange={e=>setQ(e.target.value)}/><button onClick={()=>alert('La busqueda con IA usara un indice tecnico de tus documentos al conectar Storage + base vectorial.')}>Buscar con IA</button></div><div className="lib-suggestions">{suggestions.map(s=><button key={s} onClick={()=>setQ(s)}>{s}</button>)}</div><div className="lib-toolbar"><div className="lib-tabs">{types.map(t=><button key={t} className={type===t?'active':''} onClick={()=>setType(t)}>{t}</button>)}</div></div>
      <div className="lib-layout pro"><aside className="lib-folders">{counts.map(([name,count])=><button key={name} onClick={()=>setType(name)} className={type===name?'active':''}><Icon name="folder" size={15}/><span>{name}</span><b>{count}</b></button>)}</aside><div className="lib-list">{visible.length ? visible.map((f)=>{ const i=files.indexOf(f); return <div className={'lib-file '+(active===f?'active':'')} key={i} onClick={()=>setSelected(f)}><span className="lib-ext">{f.ext||'DOC'}</span><div className="lib-meta"><b>{f.name}</b><small>{f.cat||classify(f.name)} - {f.size} - {f.when}</small></div><div className="lib-actions"><button className="soft" onClick={(e)=>{e.stopPropagation();setSelected(f)}}>Ver</button><button className="row-del" onClick={(e)=>{e.stopPropagation();del(i)}}>x</button></div></div>}) : <div className="lib-empty">No hay documentos con ese filtro.</div>}</div><aside className="lib-preview"><small>Vista tecnica</small><h2>{active?.name || 'Sin archivo seleccionado'}</h2><p>{active ? (active.cat || classify(active.name))+' - '+(active.ext || 'DOC')+' - '+active.size : 'Sube documentos para crear una base consultable.'}</p><div className="lib-ai-card"><b>Acciones IA</b><button>Usar para generar APU</button><button>Buscar matrices similares</button><button>Extraer insumos</button><button>Crear indice</button></div><div className="lib-trace"><span>Estado</span><b>{active?.status || 'Pendiente'}</b><span>Permiso</span><b>Plan Profesional</b></div></aside></div></div>
    <div className="panel"><h2>Flujo recomendado</h2><div className="library-grid">{[['1. Sube tus bases','Excel de precios, matrices, rendimientos y normas','Carga masiva'],['2. ZOEMEC indexa','Clasifica por familia, unidad, fuente y uso tecnico','IA + metadatos'],['3. Genera APU','La IA usa tus fuentes como evidencia, no solo texto inventado','Trazabilidad'],['4. Audita y exporta','Excel con formulas, PDF por concepto y presupuesto','Profesional']].map(f=><div className="folder" key={f[0]}><b><Icon name="folder" size={17}/> {f[0]}</b><p>{f[1]}</p><span>{f[2]}</span></div>)}</div></div>
  </section>
}

/* Centro Técnico: calculadora de block + calculadora de FSR real (Art. 191 RLOPSRM) */
/* ---------- Calculadoras del Centro Técnico ---------- */
function NField({label,value,on,step}){return <div className="nf"><label>{label}</label><input type="number" step={step||'any'} value={value} onChange={e=>on(e.target.value)}/></div>;}
function ORow({label,val,total}){return <div className={"o"+(total?" total":"")}><span>{label}</span><b>{val}</b></div>;}
function CalcCard({icon,title,sub,children,out}){
  return <div className="panel calc">
    <div className="calc-head"><span className="ci"><Icon name={icon} size={20}/></span><div><h2>{title}</h2>{sub && <small className="muted">{sub}</small>}</div></div>
    {children}
    <div className="calc-out">{out}</div>
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
    out={<><ORow label="Volumen en banco" val={n2(banco)+' m³'}/><ORow label={`Vol. suelto (+${n2(s.abund)}%)`} val={n2(suelto)+' m³'}/><ORow label="Costo mano de obra" val={money(cost)} total/></>}>
    <div className="calc-row"><NField label="Largo (m)" value={s.l} on={v=>set('l',v)}/><NField label="Ancho (m)" value={s.a} on={v=>set('a',v)}/><NField label="Profundidad (m)" value={s.prof} on={v=>set('prof',v)}/></div>
    <div className="calc-row"><NField label="Abundamiento (%)" value={s.abund} on={v=>set('abund',v)}/><NField label="Precio M.O. ($/m³)" value={s.precio} on={v=>set('precio',v)}/></div>
  </CalcCard>;
}

function FSRCalc(){
  const [s,setS]=useState({tp:365,tl:250,ps:0.27});
  const set=(k,v)=>setS({...s,[k]:v});
  const tp=+s.tp||0, tl=+s.tl||1, ps=+s.ps||0;
  const fsr=(ps*(tp/tl))+(tp/tl);
  return <CalcCard icon="fsr" title="Factor de Salario Real" sub="Art. 191 RLOPSRM · Fsr = Ps·(Tp/Tl) + (Tp/Tl)"
    out={<><ORow label="Relación pagado/laborado" val={(tp/tl).toFixed(4)}/><ORow label="FSR" val={fsr.toFixed(4)} total/></>}>
    <div className="calc-row"><NField label="Tp — días pagados/año" value={s.tp} on={v=>set('tp',v)}/><NField label="Tl — días laborados/año" value={s.tl} on={v=>set('tl',v)}/></div>
    <NField label="Ps — obligaciones obrero-patronales (fracción)" value={s.ps} on={v=>set('ps',v)} step="0.01"/>
    <small className="muted">Úsalo en la columna FSR del APU.</small>
  </CalcCard>;
}

function TechnicalCenter(){
  return <section><PageHead kicker="Centro Técnico" title="Calculadoras de obra" desc="Cuantifica y costea al instante. Todas las cantidades, rendimientos y precios son editables a tu criterio." />
    <div className="calc-wrap">
      <ConcreteCalc/><SteelCalc/><BlockCalc/><PaintCalc/><WaterproofCalc/><ExcavationCalc/><FSRCalc/>
    </div></section>;
}

function Office({company,setCompany,catalog,setCatalog}){
  const uploadLogo=(file)=>{if(!file)return;const r=new FileReader();r.onload=()=>setCompany({...company,logo:r.result});r.readAsDataURL(file)};
  const importExcel=async(file)=>{ if(!file) return; if(/\.xls$/i.test(file.name)){alert('Guarda el archivo como .xlsx o .csv para importarlo.');return;} try{ const cat=await parseExcelToCatalog(file); if(!cat.length){alert('No detecté columnas de descripción y precio. Revisa los encabezados del Excel.');return;} setCatalog(cat); alert(`Catálogo importado: ${cat.length} insumos. El APU usará estos precios al generar.`);}catch(err){ alert(`No pude leer el archivo: ${err?.message || 'formato no compatible'}. Usa .xlsx o .csv.`); } };
  return <section><PageHead kicker="Oficina Técnica" title="Empresa, logo y formatos" desc="Configura membretes, datos fiscales, firmas, plantillas y tu Excel de precios." /><div className="grid-2"><div className="panel form"><label>Logo</label><img className="logo-preview" src={company.logo}/><input type="file" accept="image/*" onChange={e=>uploadLogo(e.target.files[0])}/><label>Empresa</label><input value={company.name} onChange={e=>setCompany({...company,name:e.target.value})}/><label>RFC</label><input value={company.rfc} onChange={e=>setCompany({...company,rfc:e.target.value})}/><label>Teléfono</label><input value={company.phone} onChange={e=>setCompany({...company,phone:e.target.value})}/><label>Correo</label><input value={company.email} onChange={e=>setCompany({...company,email:e.target.value})}/></div><div className="panel"><h2>Plantillas</h2>{['Formato ZOEMEC','Formato gobierno','Formato CFE','Formato CONAGUA','Formato personalizado'].map(x=><div className="activity" key={x}><Icon name="doc" size={16}/> {x}</div>)}<h2>Mi Excel de precios</h2><label className="up-btn ghost-up" style={{display:'inline-block',marginTop:4}}>Importar catálogo (.xlsx/.csv)<input type="file" accept=".xlsx,.csv" hidden onChange={e=>importExcel(e.target.files[0])}/></label>{catalog&&catalog.length>0 && <p className="muted" style={{marginTop:10}}>✓ Catálogo cargado: <b>{catalog.length}</b> insumos. Se usan al generar APUs por coincidencia de nombre.</p>}<p className="muted">Detecto columnas de descripción, unidad y precio automáticamente.</p></div></div></section>}

function Community(){
  const [posts,setPosts]=useLocalState('zoemec-foro',[{q:'Que rendimiento usan para muro de block 15 cm?',who:'Laura S.',when:'hace 2 h',likes:7,cat:'Tecnico',status:'Resuelto',replies:['Yo manejo 0.35 jor de albanil por m2.','Depende del tipo de junta, pero ronda eso.']},{q:'Proveedor de acero en zona centro',who:'Diany',when:'hace 5 h',likes:3,cat:'Proveedores',status:'Abierto',replies:[]},{q:'Formato de generadores para obra publica',who:'Carlos M.',when:'ayer',likes:5,cat:'Formatos',status:'Con archivo',replies:['Te paso el mio en Excel.']},{q:'Comparativo OPUS vs NEODATA',who:'Ing. Perez',when:'hace 2 dias',likes:12,cat:'Software',status:'Debate',replies:[]}]);
  const [q,setQ]=useState(''); const [search,setSearch]=useState(''); const [cat,setCat]=useState('Tecnico'); const [filter,setFilter]=useState('Todos'); const [openReply,setOpenReply]=useState(-1); const [reply,setReply]=useState('');
  const cats=['Todos','Tecnico','Proveedores','Formatos','Software','Obra publica'];
  const visible=(filter==='Todos'?posts:posts.filter(p=>(p.cat||'Tecnico')===filter)).filter(p=>p.q.toLowerCase().includes(search.toLowerCase()) || (p.replies||[]).join(' ').toLowerCase().includes(search.toLowerCase()));
  const publish=()=>{ if(!q.trim()) return; setPosts([{q:q.trim(),who:'Diany',when:'ahora',likes:0,cat,status:'Abierto',replies:[]},...posts]); setQ(''); setFilter(cat); };
  const like=(i)=>setPosts(posts.map((p,idx)=>idx===i?{...p,likes:p.likes+1}:p));
  const addReply=(i)=>{ if(!reply.trim())return; setPosts(posts.map((p,idx)=>idx===i?{...p,replies:[...p.replies,reply.trim()],status:'Activo'}:p)); setReply(''); setOpenReply(-1); };
  return <section><PageHead kicker="Comunidad ZOEMEC" title="Red profesional de obra" desc="Resuelve dudas tecnicas, encuentra proveedores y comparte formatos con trazabilidad por usuario." />
    <div className="community-layout"><main><div className="community-hero"><div><small>Actividad</small><b>{posts.length}</b><span>hilos activos</span></div><div><small>Respuestas</small><b>{posts.reduce((a,p)=>a+p.replies.length,0)}</b><span>aportes tecnicos</span></div><div><small>Valorados</small><b>{posts.reduce((a,p)=>a+p.likes,0)}</b><span>votos utiles</span></div></div><div className="panel forum-new pro"><textarea placeholder="Pregunta algo tecnico: rendimiento, proveedor, formato, precio, software..." value={q} onChange={e=>setQ(e.target.value)} /><div className="forum-new-foot"><select value={cat} onChange={e=>setCat(e.target.value)}>{cats.filter(x=>x!=='Todos').map(x=><option key={x}>{x}</option>)}</select><span className="muted">Modo real: guardado por usuario, moderacion y permisos por plan.</span><button onClick={publish}>Publicar</button></div></div><div className="forum-tools"><div className="forum-tabs">{cats.map(x=><button key={x} className={filter===x?'active':''} onClick={()=>setFilter(x)}>{x}</button>)}</div><input className="search" placeholder="Buscar en el foro..." value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="panel forum-list pro">{visible.map((p)=>{ const i=posts.indexOf(p); return <div className="forum-item" key={i}><div className="forum-row"><div className="forum-q"><span className="forum-av">{p.who[0]}</span><div><div className="forum-tags"><em>{p.cat || 'Tecnico'}</em><strong>{p.status || 'Abierto'}</strong></div><b>{p.q}</b><small>{p.who} - {p.when}</small></div></div><div className="forum-acts"><button className="chip" onClick={()=>like(i)}>? {p.likes}</button><button className="chip" onClick={()=>setOpenReply(openReply===i?-1:i)}><Icon name="comunidad" size={14}/> {p.replies.length}</button></div></div>{p.replies.length>0 && <div className="forum-replies">{p.replies.map((r,ri)=><div className="forum-reply" key={ri}>{r}</div>)}</div>}{openReply===i && <div className="forum-replybox"><input value={reply} onChange={e=>setReply(e.target.value)} placeholder="Escribe una respuesta..." onKeyDown={e=>e.key==='Enter'&&addReply(i)}/><button onClick={()=>addReply(i)}>Responder</button></div>}</div>})}</div></main><aside className="community-side"><div className="panel"><h2>Temas calientes</h2>{['Rendimientos MO','Matrices APU','Proveedores','Obra publica'].map((x,i)=><div className="trend" key={x}><span>#{i+1}</span><b>{x}</b><small>{12-i*2} conversaciones</small></div>)}</div><div className="panel"><h2>Reglas de calidad</h2><p className="muted">Pregunta con concepto, unidad, zona y condicion de obra. Las mejores respuestas alimentan la biblioteca tecnica.</p></div></aside></div>
  </section>
}


function Academy(){
  const [list,setList]=useLocalState('zoemec-cursos', courses.map(c=>({t:c[0],d:c[1],p:c[2],link:''})));
  const [t,setT]=useState(''); const [d,setD]=useState(''); const [link,setLink]=useState('');
  const add=()=>{ if(!t.trim()) return; setList([{t:t.trim(),d:d.trim()||'Curso nuevo',p:0,link:link.trim()},...list]); setT(''); setD(''); setLink(''); };
  const del=(i)=>setList(list.filter((_,idx)=>idx!==i));
  const avg=Math.round(list.reduce((a,c)=>a+(Number(c.p)||0),0)/(list.length||1));
  return <section><PageHead kicker="Academia ZOEMEC" title="Centro de capacitacion" desc="Cursos para dominar precios unitarios, presupuestos, matrices, reportes e IA aplicada a construccion." /><div className="academy-hero panel"><div><small>Ruta recomendada</small><h2>De capturista a analista tecnico</h2><p>Aprende APU, FSR, catalogos, matrices, presupuesto y exportacion profesional.</p></div><div className="academy-meter"><b>{avg}%</b><span>avance promedio</span></div></div><div className="academy-path">{['APU base','FSR y cuadrillas','Matrices e insumos','Presupuesto','IA y auditoria'].map((x,i)=><div key={x} className={i<2?'done':''}><span>{i+1}</span><b>{x}</b></div>)}</div><div className="panel course-new pro"><div className="cn-fields"><div className="nf"><label>Titulo del curso</label><input value={t} onChange={e=>setT(e.target.value)} placeholder="Ej. Estimaciones y generadores"/></div><div className="nf"><label>Descripcion</label><input value={d} onChange={e=>setD(e.target.value)} placeholder="Que aprenderan"/></div></div><div className="nf"><label>Link del video</label><input value={link} onChange={e=>setLink(e.target.value)} placeholder="https://..."/></div><div className="cn-foot"><label className="up-btn ghost-up">Subir video<input type="file" accept="video/*" hidden onChange={()=>alert('La subida y alojamiento de video se habilita con Storage. Mientras tanto, pega el link del video.')}/></label><button onClick={add}>Crear curso</button></div></div><div className="cards-3 academy-grid">{list.map((c,i)=><div className="course-card pro" key={i}><div className="thumb"><button className="thumb-play" onClick={()=>c.link ? window.open(c.link,'_blank') : alert('Agrega un link o sube video para reproducirlo.')}><Icon name="play" size={30}/></button></div><div className="cc-body"><small className="course-pill">Modulo {i+1}</small><h2>{c.t}</h2><p>{c.d}</p>{c.link && <a className="cc-link" href={c.link} target="_blank" rel="noreferrer">Ver video</a>}<progress value={c.p} max="100"/><div className="cc-foot"><input type="range" min="0" max="100" value={c.p} onChange={e=>setList(list.map((x,idx)=>idx===i?{...x,p:+e.target.value}:x))}/><small>{c.p}%</small></div><a className="cc-del" onClick={()=>del(i)}>Eliminar</a></div></div>)}</div></section>
}

function PlansAccess(){
  const plans = [
    {name:'Inicial', price:'$399/mes', note:'Para probar la plataforma', items:['10 APUs al mes', 'PDF básico con marca ZOEMEC', 'Biblioteca de consulta limitada', 'Sin IA real masiva']},
    {name:'Profesional', price:'$899/mes', note:'Para oficina técnica activa', featured:true, items:['APUs con IA y Excel auditable', 'PDF y Excel con membrete', 'Biblioteca técnica completa', 'Presupuestos y reportes']},
    {name:'Empresa', price:'$1,899/mes', note:'Para equipos y constructoras', items:['Usuarios por rol', 'Matriz, FSR, cuadrillas y explosiones', 'Carga masiva de catálogos', 'Soporte y configuración']},
    {name:'Admin', price:'Interno', note:'Control ZOEMEC', items:['Alta de usuarios', 'Control de planes', 'Biblioteca global', 'Moderación de foro']}
  ];
  const features = [
    ['APU inteligente', '10/mes', 'Ilimitado razonable', 'Equipo completo'],
    ['Excel auditable', 'Basico', 'Completo', 'Completo + plantillas'],
    ['Biblioteca técnica', 'Lectura limitada', 'Completa', 'Completa + privada'],
    ['Foro y comunidad', 'Lectura', 'Publicar y responder', 'Moderación interna'],
    ['IA real', 'No incluida', 'Incluida con límites', 'Mayor límite mensual'],
    ['Usuarios', '1', '1', '5+']
  ];
  const production = [
    ['Autenticación', 'Firebase Auth con correo, Google y roles por usuario.'],
    ['Base de datos', 'Firestore para APUs, presupuestos, biblioteca, foro, planes y permisos.'],
    ['Archivos', 'Firebase Storage o Vercel Blob para Excel, PDF, cursos y documentos pesados.'],
    ['Cobro', 'Stripe o Mercado Pago con webhooks para activar plan automáticamente.'],
    ['IA segura', 'Endpoint serverless en Vercel; la OPENAI_API_KEY nunca va en el navegador.'],
    ['Control de uso', 'Contadores mensuales por plan: APUs, tokens IA, descargas y usuarios.']
  ];
  return <section><PageHead kicker="Planes y acceso" title="Modelo de cobro y permisos" desc="Define qué puede usar cada cliente y qué piezas faltan conectar para publicar ZOEMEC en producción." />
    <div className="plans-grid">{plans.map(p=><div className={p.featured?'plan-card featured':'plan-card'} key={p.name}>
      <span>{p.name}</span><h2>{p.price}</h2><p>{p.note}</p>
      <ul>{p.items.map(x=><li key={x}>{x}</li>)}</ul>
      <button>{p.featured?'Plan recomendado':'Configurar'}</button>
    </div>)}</div>
    <div className="panel plan-matrix"><h2>Accesos por plan</h2><table><thead><tr><th>Función</th><th>Inicial</th><th>Profesional</th><th>Empresa</th></tr></thead><tbody>{features.map(r=><tr key={r[0]}>{r.map((c,i)=><td key={i}>{c}</td>)}</tr>)}</tbody></table></div>
    <div className="prod-grid">{production.map(([t,d])=><div className="prod-step" key={t}><b>{t}</b><p>{d}</p><small>Pendiente de conectar para producción real</small></div>)}</div>
  </section>
}


function Reports({clients,apus,budgets}){
  const total=budgets.reduce((a,b)=>a+(b.total||0),0);
  const segs=[{label:'Edificacion',value:42,color:'#9D6FD0'},{label:'Obra publica',value:33,color:'#2A1740'},{label:'Remodelacion',value:15,color:'#C7A35C'},{label:'Otros',value:10,color:'#B8A4CC'}];
  const bars=[['Presupuestos enviados',78,'#9D6FD0'],['APU creados',64,'#2A1740'],['Clientes nuevos',42,'#C7A35C'],['Proyectos cerrados',36,'#B8A4CC']];
  const alerts=['3 presupuestos sin seguimiento','12 APUs generados esta semana','Biblioteca lista para indexar IA','Meta comercial al 78%'];
  return <section><PageHead kicker="Reportes" title="Tablero ejecutivo" desc="Ventas, presupuestos, clientes, APUs, avances, utilidad y rendimiento de la oficina." action={<button>Exportar reporte</button>} /><div className="report-hero"><div><small>Venta potencial</small><b>{money(total||18450240)}</b><span>acumulado</span></div><div><small>Pipeline</small><b>37%</b><span>tasa de cierre</span></div><div><small>Productividad</small><b>{apus.length||24}</b><span>APU generados</span></div><div><small>Clientes</small><b>{clients.length}</b><span>activos</span></div></div><div className="dash-charts report-grid"><div className="panel"><h2>Cotizacion mensual</h2><Spark points={[7.2,8.1,7.6,9.4,10.1,11.8,12.4,14.9]} h={110}/><div className="chart-foot"><span>Miles de pesos - 8 meses</span><b>+22% acumulado</b></div></div><div className="panel chart-donut"><h2>Cartera por tipo de obra</h2><Donut segments={segs} center="100%" sub="cartera"/><div className="donut-legend">{segs.map(s=><span key={s.label}><i style={{background:s.color}}/>{s.label} <b>{s.value}%</b></span>)}</div></div></div><div className="report-bottom"><div className="panel"><h2>Resumen mensual</h2>{bars.map(([label,val,color])=><div className="bar-row" key={label}><span>{label}</span><i><b style={{width:val+'%',background:color}}></b></i><em className="bar-val">{val}%</em></div>)}</div><div className="panel"><h2>Alertas ejecutivas</h2>{alerts.map(a=><div className="activity" key={a}><Icon name="bell" size={15}/> {a}</div>)}</div></div></section>
}

createRoot(document.getElementById('root')).render(<App />);
