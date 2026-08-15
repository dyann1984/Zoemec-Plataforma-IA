import { finalizeProfessionalAPU } from './apuProfessional.js';

const clone=value=>structuredClone(value);
const stamp=()=>new Date().toISOString();

export function auditChange(audit, {user='Usuario',field,before,after,at=stamp()}){
  if(JSON.stringify(before)===JSON.stringify(after)) return audit||[];
  return [...(audit||[]),{user,at,field,before:clone(before),after:clone(after)}];
}

export function createApuVersion(apu, history=[], {user='Usuario',reason='Guardado manual',at=stamp()}={}){
  const finalized=finalizeProfessionalAPU(apu);
  const number=(history.reduce((max,v)=>Math.max(max,Number(String(v.version||'').replace(/\D/g,''))||0),0))+1;
  const entry={version:`V${number}`,at,user,reason,directCost:finalized.calculated.direct,unitPrice:finalized.calculated.pu,total:finalized.calculated.importeTotal,changes:(finalized.audit||[]).slice(-(finalized.audit?.length||0)),snapshot:clone({...finalized,version:`V${number}`})};
  return {apu:clone(entry.snapshot),history:[...history,entry]};
}

export function restoreApuVersion(entry,history,options={}){
  if(!entry?.snapshot) throw new Error('La version seleccionada no contiene snapshot.');
  return createApuVersion(entry.snapshot,history,{...options,reason:options.reason||`Restauracion de ${entry.version}`});
}

export function comparePrice(current,next){
  const a=Number(current)||0,b=Number(next)||0,difference=b-a;
  return {current:a,next:b,difference,variationPct:a?difference/a*100:null};
}

export function applyConfirmedPriceChanges(apu,changes,{user='Usuario'}={}){
  const selected=(changes||[]).filter(c=>c.apply);
  let next=clone(apu); let audit=next.audit||[];
  selected.forEach(change=>{
    const rows=next[change.kind]||[]; const row=rows[change.index]; if(!row)return;
    const field=change.kind==='materials'?'precioUnitario':change.kind==='labor'?'salarioBase':'tarifa';
    audit=auditChange(audit,{user,field:`${change.kind}.${change.index}.${field}`,before:row[field],after:change.priceRecord.price});
    row[field]=change.priceRecord.price; row.priceRecord=clone(change.priceRecord);
    row.fuente={proveedor:change.priceRecord.supplier||null,fecha:change.priceRecord.priceDate||null,region:change.priceRecord.location||null,estado:change.priceRecord.verified?'VERIFICADO':'ESTIMADO',sourceName:change.priceRecord.sourceName||null,sourceUrl:change.priceRecord.sourceUrl||null,sourceType:change.priceRecord.sourceType,confidence:change.priceRecord.confidence};
  });
  next.audit=audit; return next;
}
