import writeXlsxFileBrowser from 'write-excel-file/browser';
import { jsPDF } from 'jspdf';
import { calcAPUv2, calcEquipmentRow, calcSeguridadRow, APU_DEFAULT_FACTORS } from './apuCalc.js';
import { reconcileAPU, DEFAULT_RECONCILIATION_TOLERANCE } from './apuReconciliation.js';
import { finalizeProfessionalAPU, isStructurallyEmptyApu } from '../domain/apuProfessional.js';
import { runApuConfidence, formatGlobalConfidence, dimensionPercentLabel } from '../domain/apuConfidence.js';
import { apuDataStateLabel } from '../domain/apuSchema.js';
import { buildReviewRow, REVISION_STATUS_LABEL } from '../domain/apuReview.js';
import { computeConceptStatus, conceptStatusLabel } from '../domain/apuCompletionStatus.js';
import { xcell, fcell, XLS, exportWorkbookExcel, money, num } from './apuExport.js';

const COLORS={labor:'#123F78',materials:'#D56A00',tools:'#2F7D3A',equipment:'#1578B7',consumables:'#8C6D1F',safety:'#B5263D',procedure:'#6D2D91',quality:'#D5A900',measure:'#078C88'};
const NO_JUSTIFICATION_TEXT='Sin justificación técnica registrada -- APU generado antes de esta funcionalidad.';
export const safeSheet=value=>String(value||'APU').replace(/[\\/?*\[\]:]/g,'-').slice(0,31);
const sourceText=row=>row?.fuente?.sourceName||row?.fuente?.proveedor||apuDataStateLabel(row?.fuente?.estado);
const asCell=(value,style={})=>xcell(value,style);
const formula=(value,style={})=>fcell(value,{...XLS.calc,...style});
const integrationText=row=>{
  const kind=String(row?.integracion||'POR_UNIDAD_OBRA');
  const factor=Number(row?.factorUso??row?.factorReposicion??1)||1;
  return kind==='AMORTIZABLE'?`${kind} (factor ${factor})`:kind;
};
const equipmentFormula=(row,n,cantidadObra)=>{
  const kind=String(row?.integracion||'POR_UNIDAD_OBRA');
  if(kind==='POR_JORNADA') return `=E${n}*F${n}/I${n}`;
  if(kind==='POR_LOTE') return `=E${n}*F${n}/H${n}`;
  if(kind==='AMORTIZABLE') return `=E${n}*F${n}*${Number(row?.factorUso||1)}/H${n}/I${n}`;
  return `=E${n}*F${n}`;
};
const safetyFormula=(row,n)=>{
  const kind=String(row?.integracion||'POR_UNIDAD_OBRA');
  if(kind==='AMORTIZABLE') return `=E${n}*F${n}*${Number(row?.factorReposicion||1)}/H${n}/I${n}`;
  if(kind==='POR_LOTE') return `=E${n}*F${n}/H${n}`;
  return `=E${n}*F${n}`;
};
const integrationBase=(row,cantidadObra)=>String(row?.integracion||'POR_UNIDAD_OBRA')==='POR_LOTE'?Number(cantidadObra||0):Number(row?.vidaUtilDias||0);
const integrationYield=row=>Number(row?.rendimientoDiario??row?.rendimiento??0);
const pdfIntegration=row=>{
  const kind=String(row?.integracion||'POR_UNIDAD_OBRA');
  if(kind==='POR_JORNADA') return `Por jornada / rend. ${integrationYield(row)}`;
  if(kind==='POR_LOTE') return 'Por lote / cantidad contractual';
  if(kind==='AMORTIZABLE') return `Amort. ${Number(row?.vidaUtilDias||0)} dias / rend. ${integrationYield(row)} / factor ${Number(row?.factorUso??row?.factorReposicion??1)||1}`;
  return 'Por unidad de obra';
};

export function buildProfessionalAPUSheet(rawApu){
  const apu=finalizeProfessionalAPU(rawApu);
  // Fuente unica de verdad del Confidence global (ver apuConfidence.js):
  // nunca se usa apu.confidence.score/.level/.dimensions.* directamente en
  // ninguna celda visible -- ese objeto es la dimension interna
  // "composicion/precios/rendimientos/cantidades" SIN gating por fallas
  // criticas, y runApuConfidence() ya la reusa internamente + le aplica el
  // gating real (nunca se recalcula por separado, nunca se duplica logica).
  const globalConfidence=runApuConfidence(apu);
  const gc=formatGlobalConfidence(globalConfidence);
  const rows=[]; const widths=[11,17,38,12,12,13,13,13,16,20,16,18];
  const add=(row=[])=>{const full=[...row];while(full.length<12)full.push(null);rows.push(full);return rows.length;};
  const span=(text,color='#123F78')=>add([asCell(text,{columnSpan:12,fontWeight:'bold',color:'#FFFFFF',backgroundColor:color,align:'center'}),...Array(11).fill(null)]);
  const head=labels=>add(labels.map(v=>asCell(v,{fontWeight:'bold',backgroundColor:'#EAF0F7',align:'center',wrap:true,borderColor:'#B8C2CC',borderWidth:1})));
  const subtotal=(label,start,end)=>add([null,asCell(label,{columnSpan:8,fontWeight:'bold',align:'right'}),...Array(7).fill(null),formula(end>=start?`=SUM(J${start}:J${end})`:'=0',{fontWeight:'bold'}),null,null]);
  span('ANALISIS DE PRECIO UNITARIO (APU)');
  add([asCell('Proyecto',XLS.label),apu.proyecto,null,asCell('Cliente',XLS.label),apu.cliente,null,asCell('Fecha base',XLS.label),apu.fechaBase,null,asCell('Moneda',XLS.label),apu.moneda,null]);
  add([asCell('Ubicacion',XLS.label),apu.ubicacion,null,asCell('Partida',XLS.label),apu.partida,null,asCell('Clave',XLS.label),apu.clave,null,asCell('Version',XLS.label),apu.version||'V1',null]);
  add([asCell('Concepto',XLS.label),asCell(apu.concept,{columnSpan:8,wrap:true}),...Array(7).fill(null),asCell('Unidad',XLS.label),apu.unit,asCell('Cantidad',XLS.label),Number(apu.cantidadObra||0)]);
  // Variables detectadas (RC5): descripcion completa ya se ve arriba sin
  // recortar (apu.concept); aqui se muestran ademas los parametros tipados
  // que se hayan podido extraer del texto (distancia, volumen, piezas,
  // dimensiones), cuando existan -- nunca obligatorio, fila omitida si el
  // concepto no trae ninguno.
  const vars = apu.variables || {};
  const varParts = [];
  if(vars.distance != null) varParts.push(`Distancia: ${vars.distance} ${vars.distanceUnit || 'm'}`);
  if(vars.volume != null) varParts.push(`Volumen: ${vars.volume} ${vars.volumeUnit || ''}`.trim());
  if(vars.pieceCount != null) varParts.push(`Piezas: ${vars.pieceCount} ${vars.pieceUnit || ''}`.trim());
  if(Array.isArray(vars.dimensions) && vars.dimensions.length) varParts.push(`Dimensiones: ${vars.dimensions.join(', ')}`);
  if(vars.thickness != null) varParts.push(`Espesor: ${vars.thickness} ${vars.thicknessUnit || ''}`.trim());
  if(vars.depth != null) varParts.push(`Profundidad: ${vars.depth} ${vars.depthUnit || ''}`.trim());
  if(vars.height != null) varParts.push(`Altura: ${vars.height} ${vars.heightUnit || ''}`.trim());
  if(vars.diameter != null) varParts.push(`Diametro: ${vars.diameter} ${vars.diameterUnit || ''}`.trim());
  if(vars.weight != null) varParts.push(`Peso: ${vars.weight} ${vars.weightUnit || ''}`.trim());
  if(vars.strength != null) varParts.push(`Resistencia: ${vars.strength} ${vars.strengthUnit || ''}`.trim());
  if(vars.materialGrade) varParts.push(`Grado de material: ${vars.materialGrade}`);
  if(vars.dosage) varParts.push(`Dosificacion: ${vars.dosage}`);
  if(varParts.length) add([asCell('Variables detectadas',XLS.label),asCell(varParts.join('  |  '),{columnSpan:11,wrap:true}),...Array(10).fill(null)]);
  add([]);

  const justRow=(text)=>{const has=text&&String(text).trim();return add([asCell('Justificación técnica',XLS.label),asCell(has?text:NO_JUSTIFICATION_TEXT,{columnSpan:11,wrap:true,color:has?undefined:'#8A6B2E'}),...Array(10).fill(null)]);};
  const tj=apu.technicalJustifications||{};

  span('A. MATERIALES',COLORS.materials); head(['No.','Clave','Descripcion','Unidad','Cantidad','Desperdicio %','Cantidad neta','Precio unitario','', 'Importe','Fuente','Estado']);
  const matStart=rows.length+1;
  (apu.materials||[]).forEach((r,i)=>{const n=rows.length+1;add([i+1,r.clave,r.descripcion,r.unidad,asCell(Number(r.consumo||0),XLS.input),asCell(Number(r.desperdicioPct||0),XLS.input),formula(`=E${n}*(1+F${n}/100)`,XLS.qty),asCell(Number(r.precioUnitario||0),XLS.input),null,formula(`=G${n}*H${n}`),sourceText(r),apuDataStateLabel(r.fuente?.estado)]);});
  const matEnd=rows.length; const matTotal=subtotal('SUBTOTAL MATERIALES',matStart,matEnd); justRow(tj.materials); add([]);

  span('B. MANO DE OBRA',COLORS.labor); head(['No.','Clave','Descripcion','Unidad','Cuadrilla','Rendimiento','Jornada','Salario base','FSR','Importe','Fuente','Estado']);
  const moStart=rows.length+1;
  (apu.labor||[]).forEach((r,i)=>{const n=rows.length+1;add([i+1,r.clave,r.descripcion,r.unidad,Number(r.cuadrilla||0),Number(r.rendimiento||0),Number(r.jornada||0),asCell(Number(r.salarioBase||0),XLS.input),asCell(Number(r.fsr||1),XLS.input),formula(Number(r.rendimiento)>0?`=E${n}/F${n}*H${n}*I${n}`:`=${Number(r.cantidad||0)}*H${n}*I${n}`),sourceText(r),apuDataStateLabel(r.fuente?.estado)]);});
  const moEnd=rows.length; const moTotal=subtotal('SUBTOTAL MANO DE OBRA',moStart,moEnd); justRow(tj.labor); add([]);

  span('C. EQUIPO Y MAQUINARIA',COLORS.equipment); head(['No.','Clave','Descripcion','Unidad','Cantidad','Tarifa / adquisicion','Integracion','Vida util / base','Rendimiento','Importe efectivo','Fuente','Estado']);
  const eqStart=rows.length+1;(apu.equipment||[]).forEach((r,i)=>{const n=rows.length+1;add([i+1,r.clave,r.descripcion,r.unidad,Number(r.cantidad||0),Number(r.tarifa||0),integrationText(r),integrationBase(r,apu.cantidadObra),integrationYield(r),formula(equipmentFormula(r,n,apu.cantidadObra)),sourceText(r),apuDataStateLabel(r.fuente?.estado)]);});
  const eqEnd=rows.length;const eqTotal=subtotal('SUBTOTAL EQUIPO',eqStart,eqEnd);justRow(tj.equipment);add([]);

  span('D. HERRAMIENTA MENOR',COLORS.tools); head(['No.','Clave','Descripcion','Unidad','Cantidad','Depreciacion %','','Valor adquisicion','','Importe','Fuente','']);
  const toolStart=rows.length+1;
  if(apu.herramientaMenor?.modo==='detalle') (apu.herramientaMenor.detalle||[]).forEach((r,i)=>{const n=rows.length+1;add([i+1,r.clave,r.descripcion,r.unidad,Number(r.cantidad||0),Number(r.depreciacionPct||0),null,Number(r.valorAdquisicion||r.precioUnitario||0),null,formula(`=E${n}*H${n}*F${n}/100`),sourceText(r),null]);});
  const toolEnd=rows.length; const toolTotal=apu.herramientaMenor?.modo==='detalle'?subtotal('SUBTOTAL HERRAMIENTA',toolStart,toolEnd):add([null,asCell('SUBTOTAL HERRAMIENTA (% M.O.)',{columnSpan:8,fontWeight:'bold',align:'right'}),...Array(7).fill(null),formula(`=J${moTotal}*${Number(apu.herramientaMenor?.porcentaje||0)}/100`,{fontWeight:'bold'}),null,null]); justRow(tj.smallTools); add([]);

  span('E. CONSUMIBLES Y AUXILIARES',COLORS.consumables); head(['No.','Clave','Descripcion','Unidad','Cantidad','Desperdicio %','Cantidad neta','Precio unitario','', 'Importe','Fuente','Estado']);
  const consStart=rows.length+1;
  (apu.consumables||[]).forEach((r,i)=>{const n=rows.length+1;add([i+1,r.clave,r.descripcion,r.unidad,asCell(Number(r.consumo||0),XLS.input),asCell(Number(r.desperdicioPct||0),XLS.input),formula(`=E${n}*(1+F${n}/100)`,XLS.qty),asCell(Number(r.precioUnitario||0),XLS.input),null,formula(`=G${n}*H${n}`),sourceText(r),apuDataStateLabel(r.fuente?.estado)]);});
  const consEnd=rows.length; const consTotal=(apu.consumables||[]).length?subtotal('SUBTOTAL CONSUMIBLES',consStart,consEnd):add([null,asCell('SUBTOTAL CONSUMIBLES',{columnSpan:8,fontWeight:'bold',align:'right'}),...Array(7).fill(null),formula('=0',{fontWeight:'bold'}),null,null]); justRow(tj.consumables); add([]);

  span('F. SEGURIDAD Y EPP',COLORS.safety);head(['No.','Clave','Descripcion','Unidad','Cantidad','Precio / adquisicion','Integracion','Vida util / base','Rendimiento','Importe efectivo','Observaciones','Estado']);
  const spStart=rows.length+1;(apu.seguridad||[]).forEach((r,i)=>{const n=rows.length+1;add([i+1,r.clave,r.descripcion,r.unidad,Number(r.cantidad||0),Number(r.precioUnitario||0),integrationText(r),integrationBase(r,apu.cantidadObra),integrationYield(r),formula(safetyFormula(r,n)),r.observaciones,apuDataStateLabel(r.fuente?.estado)]);});
  const spEnd=rows.length;const spTotal=subtotal('SUBTOTAL SEGURIDAD',spStart,spEnd);justRow(tj.safety);add([]);

  span('7. PROCEDIMIENTO DE EJECUCION',COLORS.procedure);(apu.procedimientoConstructivo||[]).forEach((v,i)=>add([i+1,asCell(v,{columnSpan:11,wrap:true}),...Array(10).fill(null)]));add([]);
  span('8. CONTROL DE CALIDAD Y TOLERANCIAS',COLORS.quality);(apu.controlCalidad||[]).forEach((v,i)=>add([i+1,asCell(v.especificacion||v,{columnSpan:5,wrap:true}),...Array(4).fill(null),asCell(v.criterio||'',{columnSpan:6,wrap:true}),...Array(5).fill(null)]));add([]);
  span('9. CRITERIO DE MEDICION Y FORMA DE PAGO',COLORS.measure);add([asCell('Unidad contractual',XLS.label),apu.criterioMedicion?.unidadMedicion||apu.unit,asCell('Incluye',XLS.label),asCell((apu.criterioMedicion?.incluye||[]).join('; '),{columnSpan:4,wrap:true}),...Array(3).fill(null),asCell('Excluye',XLS.label),asCell((apu.criterioMedicion?.excluye||[]).join('; '),{columnSpan:3,wrap:true}),...Array(2).fill(null)]);add([asCell('Criterio',XLS.label),asCell(apu.criterioMedicion?.criterio||'',{columnSpan:4,wrap:true}),...Array(3).fill(null),asCell('Forma de pago',XLS.label),asCell(apu.criterioMedicion?.formaPago||'',{columnSpan:3,wrap:true}),...Array(2).fill(null),asCell('Observaciones',XLS.label),apu.criterioMedicion?.observaciones||'',null]);add([]);

  span('10-15. INTEGRACION DEL PRECIO UNITARIO');head(['Concepto','','','','','','','','Base / tasa','Importe','','']);
  const direct=add(['COSTO DIRECTO',null,null,null,null,null,null,null,'MAT + MO + EQ + HM + CON + SEG',formula(`=SUM(J${matTotal},J${moTotal},J${eqTotal},J${toolTotal},J${consTotal},J${spTotal})`),null,null]);
  const indirect=add(['Indirectos',null,null,null,null,null,null,null,`${Number(apu.factores?.indCampo||0)+Number(apu.factores?.indOficina||0)}%`,formula(`=J${direct}*${Number(apu.factores?.indCampo||0)+Number(apu.factores?.indOficina||0)}/100`),null,null]);
  const finance=add(['Financiamiento',null,null,null,null,null,null,null,`${Number(apu.factores?.finance||0)}%`,formula(`=(J${direct}+J${indirect})*${Number(apu.factores?.finance||0)}/100`),null,null]);
  const utility=add(['Utilidad',null,null,null,null,null,null,null,`${Number(apu.factores?.utility||0)}%`,formula(`=(J${direct}+J${indirect}+J${finance})*${Number(apu.factores?.utility||0)}/100`),null,null]);
  const charges=add(['Cargos adicionales',null,null,null,null,null,null,null,`${Number(apu.factores?.cargos||0)}%`,formula(`=(J${direct}+J${indirect}+J${finance}+J${utility})*${Number(apu.factores?.cargos||0)}/100`),null,null]);
  const subtotalRow=add(['SUBTOTAL ANTES DE IVA',null,null,null,null,null,null,null,null,formula(`=SUM(J${direct}:J${charges})`,{fontWeight:'bold'}),null,null]);
  const iva=add(['IVA',null,null,null,null,null,null,null,`${Number(apu.factores?.iva||0)}%`,formula(`=J${subtotalRow}*${Number(apu.factores?.iva||0)}/100`),null,null]);
  const pu=add([asCell('PRECIO UNITARIO FINAL',{fontWeight:'bold',color:'#FFFFFF',backgroundColor:'#2F7D3A'}),null,null,null,null,null,null,null,null,formula(`=J${subtotalRow}`,{fontWeight:'bold',color:'#FFFFFF',backgroundColor:'#2F7D3A'}),null,null]);
  add(['IMPORTE TOTAL',null,null,null,null,null,null,null,`${Number(apu.cantidadObra||0)} ${apu.unit}`,formula(`=J${pu}*${Number(apu.cantidadObra||0)}`,{fontWeight:'bold'}),null,null]);add([]);

  // Gap de trazabilidad reportado: un renglon resuelto por Biblioteca
  // Inteligente (fuente.matchMethod/confidence, ver apuSchema.js#
  // fuenteFromSource) ya no debe verse identico a uno de plantilla en esta
  // tabla -- Proveedor/Fuente muestran el match real (metodo + insumo de
  // catalogo) en vez de quedar en blanco, sin inventar un proveedor.
  span('16. FUENTES DE PRECIOS',COLORS.measure);head(['Recurso','Clave','Descripcion','Unidad','Precio','Fecha','Proveedor','Tipo','Verificado','Fuente','URL','Confianza']);
  ['materials','labor','equipment','consumables'].flatMap(k=>(apu[k]||[]).map(r=>[k,r])).forEach(([kind,r])=>add([kind,r.clave,r.descripcion,r.unidad,Number(r.precioUnitario??r.salarioBase??r.tarifa??0),r.fuente?.fecha||'',r.fuente?.proveedor||(r.fuente?.estado==='BIBLIOTECA'||r.fuente?.estado==='VERIFICADO'?'Biblioteca ZOEMEC':''),apuDataStateLabel(r.fuente?.estado),r.fuente?.estado==='VERIFICADO'?'SI':'NO',r.fuente?.sourceName||(r.fuente?.matchMethod?`Biblioteca: ${r.fuente.matchMethod}${r.fuente.catalogItemId?` (${r.fuente.catalogItemId})`:''}`:''),r.fuente?.sourceUrl||'',Number(r.fuente?.confidence||0)]));add([]);
  span('17-18. SUPUESTOS, CONFIANZA Y FIRMAS');(apu.supuestos||[]).forEach((v,i)=>add([i+1,asCell(v.texto||v,{columnSpan:11,wrap:true}),...Array(10).fill(null)]));
  add([asCell('Confianza',XLS.label),gc.fullLabel,asCell('Precios',XLS.label),dimensionPercentLabel(globalConfidence.dimensions.prices),asCell('Rendimientos',XLS.label),dimensionPercentLabel(globalConfidence.dimensions.productivity),asCell('Riesgos',XLS.label),gc.risk,asCell('Estado',XLS.label),apu.validationStatus,null,null]);
  add([asCell('Elaboro',XLS.label),apu.elaboro||'',null,asCell('Reviso',XLS.label),apu.reviso||'',null,asCell('Aprobo',XLS.label),apu.aprobo||'',null,asCell('Version',XLS.label),apu.version||'V1',null]);
  return {sheet:safeSheet(`${apu.clave}_${String(apu.concept).split(/\s+/).slice(0,2).join('_')}`),rows,widths,stickyRowsCount:4,apu};
}

/* Hoja de PORTADA (spec 20): logo, identificacion del proyecto/cliente/
   ubicacion/responsable/fecha/version/moneda/region y KPIs del catalogo
   completo. Es la PRIMERA hoja del libro (exportAPUExcelV2 la antepone).
   Nunca inventa datos: si `company`/el primer APU no traen un campo, se
   deja en blanco -- nunca se fabrica un responsable o una region ficticia.
   El logo es opcional (`options.logo`, ver docs/IMAGES.md de write-excel-file
   -- {content,contentType,width,height}): si no se provee, la portada
   muestra un banner de texto "ZOEMEC" en vez de romper la exportacion. */
export function buildPortadaSheet(apus, company={}, options={}){
  const list = Array.isArray(apus) ? apus : [apus];
  const finalized = list.map(raw => finalizeProfessionalAPU(raw));
  const first = finalized[0] || {};
  const proyecto = company?.name || first.proyecto || '';
  const cliente = company?.client || first.cliente || '';
  const ubicacion = company?.address || first.ubicacion || '';
  const responsable = company?.responsible || company?.email || '';
  const moneda = first.moneda || 'MXN';
  const version = first.version || 'V1';
  const fechaBase = first.fechaBase || new Date().toLocaleDateString('es-MX');
  const region = company?.region || '';
  const totalConceptos = finalized.length;
  const apusGenerados = finalized.filter(a => !isStructurallyEmptyApu(a)).length;
  const costoDirectoTotal = finalized.reduce((s,a) => s + Number(a.calculated?.direct||0) * Number(a.cantidadObra||0), 0);
  const importeGeneral = finalized.reduce((s,a) => s + Number(a.calculated?.importeTotal||0), 0);
  const puPromedio = totalConceptos ? finalized.reduce((s,a) => s + Number(a.calculated?.pu||0), 0) / totalConceptos : 0;
  const validados = finalized.filter(a => a.validationStatus === 'VALIDADO').length;
  const requierenRevision = totalConceptos - validados;

  const rows = [];
  const widths = [20,26,20,26,20,26,20,26];
  const add = (row=[]) => { const full=[...row]; while(full.length<widths.length) full.push(null); rows.push(full); return rows.length; };
  const kv = (label,value) => [asCell(label,XLS.label), asCell(value ?? '', {wrap:true})];

  add([asCell(options.logo ? '' : 'ZOEMEC', {columnSpan:8, fontWeight:'bold', fontSize:20, color:'#FFFFFF', backgroundColor:'#2A1740', align:'center', alignVertical:'center'}), ...Array(7).fill(null)]);
  add([asCell('ANALISIS DE PRECIOS UNITARIOS', {columnSpan:8, fontWeight:'bold', fontSize:14, color:'#2A1740', backgroundColor:'#EDE3F6', align:'center'}), ...Array(7).fill(null)]);
  add([]);
  add([...kv('Proyecto', proyecto), ...kv('Cliente', cliente), ...kv('Ubicacion', ubicacion), ...kv('Responsable', responsable)]);
  add([...kv('Fecha', new Date().toLocaleDateString('es-MX')), ...kv('Version', version), ...kv('Moneda', moneda), ...kv('Region / base de precios', region || `Base de precios: ${fechaBase}`)]);
  add([]);
  add([asCell('RESUMEN DEL CATALOGO', {columnSpan:8, fontWeight:'bold', color:'#FFFFFF', backgroundColor:'#123F78', align:'center'}), ...Array(7).fill(null)]);
  add([...kv('Total de conceptos', totalConceptos), ...kv('APUs generados', apusGenerados), ...kv('APUs validados', validados), ...kv('Requieren revision', requierenRevision)]);
  add([...kv('Costo directo total', money(costoDirectoTotal)), ...kv('Importe general', money(importeGeneral)), ...kv('P.U. promedio', money(puPromedio)), ...kv('Fecha base de precios', fechaBase)]);

  const sheet = { sheet:'PORTADA', rows, widths, stickyRowsCount:0, orientation:'portrait' };
  if(options.logo) sheet.images = [{ ...options.logo, anchor:{ row:1, column:1 } }];
  return sheet;
}

/* Hoja PARAMETROS (punto 19 del spec del usuario, hoja auxiliar faltante):
   parametros globales que aplicaron a ESTE lote -- moneda, vigencia de
   precios, IVA, tolerancia del control matematico (ver apuReconciliation.js)
   y los porcentajes estandar de indirectos/financiamiento/utilidad/cargos/
   herramienta menor (APU_DEFAULT_FACTORS, src/lib/apuCalc.js -- unica fuente
   de verdad, ya unificada, no un conjunto de valores nuevo). Todo el
   contenido sale de datos reales del lote/config, nunca se inventa. */
export function buildParametrosSheet(apus, options = {}){
  const list = Array.isArray(apus) ? apus : [apus];
  const finalized = list.map(raw => finalizeProfessionalAPU(raw));
  const first = finalized[0] || {};
  const rows = [];
  const add = (row = []) => rows.push([...row, null]);
  const kv = (label, value) => add([asCell(label, XLS.label), asCell(value ?? '', { wrap: true })]);

  add([asCell('PARAMETROS DEL LOTE', { columnSpan: 2, fontWeight: 'bold', fontSize: 14, color: '#2A1740', backgroundColor: '#EDE3F6', align: 'center' }), null]);
  add([]);
  kv('Moneda', first.moneda || 'MXN');
  kv('Fecha base de precios / vigencia', first.fechaBase || new Date().toLocaleDateString('es-MX'));
  kv('IVA aplicado (%)', `${Number(first.factores?.iva ?? APU_DEFAULT_FACTORS.iva)}%`);
  kv('Config. IVA', options.ivaMode === 'presupuesto' ? 'Se maneja a nivel presupuesto (no incluido en el APU)' : 'Incluido como referencia informativa en el APU');
  kv('Tolerancia de control matematico', money(DEFAULT_RECONCILIATION_TOLERANCE));
  kv('Version del motor ZOEMEC', options.engineVersion || first.version || 'V2');
  add([]);
  add([asCell('PORCENTAJES ESTANDAR (salvo que el APU los sobreescriba)', { columnSpan: 2, fontWeight: 'bold', color: '#FFFFFF', backgroundColor: '#123F78', align: 'center' }), null]);
  kv('Herramienta menor (% de M.O.)', `${APU_DEFAULT_FACTORS.herramienta}%`);
  kv('Indirectos de campo', `${APU_DEFAULT_FACTORS.indCampo}%`);
  kv('Indirectos de oficina', `${APU_DEFAULT_FACTORS.indOficina}%`);
  kv('Financiamiento', `${APU_DEFAULT_FACTORS.finance}%`);
  kv('Utilidad', `${APU_DEFAULT_FACTORS.utility}%`);
  kv('Cargos adicionales', `${APU_DEFAULT_FACTORS.cargos}%`);

  return { sheet: 'PARAMETROS', rows, widths: [34, 46], stickyRowsCount: 0, orientation: 'portrait' };
}

export function buildProfessionalSummarySheet(apus){
  const rows=[[asCell('RESUMEN GENERAL DEL PRESUPUESTO',{...XLS.title,columnSpan:12}),...Array(11).fill(null)],['Clave','Concepto','Unidad','Cantidad','PU original (Excel)','PU calculado (Motor v2)','Diferencia','Importe sin IVA','IVA','Importe con IVA','Estado','Confianza'].map(v=>asCell(v,XLS.head))];
  const finalized=apus.map(raw=>finalizeProfessionalAPU(raw));
  finalized.forEach(a=>{
    const gc=formatGlobalConfidence(runApuConfidence(a));
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
      gc.scoreLabel
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
   abrir la app. "Confianza tecnica"/"Confianza precios" (auditoria JUDGE
   READY) ya NO leen apu.confidence.presentation (una sola sub-dimension de
   calculateAPUConfidence, SIN gating, reetiquetada -- esa era la fuente real
   del "60%" que no coincidia con el resto de la app) -- ahora leen las
   dimensiones equivalentes de runApuConfidence() (structure/prices), que SI
   limitan su techo ante una falla critica de Auditoria y declaran N/D en vez
   de inventar un numero cuando no hay base. "Evidencia mercado" es la
   cobertura de fuentes cost-weighted (independiente de la calidad tecnica de
   esa evidencia). Nunca decide "validado" por si sola: el estado que se
   exporta es el mismo REVISION_STATUS ya derivado o confirmado en la app
   (deriveRevisionStatus/applyRevisionDecision). */
export function buildControlRevisionSheet(apus){
  const list = Array.isArray(apus) ? apus : [apus];
  const finalized = list.map(raw => finalizeProfessionalAPU(raw));
  const rows = [[asCell('BANDEJA DE REVISION TECNICA', { ...XLS.title, columnSpan: 11 }), ...Array(10).fill(null)],
    ['Clave', 'Concepto', 'PU original', 'PU ZOEMEC', 'Diferencia %', 'Confianza técnica', 'Confianza precios', 'Evidencia mercado', 'Rendimiento validado', 'Completitud', 'Estado / Observaciones'].map(v => asCell(v, XLS.head))];
  finalized.forEach(apu => {
    const globalConfidence = runApuConfidence(apu);
    const r = buildReviewRow(apu);
    const diffStyle = r.diferenciaPct != null && Math.abs(r.diferenciaPct) > 25 ? { color: '#B54A62', fontWeight: 'bold' } : {};
    const motivos = (r.motivos || []).join('; ');
    // Punto 23/24 del spec del usuario: estado de completitud de 5 valores
    // (COMPLETO/COMPLETO CON SUPUESTOS/REQUIERE VALIDACION/INCOMPLETO/ERROR)
    // compuesto sobre lo que finalizeProfessionalAPU ya calculo (warnings =
    // validateAPU().issues, calculated = totales) mas el control matematico
    // independiente (reconcileAPU) -- ningun recalculo duplicado.
    const reconciliation = reconcileAPU(apu, { claimedTotals: apu.calculated });
    const status = computeConceptStatus(apu, { issues: apu.warnings }, reconciliation);
    const statusStyle = status === 'ERROR' ? { color: '#B54A62', fontWeight: 'bold' }
      : status === 'REQUIERE_VALIDACION' ? { color: '#8A6B2E', fontWeight: 'bold' }
      : status === 'INCOMPLETO' ? { color: '#8A6B2E' } : {};
    const reconciliationNote = reconciliation.ok ? '' : ` -- Control matematico: ${reconciliation.diffs.map(d => d.code).join(', ')}`;
    rows.push([
      r.clave, r.concept,
      r.puOriginal != null ? r.puOriginal : asCell('Sin referencia', { color: '#8A6B2E' }),
      r.puCalculado,
      r.diferenciaPct != null ? asCell(Number(r.diferenciaPct.toFixed(1)), diffStyle) : asCell('—', { color: '#8A6B2E' }),
      dimensionPercentLabel(globalConfidence.dimensions.structure),
      dimensionPercentLabel(globalConfidence.dimensions.prices),
      `${r.evidenciaMercado}%`,
      r.rendimientoValidado ? 'SI' : 'NO',
      asCell(conceptStatusLabel(status), statusStyle),
      asCell(`${REVISION_STATUS_LABEL[r.estado] || r.estado}${motivos ? ' -- ' + motivos : ''}${reconciliationNote}`, { wrap: true })
    ]);
  });
  return { sheet: 'CONTROL_REVISION', rows, widths: [16, 46, 14, 14, 12, 15, 15, 15, 16, 20, 46], stickyRowsCount: 2 };
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
    ['materials','labor','equipment','consumables','seguridad'].forEach(kind=>{
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
export function disambiguateSheetNames(sheets){
  const seen=new Map();
  return sheets.map(s=>{
    const count=(seen.get(s.sheet)||0)+1;
    seen.set(s.sheet,count);
    if(count===1) return s;
    const suffix=` (${count})`;
    return {...s,sheet:safeSheet(s.sheet.slice(0,31-suffix.length)+suffix)};
  });
}

/* Guard de exportacion compartido por Excel y PDF (RC8): un APU
   estructuralmente vacio (sin concepto o sin ningun renglon tecnico) nunca
   se convierte en archivo -- ni con datos fabricados ni en silencio. Nunca
   bloquea un APU con datos reales que solo "requiere revision" (precio sin
   fuente, fecha vieja...), ver isStructurallyEmptyApu. */
function assertExportableApus(list){
  const arr = Array.isArray(list) ? list : [list];
  if(!arr.length) throw new Error('No se puede generar el Excel profesional porque no hay ningún APU para exportar.');
  const empty = arr.filter(isStructurallyEmptyApu);
  if(empty.length === arr.length && arr.length === 1){
    throw new Error('No se puede generar el Excel profesional porque el APU no contiene información técnica.');
  }
  if(empty.length){
    const ids = empty.map(a => a?.clave || a?.concept || '(sin identificar)').join(', ');
    throw new Error(`No se puede generar el Excel profesional: ${empty.length} de ${arr.length} APU(s) no contienen información técnica (${ids}). Corrige o quita esos conceptos antes de exportar.`);
  }
}

export async function exportAPUExcelV2(apus,options={}){
  const list=Array.isArray(apus)?apus:[apus];
  assertExportableApus(list);
  const priceSheet=buildPriceIntelligenceSheet(list);
  const conceptSheets=disambiguateSheetNames(list.map(buildProfessionalAPUSheet));
  const portadaSheet=buildPortadaSheet(list,options.company||{},{logo:options.logo});
  const parametrosSheet=buildParametrosSheet(list,{ivaMode:options.ivaMode,engineVersion:options.engineVersion});
  const sheets=[portadaSheet,buildProfessionalSummarySheet(list),buildControlRevisionSheet(list),parametrosSheet,...conceptSheets,...(priceSheet?[priceSheet]:[])];
  await exportWorkbookExcel(sheets,options.fileName||'APU-PROFESIONAL-ZOEMEC.xlsx',options.writeXlsxFileImpl||writeXlsxFileBrowser); return sheets;
}

/* Dibuja el desarrollo COMPLETO de un APU (secciones A-F + integracion +
   procedimiento + calidad + medicion + alcance/exclusiones + fuentes +
   supuestos + trazabilidad + confianza + firmas) sobre un jsPDF EXISTENTE,
   empezando en la pagina actual del documento (el llamador decide si esa
   pagina ya esta en blanco -- ver exportAPUPdfV2 para un PDF de un solo
   APU y exportAPUPdfMaster para el PDF combinado con N APUs, cada uno
   arrancando en pagina nueva).

   Reentrante: NUNCA usa closures compartidas entre llamadas -- `y`/`page`/
   `layout` se recrean en cada invocacion. `page` arranca en
   doc.getNumberOfPages() (la pagina real actual del documento) salvo que
   el llamador pase startPage explicito, para que la numeracion de
   "Pagina N" del pie sea absoluta dentro del PDF maestro y no se reinicie
   por cada APU. */
export function drawApuSections(doc,rawApu,opts={}){
  assertExportableApus(rawApu);
  const apu=finalizeProfessionalAPU(rawApu); const t=apu.calculated;
  const globalConfidence=runApuConfidence(apu);
  const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight(),M=12;
  let y=opts.startY??12, page=opts.startPage??doc.getNumberOfPages();
  const layout={pageHeight:H,topMargin:M,bottomLimit:H-13,generalHeaders:[],sections:[],rows:[]};
  const pdfText=value=>String(value??'').replace(/\u00b2/g,'2').replace(/\u00b3/g,'3').replace(/\u00b1/g,'+/-').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const footer=()=>{doc.setFontSize(6.5);doc.setTextColor(120);doc.text(pdfText(`${apu.clave} | ${apu.concept.slice(0,55)} | ${apu.validationStatus||''}`),M,H-6);};
  const newPage=()=>{footer();doc.addPage();page++;y=12;header();};
  const ensure=h=>{if(y+h>H-13) newPage();};
  const nextGroup=()=>{ if(y>M+2) newPage(); };
  const header=()=>{layout.generalHeaders.push({page,y});doc.setFillColor(18,63,120);doc.rect(M,y,W-2*M,11,'F');doc.setTextColor(255);doc.setFont('helvetica','bold');doc.setFontSize(10.5);doc.text('ANALISIS DE PRECIO UNITARIO (APU)',W/2,y+7.3,{align:'center'});y+=14;
    doc.setTextColor(25);doc.setFontSize(7);doc.setFont('helvetica','normal');
    doc.text(pdfText(`Clave: ${apu.clave}   Unidad: ${apu.unit}   Cantidad: ${num(apu.cantidadObra)}   Estado: ${apu.validationStatus||''}`),M,y);y+=4.2;
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
    const wrapRow=row=>row.map((v,i)=>doc.splitTextToSize(pdfText(v),colW[i]-2));
    const rowHeight=wrapped=>Math.max(4.6,Math.max(...wrapped.map(w=>w.length))*3.1);
    const firstWrapped=rows.length?wrapRow(rows[0]):null;
    const firstRowHeight=firstWrapped?rowHeight(firstWrapped):0;
    // Regla anti-huerfanos: titulo de seccion (6), encabezado de columnas (5)
    // y primera fila completa deben permanecer juntos. Las filas posteriores
    // conservan su salto individual segun su altura real envuelta.
    ensure(11+(firstWrapped?firstRowHeight+1:0));
    const sectionPage=page,sectionY=y;
    doc.setFillColor(...color);doc.rect(M,y,W-2*M,6,'F');doc.setTextColor(255);doc.setFont('helvetica','bold');doc.setFontSize(7.2);doc.text(pdfText(title),M+2,y+4.3);y+=6;
    doc.setTextColor(30);doc.setFontSize(6);doc.setFont('helvetica','bold');
    heads.forEach((h,i)=>doc.text(pdfText(h),colX[i]+1,y+3.6));y+=5;
    layout.sections.push({title,page:sectionPage,y:sectionY,columnsY:sectionY+6,firstRowPage:rows.length?page:null,firstRowY:rows.length?y:null,firstRowHeight});
    doc.setFont('helvetica','normal');
    rows.forEach((row,rowIndex)=>{
      const wrapped=rowIndex===0?firstWrapped:wrapRow(row);
      const rh=rowHeight(wrapped);
      ensure(rh+1);
      layout.rows.push({section:title,row:rowIndex,page,y,height:rh});
      doc.setDrawColor(220);doc.line(M,y,W-M,y);
      wrapped.forEach((w,i)=>doc.text(w,colX[i]+1,y+3.4));
      y+=rh;
    });
    y+=2.5;
  };
  const kv=(label,value,color)=>{ensure(6);doc.setFontSize(7.2);doc.setFont('helvetica','bold');doc.setTextColor(...(color||[30,30,30]));doc.text(pdfText(label),M,y+3.6);doc.setFont('helvetica','normal');doc.setTextColor(30);doc.text(pdfText(value),W-M,y+3.6,{align:'right'});y+=5.5;};
  const bar=(title,color)=>{ensure(9);doc.setFillColor(...color);doc.rect(M,y,W-2*M,6,'F');doc.setTextColor(255);doc.setFont('helvetica','bold');doc.setFontSize(7.2);doc.text(pdfText(title),M+2,y+4.3);y+=9;doc.setFont('helvetica','normal');doc.setTextColor(30);doc.setFontSize(7);};
  // Justificacion tecnica (spec 21): bloque en cursiva bajo el subtotal de
  // cada categoria A-F, leido de apu.technicalJustifications.<clave> -- ver
  // NO_JUSTIFICATION_TEXT (mismo placeholder que la hoja XLSX) para APUs
  // historicos que nunca tuvieron este campo.
  const justBlock=text=>{
    const has=text&&String(text).trim();
    const lines=doc.splitTextToSize(pdfText(`Justificacion tecnica: ${has?text:NO_JUSTIFICATION_TEXT}`),W-2*M);
    ensure(lines.length*3.3+3);
    doc.setFont('helvetica','italic');doc.setFontSize(6.6);doc.setTextColor(has?70:150);
    doc.text(lines,M,y+3.2);y+=lines.length*3.3+3;
    doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(30);
  };
  const tj=apu.technicalJustifications||{};
  const calcCtx={cantidadContractual:Number(apu.cantidadObra||0)};

  header();
  // ---- A-F: recursos, cada uno con su tabla + subtotal + justificacion tecnica ----
  table('A. MATERIALES',[213,106,0],['Clave','Descripcion','Cant.','Desp.%','Precio','Importe'],
    [...(apu.materials||[]).map(r=>[r.clave,r.descripcion,num(r.consumo),`${num(r.desperdicioPct)}%`,money(r.precioUnitario),money(Number(r.consumo)*(1+Number(r.desperdicioPct)/100)*Number(r.precioUnitario))]),
     ['','Subtotal materiales','','','',money(t.mat)]],
    [0.7,2.9,0.6,0.6,0.9,0.9]);
  justBlock(tj.materials);

  table('B. MANO DE OBRA',[18,63,120],['Clave','Descripcion','Cuad.','Rend.','Salario','FSR','Importe'],
    [...(apu.labor||[]).map(r=>[r.clave,r.descripcion,r.cuadrilla||r.cantidad,r.rendimiento||'',money(r.salarioBase),r.fsr,money((Number(r.rendimiento)>0?Number(r.cuadrilla)/Number(r.rendimiento):Number(r.cantidad))*Number(r.salarioBase)*Number(r.fsr||1))]),
     ['','Subtotal mano de obra','','','','',money(t.mo)]],
    [0.7,2.6,0.6,0.6,0.9,0.5,0.9]);
  justBlock(tj.labor);

  table('C. EQUIPO Y MAQUINARIA',[21,120,183],['Clave','Descripcion','Cant.','Adquisicion/Tarifa','Integracion / base','Importe efectivo'],
    [...(apu.equipment||[]).map(r=>[r.clave,r.descripcion,num(r.cantidad),money(r.tarifa),pdfIntegration(r),money(calcEquipmentRow(r,calcCtx))]),
     ['','Subtotal equipo','','','',money(t.equipo)]],
    [0.6,2.6,0.6,0.9,0.9,0.9]);
  justBlock(tj.equipment);

  table('D. HERRAMIENTA MENOR',[47,125,58],['Clave','Descripcion','Cant.','Adquisicion','Deprec.%','Importe'],
    apu.herramientaMenor?.modo==='detalle'
      ?[...(apu.herramientaMenor.detalle||[]).map(r=>[r.clave,r.descripcion,num(r.cantidad),money(r.valorAdquisicion||r.precioUnitario),`${num(r.depreciacionPct)}%`,money(Number(r.cantidad)*Number(r.valorAdquisicion||r.precioUnitario)*Number(r.depreciacionPct)/100)]),['','Subtotal herramienta','','','',money(t.herramienta)]]
      :[['','',`${num(apu.herramientaMenor?.porcentaje||0)}% de mano de obra`,'','',money(t.herramienta)]],
    [0.7,2.9,0.6,0.9,0.6,0.9]);
  justBlock(tj.smallTools);

  table('E. CONSUMIBLES Y AUXILIARES',[140,109,31],['Clave','Descripcion','Cant.','Desp.%','Precio','Importe'],
    [...(apu.consumables||[]).map(r=>[r.clave,r.descripcion,num(r.consumo),`${num(r.desperdicioPct)}%`,money(r.precioUnitario),money(Number(r.consumo)*(1+Number(r.desperdicioPct)/100)*Number(r.precioUnitario))]),
     ['','Subtotal consumibles','','','',money(t.consumibles)]],
    [0.7,2.9,0.6,0.6,0.9,0.9]);
  justBlock(tj.consumables);

  table('F. SEGURIDAD Y EPP',[181,38,61],['Clave','Descripcion','Cant.','Precio/adquisicion','Integracion / base','Importe efectivo'],
    [...(apu.seguridad||[]).map(r=>[r.clave,r.descripcion,num(r.cantidad),money(r.precioUnitario),pdfIntegration(r),money(calcSeguridadRow(r,calcCtx))]),
     ['','Subtotal seguridad / EPP','','','',money(t.seguridad)]],
    [0.6,2.6,0.6,0.9,0.9,0.9]);
  justBlock(tj.safety);

  ensure(20);doc.setFillColor(230,236,244);doc.rect(M,y,W-2*M,10,'F');doc.setFont('helvetica','bold');doc.setFontSize(8.5);doc.setTextColor(18,63,120);
  doc.text(pdfText(`COSTO DIRECTO: ${money(t.direct)}`),M+3,y+6.8);doc.setFont('helvetica','normal');y+=13;

  // ---- Integracion economica + procedimiento ----
  nextGroup();
  bar('7. INTEGRACION DEL PRECIO UNITARIO',[18,63,120]);
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
  table('8. PROCEDIMIENTO DE EJECUCION',[109,45,145],['#','Paso'],
    (apu.procedimientoConstructivo||[]).map((v,i)=>[i+1,v]),[0.3,3.4]);

  // ---- Calidad + medicion + alcance/exclusiones ----
  nextGroup();
  table('9. CONTROL DE CALIDAD Y TOLERANCIAS',[213,169,0],['Especificacion','Criterio'],
    (apu.controlCalidad||[]).map(v=>[v.especificacion||'',v.criterio||'']),[1.8,1.8]);
  bar('10. CRITERIO DE MEDICION Y FORMA DE PAGO',[7,140,136]);
  kv('Unidad contractual',apu.criterioMedicion?.unidadMedicion||apu.unit);
  {const criterioLines=doc.splitTextToSize(pdfText(`Criterio: ${apu.criterioMedicion?.criterio||''}`),W-2*M);ensure(criterioLines.length*3.4+2);doc.text(criterioLines,M,y+3.4);y+=criterioLines.length*3.4+1;}
  {const pagoLines=doc.splitTextToSize(pdfText(`Forma de pago: ${apu.criterioMedicion?.formaPago||''}`),W-2*M);ensure(pagoLines.length*3.4+2);doc.text(pagoLines,M,y+3.4);y+=pagoLines.length*3.4+3;}
  bar('11. ALCANCE',[7,140,136]);
  {const incLines=doc.splitTextToSize(pdfText((apu.criterioMedicion?.incluye||[]).join('; ')||'Sin alcance explicito registrado.'),W-2*M);ensure(incLines.length*3.4+2);doc.text(incLines,M,y+3.4);y+=incLines.length*3.4+3;}
  bar('12. EXCLUSIONES',[181,38,61]);
  {const excLines=doc.splitTextToSize(pdfText((apu.criterioMedicion?.excluye||[]).join('; ')||'Sin exclusiones explicitas registradas.'),W-2*M);ensure(excLines.length*3.4+2);doc.text(excLines,M,y+3.4);y+=excLines.length*3.4+3;}

  // ---- Fuentes, supuestos/notas, trazabilidad, confianza, firmas ----
  // "Método (confianza)" -- gap de trazabilidad reportado: cuando el
  // renglon vino de un match real de Biblioteca (fuente.matchMethod, ver
  // apuSchema.js#fuenteFromSource) el metodo de coincidencia y su confianza
  // quedan visibles/auditables tambien en el PDF, no solo en Excel.
  table('13. FUENTES DE PRECIOS',[7,140,136],['Recurso','Proveedor/Fuente','Fecha','Estado','Método (confianza)'],
    ['materials','labor','equipment','consumables','seguridad'].flatMap(k=>(apu[k]||[]).map(r=>[r.descripcion,r.fuente?.proveedor||r.fuente?.sourceName||(r.fuente?.estado==='BIBLIOTECA'||r.fuente?.estado==='VERIFICADO'?'Biblioteca ZOEMEC':'Sin proveedor'),r.fuente?.fecha||'',apuDataStateLabel(r.fuente?.estado),r.fuente?.matchMethod?`${r.fuente.matchMethod} (${r.fuente.confidence??0}%)`:''])),
    [2.1,1.4,0.8,0.9,1.1]);
  table('14. SUPUESTOS, NOTAS Y OBSERVACIONES',[7,140,136],['#','Supuesto / nota'],
    (apu.supuestos||[]).map((v,i)=>[i+1,v.texto||v]),[0.3,3.4]);
  bar('15. TRAZABILIDAD',[109,45,145]);
  kv('ID interno',apu.id||'');
  kv('Clave',apu.clave||'');
  kv('Version',apu.version||'V1');
  kv('Fecha base de precios',apu.fechaBase||'');
  kv('Validado el',apu.validatedAt?new Date(apu.validatedAt).toLocaleString('es-MX'):'');
  y+=2;
  bar('16. CONFIANZA DEL ANALISIS',[7,140,136]);
  kv('Confianza global',formatGlobalConfidence(globalConfidence).fullLabel);
  kv('Precios',dimensionPercentLabel(globalConfidence.dimensions.prices));
  kv('Rendimientos',dimensionPercentLabel(globalConfidence.dimensions.productivity));
  kv('Riesgos',formatGlobalConfidence(globalConfidence).risk);
  y+=6;
  ensure(28);doc.setDrawColor(150);doc.setFontSize(7);doc.setTextColor(30);
  const sigW=(W-2*M-10)/3;
  ['Elaboro','Reviso','Aprobo'].forEach((label,i)=>{
    const x=M+i*(sigW+5);
    doc.line(x,y+16,x+sigW,y+16);
    doc.text(pdfText(label),x,y+20);
  });
  y+=24;

  footer();
  return {apu,layout,endPage:page,endY:y};
}

/* "Pagina X de Y" real (punto 21 del spec del usuario): el total de paginas
   solo se conoce DESPUES de dibujar el documento completo, asi que cada
   footer() de arriba deja de escribir el numero de pagina el mismo -- esta
   funcion hace una pasada final, doc.setPage(i) por cada pagina ya
   existente, y estampa el numero ahi (nunca se dibuja dos veces sobre la
   misma pagina: los footer() de drawApuSections/drawMasterPagedTable/
   drawMasterResumen/drawMasterControlRevision ya NO escriben ningun numero,
   solo esta pasada lo hace, una sola vez por pagina). */
function stampPageNumbers(doc){
  const total=doc.internal.getNumberOfPages();
  const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight(),M=12;
  for(let i=1;i<=total;i++){
    doc.setPage(i);
    doc.setFont('helvetica','normal');doc.setFontSize(6.5);doc.setTextColor(120);
    doc.text(pdfTextGlobal(`Página ${i} de ${total}`),W-M,H-6,{align:'right'});
  }
}

/* PDF individual A4 vertical profesional: un solo APU, un solo archivo. El
   NUMERO de paginas se adapta al contenido real -- ver drawApuSections. */
export function exportAPUPdfV2(rawApu,options={}){
  const doc=new jsPDF('portrait','mm','a4');
  const {apu,layout}=drawApuSections(doc,rawApu,{startY:12,startPage:1});
  stampPageNumbers(doc);
  if(options.save!==false)doc.save(options.fileName||`${apu.clave}-APU-PROFESIONAL-ZOEMEC.pdf`);
  return {doc,apu,layout};
}

const pdfTextGlobal=value=>String(value??'').replace(/²/g,'2').replace(/³/g,'3').replace(/±/g,'+/-').normalize('NFD').replace(/[̀-ͯ]/g,'');

/* Portada del PDF maestro (spec 20): mismos datos y mismos KPIs que
   buildPortadaSheet (XLSX) -- una sola fuente de verdad, dos renderizadores. */
function drawMasterPortada(doc,finalized,company={}){
  const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight(),M=16;
  const first=finalized[0]||{};
  const proyecto=company?.name||first.proyecto||'';
  const cliente=company?.client||first.cliente||'';
  const ubicacion=company?.address||first.ubicacion||'';
  const responsable=company?.responsible||company?.email||'';
  const moneda=first.moneda||'MXN';
  const version=first.version||'V1';
  const fechaBase=first.fechaBase||new Date().toLocaleDateString('es-MX');
  const region=company?.region||'';
  const totalConceptos=finalized.length;
  const apusGenerados=finalized.filter(a=>!isStructurallyEmptyApu(a)).length;
  const validados=finalized.filter(a=>a.validationStatus==='VALIDADO').length;
  const costoDirectoTotal=finalized.reduce((s,a)=>s+Number(a.calculated?.direct||0)*Number(a.cantidadObra||0),0);
  const importeGeneral=finalized.reduce((s,a)=>s+Number(a.calculated?.importeTotal||0),0);

  doc.setFillColor(42,23,64);doc.rect(0,0,W,70,'F');
  doc.setTextColor(255);doc.setFont('helvetica','bold');doc.setFontSize(22);doc.text('ZOEMEC',W/2,34,{align:'center'});
  doc.setFontSize(12);doc.text('ANALISIS DE PRECIOS UNITARIOS',W/2,46,{align:'center'});
  doc.setFont('helvetica','normal');doc.setFontSize(9);doc.text('Catalogo completo -- PDF maestro',W/2,56,{align:'center'});

  let y=86;doc.setTextColor(30);
  const field=(label,value)=>{doc.setFont('helvetica','bold');doc.setFontSize(9);doc.text(pdfTextGlobal(label),M,y);doc.setFont('helvetica','normal');doc.text(pdfTextGlobal(value||'Por definir'),M+50,y);y+=8;};
  field('Proyecto:',proyecto);field('Cliente:',cliente);field('Ubicacion:',ubicacion);field('Responsable:',responsable);
  field('Fecha:',new Date().toLocaleDateString('es-MX'));field('Version:',version);field('Moneda:',moneda);
  field('Region / base de precios:',region||`Base de precios: ${fechaBase}`);
  y+=6;

  doc.setFillColor(18,63,120);doc.rect(M,y,W-2*M,9,'F');doc.setTextColor(255);doc.setFont('helvetica','bold');doc.setFontSize(9.5);
  doc.text('RESUMEN DEL CATALOGO',W/2,y+6,{align:'center'});y+=16;doc.setTextColor(30);
  const kpi=(label,value)=>{doc.setFont('helvetica','bold');doc.setFontSize(9);doc.text(pdfTextGlobal(label),M,y);doc.setFont('helvetica','normal');doc.text(pdfTextGlobal(String(value)),W-M,y,{align:'right'});y+=8;};
  kpi('Total de conceptos',totalConceptos);
  kpi('APUs generados',apusGenerados);
  kpi('APUs validados',validados);
  kpi('Requieren revision',totalConceptos-validados);
  kpi('Costo directo total',money(costoDirectoTotal));
  kpi('Importe general',money(importeGeneral));
  kpi('Fecha base de precios',fechaBase);
}

/* Tabla generica paginada para las paginas de resumen del PDF maestro:
   repite el encabezado de columnas en cada pagina nueva (spec 24 -- "evitar
   encabezados repetidos cuando una tabla continua en otra pagina"), a
   diferencia de la tabla por-APU (drawApuSections#table) que no lo hacia
   porque sus tablas individuales rara vez cruzan una pagina. */
function drawMasterPagedTable(doc,{title,heads,widthsRatio,rows,footerLabel}){
  const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight(),M=12;
  const ratios=widthsRatio||heads.map(()=>1); const totalRatio=ratios.reduce((a,b)=>a+b,0);
  const colW=ratios.map(r=>(W-2*M)*r/totalRatio);
  const colX=[M]; colW.forEach((w,i)=>{ if(i<colW.length-1) colX.push(colX[i]+w); });
  let y=12, page=doc.getNumberOfPages();
  const drawTitle=()=>{doc.setFillColor(42,23,64);doc.rect(M,y,W-2*M,9,'F');doc.setTextColor(255);doc.setFont('helvetica','bold');doc.setFontSize(10);doc.text(pdfTextGlobal(title),W/2,y+6,{align:'center'});y+=12;};
  const drawHeads=()=>{doc.setFillColor(234,240,247);doc.rect(M,y,W-2*M,6,'F');doc.setTextColor(30);doc.setFont('helvetica','bold');doc.setFontSize(6.6);heads.forEach((h,i)=>doc.text(pdfTextGlobal(h),colX[i]+1,y+4));y+=6;doc.setFont('helvetica','normal');doc.setTextColor(30);};
  const footer=()=>{doc.setFontSize(6.5);doc.setTextColor(120);doc.text(pdfTextGlobal(footerLabel||title),M,H-6);};
  const newPage=()=>{footer();doc.addPage();page++;y=12;drawHeads();};
  drawTitle();drawHeads();
  rows.forEach(row=>{
    const wrapped=row.map((v,i)=>doc.splitTextToSize(pdfTextGlobal(v),colW[i]-2));
    const rh=Math.max(4.4,Math.max(...wrapped.map(w=>w.length))*3);
    if(y+rh>H-13) newPage();
    doc.setDrawColor(220);doc.line(M,y,W-M,y);
    doc.setFontSize(6.4);doc.setTextColor(30);
    wrapped.forEach((w,i)=>doc.text(w,colX[i]+1,y+3.2));
    y+=rh;
  });
  footer();
  return {endY:y,endPage:page};
}

/* RESUMEN GENERAL del PDF maestro (spec 20): No./clave/descripcion/unidad/
   cantidad/P.U./importe/estado de cada concepto, con encabezados repetidos
   entre paginas -- mismos numeros que buildProfessionalSummarySheet (XLSX),
   nunca recalculados aqui. */
function drawMasterResumen(doc,finalized){
  const validados=finalized.filter(a=>a.validationStatus==='VALIDADO').length;
  const costoDirectoTotal=finalized.reduce((s,a)=>s+Number(a.calculated?.direct||0)*Number(a.cantidadObra||0),0);
  const importeGeneral=finalized.reduce((s,a)=>s+Number(a.calculated?.importeTotal||0),0);
  const rows=finalized.map((a,i)=>[i+1,a.clave,a.concept,a.unit,num(a.cantidadObra),money(a.calculated?.pu||0),money(a.calculated?.importeTotal||0),a.validationStatus]);
  const {endY}=drawMasterPagedTable(doc,{title:'RESUMEN GENERAL',footerLabel:'RESUMEN GENERAL',
    heads:['No.','Clave','Concepto','Unidad','Cantidad','P.U.','Importe','Estado'],
    widthsRatio:[0.4,1.1,3.4,0.6,0.8,0.9,0.9,1.1], rows});
  const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight(),M=12;
  let y=endY;
  if(y+20>H-16){doc.addPage();y=12;}
  doc.setFillColor(230,236,244);doc.rect(M,y,W-2*M,18,'F');doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(18,63,120);
  doc.text(pdfTextGlobal(`Total de conceptos: ${finalized.length}   APUs validados: ${validados}   Requieren revision: ${finalized.length-validados}`),M+3,y+7);
  doc.text(pdfTextGlobal(`Costo directo total: ${money(costoDirectoTotal)}   Importe general del catalogo: ${money(importeGeneral)}`),M+3,y+14);
  doc.setFont('helvetica','normal');doc.setFontSize(6.5);doc.setTextColor(120);doc.text('RESUMEN GENERAL',M,H-6);
}

/* CONTROL DE REVISION del PDF maestro (spec 20): bloque de control
   documental (version/fecha/descripcion/elaboro/revisó/estado -- una sola
   fila real, no se fabrica un historial de versiones que no existe) seguido
   de la bandeja de revision tecnica REAL por concepto (mismos datos que la
   hoja CONTROL_REVISION del XLSX, via buildReviewRow -- ver
   src/domain/apuReview.js), para que el control documental y la evidencia
   tecnica de por que cada APU esta VALIDADO o REQUIERE REVISION queden en
   la misma pagina. */
function drawMasterControlRevision(doc,finalized,company={}){
  const W=doc.internal.pageSize.getWidth(),M=12;
  let y=12;
  doc.setFillColor(42,23,64);doc.rect(M,y,W-2*M,9,'F');doc.setTextColor(255);doc.setFont('helvetica','bold');doc.setFontSize(10);doc.text('CONTROL DE REVISION',W/2,y+6,{align:'center'});y+=13;
  doc.setTextColor(30);doc.setFontSize(7.5);
  const line=text=>{doc.text(pdfTextGlobal(text),M,y);y+=5.5;};
  const validados=finalized.filter(a=>a.validationStatus==='VALIDADO').length;
  line(`Version: ${finalized[0]?.version||'V1'}    Fecha: ${new Date().toLocaleDateString('es-MX')}`);
  line(`Descripcion: Emision del analisis de precios unitarios (${finalized.length} conceptos, ${validados} validados, ${finalized.length-validados} requieren revision).`);
  line(`Elaboro: ${company?.name||'ZOEMEC'}    Reviso: ${company?.reviewer||'Pendiente'}    Estado: ${validados===finalized.length?'VALIDADO':'REQUIERE REVISION'}`);
  y+=6;
  doc.setFontSize(6.5);doc.text('Detalle por concepto (bandeja de revision tecnica -- mismos datos que la hoja CONTROL_REVISION del XLSX):',M,y);y+=4;
  const rows=finalized.map(apu=>{
    const r=buildReviewRow(apu);
    return [r.clave,r.concept,r.puOriginal!=null?money(r.puOriginal):'Sin referencia',money(r.puCalculado),r.diferenciaPct!=null?`${r.diferenciaPct.toFixed(1)}%`:'-',`${REVISION_STATUS_LABEL[r.estado]||r.estado}`];
  });
  doc.setPage(doc.getNumberOfPages());
  // Reutiliza el mismo dibujador paginado que RESUMEN GENERAL, arrancando
  // en la Y actual (no en una pagina nueva) para no desperdiciar el espacio
  // ya usado por el bloque de control documental de arriba.
  const heads=['Clave','Concepto','PU original','PU ZOEMEC','Diferencia','Estado'];
  const ratios=[0.9,3.2,1,1,0.8,1.6]; const totalRatio=ratios.reduce((a,b)=>a+b,0);
  const colW=ratios.map(r=>(W-2*M)*r/totalRatio);
  const colX=[M]; colW.forEach((w,i)=>{ if(i<colW.length-1) colX.push(colX[i]+w); });
  const H=doc.internal.pageSize.getHeight();
  let page=doc.getNumberOfPages();
  const drawHeads=()=>{doc.setFillColor(234,240,247);doc.rect(M,y,W-2*M,6,'F');doc.setTextColor(30);doc.setFont('helvetica','bold');doc.setFontSize(6.6);heads.forEach((h,i)=>doc.text(pdfTextGlobal(h),colX[i]+1,y+4));y+=6;doc.setFont('helvetica','normal');doc.setTextColor(30);};
  const footer=()=>{doc.setFontSize(6.5);doc.setTextColor(120);doc.text('CONTROL DE REVISION',M,H-6);};
  const newPage=()=>{footer();doc.addPage();page++;y=12;drawHeads();};
  drawHeads();
  rows.forEach(row=>{
    const wrapped=row.map((v,i)=>doc.splitTextToSize(pdfTextGlobal(v),colW[i]-2));
    const rh=Math.max(4.4,Math.max(...wrapped.map(w=>w.length))*3);
    if(y+rh>H-13) newPage();
    doc.setDrawColor(220);doc.line(M,y,W-M,y);
    doc.setFontSize(6.4);doc.setTextColor(30);
    wrapped.forEach((w,i)=>doc.text(w,colX[i]+1,y+3.2));
    y+=rh;
  });
  footer();
}

/* PDF MAESTRO (spec 20-21): un solo documento con PORTADA + RESUMEN GENERAL
   + CONTROL DE REVISION + el desarrollo COMPLETO (A-F + ingenieria) de cada
   uno de los N APUs, cada uno arrancando SIEMPRE en pagina nueva -- nunca
   comparte pagina con el APU anterior (spec 21: "cada concepto debe
   comenzar en una nueva pagina"). Usa EXACTAMENTE la misma logica de
   dibujado por-APU que exportAPUPdfV2 (drawApuSections) y el mismo dato
   canonico (finalizeProfessionalAPU) que el XLSX: no hay un segundo motor
   de calculo ni una segunda plantilla de contenido para "el maestro". El
   PDF individual (exportAPUPdfV2) sigue existiendo sin cambios -- este es
   un archivo ADICIONAL, no un reemplazo. */
export function exportAPUPdfMaster(apus,options={}){
  const list=Array.isArray(apus)?apus:[apus];
  assertExportableApus(list);
  const finalized=list.map(raw=>finalizeProfessionalAPU(raw));
  const doc=new jsPDF('portrait','mm','a4');
  const company=options.company||{};

  drawMasterPortada(doc,finalized,company);
  doc.addPage();
  drawMasterResumen(doc,finalized);
  doc.addPage();
  drawMasterControlRevision(doc,finalized,company);

  const apuLayouts=finalized.map(apu=>{
    doc.addPage();
    return drawApuSections(doc,apu,{startY:12,startPage:doc.getNumberOfPages()});
  });

  stampPageNumbers(doc);
  if(options.save!==false)doc.save(options.fileName||'APU-MAESTRO-ZOEMEC.pdf');
  return {doc,apus:apuLayouts.map(l=>l.apu),layouts:apuLayouts};
}
