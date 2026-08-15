import { money } from '../../lib/apuExport.js';

export function Param({label,v,on}){return <div className="param"><label>{label}</label><input type="number" step="0.1" value={v} onChange={e=>on(e.target.value)}/></div>}

export function Cost({label,v}){return <div className="cost"><span>{label}</span><b>{money(v)}</b></div>}

export function NField({label,value,on,step}){return <div className="nf"><label>{label}</label><input type="number" step={step||'any'} value={value} onChange={e=>on(e.target.value)}/></div>;}

export function ORow({label,val,total}){return <div className={"o"+(total?" total":"")}><span>{label}</span><b>{val}</b></div>;}
