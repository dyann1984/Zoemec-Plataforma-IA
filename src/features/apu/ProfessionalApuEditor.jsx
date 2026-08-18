import React,{useMemo,useState} from 'react';
import {finalizeProfessionalAPU,validateAPU,makePriceRecord,PRICE_SOURCE_TYPE} from '../../domain/apuProfessional.js';
import {auditChange,createApuVersion,restoreApuVersion,comparePrice,applyConfirmedPriceChanges} from '../../domain/apuVersioning.js';
import {apuDataStateLabel,APU_DATA_STATE} from '../../domain/apuSchema.js';
import {money,num} from '../../lib/apuExport.js';
import {scopedKey} from '../../utils/scopedStorage.js';

const N=new Set(['cantidadObra','tipoCambio','cantidad','consumo','desperdicioPct','precioUnitario','cuadrilla','rendimiento','jornada','salarioBase','fsr','tarifa','valorAdquisicion','depreciacionPct','vidaUtil','factorUso','factorImputable']);
const SPEC={labor:[['clave','Clave'],['descripcion','Descripción'],['unidad','Unidad'],['cuadrilla','Cuadrilla'],['rendimiento','Rendimiento'],['jornada','Jornada'],['salarioBase','Salario'],['fsr','FSR']],materials:[['clave','Clave'],['descripcion','Descripción'],['unidad','Unidad'],['consumo','Cantidad'],['desperdicioPct','Desperdicio %'],['precioUnitario','Precio']],tools:[['clave','Clave'],['descripcion','Herramienta'],['unidad','Unidad'],['cantidad','Cantidad'],['valorAdquisicion','Valor'],['vidaUtil','Vida útil'],['depreciacionPct','Depreciación %'],['factorUso','Factor uso']],equipment:[['clave','Clave'],['descripcion','Equipo'],['unidad','Unidad'],['cantidad','Cantidad'],['tarifa','Tarifa'],['rendimiento','Rendimiento']],seguridad:[['clave','Clave'],['descripcion','EPP'],['unidad','Unidad'],['cantidad','Cantidad'],['vidaUtil','Vida útil'],['factorImputable','Factor'],['precioUnitario','Precio'],['observaciones','Observaciones']]};
const BLANK={labor:{clave:'MO-NUEVO',descripcion:'',unidad:'jor',cuadrilla:1,rendimiento:1,jornada:8,salarioBase:0,fsr:1,fuente:{}},materials:{clave:'MAT-NUEVO',descripcion:'',unidad:'pza',consumo:0,desperdicioPct:0,precioUnitario:0,fuente:{}},tools:{clave:'HM-NUEVO',descripcion:'',unidad:'pza',cantidad:0,valorAdquisicion:0,vidaUtil:0,depreciacionPct:0,factorUso:1,fuente:{}},equipment:{clave:'EQ-NUEVO',descripcion:'',unidad:'hr',cantidad:0,tarifa:0,rendimiento:0,fuente:{}},seguridad:{clave:'SP-NUEVO',descripcion:'',unidad:'pza',cantidad:0,vidaUtil:0,factorImputable:0,precioUnitario:0,observaciones:''}};
const priceKey=k=>k==='materials'?'precioUnitario':k==='labor'?'salarioBase':k==='equipment'?'tarifa':k==='tools'?'valorAdquisicion':'precioUnitario';
const SECTION_TOTAL_KEY={labor:'mo',materials:'mat',tools:'herramienta',equipment:'equipo',seguridad:'seguridad'};
const SECTION_UNIT={labor:'recurso',materials:'insumo',tools:'herramienta',equipment:'equipo',seguridad:'EPP'};

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

export function ProfessionalApuEditor({apu,onChange,onSave,onExcel,onPdf,onFindPrices,user}){
 const final=useMemo(()=>finalizeProfessionalAPU(apu),[apu]);const [notice,setNotice]=useState(null),[modal,setModal]=useState(''),[quotes,setQuotes]=useState([]);
 const [moreOpen,setMoreOpen]=useState(false);
 const cacheKey=scopedKey(`apu:versions:${apu.id}`,user?.uid);const [history,setHistory]=useState(()=>apu.versionHistory||JSON.parse(localStorage.getItem(cacheKey)||'[]'));
 const actor=user?.email||'Usuario';
 const withAudit=(next,field,before,after)=>({...next,audit:auditChange(next.audit||apu.audit,{user:actor,field,before,after})});
 const change=(f,v)=>{const after=N.has(f)?Number(v):v;onChange(withAudit({...apu,[f]:after},f,apu[f],after));};
 const rows=k=>k==='tools'?(apu.herramientaMenor?.detalle||[]):apu[k];
 const update=(k,i,f,v)=>{const n=structuredClone(apu),list=k==='tools'?n.herramientaMenor.detalle:n[k],row=list[i],before=row[f],after=N.has(f)?Number(v):v;row[f]=after;if(f===priceKey(k)){row.priceRecord=makePriceRecord({description:row.descripcion,price:Number(v),unit:row.unidad,currency:apu.moneda,sourceType:PRICE_SOURCE_TYPE.USER_PROVIDED,confidence:60});row.fuente={...(row.fuente||{}),estado:'USER PROVIDED',sourceType:'USER PROVIDED'};}onChange(withAudit(n,`${k}.${i}.${f}`,before,after))};
 const add=k=>{const n=structuredClone(apu);if(k==='tools'){n.herramientaMenor.modo='detalle';n.herramientaMenor.detalle=[...(n.herramientaMenor.detalle||[]),structuredClone(BLANK.tools)];}else n[k]=[...n[k],structuredClone(BLANK[k])];onChange(n)};
 const remove=(k,i)=>{const n=structuredClone(apu);(k==='tools'?n.herramientaMenor.detalle:n[k]).splice(i,1);onChange(n)};
 const saveVersion=(current=apu,reason='Guardado manual')=>{const r=createApuVersion(current,history,{user:user?.email||'Usuario',reason});r.apu.versionHistory=r.history;setHistory(r.history);localStorage.setItem(cacheKey,JSON.stringify(r.history));onChange(r.apu);onSave?.(r.apu);return r.apu};
 const openPrices=async()=>{const alternatives=await onFindPrices?.(apu)||[];setQuotes(alternatives.map(q=>({...q,apply:false,...comparePrice(q.current,q.priceRecord.price)})));setModal('prices')};
 const applyPrices=()=>{if(!quotes.some(q=>q.apply))return;const next=applyConfirmedPriceChanges(apu,quotes,{user:user?.email||'Usuario'});saveVersion(next,'Actualización confirmada de precios');setNotice(validateAPU(next));setModal('')};
 const sectionSummary=k=>{const n=rows(k).length;const unit=SECTION_UNIT[k];return `${n} ${unit}${n===1?'':n===0?'s':'s'} · ${money(final.calculated[SECTION_TOTAL_KEY[k]]||0)}`;};
 const table=(k,title)=><Accordion key={k} title={title} summary={sectionSummary(k)} defaultOpen={k==='labor'}><div className="apu-table-scroll"><table className="data-table"><thead><tr>{SPEC[k].map(([f,l])=><th key={f}>{l}</th>)}<th>Fuente</th><th>Fecha</th><th>Estado</th><th/></tr></thead><tbody>{rows(k).map((r,i)=><tr key={r.clave||i}>{SPEC[k].map(([f])=><td key={f}><input value={r[f]??''} onChange={e=>update(k,i,f,e.target.value)}/></td>)}<td><input value={r.fuente?.proveedor||''} onChange={e=>{const n=structuredClone(apu),x=k==='tools'?n.herramientaMenor.detalle[i]:n[k][i];x.fuente={...(x.fuente||{}),proveedor:e.target.value,estado:x.fuente?.estado||APU_DATA_STATE.REQUIERE_VALIDACION};onChange(n)}}/></td><td><input value={r.fuente?.fecha||''} onChange={e=>{const n=structuredClone(apu),x=k==='tools'?n.herramientaMenor.detalle[i]:n[k][i];x.fuente={...(x.fuente||{}),fecha:e.target.value};onChange(n)}}/></td><td>{apuDataStateLabel(r.fuente?.estado)}</td><td><button onClick={()=>remove(k,i)}>×</button></td></tr>)}</tbody></table></div><button onClick={()=>add(k)}>+ Agregar</button></Accordion>;
 const list=(f,title,object=false)=><Accordion key={f} title={title} summary={`${(apu[f]||[]).length} elemento(s)`}>{(apu[f]||[]).map((v,i)=><div className="pro-list-row" key={i}><textarea value={object?(v.especificacion||v.texto||''):v} onChange={e=>{const n=structuredClone(apu);n[f][i]=object?{...v,[f==='supuestos'?'texto':'especificacion']:e.target.value}:e.target.value;onChange(n)}}/><button onClick={()=>{const n=structuredClone(apu);n[f].splice(i,1);onChange(n)}}>×</button></div>)}<button onClick={()=>onChange({...apu,[f]:[...(apu[f]||[]),object?(f==='supuestos'?{texto:''}:{especificacion:'',criterio:'',norma:''}):'']})}>+ Agregar</button></Accordion>;
 return <div className="professional-apu-editor">
  <h3 className="pro-section-title pro-section-title-first">G. Acciones</h3>
  <div className="pro-toolbar">
   <button onClick={()=>saveVersion()}>Guardar versión</button>
   <button onClick={()=>setNotice(validateAPU(apu))}>Validar</button>
   <button onClick={()=>setNotice({status:'RECALCULADO',issues:[]})}>Recalcular</button>
   <span className="pro-toolbar-group-label">Entregables</span>
   <button onClick={onExcel}>Descargar Excel</button>
   <button onClick={onPdf}>Descargar PDF</button>
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
  {table('labor','1. Mano de obra')}{table('materials','2. Materiales')}{table('tools','3. Herramienta menor')}{table('equipment','4. Equipo')}{table('seguridad','5. Seguridad')}
  </div>
  <h3 className="pro-section-title">E. Ingeniería</h3>
  <div className="pro-accordion-group">
  {list('procedimientoConstructivo','6. Procedimiento')}{list('controlCalidad','7. Calidad',true)}
  <Accordion title="8. Medición y forma de pago" summary={apu.criterioMedicion?.unidadMedicion || 'Sin definir'}><div className="pro-header-grid">{[['unidadMedicion','Unidad contractual'],['criterio','Criterio de medición'],['formaPago','Forma de pago'],['observaciones','Observaciones']].map(([f,l])=><label key={f}>{l}<textarea value={apu.criterioMedicion?.[f]||''} onChange={e=>onChange({...apu,criterioMedicion:{...apu.criterioMedicion,[f]:e.target.value}})}/></label>)}<label>Inclusiones<textarea value={(apu.criterioMedicion?.incluye||[]).join('\n')} onChange={e=>onChange({...apu,criterioMedicion:{...apu.criterioMedicion,incluye:e.target.value.split('\n')}})}/></label><label>Exclusiones<textarea value={(apu.criterioMedicion?.excluye||[]).join('\n')} onChange={e=>onChange({...apu,criterioMedicion:{...apu.criterioMedicion,excluye:e.target.value.split('\n')}})}/></label></div></Accordion>
  {list('supuestos','9. Supuestos',true)}
  </div>
  <h3 className="pro-section-title">F. Datos administrativos</h3>
  <Accordion title="Datos del proyecto" summary={apu.proyecto || apu.cliente || 'Sin capturar'}>
   <div className="pro-header-grid">{[['proyecto','Proyecto'],['cliente','Cliente'],['ubicacion','Ubicación'],['pais','País'],['estado','Estado'],['municipio','Municipio'],['fechaBase','Fecha base'],['moneda','Moneda'],['tipoCambio','Tipo cambio'],['partida','Partida'],['clave','Clave'],['concept','Concepto'],['unit','Unidad'],['cantidadObra','Cantidad'],['elaboro','Elaboró'],['reviso','Revisó'],['aprobo','Aprobó'],['version','Versión']].map(([f,l])=><label key={f}>{l}<input value={apu[f]??''} onChange={e=>change(f,e.target.value)}/></label>)}</div>
  </Accordion>
  <div className="pro-economy"><b>Costo directo {money(final.calculated.direct)}</b><strong>PRECIO UNITARIO SIN IVA {money(final.calculated.pu)}</strong><span>Cantidad {num(apu.cantidadObra)}</span><b>Importe sin IVA {money(final.calculated.importeTotal)}</b><span>IVA {money(final.calculated.iva*apu.cantidadObra)}</span><b>Importe con IVA {money(final.calculated.importeTotal+final.calculated.iva*apu.cantidadObra)}</b></div>
  {notice&&<div className="validation-panel"><h3>{notice.status}</h3>{(notice.issues||[]).map((x,i)=><p key={i}>{x.message}</p>)}</div>}
  {modal&&<div className="pro-modal"><div><button onClick={()=>setModal('')}>×</button><h2>{modal==='prices'?'Comparador de precios':modal==='history'?'Historial':'Fuentes'}</h2>{modal==='prices'?<><table className="data-table"><thead><tr><th>Recurso</th><th>Actual</th><th>Nuevo</th><th>Diferencia</th><th>Variación</th><th>Proveedor nuevo</th><th>Fecha</th><th>Aplicar</th></tr></thead><tbody>{quotes.map((q,i)=><tr key={i}><td>{q.resource}</td><td>{money(q.current)}</td><td>{money(q.next)}</td><td>{money(q.difference)}</td><td>{q.variationPct==null?'—':`${num(q.variationPct)}%`}</td><td>{q.priceRecord.supplier||'PENDIENTE'}</td><td>{q.priceRecord.priceDate||'Sin fecha'}</td><td><input type="checkbox" checked={q.apply} onChange={e=>setQuotes(quotes.map((x,j)=>j===i?{...x,apply:e.target.checked}:x))}/></td></tr>)}</tbody></table><button onClick={applyPrices}>Aplicar seleccionados</button><button onClick={()=>setModal('')}>Cancelar</button></>:modal==='history'?history.map(v=><p key={v.version}><b>{v.version}</b> · {v.at} · {money(v.unitPrice)} <button onClick={()=>{const r=restoreApuVersion(v,history,{user:user?.email});r.apu.versionHistory=r.history;setHistory(r.history);onChange(r.apu)}}>Restaurar</button></p>):['materials','labor','equipment'].flatMap(k=>apu[k].map(r=><p key={`${k}-${r.clave}`}><b>{r.descripcion}</b> · {r.fuente?.proveedor||'Sin proveedor'} · {r.fuente?.fecha||'Sin fecha'} · {apuDataStateLabel(r.fuente?.estado)}</p>))}</div></div>}
 </div>;
}
