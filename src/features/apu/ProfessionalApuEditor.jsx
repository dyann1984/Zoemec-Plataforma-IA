import React,{useMemo,useState} from 'react';
import {finalizeProfessionalAPU,validateAPU,makePriceRecord,PRICE_SOURCE_TYPE,isStructurallyEmptyApu} from '../../domain/apuProfessional.js';
import {auditChange,createApuVersion,restoreApuVersion,comparePrice,applyConfirmedPriceChanges} from '../../domain/apuVersioning.js';
import {apuDataStateLabel,APU_DATA_STATE} from '../../domain/apuSchema.js';
import {money,num} from '../../lib/apuExport.js';
import {scopedKey} from '../../utils/scopedStorage.js';
import {Technical3DViewer} from '../visual3d/Technical3DViewer.jsx';
import {ZoemecIntelligencePanel} from './ZoemecIntelligencePanel.jsx';
import {apiPost,apiGetSafe} from '../../services/apiClient.js';
import {exportApuAuditDossierPdf} from '../../lib/apuDossierPdf.js';
import {exportApuAuditDossierExcel} from '../../lib/apuDossierXlsx.js';

const N=new Set(['cantidadObra','tipoCambio','cantidad','consumo','desperdicioPct','precioUnitario','cuadrilla','rendimiento','jornada','salarioBase','fsr','tarifa','valorAdquisicion','depreciacionPct','vidaUtil','factorUso','factorImputable']);
const SPEC={labor:[['clave','Clave'],['descripcion','Descripción'],['unidad','Unidad'],['cuadrilla','Cuadrilla'],['rendimiento','Rendimiento'],['jornada','Jornada'],['salarioBase','Salario'],['fsr','FSR']],materials:[['clave','Clave'],['descripcion','Descripción'],['unidad','Unidad'],['consumo','Cantidad'],['desperdicioPct','Desperdicio %'],['precioUnitario','Precio']],tools:[['clave','Clave'],['descripcion','Herramienta'],['unidad','Unidad'],['cantidad','Cantidad'],['valorAdquisicion','Valor'],['vidaUtil','Vida útil'],['depreciacionPct','Depreciación %'],['factorUso','Factor uso']],equipment:[['clave','Clave'],['descripcion','Equipo'],['unidad','Unidad'],['cantidad','Cantidad'],['tarifa','Tarifa'],['rendimiento','Rendimiento']],consumables:[['clave','Clave'],['descripcion','Descripción'],['especificacion','Especificación'],['unidad','Unidad'],['consumo','Cantidad'],['desperdicioPct','Desperdicio %'],['precioUnitario','Precio']],seguridad:[['clave','Clave'],['descripcion','EPP'],['unidad','Unidad'],['cantidad','Cantidad'],['vidaUtil','Vida útil'],['factorImputable','Factor'],['precioUnitario','Precio'],['observaciones','Observaciones']]};
const BLANK={labor:{clave:'MO-NUEVO',descripcion:'',unidad:'jor',cuadrilla:1,rendimiento:1,jornada:8,salarioBase:0,fsr:1,fuente:{}},materials:{clave:'MAT-NUEVO',descripcion:'',unidad:'pza',consumo:0,desperdicioPct:0,precioUnitario:0,fuente:{}},tools:{clave:'HM-NUEVO',descripcion:'',unidad:'pza',cantidad:0,valorAdquisicion:0,vidaUtil:0,depreciacionPct:0,factorUso:1,fuente:{}},equipment:{clave:'EQ-NUEVO',descripcion:'',unidad:'hr',cantidad:0,tarifa:0,rendimiento:0,fuente:{}},consumables:{clave:'CON-NUEVO',descripcion:'',especificacion:'',unidad:'pza',consumo:0,desperdicioPct:0,precioUnitario:0,fuente:{},technicalReason:''},seguridad:{clave:'SP-NUEVO',descripcion:'',unidad:'pza',cantidad:0,vidaUtil:0,factorImputable:0,precioUnitario:0,observaciones:''}};
const priceKey=k=>k==='materials'?'precioUnitario':k==='labor'?'salarioBase':k==='equipment'?'tarifa':k==='tools'?'valorAdquisicion':'precioUnitario';
const SECTION_TOTAL_KEY={labor:'mo',materials:'mat',tools:'herramienta',equipment:'equipo',consumables:'consumibles',seguridad:'seguridad'};
const SECTION_UNIT={labor:'recurso',materials:'insumo',tools:'herramienta',equipment:'equipo',consumables:'consumible',seguridad:'EPP'};
const TECHNICAL_JUSTIFICATION_LABELS=[['materials','A. Materiales'],['labor','B. Mano de obra'],['equipment','C. Equipo y maquinaria'],['smallTools','D. Herramienta menor'],['consumables','E. Consumibles y auxiliares'],['safety','F. Seguridad y EPP']];

/* Encabezado plegable con resumen (conteo + subtotal real, nunca inventado) para
   que las 9 secciones del APU no compitan todas abiertas por atencion visual. */
function Accordion({title,summary,defaultOpen=false,children}){
 const [open,setOpen]=useState(defaultOpen);
 return <section className={`pro-accordion${open?' open':''}`}>
  <button type="button" className="pro-accordion-head" onClick={()=>setOpen(o=>!o)} aria-expanded={open}>
   <span className="pro-accordion-title">{title}</span>
   {summary && <span className="pro-accordion-summary">{summary}</span>}
   <span className="pro-accordion-caret" aria-hidden="true">{open?'−':'+'}</span>
  </button>
  {open && <div className="pro-accordion-body">{children}</div>}
 </section>;
}

const PI_KINDS=['materials','labor','equipment','consumables','seguridad'];

/* Aprobacion humana de precios de mercado (Price Intelligence, ver
   src/domain/priceIntelligence.js y src/lib/technicalMatch.js). Un precio
   que vino de busqueda web real NUNCA se marca VERIFICADO solo por tener
   evidencia de mercado -- necesita que un humano lo confirme aqui. Esta es
   esa confirmacion explicita: Aceptar / Cambiar referencia / Mantener precio
   actual, nunca una promocion automatica en segundo plano. */
function PriceReviewPanel({apu,onChange}){
 const pending=[];
 PI_KINDS.forEach(kind=>{
  (apu[kind]||[]).forEach((row,index)=>{
   const pr=row.priceRecord;
   if(!pr||!pr.evidenceLevel||pr.evidenceLevel==='ESTIMADO_IA') return;
   if(row.fuente?.estado!==APU_DATA_STATE.REQUIERE_VALIDACION) return; // ya se acepto/rechazo
   pending.push({kind,index,row,pr});
  });
 });
 if(!pending.length) return null;
 const field=kind=>priceKey(kind);

 const setRow=(kind,index,mutate)=>{
  const n=structuredClone(apu);
  const row=n[kind][index];
  mutate(row);
  onChange(n);
 };
 const aceptar=(kind,index)=>setRow(kind,index,row=>{
  row.fuente={...(row.fuente||{}),estado:APU_DATA_STATE.VERIFICADO};
 });
 const mantenerActual=(kind,index)=>setRow(kind,index,row=>{
  const f=field(kind);
  const estimado=row[`${f}EstimadoIA`];
  if(estimado!=null) row[f]=estimado;
  row.fuente={...(row.fuente||{}),estado:APU_DATA_STATE.ESTIMADO_IA};
 });
 const cambiarReferencia=(kind,index,ref)=>setRow(kind,index,row=>{
  const f=field(kind);
  row[f]=ref.precioNormalizado;
  row.fuente={...(row.fuente||{}),estado:APU_DATA_STATE.VERIFICADO,proveedor:ref.proveedor,sourceUrl:ref.url,fecha:ref.fecha};
 });

 return <section className="pro-price-review">
  <h3 className="pro-section-title">Revisión de precios de mercado <span className="pro-price-review-count">{pending.length} pendiente(s)</span></h3>
  {pending.map(({kind,index,row,pr})=>{
   const aceptadas=(pr.references||[]).filter(r=>r.match?.verdict==='ALTO');
   const auxiliares=(pr.references||[]).filter(r=>r.match?.verdict==='MEDIO');
   const seleccionables=[...aceptadas,...auxiliares];
   const avgScore=aceptadas.length?Math.round(aceptadas.reduce((s,r)=>s+r.match.score,0)/aceptadas.length):(auxiliares[0]?.match?.score||0);
   return <div className="pro-price-review-card" key={`${kind}-${index}`}>
    <div className="pro-price-review-head">
     <b>{row.descripcion}</b>
     <span className="pro-price-review-kind">{kind}</span>
    </div>
    <div className="pro-price-review-grid">
     <div><small>Precio propuesto</small><b>{money(row[field(kind)])}</b></div>
     <div><small>Referencias</small><b>{aceptadas.length} compatible(s){auxiliares.length?` · ${auxiliares.length} auxiliar(es)`:''}</b></div>
     <div><small>Mediana</small><b>{pr.stats?.mediana!=null?money(pr.stats.mediana):'—'}</b></div>
     <div><small>Rango</small><b>{pr.stats?.minimo!=null?`${money(pr.stats.minimo)}–${money(pr.stats.maximo)}`:'—'}</b></div>
     <div><small>Coincidencia técnica</small><b>{avgScore}%</b></div>
    </div>
    <div className="pro-price-review-actions">
     <button className="soft" onClick={()=>aceptar(kind,index)}>Aceptar</button>
     {seleccionables.length>1 && <select onChange={e=>{const ref=seleccionables[Number(e.target.value)];if(ref) cambiarReferencia(kind,index,ref);}} defaultValue="">
      <option value="" disabled>Cambiar referencia…</option>
      {seleccionables.map((r,i)=><option key={i} value={i}>{r.proveedor} — {money(r.precioNormalizado)} ({r.match?.verdict} {r.match?.score}%)</option>)}
     </select>}
     <button className="soft" onClick={()=>mantenerActual(kind,index)}>Mantener precio actual</button>
    </div>
   </div>;
  })}
 </section>;
}

export function ProfessionalApuEditor({apu,onChange,onSave,onExcel,onPdf,onFindPrices,user}){
 const final=useMemo(()=>finalizeProfessionalAPU(apu),[apu]);const [notice,setNotice]=useState(null),[modal,setModal]=useState(''),[quotes,setQuotes]=useState([]);
 const [moreOpen,setMoreOpen]=useState(false);
 const [selectedApuElement,setSelectedApuElement]=useState(null);
 const cacheKey=scopedKey(`apu:versions:${apu.id}`,user?.uid);
 const loadHistoryFor=()=>apu.versionHistory||JSON.parse(localStorage.getItem(cacheKey)||'[]');
 // Fase 8 Parte 2 (fix de gap real de QA): `history` antes solo se cargaba
 // UNA VEZ (inicializador perezoso de useState) -- si `apu.id` cambia en un
 // render posterior (ej. "Abrir" otro APU guardado sin desmontar este
 // componente) `cacheKey` SI se recalculaba pero `history` se quedaba
 // apuntando al id viejo, causando que el siguiente "Guardar version"
 // decidiera create/save-version segun un historial que ya no correspondia
 // a la identidad actual. Mismo patron "ajustar estado durante el render"
 // ya usado en este repo (src/hooks/useLocalState.js, src/cloud.js).
 const [historyState,setHistoryState]=useState(()=>({id:apu.id,history:loadHistoryFor()}));
 if(historyState.id!==apu.id){
  setHistoryState({id:apu.id,history:loadHistoryFor()});
 }
 const history=historyState.id===apu.id?historyState.history:loadHistoryFor();
 const setHistory=(next)=>setHistoryState(prev=>({id:apu.id,history:typeof next==='function'?next(prev.history):next}));
 const actor=user?.email||'Usuario';
 const withAudit=(next,field,before,after)=>({...next,audit:auditChange(next.audit||apu.audit,{user:actor,field,before,after})});
 const change=(f,v)=>{const after=N.has(f)?Number(v):v;onChange(withAudit({...apu,[f]:after},f,apu[f],after));};
 const rows=k=>k==='tools'?(apu.herramientaMenor?.detalle||[]):apu[k];
 const update=(k,i,f,v)=>{const n=structuredClone(apu),list=k==='tools'?n.herramientaMenor.detalle:n[k],row=list[i],before=row[f],after=N.has(f)?Number(v):v;row[f]=after;if(f===priceKey(k)){row.priceRecord=makePriceRecord({description:row.descripcion,price:Number(v),unit:row.unidad,currency:apu.moneda,sourceType:PRICE_SOURCE_TYPE.USER_PROVIDED,confidence:60});row.fuente={...(row.fuente||{}),estado:'USER PROVIDED',sourceType:'USER PROVIDED'};}onChange(withAudit(n,`${k}.${i}.${f}`,before,after))};
 const add=k=>{const n=structuredClone(apu);if(k==='tools'){n.herramientaMenor.modo='detalle';n.herramientaMenor.detalle=[...(n.herramientaMenor.detalle||[]),structuredClone(BLANK.tools)];}else n[k]=[...n[k],structuredClone(BLANK[k])];onChange(n)};
 const remove=(k,i)=>{const n=structuredClone(apu);(k==='tools'?n.herramientaMenor.detalle:n[k]).splice(i,1);onChange(n)};
 const [versionSaveState,setVersionSaveState]=useState(null); // {status:'saving'|'saved'|'error'|'conflict', message, serverCurrentVersion}
 /* Fase 7: ademas de la version LOCAL instantanea (createApuVersion, sin la
    cual la UI se sentiria lenta -- localStorage/estado de React nunca
    tarda), intenta persistir la misma version en el servidor autoritativo
    (api/apus.mjs) -- create la primera vez (history vacio todavia, mismo
    criterio que createApuVersion usa para numerar V1), save-version las
    siguientes. Leccion de Fase 6.1: nunca exito optimista silencioso -- si
    el servidor falla, se avisa explicitamente (versionSaveState:'error'),
    nunca se presenta como guardado. r.apu (ya finalizado por
    createApuVersion, con id garantizado) es lo que se envia -- nunca el
    `current` crudo, que podria no tener id todavia en un APU nuevo.

    FIX Fase 9 (hallazgo F-004, P1 -- lost update real, confirmado con PoC):
    antes el "bump" de version local (setHistory/localStorage/onChange/
    onSave) se aplicaba de forma OPTIMISTA, ANTES de saber si el servidor
    aceptaria el guardado -- si otra pestaña/dispositivo ya habia guardado
    una version mas reciente, este editor de todos modos mostraba "Versión
    respaldada en el servidor" (mentira: en realidad el servidor la
    rechazaba en silencio o, peor, el guardado optimista local hacia que
    esta sesion CREYERA que su V-siguiente era la vigente cuando no lo era).
    Ahora: (1) se manda expectedParentVersionId (la ULTIMA version que ESTE
    editor conoce) para que el servidor pueda detectar el conflicto real;
    (2) el bump de version LOCAL (historial/onChange/onSave) solo se aplica
    DESPUES de que el servidor confirma -- nunca antes; (3) en conflicto real
    (409/VERSION_CONFLICT) NUNCA se aplica el bump ni se dice "guardado": se
    expone versionSaveState:'conflict' con la version real del servidor, y
    la edicion del usuario permanece intacta en `apu` (el estado del padre,
    que este saveVersion nunca toco) para que la decida el mismo -- recargar
    la version vigente y reintentar, o forzar sabiendo que pisara el cambio
    ajeno (esa decision de UI queda fuera de este cambio; lo que garantiza
    esta funcion es que NUNCA se pierde/oculta el conflicto en silencio). */
 const saveVersion=async(current=apu,reason='Guardado manual')=>{
  const wasFirstSave=history.length===0;
  const expectedParentVersionId=wasFirstSave?null:(history[history.length-1]?.version??null);
  const r=createApuVersion(current,history,{user:user?.email||'Usuario',reason});
  setVersionSaveState({status:'saving'});
  try{
   if(wasFirstSave) await apiPost('/api/apus',{action:'create',id:r.apu.id,projectId:r.apu.projectId||null,apu:r.apu,reason});
   else await apiPost('/api/apus',{action:'save-version',id:r.apu.id,apu:r.apu,reason,expectedParentVersionId});
   r.apu.versionHistory=r.history;setHistory(r.history);localStorage.setItem(cacheKey,JSON.stringify(r.history));onChange(r.apu);onSave?.(r.apu);
   setVersionSaveState({status:'saved'});
   return r.apu;
  }catch(err){
   if(err.code==='VERSION_CONFLICT'){
    setVersionSaveState({status:'conflict',message:err.message,serverCurrentVersion:err.currentVersion});
   }else{
    setVersionSaveState({status:'error',message:err.message});
   }
   return current;
  }
 };
 const restoreVersion=(v)=>{const r=restoreApuVersion(v,history,{user:user?.email});r.apu.versionHistory=r.history;setHistory(r.history);onChange(r.apu)};
 /* FIX Fase 9 (hallazgo F-004): resolucion explicita de un conflicto de
    version -- el usuario decide, nunca se resuelve solo. "Recargar version
    del servidor" trae el snapshot/version REAL vigente (descarta la edicion
    local de ESTE intento, a proposito, con el usuario enterado por el
    propio boton) para que un siguiente "Guardar versión" ya parta del
    expectedParentVersionId correcto y pueda tener exito. */
 const reloadServerVersion=async()=>{
  const data=await apiGetSafe(`/api/apus?id=${encodeURIComponent(apu.id)}`);
  if(!data?.apu){ setVersionSaveState({status:'error',message:'No se pudo recargar la version del servidor.'}); return; }
  const serverHistory=(data.versions||[]).map(v=>({...v}));
  setHistory(serverHistory);
  localStorage.setItem(cacheKey,JSON.stringify(serverHistory));
  onChange({...data.apu.snapshot,versionHistory:serverHistory});
  setVersionSaveState(null);
 };
 const [dossierMode,setDossierMode]=useState('TECNICO');
 const [dossierState,setDossierState]=useState(null); // {status:'generating'|'done'|'error', format, message, verificationLabel}
 const generateDossier=async(format)=>{
  setDossierState({status:'generating',format});
  try{
   const run=format==='PDF'?exportApuAuditDossierPdf:exportApuAuditDossierExcel;
   const {data}=await run({apu,apuId:apu.id,projectId:apu.projectId||null,mode:dossierMode,company:{responsible:user?.email}});
   setDossierState({status:'done',format,verificationLabel:data.verificationLabel});
  }catch(err){
   setDossierState({status:'error',format,message:err.message});
  }
 };
 const openPrices=async()=>{const alternatives=await onFindPrices?.(apu)||[];setQuotes(alternatives.map(q=>({...q,apply:false,...comparePrice(q.current,q.priceRecord.price)})));setModal('prices')};
 const applyPrices=()=>{if(!quotes.some(q=>q.apply))return;const next=applyConfirmedPriceChanges(apu,quotes,{user:user?.email||'Usuario'});saveVersion(next,'Actualización confirmada de precios');setNotice(validateAPU(next));setModal('')};
 const sectionSummary=k=>{const n=rows(k).length;const unit=SECTION_UNIT[k];return `${n} ${unit}${n===1?'':n===0?'s':'s'} · ${money(final.calculated[SECTION_TOTAL_KEY[k]]||0)}`;};
 // Espejo visual del guard real de exportacion (isStructurallyEmptyApu,
 // src/domain/apuProfessional.js -- el mismo que exportAPUExcelV2/
 // exportAPUPdfV2 aplican como segunda barrera antes de escribir el
 // archivo). Deshabilitar aqui es solo UX (evita el clic inutil y explica
 // por que); el guard interno sigue siendo la barrera real, nunca se retira.
 const isEmptyApu=isStructurallyEmptyApu(final);
 const emptyApuTitle='Este APU no tiene concepto ni contenido técnico (materiales/mano de obra/equipo/EPP) todavía -- no hay nada que exportar.';
 const table=(k,title)=><Accordion key={k} title={title} summary={sectionSummary(k)} defaultOpen={k==='labor'}><div className="apu-table-scroll"><table className="data-table"><thead><tr>{SPEC[k].map(([f,l])=><th key={f}>{l}</th>)}<th>Fuente</th><th>Fecha</th><th>Estado</th><th/></tr></thead><tbody>{rows(k).map((r,i)=><tr key={r.clave||i}>{SPEC[k].map(([f])=><td key={f}><input value={r[f]??''} onChange={e=>update(k,i,f,e.target.value)}/></td>)}<td><input value={r.fuente?.proveedor||''} placeholder={r.fuente?.estado===APU_DATA_STATE.BIBLIOTECA?'Biblioteca ZOEMEC':''} onChange={e=>{const n=structuredClone(apu),x=k==='tools'?n.herramientaMenor.detalle[i]:n[k][i];x.fuente={...(x.fuente||{}),proveedor:e.target.value,estado:x.fuente?.estado||APU_DATA_STATE.REQUIERE_VALIDACION};onChange(n)}}/></td><td><input value={r.fuente?.fecha||''} onChange={e=>{const n=structuredClone(apu),x=k==='tools'?n.herramientaMenor.detalle[i]:n[k][i];x.fuente={...(x.fuente||{}),fecha:e.target.value};onChange(n)}}/></td><td title={r.fuente?.matchMethod?`Método de coincidencia: ${r.fuente.matchMethod} · Confianza: ${r.fuente.confidence??0}% · Origen del precio: ${r.fuente.origenPrecio||''}${r.fuente.catalogItemId?` · Insumo de catálogo: ${r.fuente.catalogItemId}`:''}`:undefined}>{apuDataStateLabel(r.fuente?.estado)}</td><td><button onClick={()=>remove(k,i)}>×</button></td></tr>)}</tbody></table></div><button onClick={()=>add(k)}>+ Agregar</button></Accordion>;
 const list=(f,title,object=false)=><Accordion key={f} title={title} summary={`${(apu[f]||[]).length} elemento(s)`}>{(apu[f]||[]).map((v,i)=><div className="pro-list-row" key={i}><textarea value={object?(v.especificacion||v.texto||''):v} onChange={e=>{const n=structuredClone(apu);n[f][i]=object?{...v,[f==='supuestos'?'texto':'especificacion']:e.target.value}:e.target.value;onChange(n)}}/><button onClick={()=>{const n=structuredClone(apu);n[f].splice(i,1);onChange(n)}}>×</button></div>)}<button onClick={()=>onChange({...apu,[f]:[...(apu[f]||[]),object?(f==='supuestos'?{texto:''}:{especificacion:'',criterio:'',norma:''}):'']})}>+ Agregar</button></Accordion>;
 return <div className="professional-apu-editor">
  <ZoemecIntelligencePanel apu={apu} onChange={onChange} history={history} onRestoreVersion={restoreVersion} user={user}/>
  <PriceReviewPanel apu={apu} onChange={onChange}/>
  <h3 className="pro-section-title pro-section-title-first">G. Acciones</h3>
  <div className="pro-toolbar">
   <button onClick={()=>saveVersion()} disabled={versionSaveState?.status==='saving'}>Guardar versión</button>
   {/* Fase 7: estado explicito de la persistencia autoritativa -- nunca
       exito optimista silencioso (leccion Fase 6.1). "Guardado" real =
       localStorage/estado de React (instantaneo, siempre ocurre); el aviso
       aqui es especificamente sobre si la version tambien quedo respaldada
       en el servidor. */}
   {versionSaveState?.status==='saving' && <span className="pro-toolbar-status">Guardando versión en el servidor…</span>}
   {versionSaveState?.status==='saved' && <span className="pro-toolbar-status">Versión respaldada en el servidor.</span>}
   {versionSaveState?.status==='error' && <span className="pro-toolbar-status pro-toolbar-status-error">No se pudo respaldar en el servidor: {versionSaveState.message} (tu edición sigue aquí, sin guardar).</span>}
   {/* FIX Fase 9 (hallazgo F-004): conflicto real -- NUNCA se dice "guardado".
       Se muestra la version vigente real del servidor y se ofrece recargarla
       explicitamente; la edicion actual del usuario permanece intacta en el
       editor (nunca se sobreescribe sola) hasta que el decida que hacer. */}
   {versionSaveState?.status==='conflict' && <span className="pro-toolbar-status pro-toolbar-status-error">
    Conflicto de versión: alguien más (u otra pestaña/dispositivo) ya guardó {versionSaveState.serverCurrentVersion} en el servidor. Tu edición NO se guardó como versión nueva y sigue aquí, sin perder nada.
    {' '}<button type="button" className="link-inline" onClick={reloadServerVersion}>Recargar versión del servidor</button>
   </span>}
   <button onClick={()=>setNotice(validateAPU(apu))}>Validar</button>
   <button onClick={()=>setNotice({status:'RECALCULADO',issues:[]})}>Recalcular</button>
   <span className="pro-toolbar-group-label">Entregables</span>
   <button onClick={onExcel} disabled={isEmptyApu} title={isEmptyApu?emptyApuTitle:'Exporta únicamente el APU que estás editando actualmente.'}>Descargar Excel de este APU</button>
   <button onClick={onPdf} disabled={isEmptyApu} title={isEmptyApu?emptyApuTitle:'Exporta únicamente el APU que estás editando actualmente.'}>Descargar PDF de este APU</button>
   <span className="pro-toolbar-group-label">Dossier auditable</span>
   {/* Fase 8: entregable NUEVO y separado de los botones de exportacion de
       arriba (que NO se tocan) -- si apu.id tiene una version guardada en
       el servidor (Fase 7), el dossier se construye SIEMPRE desde esa
       version, nunca desde este estado de React (ver
       src/lib/apuDossierData.js#resolveApuSnapshot). Si no existe version
       server-side, el dossier se genera igual pero rotulado honestamente
       como BORRADOR NO RESPALDADO -- nunca en silencio. */}
   <select value={dossierMode} onChange={e=>setDossierMode(e.target.value)} disabled={isEmptyApu} aria-label="Modo del dossier">
    <option value="TECNICO">Modo técnico (completo)</option>
    <option value="CLIENTE">Modo cliente (resumido)</option>
   </select>
   <button onClick={()=>generateDossier('PDF')} disabled={isEmptyApu||dossierState?.status==='generating'} title={isEmptyApu?emptyApuTitle:'Genera el dossier técnico auditable en PDF.'}>Dossier PDF</button>
   <button onClick={()=>generateDossier('XLSX')} disabled={isEmptyApu||dossierState?.status==='generating'} title={isEmptyApu?emptyApuTitle:'Genera el dossier técnico auditable en Excel.'}>Dossier Excel</button>
   {dossierState?.status==='generating' && <span className="pro-toolbar-status">Generando dossier {dossierState.format}…</span>}
   {dossierState?.status==='done' && <span className="pro-toolbar-status">Dossier {dossierState.format} generado ({dossierState.verificationLabel}).</span>}
   {dossierState?.status==='error' && <span className="pro-toolbar-status pro-toolbar-status-error">No se pudo generar el dossier {dossierState.format}: {dossierState.message}</span>}
   <div className="pro-toolbar-more">
    <button type="button" className="soft" onClick={()=>setMoreOpen(o=>!o)} aria-expanded={moreOpen}>Más opciones {moreOpen?'▴':'▾'}</button>
    {moreOpen && <div className="pro-toolbar-more-menu">
     <button className="ghost" onClick={()=>{setModal('sources');setMoreOpen(false);}}>Ver fuentes</button>
     <button className="ghost" onClick={()=>{openPrices();setMoreOpen(false);}}>Actualizar precios</button>
     <button className="ghost" onClick={()=>{setModal('history');setMoreOpen(false);}}>Historial</button>
     <button className="ghost" onClick={()=>{window.print();setMoreOpen(false);}}>Imprimir</button>
    </div>}
   </div>
  </div>
  <h3 className="pro-section-title">D. Matriz APU</h3>
  <div className="pro-accordion-group">
  {table('labor','1. Mano de obra')}{table('materials','2. Materiales')}{table('tools','3. Herramienta menor')}{table('equipment','4. Equipo')}{table('consumables','5. Consumibles y auxiliares')}{table('seguridad','6. Seguridad')}
  </div>
  <h3 className="pro-section-title">E. Ingeniería</h3>
  <div className="pro-accordion-group">
  {list('procedimientoConstructivo','6. Procedimiento')}{list('controlCalidad','7. Calidad',true)}
  <Accordion title="8. Medición y forma de pago" summary={apu.criterioMedicion?.unidadMedicion || 'Sin definir'}><div className="pro-header-grid">{[['unidadMedicion','Unidad contractual'],['criterio','Criterio de medición'],['formaPago','Forma de pago'],['observaciones','Observaciones']].map(([f,l])=><label key={f}>{l}<textarea value={apu.criterioMedicion?.[f]||''} onChange={e=>onChange({...apu,criterioMedicion:{...apu.criterioMedicion,[f]:e.target.value}})}/></label>)}<label>Inclusiones<textarea value={(apu.criterioMedicion?.incluye||[]).join('\n')} onChange={e=>onChange({...apu,criterioMedicion:{...apu.criterioMedicion,incluye:e.target.value.split('\n')}})}/></label><label>Exclusiones<textarea value={(apu.criterioMedicion?.excluye||[]).join('\n')} onChange={e=>onChange({...apu,criterioMedicion:{...apu.criterioMedicion,excluye:e.target.value.split('\n')}})}/></label></div></Accordion>
  {list('supuestos','9. Supuestos',true)}
  <Accordion title="10. Justificaciones técnicas" summary={`${TECHNICAL_JUSTIFICATION_LABELS.filter(([k])=>(apu.technicalJustifications?.[k]||'').trim()).length}/6 completas`}>
   <div className="pro-header-grid">{TECHNICAL_JUSTIFICATION_LABELS.map(([k,l])=><label key={k}>{l}<textarea value={apu.technicalJustifications?.[k]||''} onChange={e=>onChange({...apu,technicalJustifications:{...apu.technicalJustifications,[k]:e.target.value}})} placeholder="Sin justificación técnica registrada"/></label>)}</div>
  </Accordion>
  </div>
  <h3 className="pro-section-title">F. Datos administrativos</h3>
  <Accordion title="Datos del proyecto" summary={apu.proyecto || apu.cliente || 'Sin capturar'}>
   <div className="pro-header-grid">{[['proyecto','Proyecto'],['cliente','Cliente'],['ubicacion','Ubicación'],['pais','País'],['estado','Estado'],['municipio','Municipio'],['fechaBase','Fecha base'],['moneda','Moneda'],['tipoCambio','Tipo cambio'],['partida','Partida'],['clave','Clave'],['concept','Concepto'],['unit','Unidad'],['cantidadObra','Cantidad'],['elaboro','Elaboró'],['reviso','Revisó'],['aprobo','Aprobó'],['version','Versión']].map(([f,l])=><label key={f}>{l}<input value={apu[f]??''} onChange={e=>change(f,e.target.value)}/></label>)}</div>
  </Accordion>
  <h3 className="pro-section-title">G. Visualización 3D</h3>
  <Accordion title="Modelo técnico 3D" summary="Geometría paramétrica derivada de datos reales del APU">
   {/* onSelectElement: bug reportado (seleccion 3D nunca conectada) --
       setSelectedApuElement es la funcion que devuelve useState, con
       identidad ESTABLE entre renders (React la garantiza), asi que pasarla
       aqui nunca provoca que Technical3DViewer reconstruya su escena three.js
       por un cambio de referencia de esta funcion. El propio visor ya
       resalta el elemento y muestra su info (clave/concepto/dimensiones); el
       aviso de abajo confirma que la seleccion SI llega hasta este
       componente padre, con el dato real devuelto por el raycast. */}
   <Technical3DViewer apu={apu} onSelectElement={setSelectedApuElement}/>
   {selectedApuElement && <p className="muted" style={{fontSize:'.78rem',marginTop:6}}>
     Último elemento 3D seleccionado: <b>{selectedApuElement.label || selectedApuElement.clave || selectedApuElement.id}</b>
     {selectedApuElement.type ? ` (${selectedApuElement.type})` : ''}
   </p>}
  </Accordion>
  <div className="pro-economy"><b>Costo directo {money(final.calculated.direct)}</b><strong>PRECIO UNITARIO SIN IVA {money(final.calculated.pu)}</strong><span>Cantidad {num(apu.cantidadObra)}</span><b>Importe sin IVA {money(final.calculated.importeTotal)}</b><span>IVA {money(final.calculated.iva*apu.cantidadObra)}</span><b>Importe con IVA {money(final.calculated.importeTotal+final.calculated.iva*apu.cantidadObra)}</b></div>
  {notice&&<div className="validation-panel"><h3>{notice.status}</h3>{(notice.issues||[]).map((x,i)=><p key={i}>{x.message}</p>)}</div>}
  {modal&&<div className="pro-modal"><div><button onClick={()=>setModal('')}>×</button><h2>{modal==='prices'?'Comparador de precios':modal==='history'?'Historial':'Fuentes'}</h2>{modal==='prices'?<><table className="data-table"><thead><tr><th>Recurso</th><th>Actual</th><th>Nuevo</th><th>Diferencia</th><th>Variación</th><th>Proveedor nuevo</th><th>Fecha</th><th>Aplicar</th></tr></thead><tbody>{quotes.map((q,i)=><tr key={i}><td>{q.resource}</td><td>{money(q.current)}</td><td>{money(q.next)}</td><td>{money(q.difference)}</td><td>{q.variationPct==null?'—':`${num(q.variationPct)}%`}</td><td>{q.priceRecord.supplier||'PENDIENTE'}</td><td>{q.priceRecord.priceDate||'Sin fecha'}</td><td><input type="checkbox" checked={q.apply} onChange={e=>setQuotes(quotes.map((x,j)=>j===i?{...x,apply:e.target.checked}:x))}/></td></tr>)}</tbody></table><button onClick={applyPrices}>Aplicar seleccionados</button><button onClick={()=>setModal('')}>Cancelar</button></>:modal==='history'?history.map(v=><p key={v.version}><b>{v.version}</b> · {v.at} · {money(v.unitPrice)} <button onClick={()=>restoreVersion(v)}>Restaurar</button></p>):['materials','labor','equipment','consumables'].flatMap(k=>(apu[k]||[]).map(r=><p key={`${k}-${r.clave}`}><b>{r.descripcion}</b> · {r.fuente?.proveedor||'Sin proveedor'} · {r.fuente?.fecha||'Sin fecha'} · {apuDataStateLabel(r.fuente?.estado)}</p>))}</div></div>}
 </div>;
}
