/* Panel de administracion: resumen, usuarios, biblioteca global, config de
   la plataforma, servicios externos (Google Drive/OneDrive), IA (costos y
   logs de Visual IA) y diagnostico de variables de entorno. Combina lectura
   directa de Firestore (coleccion completa, sin filtrar por usuario, solo
   accesible para isAdminUser) con las funciones serverless /api/health,
   /api/status, /api/onedrive y /api/google-drive. */
import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { authHeaders, apiPost, apiGetSafe } from '../../services/apiClient.js';
import { friendlyServiceError } from '../../services/errorMessages.js';
import { ADMIN_EMAILS, isAdminUser } from '../../domain/permissions.js';
import { isOneDriveConfigured } from '../../lib/onedrive.js';
import { Icon } from '../../components/ui/Icon.jsx';
import { PageHead, EmptyState } from '../../components/ui/PageElements.jsx';
import { Donut, Spark } from '../../components/ui/charts.jsx';

const AI_COST_ESTIMATE = { apu:0.02, visual:0.09, assistant:0.006 };

export function AdminPanel({user}){
  const [tab,setTab]=useState('resumen');
  const [users,setUsers]=useState(null);
  const [usersErr,setUsersErr]=useState('');
  const [library,setLibrary]=useState(null);
  const [libraryErr,setLibraryErr]=useState('');
  const [config,setConfig]=useState(null);
  const [health,setHealth]=useState(null);
  const [logs,setLogs]=useState(null);
  const [logsErr,setLogsErr]=useState('');
  const [oneDriveAdmin,setOneDriveAdmin]=useState(null);
  const [platformStatus,setPlatformStatus]=useState(null);
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
    setLibrary(null); setLibraryErr('');
    try{ const snap=await getDocs(collection(db,'library')); setLibrary(snap.docs.map(d=>({id:d.id,...d.data()}))); }
    catch(err){ setLibraryErr(friendlyServiceError(err,'No se pudo leer la biblioteca (permisos, indice o red).')); setLibrary([]); }
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
  const loadLogs=async()=>{
    setLogs(null); setLogsErr('');
    try{
      const snap=await getDocs(query(collection(db,'visual_requests'), orderBy('createdAt','desc'), limit(50)));
      setLogs(snap.docs.map(d=>({id:d.id,...d.data()})));
    }catch(err){ setLogsErr(friendlyServiceError(err,'No se pudieron leer los registros de Visual IA.')); setLogs([]); }
  };
  const loadOneDriveAdmin=async()=>{
    setOneDriveAdmin(null);
    try{ const data=await apiPost('/api/onedrive',{action:'status'}); setOneDriveAdmin(data); }
    catch(err){ setOneDriveAdmin({error:friendlyServiceError(err,'No se pudo consultar OneDrive.')}); }
  };
  const [odTest,setOdTest]=useState(null);
  const [odTesting,setOdTesting]=useState(false);
  const testOneDriveConnection=async()=>{
    setOdTesting(true); setOdTest(null);
    try{
      const data=await apiPost('/api/onedrive',{action:'listRoot'});
      setOdTest({ ok:true, count:(data.items||[]).length });
    }catch(err){ setOdTest({ ok:false, message:friendlyServiceError(err,'No se pudo probar la conexion.') }); }
    finally{ setOdTesting(false); }
  };
  const [gdTest,setGdTest]=useState(null);
  const [gdTesting,setGdTesting]=useState(false);
  const testGoogleDriveConnection=async()=>{
    setGdTesting(true); setGdTest(null);
    try{
      const data=await apiPost('/api/google-drive',{action:'list'});
      setGdTest({ ok:true, count:(data.items||[]).length });
    }catch(err){ setGdTest({ ok:false, message:friendlyServiceError(err,'No se pudo probar la conexion.') }); }
    finally{ setGdTesting(false); }
  };

  useEffect(()=>{ loadUsers(); },[]);
  useEffect(()=>{
    if(tab==='biblioteca' && library===null) loadLibrary();
    if(tab==='config' && config===null) loadConfig();
    if(tab==='servicios'){
      if(health===null) loadHealth();
      if(oneDriveAdmin===null) loadOneDriveAdmin();
      if(library===null) loadLibrary();
      if(platformStatus===null) apiGetSafe('/api/status').then(setPlatformStatus);
    }
    if(tab==='ia' && logs===null) loadLogs();
    if(tab==='resumen'){
      if(library===null) loadLibrary();
      if(logs===null) loadLogs();
    }
    if(tab==='diagnostico'){
      if(health===null) loadHealth();
      if(oneDriveAdmin===null) loadOneDriveAdmin();
      if(platformStatus===null) apiGetSafe('/api/status').then(setPlatformStatus);
    }
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

  const tabs=[['resumen','Resumen'],['usuarios','Usuarios'],['servicios','Servicios'],['biblioteca','Biblioteca'],['ia','IA y consumo'],['config','Configuración'],['diagnostico','Diagnóstico']];
  const Busy=()=><div className="ai-note-busy"><span className="asst-dots"><i/><i/><i/></span><b>Cargando datos reales de Firestore...</b></div>;
  const usageTotals=(users||[]).reduce((acc,u)=>{
    Object.values(u.usage||{}).forEach(monthUsage=>{
      Object.entries(monthUsage||{}).forEach(([feature,count])=>{ acc[feature]=(acc[feature]||0)+Number(count||0); });
    });
    return acc;
  },{});

  return <section>
    <PageHead kicker="Panel Admin" title="Administración de la plataforma" desc="Resumen ejecutivo, usuarios, servicios (Firebase, OpenAI, OneDrive), biblioteca, IA y consumo, configuración y diagnóstico, con datos reales de Firestore." />
    <div className="admin-tabs">{tabs.map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}</div>

    {tab==='resumen' && (()=>{
      const totalUsers=users?.length||0;
      const activeUsers=(users||[]).filter(u=>u.active!==false).length;
      const plans=['Gratis','Inicial','Profesional','Empresa'];
      const palette=['#B8A4CC','#9D6FD0','#6F3FA7','#2A1740'];
      const segs=plans.map((p,i)=>({label:p,value:(users||[]).filter(u=>(u.role==='admin'?'Empresa':(u.plan||'Gratis'))===p).length,color:palette[i]})).filter(s=>s.value>0);
      const totalCalls=(usageTotals.apu||0)+(usageTotals.visual||0)+(usageTotals.assistant||0);
      const planCounts=plans.map(p=>({plan:p,count:(users||[]).filter(u=>(u.plan||'Gratis')===p).length,active:(users||[]).filter(u=>(u.plan||'Gratis')===p && u.active!==false).length}));
      const groups={};
      (users||[]).forEach(u=>{ const k=u.companyName||'Sin nombre de empresa'; (groups[k]=groups[k]||[]).push(u); });
      const companyRows=Object.entries(groups).sort((a,b)=>b[1].length-a[1].length);
      return <div className="panel admin-panel-body">
        <div className="admin-panel-head"><h2>Resumen ejecutivo</h2><button className="soft" onClick={loadUsers}>Actualizar</button></div>
        {users===null ? <Busy/> : <>
          <div className="kpi-row">
            <div className="kpi-tile"><small>Usuarios</small><b>{totalUsers}</b><span>{activeUsers} activos</span></div>
            <div className="kpi-tile"><small>Documentos en Biblioteca</small><b>{library!==null ? library.length : '…'}</b><span>Firestore · colección library</span></div>
            <div className="kpi-tile"><small>Peticiones Visual IA</small><b>{logs!==null ? logs.length : '…'}</b><span>últimas registradas</span></div>
            <div className="kpi-tile"><small>Llamadas IA totales (mes)</small><b>{totalCalls}</b><span>APU + Visual IA + asistente</span></div>
          </div>
          <div className="dash-charts">
            <div className="panel"><h2>Distribución de planes</h2>{segs.length ? <Donut segments={segs} center={totalUsers} sub="usuarios"/> : <EmptyState text="Sin usuarios con plan asignado."/>}
              <div className="donut-legend">{segs.map(s=><span key={s.label}><i style={{background:s.color}}/>{s.label} <b>{s.value}</b></span>)}</div>
            </div>
            <div className="panel"><h2>Uso de IA por función</h2><Spark points={[usageTotals.apu||0,usageTotals.visual||0,usageTotals.assistant||0,totalCalls]}/>
              <div className="chart-foot"><span>APU {usageTotals.apu||0} · Visual {usageTotals.visual||0} · Asistente {usageTotals.assistant||0}</span><b>Mes en curso</b></div>
            </div>
          </div>
          <div className="admin-panel-head" style={{marginTop:'6px'}}><h2 style={{fontSize:'.95rem'}}>Planes y licencias</h2></div>
          <div className="admin-plan-grid">{planCounts.map(c=><div className="admin-plan-card" key={c.plan}><b>{c.plan}</b><span className="admin-plan-count">{c.count}</span><small>{c.active} activos</small></div>)}</div>
          <div className="admin-panel-head" style={{marginTop:'14px'}}><h2 style={{fontSize:'.95rem'}}>Empresas <small className="hint">({companyRows.length})</small></h2></div>
          {!companyRows.length ? <EmptyState icon="oficina" title="Sin organizaciones aún" text="El nombre de empresa se registra cuando un usuario lo captura en Oficina técnica."/> :
          <div className="admin-table-wrap"><table className="data-table admin-table">
            <thead><tr><th>Empresa</th><th>Usuarios</th><th>Planes</th></tr></thead>
            <tbody>{companyRows.map(([name,us])=><tr key={name}><td>{name}</td><td>{us.length}</td><td>{[...new Set(us.map(u=>u.plan||'Gratis'))].join(', ')}</td></tr>)}</tbody>
          </table></div>}
        </>}
      </div>;
    })()}

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

    {tab==='biblioteca' && <div className="panel admin-panel-body">
      <div className="admin-panel-head"><h2>Biblioteca <small className="hint">({library?.length ?? '…'})</small></h2><button className="soft" onClick={loadLibrary}>Actualizar</button></div>
      {library===null ? <Busy/> :
       libraryErr ? <EmptyState icon="admin" title="No se pudo cargar" text={libraryErr}/> :
       !library.length ? <EmptyState icon="biblioteca" title="Sin documentos en Firestore" text="Los documentos que los usuarios suben a la Biblioteca aparecerán aquí."/> :
      <div className="admin-table-wrap"><table className="data-table admin-table">
        <thead><tr><th>Documento</th><th>Categoría</th><th>Visibilidad</th><th>Propietario</th><th>Tamaño</th></tr></thead>
        <tbody>{library.map(f=><tr key={f.id}><td>{f.name||'—'}</td><td>{f.cat||'—'}</td><td>{f.visibility||'private'}</td><td className="admin-uid">{f.ownerUid?String(f.ownerUid).slice(0,8):'—'}</td><td>{f.size||'—'}</td></tr>)}</tbody>
      </table></div>}
    </div>}

    {tab==='ia' && (()=>{
      const month=(()=>{ const n=new Date(); return `${n.getUTCFullYear()}-${String(n.getUTCMonth()+1).padStart(2,'0')}`; })();
      const rows=(users||[]).map(u=>{
        const cur=u.usage?.[month]||{};
        return { id:u.id, name:u.name||u.email||'—', plan:u.role==='admin'?'Empresa':(u.plan||'Gratis'),
          apu:Number(cur.apu||0), visual:Number(cur.visual||0), assistant:Number(cur.assistant||0),
          last:u.lastAiUseAt?.toDate ? u.lastAiUseAt.toDate().toLocaleString('es-MX') : '—' };
      }).filter(r=>r.apu||r.visual||r.assistant).sort((a,b)=>(b.apu+b.visual+b.assistant)-(a.apu+a.visual+a.assistant));
      const estimated=(usageTotals.apu||0)*AI_COST_ESTIMATE.apu + (usageTotals.visual||0)*AI_COST_ESTIMATE.visual + (usageTotals.assistant||0)*AI_COST_ESTIMATE.assistant;
      return <div className="panel admin-panel-body">
        <div className="admin-panel-head"><h2>IA y consumo</h2><button className="soft" onClick={()=>{loadUsers();loadLogs();}}>Actualizar</button></div>
        {users===null ? <Busy/> : <>
          <div className="admin-cost-grid">
            <div className="admin-cost-card"><small>Llamadas APU (mes)</small><b>{usageTotals.apu||0}</b></div>
            <div className="admin-cost-card"><small>Llamadas Visual IA (mes)</small><b>{usageTotals.visual||0}</b></div>
            <div className="admin-cost-card"><small>Llamadas asistente (mes)</small><b>{usageTotals.assistant||0}</b></div>
            <div className="admin-cost-card"><small>Costo estimado (USD)</small><b>${estimated.toFixed(2)}</b></div>
          </div>
          <div className="admin-metric-note">Este costo es una <b>estimación orientativa</b> calculada con precios de referencia por llamada (APU ${AI_COST_ESTIMATE.apu}, Visual IA ${AI_COST_ESTIMATE.visual}, asistente ${AI_COST_ESTIMATE.assistant}), no es la facturación real de OpenAI. Para el gasto exacto se requiere conectar la API de facturación de OpenAI (ver pestaña Diagnóstico).</div>

          <div className="admin-panel-head" style={{marginTop:'16px'}}><h2 style={{fontSize:'.95rem'}}>Uso por usuario <small className="hint">mes {month}</small></h2></div>
          {!rows.length ? <EmptyState icon="apu" title="Sin uso de IA este mes" text="Cuando los usuarios generen APUs, usen Visual IA o al asistente, el consumo aparecerá aquí (contador real por usuario en Firestore)."/> :
          <div className="admin-table-wrap"><table className="data-table admin-table">
            <thead><tr><th>Usuario</th><th>Plan</th><th>APU</th><th>Visual IA</th><th>Asistente</th><th>Último uso</th></tr></thead>
            <tbody>{rows.map(r=><tr key={r.id}><td>{r.name}</td><td>{r.plan}</td><td>{r.apu}</td><td>{r.visual}</td><td>{r.assistant}</td><td>{r.last}</td></tr>)}</tbody>
          </table></div>}

          <div className="admin-panel-head" style={{marginTop:'16px'}}><h2 style={{fontSize:'.95rem'}}>Logs de Visual IA <small className="hint">últimos {logs?.length ?? '…'}</small></h2></div>
          {logs===null ? <Busy/> :
           logsErr ? <EmptyState icon="admin" title="No se pudo cargar" text={logsErr}/> :
           !logs.length ? <EmptyState icon="tecnico" title="Sin registros todavía" text="Cada solicitud de Visual IA queda registrada en Firestore (colección visual_requests) con usuario, modo y resultado."/> :
           <div className="admin-log-list">{logs.map(l=><div className="admin-log-row" key={l.id}>
             <span>{l.createdAt?.toDate ? l.createdAt.toDate().toLocaleString('es-MX') : '—'}</span>
             <b>{l.email || l.uid || 'Usuario'} · {l.fileName || 'sin archivo'}</b>
             <span>{l.mode || '—'}</span>
             <span>{l.imageGenerated ? 'Render generado' : (l.imageError ? 'Solo análisis (sin render)' : 'Solo texto')}</span>
           </div>)}</div>}
        </>}
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

    {tab==='servicios' && (()=>{
      const connectedUsers=(users||[]).filter(u=>u.oneDrive?.refreshToken).length;
      const onedriveDocs=(library||[]).filter(f=>f.source==='onedrive').length;
      const gdriveDocs=(library||[]).filter(f=>f.source==='google-drive').length;
      const envVars=[
        ['VITE_ONEDRIVE_CLIENT_ID (cliente)', isOneDriveConfigured()],
        ['ONEDRIVE_CLIENT_ID (servidor)', Boolean(oneDriveAdmin?.env?.ONEDRIVE_CLIENT_ID)],
        ['ONEDRIVE_CLIENT_SECRET (servidor)', Boolean(oneDriveAdmin?.env?.ONEDRIVE_CLIENT_SECRET)],
        ['ONEDRIVE_TENANT_ID (servidor, opcional)', Boolean(oneDriveAdmin?.env?.ONEDRIVE_TENANT_ID)]
      ];
      const missingVars=envVars.filter(([,present])=>!present);
      const gdriveConfigured=Boolean(platformStatus?.googleDriveConfigured);
      return <div className="panel admin-panel-body">
        <div className="admin-panel-head"><h2>Servicios</h2><button className="soft" onClick={()=>{loadHealth();loadOneDriveAdmin();}}>Actualizar</button></div>
        <div className="admin-panel-head" style={{marginTop:0}}><h2 style={{fontSize:'.95rem'}}>Firebase y OpenAI</h2></div>
        {health===null ? <Busy/> :
         health.error ? <EmptyState icon="admin" title="No se pudo consultar" text={health.error}/> :
         <div className="admin-health-grid">{Object.entries(health.checks||{}).map(([key,c])=><div className={'admin-health-card '+c.status} key={key}>
           <b>{c.label||key}</b>
           <span className="admin-health-status">{c.status==='ok'?'Operativo':c.status==='error'?'Con errores':'No disponible'}</span>
           <p>{c.detail}</p>
         </div>)}</div>}

        <div className="admin-panel-head" style={{marginTop:'16px'}}><h2 style={{fontSize:'.95rem'}}>Google Drive</h2></div>
        <div className="admin-cost-grid">
          <div className="admin-cost-card"><small>Configurado en el servidor</small><b>{gdriveConfigured ? 'Sí' : 'No'}</b></div>
          <div className="admin-cost-card"><small>Documentos importados de Drive</small><b>{library===null ? '…' : gdriveDocs}</b></div>
        </div>
        {!gdriveConfigured && <div className="od-config-warning"><Icon name="alerta" size={18}/><div>Faltan variables de servidor: <b>GOOGLE_DRIVE_CLIENT_ID</b>, <b>GOOGLE_DRIVE_CLIENT_SECRET</b>, <b>GOOGLE_DRIVE_REFRESH_TOKEN</b> y <b>GOOGLE_DRIVE_FOLDER_ID</b> en Vercel. Este detalle solo es visible aquí; los usuarios ven "Google Drive no configurado" sin más detalle técnico.</div></div>}
        <div className="visual-actions"><button className="soft" onClick={testGoogleDriveConnection} disabled={gdTesting}>{gdTesting?'Probando...':'Probar conexión'}</button></div>
        {gdTest && (gdTest.ok
          ? <div className="admin-metric-note">Conexión correcta: se encontraron {gdTest.count} elemento(s) en la carpeta raíz de Google Drive (respuesta sanitizada, sin nombres de archivo).</div>
          : <EmptyState icon="admin" title="La prueba de conexión falló" text={gdTest.message}/>)}

        <div className="admin-panel-head" style={{marginTop:'16px'}}><h2 style={{fontSize:'.95rem'}}>OneDrive</h2></div>
        {oneDriveAdmin===null ? <Busy/> :
         oneDriveAdmin.error ? <EmptyState icon="admin" title="No se pudo consultar" text={oneDriveAdmin.error}/> : <>
          <div className="admin-cost-grid">
            <div className="admin-cost-card"><small>Configurado en el servidor</small><b>{oneDriveAdmin.configured ? 'Sí' : 'No'}</b></div>
            <div className="admin-cost-card"><small>Tu cuenta admin</small><b>{oneDriveAdmin.connected ? 'Conectada' : 'No conectada'}</b></div>
            <div className="admin-cost-card"><small>Usuarios con OneDrive conectado</small><b>{connectedUsers}</b></div>
            <div className="admin-cost-card"><small>Documentos importados de OneDrive</small><b>{library===null ? '…' : onedriveDocs}</b></div>
            <div className="admin-cost-card"><small>Última sincronización (tu cuenta)</small><b>{oneDriveAdmin.connectedAt?.toDate ? oneDriveAdmin.connectedAt.toDate().toLocaleString('es-MX') : (oneDriveAdmin.connectedAt || '—')}</b></div>
          </div>
          <div className="admin-table-wrap"><table className="data-table admin-table">
            <thead><tr><th>Variable</th><th>Estado</th></tr></thead>
            <tbody>{envVars.map(([name,present])=><tr key={name}><td>{name}</td><td>{present ? 'Detectada' : 'Faltante'}</td></tr>)}</tbody>
          </table></div>
          {missingVars.length > 0 && <div className="od-config-warning"><Icon name="alerta" size={18}/><div>Faltan {missingVars.length} variable(s) para activar OneDrive por completo: {missingVars.map(([name])=>name).join(', ')}. Este detalle solo es visible aquí; los usuarios ven "Biblioteca local disponible".</div></div>}
          <div className="visual-actions"><button className="soft" onClick={testOneDriveConnection} disabled={odTesting || !oneDriveAdmin.connected}>{odTesting?'Probando...':'Probar conexión'}</button></div>
          {!oneDriveAdmin.connected && <p className="muted">Conecta tu cuenta de OneDrive (desde Biblioteca o el indicador de nube) para poder probar la conexión real con Microsoft Graph.</p>}
          {odTest && (odTest.ok
            ? <div className="admin-metric-note">Conexión correcta: se encontraron {odTest.count} archivo(s)/carpeta(s) en la raíz de OneDrive (respuesta sanitizada, sin nombres de archivo).</div>
            : <EmptyState icon="admin" title="La prueba de conexión falló" text={odTest.message}/>)}
        </>}
      </div>;
    })()}

    {tab==='diagnostico' && (()=>{
      const envRows=[
        ['Firebase Storage/Firestore', health?.checks?.firebase?.status==='ok'],
        ['OpenAI (OPENAI_API_KEY)', health?.checks?.openai?.status==='ok'],
        ['Google Drive (CLIENT_ID/SECRET/REFRESH_TOKEN)', Boolean(platformStatus?.googleDriveConfigured)],
        ['OneDrive cliente (VITE_ONEDRIVE_CLIENT_ID)', isOneDriveConfigured()],
        ['OneDrive servidor (ONEDRIVE_CLIENT_ID/SECRET)', Boolean(oneDriveAdmin?.env?.ONEDRIVE_CLIENT_ID && oneDriveAdmin?.env?.ONEDRIVE_CLIENT_SECRET)],
        ['Lista de administradores (VITE_ADMIN_EMAILS)', ADMIN_EMAILS.length > 0]
      ];
      return <div className="panel admin-panel-body">
        <div className="admin-panel-head"><h2>Diagnóstico</h2><button className="soft" onClick={()=>{loadHealth();loadOneDriveAdmin();}}>Actualizar</button></div>
        <div className="admin-panel-head" style={{marginTop:0}}><h2 style={{fontSize:'.95rem'}}>Tu sesión</h2></div>
        <div className="admin-cost-grid">
          <div className="admin-cost-card"><small>Correo detectado</small><b>{user?.email || '—'}</b></div>
          <div className="admin-cost-card"><small>Rol detectado</small><b>{user?.role || 'user'}</b></div>
          <div className="admin-cost-card"><small>isAdmin</small><b>{user?.isAdmin ? 'true' : 'false'}</b></div>
          <div className="admin-cost-card"><small>Plan</small><b>{user?.plan || '—'}</b></div>
        </div>
        <div className="admin-metric-note">isAdmin se calcula con isAdminUser(): rol normalizado (admin/administrator/administrador/superadmin), custom claim de Firebase (admin===true) o correo en VITE_ADMIN_EMAILS. En desarrollo, este mismo detalle se imprime en la consola del navegador al iniciar sesión.</div>

        <div className="admin-panel-head" style={{marginTop:'16px'}}><h2 style={{fontSize:'.95rem'}}>Variables y servicios detectados</h2></div>
        <div className="admin-table-wrap"><table className="data-table admin-table">
          <thead><tr><th>Servicio / variable</th><th>Estado</th></tr></thead>
          <tbody>{envRows.map(([name,ok])=><tr key={name}><td>{name}</td><td>{ok ? 'Detectado' : 'Faltante o sin confirmar'}</td></tr>)}</tbody>
        </table></div>
        <div className="admin-metric-note">Ninguna fila muestra el valor real de una variable, solo si esta presente. Para el detalle de cada servicio revisa la pestaña Servicios.</div>
      </div>;
    })()}
  </section>;
}
