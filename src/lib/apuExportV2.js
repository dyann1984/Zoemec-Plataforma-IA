import writeXlsxFileBrowser from 'write-excel-file/browser';
import { jsPDF } from 'jspdf';
import { calcAPUv2 } from './apuCalc.js';
import { finalizeProfessionalAPU } from '../domain/apuProfessional.js';
import { apuDataStateLabel } from '../domain/apuSchema.js';
import { buildReviewRow, REVISION_STATUS_LABEL } from '../domain/apuReview.js';
import { xcell, fcell, XLS, exportWorkbookExcel, money, num } from './apuExport.js';

const COLORS={labor:'#123F78',materials:'#D56A00',tools:'#2F7D3A',equipment:'#1578B7',safety:'#B5263D',procedure:'#6D2D91',quality:'#D5A900',measure:'#078C88'};
const safeSheet=value=>String(value||'APU').replace(/[\\/?*\[\]:]/g,'-').slice(0,31);
const sourceText=row=>row?.fuente?.sourceName||row?.fuente?.proveedor||apuDataStateLabel(row?.fuente?.estado);
const asCell=(value,style={})=>xcell(value,style);
const formula=(value,style={})=>fcell(value,{...XLS.calc,...style});

export function buildProfessionalAPUSheet(rawApu){
  const apu=finalizeProfessionalAPU(rawApu);
  const rows=[]; const widths=[11,17,38,12,12,13,13,13,16,20,16,18];
  const add=(row=[])=>{const full=[...row];while(full.length<12)full.push(null);rows.push(full);return rows.length;};
  const span=(text,color='#123F78')=>add([asCell(text,{columnSpan:12,fontWeight:'bold',color:'#FFFFFF',backgroundColor:color,align:'center'}),...Array(11).fill(null)]);
  const head=labels=>add(labels.map(v=>asCell(v,{fontWeight:'bold',backgroundColor:'#EAF0F7',align:'center',wrap:true,borderColor:'#B8C2CC',borderWidth:1})));
  const subtotal=(label,start,end)=>add([null,asCell(label,{columnSpan:8,fontWeight:'bold',align:'right'}),...Array(7).fill(null),formula(end>=start?`=SUM(J${start}:J${end})`:'=0',{fontWeight:'bold'}),null,null]);
  span('ANALISIS DE PRECIO UNITARIO (APU)');
  add([asCell('Proyecto',XLS.label),apu.proyecto,null,asCell('Cliente',XLS.label),apu.cliente,null,asCell('Fecha base',XLS.label),apu.fechaBase,null,asCell('Moneda',XLS.label),apu.moneda,null]);
  add([asCell('Ubicacion',XLS.label),apu.ubicacion,null,asCell('Partida',XLS.label),apu.partida,null,asCell('Clave',XLS.label),apu.clave,null,asCell('Version',XLS.label),apu.version||'V1',null]);
  add([asCell('Concepto',XLS.label),asCell(apu.concept,{columnSpan:8,wrap:true}),...Array(7).fill(null),asCell('Unidad',XLS.label),apu.unit,asCell('Cantidad',XLS.label),Number(apu.cantidadObra||0)]);
  add([]);

  span('1. MANO DE OBRA',COLORS.labor); head(['No.','Clave','Descripcion','Unidad','Cuadrilla','Rendimiento','Jornada','Salario base','FSR','Importe','Fuente','Estado']);
  const moStart=rows.length+1;
  (apu.labor||[]).forEach((r,i)=>{const n=rows.length+1;add([i+1,r.clave,r.descripcion,r.unidad,Number(r.cuadrilla||0),Number(r.rendimiento||0),Number(r.jornada||0),asCell(Number(r.salarioBase||0),XLS.input),asCell(Number(r.fsr||1),XLS.input),formula(Number(r.rendimiento)>0?`=E${n}/F${n}*H${n}*I${n}`:`=${Number(r.cantidad||0)}*H${n}*I${n}`),sourceText(r),apuDataStateLabel(r.fuente?.estado)]);});
  const moEnd=rows.length; const moTotal=subtotal('SUBTOTAL MANO DE OBRA',moStart,moEnd); add([]);

  span('2. MATERIALES Y CONSUMIBLES',COLORS.materials); head(['No.','Clave','Descripcion','Unidad','Cantidad','Desperdicio %','Cantidad neta','Precio unitario','', 'Importe','Fuente','Estado']);
  const matStart=rows.length+1;
  (apu.materials||[]).forEach((r,i)=>{const n=rows.length+1;add([i+1,r.clave,r.descripcion,r.unidad,asCell(Number(r.consumo||0),XLS.input),asCell(Number(r.desperdicioPct||0),XLS.input),formula(`=E${n}*(1+F${n}/100)`,XLS.qty),asCell(Number(r.precioUnitario||0),XLS.input),null,formula(`=G${n}*H${n}`),sourceText(r),apuDataStateLabel(r.fuente?.estado)]);});
  const matEnd=rows.length; const matTotal=subtotal('SUBTOTAL MATERIALES',matStart,matEnd); add([]);

  span('3. HERRAMIENTA MENOR',COLORS.tools); head(['No.','Clave','Descripcion','Unidad','Cantidad','Depreciacion %','','Valor adquisicion','','Importe','Fuente','']);
  const toolStart=rows.length+1;
  if(apu.herramientaMenor?.modo==='detalle') (apu.herramientaMenor.detalle||[]).forEach((r,i)=>{const n=rows.length+1;add([i+1,r.clave,r.descripcion,r.unidad,Number(r.cantidad||0),Number(r.depreciacionPct||0),null,Number(r.valorAdquisicion||r.precioUnitario||0),null,formula(`=E${n}*H${n}*F${n}/100`),sourceText(r),null]);});
  const toolEnd=rows.length; const toolTotal=apu.herramientaMenor?.modo==='detalle'?subtotal('SUBTOTAL HERRAMIENTA',toolStart,toolEnd):add([null,asCell('SUBTOTAL HERRAMIENTA (% M.O.)',{columnSpan:8,fontWeight:'bold',align:'right'}),...Array(7).fill(null),formula(`=J${moTotal}*${Number(apu.herramientaMenor?.porcentaje||0)}/100`,{fontWeight:'bold'}),null,null]); add([]);

  span('4. EQUIPO, MAQUINARIA Y ANDAMIOS',COLORS.equipment); head(['No.','Clave','Descripcion','Unidad','Cantidad','Tarifa','Rendimiento','','','Importe','Fuente','Estado']);
  const eqStart=rows.length+1;(apu.equipment||[]).forEach((r,i)=>{const n=rows.length+1;add([i+1,r.clave,r.descripcion,r.unidad,Number(r.cantidad||0),Number(r.tarifa||0),Number(r.rendimiento||0),null,null,formula(`=E${n}*F${n}`),sourceText(r),apuDataStateLabel(r.fuente?.estado)]);});
  const eqEnd=rows.length;const eqTotal=subtotal('SUBTOTAL EQUIPO',eqStart,eqEnd);add([]);

  span('5. SEGURIDAD Y PROTECCION',COLORS.safety);head(['No.','Clave','Descripcion','Unidad','Cantidad','Precio','','','','Importe','Observaciones','']);
  const spStart=rows.length+1;(apu.seguridad||[]).forEach((r,i)=>{const n=rows.length+1;add([i+1,r.clave,r.descripcion,r.unidad,Number(r.cantidad||0),Number(r.precioUnitario||0),null,null,null,formula(`=E${n}*F${n}`),r.observaciones,null]);});
  const spEnd=rows.length;const spTotal=subtotal('SUBTOTAL SEGURIDAD',spStart,spEnd);add([]);

  span('6. PROCEDIMIENTO DE EJECUCION',COLORS.procedure);(apu.procedimientoConstructivo||[]).forEach((v,i)=>add([i+1,asCell(v,{columnSpan:11,wrap:true}),...Array(10).fill(null)]));add([]);
  span('7. CONTROL DE CALIDAD Y TOLERANCIAS',COLORS.quality);(apu.controlCalidad||[]).forEach((v,i)=>add([i+1,asCell(v.especificacion||v,{columnSpan:5,wrap:true}),...Array(4).fill(null),asCell(v.criterio||'',{columnSpan:6,wrap:true}),...Array(5).fill(null)]));add([]);
  span('8. CRITERIO DE MEDICION Y FORMA DE PAGO',COLORS.measure);add([asCell('Unidad contractual',XLS.label),apu.criterioMedicion?.unidadMedicion||apu.unit,asCell('Incluye',XLS.label),asCell((apu.criterioMedicion?.incluye||[]).join('; '),{columnSpan:4,wrap:true}),...Array(3).fill(null),asCell('Excluye',XLS.label),asCell((apu.criterioMedicion?.excluye||[]).join('; '),{columnSpan:3,wrap:true}),...Array(2).fill(null)]);add([asCell('Criterio',XLS.label),asCell(apu.criterioMedicion?.criterio||'',{columnSpan:4,wrap:true}),...Array(3).fill(null),asCell('Forma de pago',XLS.label),asCell(apu.criterioMedicion?.formaPago||'',{columnSpan:3,wrap:true}),...Array(2).fill(null),asCell('Observaciones',XLS.label),apu.criterioMedicion?.observaciones||'',null]);add([]);

  span('9-14. INTEGRACION DEL PRECIO UNITARIO');head(['Concepto','','','','','','','','Base / tasa','Importe','','']);
  const direct=add(['COSTO DIRECTO',null,null,null,null,null,null,null,'MO + MAT + HM + EQ + SP',formula(`=SUM(J${moTotal},J${matTotal},J${toolTotal},J${eqTotal},J${spTotal})`),null,null]);
  const indirect=add(['Indirectos',null,null,null,null,null,null,null,`${Number(apu.factores?.indCampo||0)+Number(apu.factores?.indOficina||0)}%`,formula(`=J${direct}*${Number(apu.factores?.indCampo||0)+Number(apu.factores?.indOficina||0)}/100`),null,null]);
  const finance=add(['Financiamiento',null,null,null,null,null,null,null,`${Number(apu.factores?.finance||0)}%`,formula(`=(J${direct}+J${indirect})*${Number(apu.factores?.finance||0)}/100`),null,null]);
  const utility=add(['Utilidad',null,null,null,null,null,null,null,`${Number(apu.factores?.utility||0)}%`,formula(`=(J${direct}+J${indirect}+J${finance})*${Number(apu.factores?.utility||0)}/100`),null,null]);
  const charges=add(['Cargos adicionales',null,null,null,null,null,null,null,`${Number(apu.factores?.cargos||0)}%`,formula(`=(J${direct}+J${indirect}+J${finance}+J${utility})*${Number(apu.factores?.cargos||0)}/100`),null,null]);
  const subtotalRow=add(['SUBTOTAL ANTES DE IVA',null,null,null,null,null,null,null,null,formula(`=SUM(J${direct}:J${charges})`,{fontWeight:'bold'}),null,null]);
  const iva=add(['IVA',null,null,null,null,null,null,null,`${Number(apu.factores?.iva||0)}%`,formula(`=J${subtotalRow}*${Number(apu.factores?.iva||0)}/100`),null,null]);
  const pu=add([asCell('PRECIO UNITARIO FINAL',{fontWeight:'bold',color:'#FFFFFF',backgroundColor:'#2F7D3A'}),null,null,null,null,null,null,null,null,formula(`=J${subtotalRow}`,{fontWeight:'bold',color:'#FFFFFF',backgroundColor:'#2F7D3A'}),null,null]);
  add(['IMPORTE TOTAL',null,null,null,null,null,null,null,`${Number(apu.cantidadObra||0)} ${apu.unit}`,formula(`=J${pu}*${Number(apu.cantidadObra||0)}`,{fontWeight:'bold'}),null,null]);add([]);

  span('15. FUENTES DE PRECIOS',COLORS.measure);head(['Recurso','Clave','Descripcion','Unidad','Precio','Fecha','Proveedor','Tipo','Verificado','Fuente','URL','Confianza']);
  ['materials','labor','equipment'].flatMap(k=>(apu[k]||[]).map(r=>[k,r])).forEach(([kind,r])=>add([kind,r.clave,r.descripcion,r.unidad,Number(r.precioUnitario??r.salarioBase??r.tarifa??0),r.fuente?.fecha||'',r.fuente?.proveedor||'',apuDataStateLabel(r.fuente?.estado),r.fuente?.estado==='VERIFICADO'?'SI':'NO',r.fuente?.sourceName||'',r.fuente?.sourceUrl||'',Number(r.fuente?.confidence||0)]));add([]);
  span('16-17. SUPUESTOS, CONFIANZA Y FIRMAS');(apu.supuestos||[]).forEach((v,i)=>add([i+1,asCell(v.texto||v,{columnSpan:11,wrap:true}),...Array(10).fill(null)]));
  add([asCell('Confianza',XLS.label),`${apu.confidence.score}% ${apu.confidence.level}`,asCell('Precios',XLS.label),`${apu.confidence.dimensions.precios}%`,asCell('Rendimientos',XLS.label),`${apu.confidence.dimensions.rendimientos}%`,asCell('Riesgos',XLS.label),apu.confidence.risks,asCell('Estado',XLS.label),apu.validationStatus,null,null]);
  add([asCell('Elaboro',XLS.label),apu.elaboro||'',null,asCell('Reviso',XLS.label),apu.reviso||'',null,asCell('Aprobo',XLS.label),apu.aprobo||'',null,asCell('Version',XLS.label),apu.version||'V1',null]);
  return {sheet:safeSheet(`${apu.clave}_${String(apu.concept).split(/\s+/).slice(0,2).join('_')}`),rows,widths,stickyRowsCount:4,apu};
}

export function buildProfessionalSummarySheet(apus){
  const rows=[[asCell('RESUMEN GENERAL DEL PRESUPUESTO',{...XLS.title,columnSpan:12}),...Array(11).fill(null)],['Clave','Concepto','Unidad','Cantidad','PU original (Excel)','PU calculado (Motor v2)','Diferencia','Importe sin IVA','IVA','Importe con IVA','Estado','Confianza'].map(v=>asCell(v,XLS.head))];
  const finalized=apus.map(raw=>finalizeProfessionalAPU(raw));
  finalized.forEach(a=>{
    const puCalc=Number(a.calculated.pu||0);
    const puOriginal=Number(a.referencePU||0);
    const diferencia=puOriginal>0?puCalc-puOriginal:null;
    rows.push([
      a.clave,a.concept,a.unit,Number(a.cantidadObra||0),
      puOriginal>0?puOriginal:asCell('Sin referencia',{color:'#8A6B2E'}),
      puCalc,
      diferencia==null?asCell('—',{color:'#8A6B2E'}):asCell(diferencia,{color:Math.abs(diferencia)>puOriginal*0.15?'#B54A62':'#211A29',fontWeight:Math.abs(diferencia)>puOriginal*0.15?'bold':'normal'}),
      Number(a.calculated.importeTotal||0),
      Number(a.calculated.iva||0)*Number(a.cantidadObra||0),
      Number(a.calculated.importeTotal||0)+Number(a.calculated.iva||0)*Number(a.cantidadObra||0),
      a.validationStatus,
      `${a.confidence.score}%`
    ]);
  });
  const first=3,last=rows.length;
  rows.push(['','','','','','',asCell('TOTALES',{fontWeight:'bold'}),formula(`=SUM(H${first}:H${last})`,{fontWeight:'bold'}),formula(`=SUM(I${first}:I${last})`,{fontWeight:'bold'}),formula(`=SUM(J${first}:J${last})`,{fontWeight:'bold'}),'','']);
  rows.push(['Costo directo acumulado',finalized.reduce((s,a)=>s+a.calculated.direct*Number(a.cantidadObra||0),0),'Indirectos',finalized.reduce((s,a)=>s+a.calculated.indirect*Number(a.cantidadObra||0),0),'Financiamiento',finalized.reduce((s,a)=>s+a.calculated.finance*Number(a.cantidadObra||0),0),'Utilidad',finalized.reduce((s,a)=>s+a.calculated.utility*Number(a.cantidadObra||0),0),'Cargos',finalized.reduce((s,a)=>s+a.calculated.cargos*Number(a.cantidadObra||0),0)]);
  return {sheet:'RESUMEN',rows,widths:[16,50,10,12,16,18,14,16,14,16,20,12],stickyRowsCount:2};
}

/* Bandeja de Revision Tecnica en Excel (Fase 8 requisito 9): una fila por
   concepto con las mismas columnas que la bandeja en pantalla (ver
   src/domain/apuReview.js#buildReviewRow), para poder revisar/filtrar sin
   abrir la app. "Confianza tecnica"/"Confianza precios" reusan la
   confianza re-etiquetada de calculateAPUConfidence (apu.confidence.presentation);
   "Evidencia mercado" es la cobertura de fuentes cost-weighted (independiente
   de la calidad tecnica de esa evidencia). Nunca decide "validado" por si
   sola: el estado que se exporta es el mismo REVISION_STATUS ya derivado o
   confirmado en la app (deriveRevisionStatus/applyRevisionDecision). */
export function buildControlRevisionSheet(apus){
  const list = Array.isArray(apus) ? apus : [apus];
  const finalized = list.map(raw => finalizeProfessionalAPU(raw));
  const rows = [[asCell('BANDEJA DE REVISION TECNICA', { ...XLS.title, columnSpan: 10 }), ...Array(9).fill(null)],
    ['Clave', 'Concepto', 'PU original', 'PU ZOEMEC', 'Diferencia %', 'Confianza técnica', 'Confianza precios', 'Evidencia mercado', 'Rendimiento validado', 'Estado / Observaciones'].map(v => asCell(v, XLS.head))];
  finalized.forEach(apu => {
    const r = buildReviewRow(apu);
    const diffStyle = r.diferenciaPct != null && Math.abs(r.diferenciaPct) > 25 ? { color: '#B54A62', fontWeight: 'bold' } : {};
    const motivos = (r.motivos || []).join('; ');
    rows.push([
      r.clave, r.concept,
      r.puOriginal != null ? r.puOriginal : asCell('Sin referencia', { color: '#8A6B2E' }),
      r.puCalculado,
      r.diferenciaPct != null ? asCell(Number(r.diferenciaPct.toFixed(1)), diffStyle) : asCell('—', { color: '#8A6B2E' }),
      `${apu.confidence.presentation.confianzaTecnica}%`,
      `${apu.confidence.presentation.confianzaPrecios}%`,
      `${r.evidenciaMercado}%`,
      r.rendimientoValidado ? 'SI' : 'NO',
      asCell(`${REVISION_STATUS_LABEL[r.estado] || r.estado}${motivos ? ' -- ' + motivos : ''}`, { wrap: true })
    ]);
  });
  return { sheet: 'CONTROL_REVISION', rows, widths: [16, 46, 14, 14, 12, 15, 15, 15, 16, 46], stickyRowsCount: 2 };
}

/* Hoja agregada del lote completo: una fila POR REFERENCIA REAL encontrada
   (Price Intelligence, ver src/domain/priceIntelligence.js) en cualquier
   concepto -- a diferencia de la seccion "15. FUENTES DE PRECIOS" de cada
   hoja individual (que solo muestra 1 proveedor por renglon), aqui se ve
   cada fuente consultada por separado con su presentacion/conversion/outlier,
   para poder defender "esta es la mediana de estas N fuentes reales". Los
   recursos sin ninguna referencia (busqueda sin evidencia, ESTIMADO_IA)
   tambien aparecen, con una sola fila que deja constancia de que se intento
   la busqueda y no hubo resultado -- nunca se omiten en silencio. */
export function buildPriceIntelligenceSheet(apus){
  const list=Array.isArray(apus)?apus:[apus];
  const finalized=list.map(raw=>finalizeProfessionalAPU(raw));
  const rows=[[asCell('FUENTES DE PRECIOS -- LOTE COMPLETO (Price Intelligence + validacion de equivalencia tecnica)',{...XLS.title,columnSpan:16}),...Array(15).fill(null)],
    ['Concepto (clave)','Recurso','Descripcion','Proveedor','URL','Precio original','Presentacion original','Unidad original','Factor conversion','Precio normalizado','Fecha','Outlier','Coincidencia tecnica','Veredicto','Motivo de rechazo','Precio recomendado (mediana, solo ALTO)'].map(v=>asCell(v,XLS.head))];
  let any=false;
  finalized.forEach(apu=>{
    ['materials','labor','equipment','seguridad'].forEach(kind=>{
      (apu[kind]||[]).forEach(row=>{
        const pr=row.priceRecord;
        // evidenceLevel solo lo pone priceRecordFromMarketIntelligence: un
        // priceRecord generico (el que finalizeProfessionalAPU crea por
        // defecto para CUALQUIER renglon, aunque nunca se haya intentado
        // buscar precio de mercado) no debe aparecer aqui como "sin
        // evidencia" -- eso ensuciaria la hoja con renglones que ni siquiera
        // pasaron por Price Intelligence.
        if(!pr || pr.evidenceLevel==null) return;
        const refs=Array.isArray(pr.references)?pr.references:[];
        if(pr.technicalSpec){
          const ft=pr.technicalSpec;
          rows.push([apu.clave,kind,asCell(`Ficha tecnica: familia="${ft.familia||''}" material="${ft.material||''}" dimensiones="${ft.dimensiones||''}" obligatorias=[${(ft.keywordsObligatorias||[]).join(', ')}] excluyentes=[${(ft.keywordsExcluyentes||[]).join(', ')}]`,{columnSpan:14,color:'#5B6472',wrap:true}),...Array(13).fill(null)]);
        }
        if(!refs.length){
          rows.push([apu.clave,kind,row.descripcion,asCell('Sin evidencia externa',{color:'#8A6B2E'}),'','','','','','','','','','',apuEvidenceLabel(pr.evidenceLevel||'ESTIMADO_IA'),'']);
          any=true;
          return;
        }
        refs.forEach(ref=>{
          any=true;
          const verdict=ref.match?.verdict||'';
          const verdictStyle=verdict==='ALTO'?{color:'#1E7D32',fontWeight:'bold'}:verdict==='MEDIO'?{color:'#8A6B2E'}:{color:'#B54A62'};
          rows.push([
            apu.clave,kind,row.descripcion,ref.proveedor,ref.url,
            Number(ref.precioOriginal||0),ref.presentacionOriginal,ref.unidadOriginal,
            Number(ref.factorConversion||1),Number(ref.precioNormalizado||0),ref.fecha,
            ref.outlier?asCell('SI',{color:'#B54A62',fontWeight:'bold'}):'NO',
            ref.match?`${ref.match.score}%`:'',
            asCell(verdict,verdictStyle),
            ref.match?.rejectReason||'',
            pr.stats?.mediana!=null?Number(pr.stats.mediana):''
          ]);
        });
      });
    });
  });
  return any?{sheet:'FUENTES_PRECIOS',rows,widths:[16,10,38,20,28,12,16,12,10,14,12,8,10,10,36,16],stickyRowsCount:2}:null;
}
function apuEvidenceLabel(level){
  return level==='MERCADO'?'MERCADO (>=3 ALTO)':level==='REFERENCIAL'?'REFERENCIAL (1-2 ALTO)':level==='VALIDADO'?'VALIDADO':'ESTIMADO IA (sin ref. ALTO)';
}

/* El catalogo real puede repetir la misma clave para renglones distintos
   (misma partida, cantidad/ubicacion diferente -- ej. EBDI 71 CD Victoria
   trae la clave 387 dos veces, 24 pza y 11 pza). buildProfessionalAPUSheet
   nombra la hoja solo con la clave, asi que dos renglones con la misma clave
   generaban el MISMO nombre de hoja -- Excel no permite hojas duplicadas, y
   la segunda se perdia en silencio. Aqui se desambigua con un sufijo (2),
   (3)... SOLO cuando de verdad colisiona, respetando el limite de 31
   caracteres de Excel. */
function disambiguateSheetNames(sheets){
  const seen=new Map();
  return sheets.map(s=>{
    const count=(seen.get(s.sheet)||0)+1;
    seen.set(s.sheet,count);
    if(count===1) return s;
    const suffix=` (${count})`;
    return {...s,sheet:safeSheet(s.sheet.slice(0,31-suffix.length)+suffix)};
  });
}

export async function exportAPUExcelV2(apus,options={}){
  const list=Array.isArray(apus)?apus:[apus];
  const priceSheet=buildPriceIntelligenceSheet(list);
  const conceptSheets=disambiguateSheetNames(list.map(buildProfessionalAPUSheet));
  const sheets=[buildProfessionalSummarySheet(list),buildControlRevisionSheet(list),...conceptSheets,...(priceSheet?[priceSheet]:[])];
  await exportWorkbookExcel(sheets,options.fileName||'APU-PROFESIONAL-ZOEMEC.xlsx',options.writeXlsxFileImpl||writeXlsxFileBrowser); return sheets;
}

/* PDF individual A4 vertical profesional. Estructura fija en 3 grupos de
   contenido (Pagina 1: identificacion + matriz de recursos + costo directo;
   Pagina 2: integracion economica + procedimiento; Pagina 3: calidad +
   medicion + fuentes + supuestos + firmas), pero el NUMERO de paginas se
   adapta al contenido real: si un grupo no cabe en una pagina, sigue en la
   siguiente (ensure() ya hacia esto); lo nuevo es que ademas se fuerza un
   salto de pagina ENTRE grupos (nextGroup()) para que cada grupo arranque
   limpio, en vez de quedar partido a la mitad solo porque sobraba espacio. */
export function exportAPUPdfV2(rawApu,options={}){
  const apu=finalizeProfessionalAPU(rawApu); const t=apu.calculated; const doc=new jsPDF('portrait','mm','a4'); const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight(),M=12;let y=12,page=1;
  const pdfText=value=>String(value??'').replace(/\u00b2/g,'2').replace(/\u00b3/g,'3').replace(/\u00b1/g,'+/-').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const footer=()=>{doc.setFontSize(6.5);doc.setTextColor(120);doc.text(pdfText(`${apu.clave} | ${apu.concept.slice(0,55)}`),M,H-6);doc.text(`Pagina ${page}`,W-M,H-6,{align:'right'});};
  const newPage=()=>{footer();doc.addPage();page++;y=12;header();};
  const ensure=h=>{if(y+h>H-13) newPage();};
  const nextGroup=()=>{ if(y>M+2) newPage(); };
  const header=()=>{doc.setFillColor(18,63,120);doc.rect(M,y,W-2*M,11,'F');doc.setTextColor(255);doc.setFont('helvetica','bold');doc.setFontSize(10.5);doc.text('ANALISIS DE PRECIO UNITARIO (APU)',W/2,y+7.3,{align:'center'});y+=14;
    doc.setTextColor(25);doc.setFontSize(7);doc.setFont('helvetica','normal');
    doc.text(pdfText(`Clave: ${apu.clave}   Unidad: ${apu.unit}   Cantidad: ${num(apu.cantidadObra)}`),M,y);y+=4.2;
    doc.text(pdfText(`Proyecto: ${apu.proyecto||'Por definir'}   Cliente: ${apu.cliente||'Por definir'}   Fecha base: ${apu.fechaBase||''}`),M,y);y+=4.2;
    doc.setFont('helvetica','bold');const conceptLines=doc.splitTextToSize(pdfText(apu.concept),W-2*M);doc.text(conceptLines,M,y);doc.setFont('helvetica','normal');y+=conceptLines.length*3.6+3;
  };
  /* Tabla de ancho proporcional (widthsRatio), en vez de columnas iguales: en
     A4 vertical (186mm utiles) una descripcion de insumo necesita mucho mas
     espacio que su clave o su importe. */
  const table=(title,color,heads,rows,widthsRatio)=>{
    const ratios=widthsRatio||heads.map(()=>1); const totalRatio=ratios.reduce((a,b)=>a+b,0);
    const colW=ratios.map(r=>(W-2*M)*r/totalRatio);
    const colX=[M]; colW.forEach((w,i)=>{ if(i<colW.length-1) colX.push(colX[i]+w); });
    ensure(13+rows.length*5.2);
    doc.setFillColor(...color);doc.rect(M,y,W-2*M,6,'F');doc.setTextColor(255);doc.setFont('helvetica','bold');doc.setFontSize(7.2);doc.text(pdfText(title),M+2,y+4.3);y+=6;
    doc.setTextColor(30);doc.setFontSize(6);doc.setFont('helvetica','bold');
    heads.forEach((h,i)=>doc.text(pdfText(h),colX[i]+1,y+3.6));y+=5;
    doc.setFont('helvetica','normal');
    rows.forEach(row=>{
      const wrapped=row.map((v,i)=>doc.splitTextToSize(pdfText(v),colW[i]-2));
      const rh=Math.max(4.6,Math.max(...wrapped.map(w=>w.length))*3.1);
      ensure(rh+1);
      doc.setDrawColor(220);doc.line(M,y,W-M,y);
      wrapped.forEach((w,i)=>doc.text(w,colX[i]+1,y+3.4));
      y+=rh;
    });
    y+=2.5;
  };
  const kv=(label,value,color)=>{ensure(6);doc.setFontSize(7.2);doc.setFont('helvetica','bold');doc.setTextColor(...(color||[30,30,30]));doc.text(pdfText(label),M,y+3.6);doc.setFont('helvetica','normal');doc.setTextColor(30);doc.text(pdfText(value),W-M,y+3.6,{align:'right'});y+=5.5;};

  header();
  // ---- PAGINA 1: identificacion (ya en header) + matriz de recursos + costo directo ----
  table('1. MANO DE OBRA',[18,63,120],['Clave','Descripcion','Cuad.','Rend.','Salario','FSR','Importe'],
    (apu.labor||[]).map(r=>[r.clave,r.descripcion,r.cuadrilla||r.cantidad,r.rendimiento||'',money(r.salarioBase),r.fsr,money((Number(r.rendimiento)>0?Number(r.cuadrilla)/Number(r.rendimiento):Number(r.cantidad))*Number(r.salarioBase)*Number(r.fsr||1))]),
    [0.7,2.6,0.6,0.6,0.9,0.5,0.9]);
  table('2. MATERIALES',[213,106,0],['Clave','Descripcion','Cant.','Desp.%','Precio','Importe'],
    (apu.materials||[]).map(r=>[r.clave,r.descripcion,num(r.consumo),`${num(r.desperdicioPct)}%`,money(r.precioUnitario),money(Number(r.consumo)*(1+Number(r.desperdicioPct)/100)*Number(r.precioUnitario))]),
    [0.7,2.9,0.6,0.6,0.9,0.9]);
  table('3-5. HERRAMIENTA, EQUIPO Y SEGURIDAD',[47,125,58],['Rubro','Descripcion','Cant.','Precio/Tarifa','Fuente','Importe'],
    [...(apu.herramientaMenor?.detalle||[]).map(r=>['Herr.',r.descripcion,num(r.cantidad),money(r.valorAdquisicion),sourceText(r),money(Number(r.cantidad)*Number(r.valorAdquisicion)*Number(r.depreciacionPct)/100)]),
     ...(apu.equipment||[]).map(r=>['Equipo',r.descripcion,num(r.cantidad),money(r.tarifa),sourceText(r),money(Number(r.cantidad)*Number(r.tarifa))]),
     ...(apu.seguridad||[]).map(r=>['Seguridad',r.descripcion,num(r.cantidad),money(r.precioUnitario),r.observaciones||'',money(Number(r.cantidad)*Number(r.precioUnitario))])],
    [0.6,2.6,0.6,0.9,0.9,0.9]);
  ensure(20);doc.setFillColor(230,236,244);doc.rect(M,y,W-2*M,10,'F');doc.setFont('helvetica','bold');doc.setFontSize(8.5);doc.setTextColor(18,63,120);
  doc.text(pdfText(`COSTO DIRECTO: ${money(t.direct)}`),M+3,y+6.8);doc.setFont('helvetica','normal');y+=13;

  // ---- PAGINA 2: integracion economica + procedimiento ----
  nextGroup();
  ensure(10);doc.setFillColor(18,63,120);doc.rect(M,y,W-2*M,6,'F');doc.setTextColor(255);doc.setFont('helvetica','bold');doc.setFontSize(7.2);doc.text('9-14. INTEGRACION DEL PRECIO UNITARIO',M+2,y+4.3);y+=9;doc.setFont('helvetica','normal');
  kv('Costo directo',money(t.direct));
  kv(`Indirectos (${Number(apu.factores?.indCampo||0)+Number(apu.factores?.indOficina||0)}%)`,money(t.indirect));
  kv(`Financiamiento (${num(apu.factores?.finance)}%)`,money(t.finance));
  kv(`Utilidad (${num(apu.factores?.utility)}%)`,money(t.utility));
  kv(`Cargos adicionales (${num(apu.factores?.cargos)}%)`,money(t.cargos));
  ensure(8);doc.setDrawColor(18,63,120);doc.line(M,y,W-M,y);y+=1.5;
  doc.setFillColor(47,125,58);doc.rect(M,y,W-2*M,9,'F');doc.setTextColor(255);doc.setFont('helvetica','bold');doc.setFontSize(9);
  doc.text(pdfText('PRECIO UNITARIO'),M+3,y+6);doc.text(pdfText(money(t.pu)),W-M-3,y+6,{align:'right'});y+=12;doc.setFont('helvetica','normal');doc.setTextColor(30);
  kv(`IVA (${num(apu.factores?.iva)}%)`,money(t.iva));
  kv(`Importe total (${num(apu.cantidadObra)} ${apu.unit})`,money(t.importeTotal),[213,106,0]);
  y+=3;
  table('6. PROCEDIMIENTO DE EJECUCION',[109,45,145],['#','Paso'],
    (apu.procedimientoConstructivo||[]).map((v,i)=>[i+1,v]),[0.3,3.4]);

  // ---- PAGINA 3: calidad + medicion + fuentes + supuestos + confianza + firmas ----
  nextGroup();
  table('7. CONTROL DE CALIDAD Y TOLERANCIAS',[213,169,0],['Especificacion','Criterio'],
    (apu.controlCalidad||[]).map(v=>[v.especificacion||'',v.criterio||'']),[1.8,1.8]);
  ensure(9);doc.setFillColor(7,140,136);doc.rect(M,y,W-2*M,6,'F');doc.setTextColor(255);doc.setFont('helvetica','bold');doc.setFontSize(7.2);doc.text('8. CRITERIO DE MEDICION Y FORMA DE PAGO',M+2,y+4.3);y+=9;doc.setFont('helvetica','normal');doc.setTextColor(30);doc.setFontSize(7);
  kv('Unidad contractual',apu.criterioMedicion?.unidadMedicion||apu.unit);
  {const incLines=doc.splitTextToSize(pdfText(`Incluye: ${(apu.criterioMedicion?.incluye||[]).join('; ')}`),W-2*M);ensure(incLines.length*3.4+2);doc.text(incLines,M,y+3.4);y+=incLines.length*3.4+1;}
  {const excLines=doc.splitTextToSize(pdfText(`Excluye: ${(apu.criterioMedicion?.excluye||[]).join('; ')}`),W-2*M);ensure(excLines.length*3.4+2);doc.text(excLines,M,y+3.4);y+=excLines.length*3.4+3;}
  table('15. FUENTES DE PRECIOS',[7,140,136],['Recurso','Proveedor/Fuente','Fecha','Estado'],
    ['materials','labor','equipment','seguridad'].flatMap(k=>(apu[k]||[]).map(r=>[r.descripcion,r.fuente?.proveedor||r.fuente?.sourceName||'Sin proveedor',r.fuente?.fecha||'',apuDataStateLabel(r.fuente?.estado)])),
    [2.6,1.6,0.9,1]);
  table('16. SUPUESTOS TECNICOS',[7,140,136],['#','Supuesto'],
    (apu.supuestos||[]).map((v,i)=>[i+1,v.texto||v]),[0.3,3.4]);
  ensure(9);doc.setFillColor(7,140,136);doc.rect(M,y,W-2*M,6,'F');doc.setTextColor(255);doc.setFont('helvetica','bold');doc.setFontSize(7.2);doc.text('17. CONFIANZA DEL ANALISIS',M+2,y+4.3);y+=9;doc.setFont('helvetica','normal');doc.setTextColor(30);doc.setFontSize(7);
  kv('Confianza global',`${apu.confidence.score}% ${apu.confidence.level}`);
  kv('Precios',`${apu.confidence.dimensions.precios}%`);
  kv('Rendimientos',`${apu.confidence.dimensions.rendimientos}%`);
  kv('Riesgos',apu.confidence.risks);
  y+=6;
  ensure(28);doc.setDrawColor(150);doc.setFontSize(7);doc.setTextColor(30);
  const sigW=(W-2*M-10)/3;
  ['Elaboro','Reviso','Aprobo'].forEach((label,i)=>{
    const x=M+i*(sigW+5);
    doc.line(x,y+16,x+sigW,y+16);
    doc.text(pdfText(label),x,y+20);
  });
  y+=24;

  footer(); if(options.save!==false)doc.save(options.fileName||`${apu.clave}-APU-PROFESIONAL-ZOEMEC.pdf`); return {doc,apu};
}
