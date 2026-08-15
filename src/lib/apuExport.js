/* Generacion de PDF/Excel del APU y del presupuesto: modulo puro (sin JSX,
   sin hooks de React) para que se pueda importar tanto desde src/main.jsx
   (UI) como desde pruebas de integracion en Node sin necesitar un transform
   de JSX. Toda la matematica viene de calcAPU/rowImporte en apuCalc.js; este
   archivo solo formatea y escribe esos numeros en PDF/XLSX, nunca los
   recalcula con una formula paralela.

   El unico punto de variacion entre produccion y pruebas es QUIEN escribe el
   .xlsx a disco/descarga: en el navegador write-excel-file necesita Blob y
   document (para disparar la descarga); en Node no hay DOM. Por eso
   exportRowsExcel/exportWorkbookExcel/exportAPUExcel/exportBudgetExcel
   reciben el escritor como ultimo parametro opcional (por defecto el build
   de navegador, igual que antes). Las pruebas de integracion inyectan
   write-excel-file/node, que es el build oficial de la misma libreria para
   Node y comparte el mismo generador de celdas/formulas
   (generateXlsxFileContents) que el build de navegador: no cambia una sola
   formula, solo cambia como se entregan los bytes finales. */

import { jsPDF } from 'jspdf';
import writeXlsxFileBrowser from 'write-excel-file/browser';
import { cleanText } from './excelImport.js';
import { rowImporte, DEFAULT_IVA_RATE } from './apuCalc.js';

export const money = (n) => Number(n || 0).toLocaleString('es-MX', { style:'currency', currency:'MXN' });
export const num = (n) => Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits:2, maximumFractionDigits:2 });

/* ---------- Excel: celdas, estilos y escritura ---------- */

export function excelCell(value){
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

export const XLS = {
  title:{fontWeight:'bold', fontSize:16, color:'#ffffff', backgroundColor:'#2A1740', align:'center', alignVertical:'center'},
  subtitle:{fontWeight:'bold', color:'#6F3FA7', backgroundColor:'#F2ECF8', align:'center'},
  head:{fontWeight:'bold', color:'#ffffff', backgroundColor:'#2A1740', align:'center'},
  section:{fontWeight:'bold', color:'#2A1740', backgroundColor:'#EDE3F6'},
  total:{fontWeight:'bold', color:'#2A1740', backgroundColor:'#F6F0FB'},
  grand:{fontWeight:'bold', color:'#ffffff', backgroundColor:'#2A1740'},
  label:{fontWeight:'bold', color:'#2A1740', backgroundColor:'#F7F2FA'},
  note:{color:'#6D6078', backgroundColor:'#FBF8FD', wrap:true},
  input:{backgroundColor:'#FFFDF7', color:'#1F162A'},
  calc:{backgroundColor:'#F7F2FA', format:'$#,##0.00'},
  formula:{color:'#6D6078', backgroundColor:'#FBF8FD', wrap:true},
  money:{format:'$#,##0.00'},
  qty:{format:'#,##0.0000'},
  pct:{format:'0.00%'},
  ok:{fontWeight:'bold', color:'#166534', backgroundColor:'#ECFDF3'}
};
export const xcell = (value, style={}) => ({ value, ...style });
export const fcell = (formula, style={}) => ({ value:String(formula || '').replace(/^=/,''), type:'Formula', ...XLS.money, ...style });
export const styleHeader = (row) => row.map(value => xcell(value, XLS.head));
export const styleSection = (label) => [xcell(label, XLS.section)];

export function exportRowsCSV(rows, fileName){
  const safeName = fileName.replace(/[\\/:*?"<>|]/g, '-');
  const csv = rows.map(row => row.map(value => {
    const text = String(value ?? '').replace(/"/g, '""');
    return /[",\n\r]/.test(text) ? `"${text}"` : text;
  }).join(',')).join('\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function exportRowsExcel(rows, fileName, writeXlsxFileImpl = writeXlsxFileBrowser){
  const safeName = fileName.replace(/[\\/:*?"<>|]/g, '-');
  const data = rows.map(row => row.map(excelCell));
  try{
    const result = writeXlsxFileImpl(data);
    if(result && typeof result.toFile === 'function') return await result.toFile(safeName);
    return await result;
  }catch(error){
    exportRowsCSV(rows, safeName.replace(/\.xlsx$/i, '.csv'));
  }
}

export async function exportWorkbookExcel(sheets, fileName, writeXlsxFileImpl = writeXlsxFileBrowser){
  const safeName = fileName.replace(/[\\/:*?"<>|]/g, '-');
  const workbook = sheets.map(sheet => ({
    sheet: sheet.sheet,
    data: sheet.rows.map(row => row.map(excelCell)),
    columns: sheet.widths?.map(width => ({ width })),
    stickyRowsCount: sheet.stickyRowsCount || 0,
    orientation: sheet.orientation || 'landscape',
    showGridLines: false,
    zoomScale: sheet.zoomScale || 0.85
  }));
  try{
    const result = writeXlsxFileImpl(workbook, { fontFamily:'Arial', fontSize:10 });
    if(result && typeof result.toFile === 'function') return await result.toFile(safeName);
    return await writeXlsxFileImpl(workbook, { fontFamily:'Arial', fontSize:10, fileName:safeName });
  }catch(error){
    console.error('No pude generar XLSX, exporto CSV de respaldo:', error);
    const flat = sheets.flatMap(sheet => [[sheet.sheet], ...sheet.rows, []]);
    exportRowsCSV(flat, safeName.replace(/\.xlsx$/i, '.csv'));
    throw error;
  }
}

/* ---------- Modelo de auditoria compartido por PDF y Excel ---------- */

function auditSource(apu, kind, row){
  const desc = String(row?.[0] || '').toLowerCase();
  const market = apu.marketSources?.[String(row?.[0] || '').trim()];
  if(market) return `Precio de mercado (${market.date}): ${market.source}${market.url ? ' | ' + market.url : ''}`;
  if(apu.templateGenerated && apu.sourceFile) return `Plantilla ZOEMEC | partida de: ${apu.sourceFile}`;
  if(apu.templateGenerated) return 'Plantilla ZOEMEC / revisar precios';
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
export function buildAuditModel(apu, totals){
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
    ['Financiamiento', `(Costo directo + indirectos) x ${num(apu.finance)}%`, totals.finance],
    ['Utilidad', `(Costo directo + indirectos + financiamiento) x ${num(apu.utility)}%`, totals.utility],
    ['Cargos adicionales', `Subtotal x ${num(apu.cargos)}%`, totals.cargos],
    ['Precio unitario sin IVA', 'Costo directo + indirectos + financiamiento + utilidad + cargos', totals.pu],
    ['IVA informativo', `Precio unitario x ${num(apu.iva)}%`, totals.iva]
  ];
  return { materials, labor, equipment, all, explosion, formulas };
}

/* ---------- PDF del APU (cedula tecnica) ---------- */

export function exportAPUPDFPro(apu, totals, company){
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
  return doc;
}

/* ---------- Excel del APU (hoja auditable con formulas) ---------- */

export function buildCompleteAPUSheet(apu, totals, company, audit){
  const rows = [];
  const widths = [13,52,12,13,15,12,34,17,28];
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
  const sumRange = (col, start, end) => end >= start ? `=SUM(${col}${start}:${col}${end})` : '=0';
  const formulaNote = (text) => xcell(text, XLS.formula);
  const inputNumber = (value, style={}) => xcell(Number(value || 0), {...XLS.input, ...style});

  add(span(company.name || 'ZOEMEC', XLS.title));
  add(span('CEDULA DE ANALISIS DE PRECIO UNITARIO AUDITABLE', XLS.subtitle));
  add([xcell('Clave', XLS.label), apu.clave, xcell('Unidad', XLS.label), apu.unit, xcell('Fecha', XLS.label), apu.date, xcell('Confianza IA', XLS.label), `${apu.confidence || 88}%`]);
  add([xcell('Familia', XLS.label), apu.family || 'APU general', xcell('Clave SAT', XLS.label), apu.sat || '72100000', xcell('Cantidad base', XLS.label), Number(apu.sourceQty || 1) || 1, xcell('P.U. referencia', XLS.label), Number(apu.referencePU || 0) || 0]);
  add(span('CONCEPTO ANALIZADO', XLS.label));
  add([xcell(apu.concept, {...XLS.note, columnSpan:widths.length}), ...Array(widths.length-1).fill(null)]);
  add([]);
  section('RESUMEN EJECUTIVO');
  add(styleHeader(['Partida','Base de calculo','Importe','','Partida','Base de calculo','Importe','','']));
  const resRow1 = add(['Materiales','Suma de insumos materiales',null,null,'Herramienta menor',`${apu.herramienta}% sobre M.O.`,null,null,null]);
  const resRow2 = add(['Mano de obra','Jornadas x salario base x FSR',null,null,'Indirectos',`${Number(apu.indCampo || 0)+Number(apu.indOficina || 0)}% sobre C.D.`,null,null,null]);
  const resRow3 = add(['Equipo / maquinaria','Cantidad x costo horario',null,null,'Precio unitario sin IVA','Resultado auditable',null,null,null]);
  add([]);

  section('MATERIALES');
  header();
  const matStart = rows.length + 1;
  audit.materials.forEach(r => {
    const n = rows.length + 1;
    add([r.code,r.desc,r.unit,inputNumber(r.qty, XLS.qty),inputNumber(r.base, XLS.money),inputNumber(r.factor),formulaNote(`D${n} x E${n} x (1 + F${n}/100)`),moneyFormula(`=D${n}*E${n}*(1+F${n}/100)`),r.source]);
  });
  const matEnd = rows.length;
  const matTotalRow = add([null,xcell('SUBTOTAL MATERIALES', XLS.total),null,null,null,null,null,moneyFormula(sumRange('H', matStart, matEnd)),null]);
  add([]);

  section('MANO DE OBRA  (salario real = salario base x FSR)');
  header();
  const laborStart = rows.length + 1;
  audit.labor.forEach(r => {
    const n = rows.length + 1;
    add([r.code,r.desc,r.unit,inputNumber(r.qty, XLS.qty),inputNumber(r.base, XLS.money),inputNumber(r.factor),formulaNote(`D${n} x E${n} x F${n}`),moneyFormula(`=D${n}*E${n}*F${n}`),r.source]);
  });
  const laborEnd = rows.length;
  const laborTotalRow = add([null,xcell('SUBTOTAL MANO DE OBRA', XLS.total),null,null,null,null,null,moneyFormula(sumRange('H', laborStart, laborEnd)),null]);
  add([]);

  section('EQUIPO / MAQUINARIA');
  header();
  const eqStart = rows.length + 1;
  audit.equipment.forEach(r => {
    const n = rows.length + 1;
    add([r.code,r.desc,r.unit,inputNumber(r.qty, XLS.qty),inputNumber(r.base, XLS.money),null,formulaNote(`D${n} x E${n}`),moneyFormula(`=D${n}*E${n}`),r.source]);
  });
  const eqEnd = rows.length;
  const eqTotalRow = add([null,xcell('SUBTOTAL EQUIPO', XLS.total),null,null,null,null,null,moneyFormula(sumRange('H', eqStart, eqEnd)),null]);
  add([]);

  section('INTEGRACION DEL PRECIO UNITARIO');
  add(styleHeader(['Concepto','Formula tecnica','Base / porcentaje','','','','Formula Excel','Importe','']));
  const hmRow = add(['Herramienta menor',`H${laborTotalRow} x ${Number(apu.herramienta || 0)}%`,`${apu.herramienta}% M.O.`,null,null,null,formulaNote(`H${laborTotalRow} x ${Number(apu.herramienta || 0)}%`),moneyFormula(`=H${laborTotalRow}*${Number(apu.herramienta || 0)}/100`),null]);
  const directRow = add([xcell('COSTO DIRECTO', XLS.total),'Materiales + Mano de obra + Equipo + Herramienta',null,null,null,null,formulaNote(`H${matTotalRow}+H${laborTotalRow}+H${eqTotalRow}+H${hmRow}`),moneyFormula(`=H${matTotalRow}+H${laborTotalRow}+H${eqTotalRow}+H${hmRow}`),null]);
  const indirectPct = Number(apu.indCampo || 0)+Number(apu.indOficina || 0);
  const indirectRow = add(['Indirectos',`Costo directo x (${apu.indCampo}% campo + ${apu.indOficina}% oficina)`,`${indirectPct}%`,null,null,null,formulaNote(`H${directRow} x ${indirectPct}%`),moneyFormula(`=H${directRow}*${indirectPct}/100`),null]);
  const financeRow = add(['Financiamiento',`(Costo directo + indirectos) x ${apu.finance}%`,`${apu.finance}%`,null,null,null,formulaNote(`(H${directRow}+H${indirectRow}) x ${apu.finance}%`),moneyFormula(`=(H${directRow}+H${indirectRow})*${Number(apu.finance || 0)}/100`),null]);
  const utilityRow = add(['Utilidad',`(Costo directo + indirectos + financiamiento) x ${apu.utility}%`,`${apu.utility}%`,null,null,null,formulaNote(`(H${directRow}+H${indirectRow}+H${financeRow}) x ${apu.utility}%`),moneyFormula(`=(H${directRow}+H${indirectRow}+H${financeRow})*${Number(apu.utility || 0)}/100`),null]);
  const chargesRow = add(['Cargos adicionales',`Subtotal anterior x ${apu.cargos}%`,`${apu.cargos}%`,null,null,null,formulaNote(`(H${directRow}+H${indirectRow}+H${financeRow}+H${utilityRow}) x ${apu.cargos}%`),moneyFormula(`=(H${directRow}+H${indirectRow}+H${financeRow}+H${utilityRow})*${Number(apu.cargos || 0)}/100`),null]);
  const puRow = add([xcell('PRECIO UNITARIO SIN IVA', XLS.grand),'Costo directo + sobrecostos',null,null,null,null,formulaNote(`SUM(H${directRow}:H${chargesRow})`),fcell(`=SUM(H${directRow}:H${chargesRow})`, XLS.grand),null]);
  add(['IVA informativo',`Precio unitario x ${apu.iva}%`,`${apu.iva}%`,null,null,null,formulaNote(`H${puRow} x ${apu.iva}%`),moneyFormula(`=H${puRow}*${Number(apu.iva || 0)}/100`),null]);
  // Resumen ejecutivo ligado por formula a los subtotales reales: recalcula al editar cualquier insumo
  rows[resRow1-1][2] = moneyFormula(`=H${matTotalRow}`);
  rows[resRow1-1][6] = moneyFormula(`=H${hmRow}`);
  rows[resRow2-1][2] = moneyFormula(`=H${laborTotalRow}`);
  rows[resRow2-1][6] = moneyFormula(`=H${indirectRow}`);
  rows[resRow3-1][2] = moneyFormula(`=H${eqTotalRow}`);
  rows[resRow3-1][6] = fcell(`=H${puRow}`, XLS.grand);
  add([]);

  section('ANALISIS DE CUADRILLAS Y FSR');
  add(styleHeader(['Oficio','Jornadas','Unidad','Salario base','FSR','Salario real','Importe','Rendimiento','']));
  audit.labor.forEach(r => {
    const n = rows.length + 1;
    add([r.desc,inputNumber(r.qty, XLS.qty),r.unit,inputNumber(r.base, XLS.money),inputNumber(r.factor),fcell(`=D${n}*E${n}`, XLS.money),fcell(`=B${n}*D${n}*E${n}`, XLS.money),r.rendimiento,null]);
  });
  add([]);

  section('EXPLOSION DE INSUMOS DEL CONCEPTO');
  add(styleHeader(['Codigo','Descripcion','Unidad','Cantidad por unidad','Cantidad concepto','P.U.','Importe','Fuente','Formula']));
  audit.explosion.forEach(r => {
    const n = rows.length + 1;
    add([r.code,r.desc,r.unit,inputNumber(r.qtyUnit, XLS.qty),inputNumber(r.qtyTotal, XLS.qty),inputNumber(r.pu, XLS.money),fcell(`=E${n}*F${n}`, XLS.money),r.source,formulaNote(`E${n} x F${n}`)]);
  });
  add([]);
  section('SUPUESTOS Y TRAZABILIDAD');
  add([xcell('Editable por el usuario', XLS.ok), xcell('Cantidades, precios, mermas, FSR, indirectos, financiamiento, utilidad y cargos se pueden modificar. Los importes se recalculan por formula.', {...XLS.note, columnSpan:8}), ...Array(7).fill(null)]);
  add([xcell('Fuente principal', XLS.label), apu.sourceFile || 'Generacion IA ZOEMEC / captura del usuario', xcell('Partida / fila origen', XLS.label), `${apu.sourceSection || 'Sin partida'}${apu.rowNumber ? ` | fila ${apu.rowNumber}` : ''}`, xcell('Revision requerida', XLS.label), 'Validar rendimientos y precios contra catalogo vigente', null, null, null]);
  return { sheet:`APU-${apu.clave}`.slice(0,31), rows, widths, stickyRowsCount:13 };
}

export async function exportAPUExcel(apu, totals, company, writeXlsxFileImpl = writeXlsxFileBrowser){
  const audit = buildAuditModel(apu, totals);
  const sheets = [buildCompleteAPUSheet(apu, totals, company, audit)];
  await exportWorkbookExcel(sheets, `${apu.clave}-APU-AUDITABLE-ZOEMEC.xlsx`, writeXlsxFileImpl).catch(()=>alert('No pude generar el Excel. Inténtalo de nuevo.'));
}

/* ---------- Presupuesto: PDF y Excel ---------- */

export function exportBudgetExcel(items, total, iva, ivaRate=DEFAULT_IVA_RATE, writeXlsxFileImpl = writeXlsxFileBrowser){
  const rows=[['PRESUPUESTO'],['Concepto','Unidad','Cantidad','P.U. (sin IVA)','Importe'],...items.map(i=>[i.concept,i.unit,i.qty,i.pu,Number(i.qty)*Number(i.pu)]),[],['Subtotal',total],[`IVA ${num(ivaRate)}%`,iva],['Total',total+iva]];
  return exportRowsExcel(rows,'Presupuesto-ZOEMEC.xlsx', writeXlsxFileImpl).catch(()=>alert('No pude generar el Excel. Inténtalo de nuevo.'));
}
export function exportBudgetPDF(items, total, iva, company, ivaRate=DEFAULT_IVA_RATE){
  const doc=new jsPDF();let y=16;doc.setFontSize(16);doc.text(company.name||'ZOEMEC',14,y);doc.setFontSize(13);doc.text('PRESUPUESTO EJECUTIVO',14,y+14);y+=28;items.forEach(i=>{doc.text(i.concept,14,y,{maxWidth:100});doc.text(i.unit,118,y);doc.text(String(i.qty),135,y);doc.text(money(i.pu),152,y);doc.text(money(i.qty*i.pu),174,y);y+=10;if(y>270){doc.addPage();y=18;}});y+=6;doc.text('Subtotal',130,y);doc.text(money(total),170,y);y+=8;doc.text(`IVA ${num(ivaRate)}%`,130,y);doc.text(money(iva),170,y);y+=8;doc.text('Total',130,y);doc.text(money(total+iva),170,y);doc.save('Presupuesto-ZOEMEC.pdf');
  return doc;
}
