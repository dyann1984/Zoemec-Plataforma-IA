/* Centro Tecnico: calculadoras de obra (concreto, acero, block, pintura,
   impermeabilizante, excavacion, cimentacion, piedra, cadena, castillo,
   aplanado, losa, FSR). Cada calculadora es autonoma; el resultado se puede
   copiar o enviar directo a Presupuestos via un CustomEvent
   ('zoemec-budget-add') que escucha src/main.jsx. No usa el motor calcAPU:
   son formulas de cuantificacion de obra civil independientes del APU. */
import { useState } from 'react';
import { Icon } from '../../components/ui/Icon.jsx';
import { PageHead } from '../../components/ui/PageElements.jsx';
import { NField, ORow } from '../../components/ui/FormFields.jsx';
import { money } from '../../lib/apuExport.js';

/* Envía el resultado de una calculadora directo al módulo de Presupuestos (ventaja vs OPUS/Neodata) */
/* Centro Técnico: calculadora de block + calculadora de FSR real (Art. 191 RLOPSRM) */
/* ---------- Calculadoras del Centro Técnico ---------- */
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
export function TechnicalCenter({embedded=false}){
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
