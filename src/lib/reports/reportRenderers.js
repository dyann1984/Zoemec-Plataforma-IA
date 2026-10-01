/* F5 -- Renderizadores PDF/XLSX del Centro de Reportes. Cada par (PDF,
   XLSX) lee el MISMO modelo de reportModels.js: ninguna cifra se calcula
   aqui (solo formato). Las celdas XLSX guardan el valor numerico COMPLETO
   (sin redondear); PDF y pantalla muestran 2 decimales. */
import { createReport } from './reportPdfKit.js';
import { c, pad, RX, headerBlock, moneyFormat, cellRef } from './reportXlsxKit.js';
import { REPORT_LABEL, BRAND, makeMoney, fmtQty, fmtPct, documentRevision, sourceText } from './reportModels.js';
import { GENERATOR_STATUS } from '../../domain/quantityGenerators.js';
import { APU_STATUS } from '../../domain/budgetScope.js';
import { EXPLOSION_SCOPE } from '../../domain/explosionData.js';

const coverFields = (h, revision) => [
  ['Proyecto', h.proyecto], ['Cliente', h.cliente], ['Ubicación', h.ubicacion], ['Fecha', h.fecha],
  ['Moneda', h.moneda], ['Responsable', h.responsable], ['Revisión del documento', revision], ['Generado por', h.generadoPor]
];
const staleNote = stale => `Existen cantidades pendientes de revisión: ${stale.length} concepto(s) con generadores desactualizados (${stale.map(s => s.clave || s.concept).join(', ')}). Las cifras reflejan la cantidad VIGENTE del concepto; la geometría actual del plano difiere y aún no se confirma.`;
const pendingRows = (stale, money) => stale.map(s => ({ cells: [s.clave, s.concept, `${fmtQty(s.qty)} ${s.unit}`, s.pending.map(p => `${fmtQty(p.toQty)} ${s.unit}${p.planoRevision != null ? ` (plano rev. ${p.planoRevision})` : ''}`).join(' · ') || '—'], color: [178, 34, 34] }));

/* =============================== PRESUPUESTO =============================== */
export function renderBudgetPdf(model, { logo = null } = {}){
  const h = model.header, money = makeMoney(h.moneda);
  const k = createReport({ reportLabel: REPORT_LABEL.PRESUPUESTO, header: h, draft: model.draft, logo });
  k.cover({ title: 'Presupuesto', subtitle: BRAND.full, fields: coverFields(h, documentRevision(h)),
    note: 'Cantidad × Precio Unitario = Importe. El P.U. de cada concepto proviene de su APU (metodología RLOPSRM: ya incluye indirectos, financiamiento, utilidad y cargos adicionales). Las cantidades provienen del Catálogo de Conceptos (captura manual o números generadores del plano).' });
  if(model.empty){ k.section('Presupuesto'); k.empty(model.empty); return k.finish(); }
  const s = model.summary;
  k.section('Resumen del presupuesto');
  const sumRows = [
    { cells: ['Costo directo', money(s.costoDirecto)] },
    { cells: ['Indirectos (campo y oficina)', money(s.indirectos)] },
    { cells: ['Financiamiento', money(s.financiamiento)] },
    { cells: ['Utilidad', money(s.utilidad)] },
    { cells: ['Cargos adicionales', money(s.cargos)] },
    { cells: [s.ivaAplica ? 'Subtotal (antes de IVA)' : 'TOTAL', money(s.subtotal)], kind: s.ivaAplica ? 'subtotal' : 'total' }
  ];
  if(s.ivaAplica) sumRows.push({ cells: ['IVA', money(s.iva)] }, { cells: ['TOTAL', money(s.total)], kind: 'total' });
  k.table({ columns: [{ head: 'Concepto', w: 3 }, { head: `Importe (${h.moneda})`, w: 1.4, align: 'right' }], rows: sumRows, fontSize: 8.4 });
  k.paragraph('Indirectos, financiamiento, utilidad y cargos se muestran desglosados a partir de la cascada que cada APU ya calculó; no se suman por segunda vez: Costo directo + componentes = Subtotal.', { size: 7, color: [110, 118, 128], style: 'italic' });
  if(model.counts.withoutApu) k.paragraph(`${model.counts.withoutApu} concepto(s) sin APU asociado: aparecen con P.U. "Sin APU" e importe ${money(0)}.`, { size: 7.4, color: [178, 34, 34] });
  if(model.draft){
    k.subsection('Cantidades pendientes de revisión');
    k.paragraph(staleNote(model.stale), { size: 7.4, color: [178, 34, 34] });
    k.table({ columns: [{ head: 'Clave', w: 1 }, { head: 'Concepto', w: 3.4 }, { head: 'Cantidad vigente', w: 1.3, align: 'right' }, { head: 'Según geometría actual', w: 2, align: 'right' }], rows: pendingRows(model.stale, money) });
  }
  k.section('Resumen por capítulo');
  k.table({ columns: [{ head: 'Capítulo', w: 3 }, { head: 'Conceptos', w: 0.9, align: 'right' }, { head: 'Importe', w: 1.5, align: 'right' }, { head: '%', w: 0.8, align: 'right' }],
    rows: [...model.chapters.map(ch => ({ cells: [ch.label, String(ch.conceptCount), money(ch.importe), fmtPct(s.subtotal > 0 ? ch.importe / s.subtotal * 100 : 0)] })),
      { cells: ['TOTAL', String(model.counts.concepts), money(s.subtotal), fmtPct(s.subtotal > 0 ? 100 : 0)], kind: 'total' }] });
  k.section('Detalle del presupuesto');
  const rows = [];
  model.chapters.forEach(ch => {
    rows.push({ cells: [ch.label], kind: 'group' });
    ch.rows.forEach(r => rows.push({ cells: [r.clave, `${r.concept}${r.stale ? ' [pendiente de revisión]' : ''}`, r.unit, fmtQty(r.qty), r.hasApu ? money(r.pu) : 'Sin APU', money(r.importe)], color: r.stale ? [178, 34, 34] : null }));
    rows.push({ cells: ['', `Subtotal ${ch.label}`, '', '', '', money(ch.importe)], kind: 'subtotal' });
  });
  rows.push({ cells: ['', s.ivaAplica ? 'TOTAL (antes de IVA)' : 'TOTAL GENERAL', '', '', '', money(s.subtotal)], kind: 'total' });
  k.table({ columns: [{ head: 'Clave', w: 1.1 }, { head: 'Concepto', w: 4.2 }, { head: 'Unidad', w: 0.8 }, { head: 'Cantidad', w: 1.1, align: 'right' }, { head: 'P.U.', w: 1.3, align: 'right' }, { head: 'Importe', w: 1.5, align: 'right' }], rows });
  return k.finish();
}

export function renderBudgetXlsx(model){
  const h = model.header, MF = { format: moneyFormat(h.moneda) }, W = 7;
  const rev = documentRevision(h);
  // RESUMEN
  const r1 = headerBlock({ header: h, reportLabel: `${REPORT_LABEL.PRESUPUESTO} — Resumen`, revision: rev, draft: model.draft, width: W }).rows;
  if(model.empty) r1.push(pad([c(model.empty, RX.note)], W));
  else{
    const s = model.summary;
    r1.push(pad([c('Concepto', RX.head), c(`Importe (${h.moneda})`, RX.head)], W));
    [['Costo directo', s.costoDirecto], ['Indirectos (campo y oficina)', s.indirectos], ['Financiamiento', s.financiamiento], ['Utilidad', s.utilidad], ['Cargos adicionales', s.cargos]]
      .forEach(([l, v]) => r1.push(pad([c(l), c(v, MF)], W)));
    r1.push(pad([c(s.ivaAplica ? 'Subtotal (antes de IVA)' : 'TOTAL', s.ivaAplica ? RX.subtotal : RX.total), c(s.subtotal, { ...(s.ivaAplica ? RX.subtotal : RX.total), ...MF })], W));
    if(s.ivaAplica){ r1.push(pad([c('IVA'), c(s.iva, MF)], W)); r1.push(pad([c('TOTAL', RX.total), c(s.total, { ...RX.total, ...MF })], W)); }
    r1.push(pad([], W));
    r1.push(pad([c('Capítulo', RX.head), c('Importe', RX.head), c('Conceptos', RX.head), c('%', RX.head)], W));
    model.chapters.forEach(ch => r1.push(pad([c(ch.label), c(ch.importe, MF), c(ch.conceptCount), c(s.subtotal > 0 ? ch.importe / s.subtotal : 0, RX.pct)], W)));
    r1.push(pad([], W));
    r1.push(pad([c('El P.U. de cada concepto ya incluye indirectos, financiamiento, utilidad y cargos (cascada calculada en cada APU); el desglose separa esos componentes sin sumarlos de nuevo.', { ...RX.note, columnSpan: 4 })], W));
    if(model.draft) model.stale.forEach(st => r1.push(pad([c(`Pendiente de revisión: ${st.clave} ${st.concept} — vigente ${fmtQty(st.qty)} ${st.unit}; geometría actual ${st.pending.map(p => fmtQty(p.toQty)).join(' / ')} ${st.unit}`, { ...RX.draft, columnSpan: 4 })], W)));
  }
  // PRESUPUESTO
  const hb = headerBlock({ header: h, reportLabel: REPORT_LABEL.PRESUPUESTO, revision: rev, draft: model.draft, width: W });
  const rows = hb.rows;
  const headRow = hb.nextRow;
  rows.push(pad(['Clave', 'Concepto', 'Unidad', 'Cantidad', 'P.U.', 'Importe', 'Origen de cantidad'].map(t => c(t, RX.head)), W));
  if(model.empty) rows.push(pad([c(model.empty, RX.note)], W));
  model.chapters.forEach(ch => {
    rows.push(pad([c(ch.label, { ...RX.group, columnSpan: W })], W));
    ch.rows.forEach(r => rows.push(pad([c(r.clave), c(r.concept, { wrap: true }), c(r.unit), c(r.qty, RX.qty), r.hasApu ? c(r.pu, MF) : c('Sin APU', RX.note), c(r.importe, MF), c(r.origenCantidad, r.stale ? RX.draft : RX.trace)], W)));
    rows.push(pad([c(''), c(`Subtotal ${ch.label}`, RX.subtotal), c('', RX.subtotal), c('', RX.subtotal), c('', RX.subtotal), c(ch.importe, { ...RX.subtotal, ...MF }), c('', RX.subtotal)], W));
  });
  if(!model.empty){
    const s = model.summary;
    rows.push(pad([c('', RX.total), c(s.ivaAplica ? 'TOTAL (antes de IVA)' : 'TOTAL GENERAL', RX.total), c('', RX.total), c('', RX.total), c('', RX.total), c(s.subtotal, { ...RX.total, ...MF }), c('', RX.total)], W));
    if(s.ivaAplica){
      rows.push(pad([c(''), c('IVA'), null, null, null, c(s.iva, MF)], W));
      rows.push(pad([c('', RX.total), c('TOTAL', RX.total), c('', RX.total), c('', RX.total), c('', RX.total), c(s.total, { ...RX.total, ...MF }), c('', RX.total)], W));
    }
  }
  return [
    { sheet: 'RESUMEN', rows: r1, widths: [34, 20, 12, 14, 12, 12, 12] },
    { sheet: 'PRESUPUESTO', rows, widths: [13, 52, 9, 13, 16, 18, 34], stickyRowsCount: headRow, autoFilter: `A${headRow}:${cellRef(W - 1, rows.length)}` }
  ];
}

/* ============================ NUMEROS GENERADORES ============================ */
// "Estado" con ancho suficiente para "COMPLETO · DEFAULT: altura" sin partirlo.
const GEN_COLUMNS = [{ head: 'Elemento', w: 0.9 }, { head: 'Operación', w: 3.1 }, { head: 'Bruto', w: 0.9, align: 'right' }, { head: 'Deducción', w: 0.9, align: 'right' }, { head: 'Neto', w: 0.9, align: 'right' }, { head: 'Estado', w: 2.2 }];
function generatorRows(concept){
  const rows = [];
  concept.elements.forEach(e => {
    const inc = e.status === GENERATOR_STATUS.INCOMPLETO;
    const flags = [e.status, e.counted ? '' : 'no suma', e.defaults.length ? `DEFAULT: ${e.defaults.join(', ')}` : ''].filter(Boolean).join(' · ');
    rows.push({ cells: [e.code, e.expression, inc ? 'INCOMPLETO' : fmtQty(e.gross), '', inc ? '—' : fmtQty(e.net), flags], color: e.defaults.length ? [178, 34, 34] : null });
    e.deductions.forEach(d => rows.push({ cells: ['', `− ${d.description}  ${d.expression}${d.note ? ` (${d.note})` : ''}`, '', fmtQty(d.quantity), '', ''], kind: 'trace' }));
    if(e.deductions.length) rows.push({ cells: ['', `NETO ${e.code}`, '', '', `${fmtQty(e.net)}`, e.unit], kind: 'trace' });
    e.issues.forEach(i => rows.push({ cells: [`! ${i}`], kind: 'note' }));
  });
  rows.push({ cells: ['TOTAL', `${concept.elements.length} elemento(s)`, '', '', fmtQty(concept.total), concept.unit], kind: 'subtotal' });
  return rows;
}
export function renderGeneratorsPdf(model, { logo = null } = {}){
  const h = model.header;
  const k = createReport({ reportLabel: REPORT_LABEL.GENERADORES, header: h, draft: model.draft, logo });
  k.section(REPORT_LABEL.GENERADORES);
  k.kv([['Proyecto', h.proyecto], ['Cliente', h.cliente], ['Ubicación', h.ubicacion], ['Fecha', h.fecha], ['Conceptos', String(model.concepts.length)], ['Revisión', documentRevision(h)]]);
  if(model.empty){ k.empty(model.empty); return k.finish(); }
  if(model.draft) k.paragraph(staleNote(model.stale), { size: 7.4, color: [178, 34, 34] });
  model.concepts.forEach(cpt => {
    k.subsection(`${cpt.clave ? `${cpt.clave} · ` : ''}${cpt.concept} (${cpt.unit}) — ${cpt.capituloLabel}`);
    const planos = cpt.planos.map(p => `${p.name}${p.revision != null ? ` · plano rev. ${p.revision}` : ''}${p.usedRevision != null ? ` · generadores confirmados con rev. ${p.usedRevision}` : ''}`).join(' | ');
    if(planos) k.paragraph(`Origen: ${planos}`, { size: 7, color: [110, 118, 128] });
    if(cpt.stale) k.paragraph(`Generadores desactualizados: ${cpt.staleness.map(s => `${fmtQty(s.fromQty)} → ${fmtQty(s.toQty)} ${cpt.unit}`).join(', ')} — pendiente de confirmar en el plano.`, { size: 7.4, color: [178, 34, 34] });
    k.table({ columns: GEN_COLUMNS, rows: generatorRows(cpt) });
    k.paragraph(`Cantidad del concepto: ${fmtQty(cpt.qty)} ${cpt.unit}${cpt.cuadra ? ' — cuadra con la suma de generadores' : ' — NO CUADRA con la suma de generadores'}`, { size: 7.6, style: 'bold', color: cpt.cuadra ? [11, 47, 74] : [178, 34, 34] });
  });
  return k.finish();
}
/* Columnas A..G = Elemento/Operación/Bruto/Deducción/Neto/Unidad/Estado
   (mismo layout que el exportador F3: sus pruebas siguen aplicando). */
export function renderGeneratorsXlsx(model){
  const h = model.header, W = 7;
  const hb = headerBlock({ header: h, reportLabel: REPORT_LABEL.GENERADORES, revision: documentRevision(h), draft: model.draft, width: W });
  const rows = hb.rows, headRow = hb.nextRow;
  rows.push(pad(['Concepto / Elemento', 'Operación', 'Bruto', 'Deducción', 'Neto', 'Unidad', 'Estado'].map(t => c(t, RX.head)), W));
  if(model.empty) rows.push(pad([c(model.empty, RX.note)], W));
  model.concepts.forEach(cpt => {
    rows.push(pad([c(`${cpt.clave ? `${cpt.clave} · ` : ''}${cpt.concept}`, RX.group), c(cpt.capituloLabel, RX.group), c('', RX.group), c('', RX.group), c('', RX.group), c(cpt.unit, RX.group), c(cpt.stale ? 'GENERADORES DESACTUALIZADOS' : '', cpt.stale ? RX.draft : RX.group)], W));
    cpt.elements.forEach(e => {
      const inc = e.status === GENERATOR_STATUS.INCOMPLETO;
      const st = [e.counted ? e.status : `${e.status} (no suma)`, e.defaults.length ? `DEFAULT: ${e.defaults.join(', ')}` : ''].filter(Boolean).join(' · ');
      rows.push(pad([c(e.code), c(e.expression), inc ? c('') : c(e.gross, RX.qty), c(''), inc ? c('') : c(e.net, RX.qty), c(e.unit), c(st, e.defaults.length ? RX.draft : {})], W));
      e.deductions.forEach(d => rows.push(pad([c(''), c(`  − ${d.description}  ${d.expression}${d.note ? ` (${d.note})` : ''}`, RX.trace), c(''), c(d.quantity, RX.qty), c(''), c(e.unit)], W)));
      e.issues.forEach(i => rows.push(pad([c(''), c(`  ! ${i}`, RX.note)], W)));
    });
    rows.push(pad([c('TOTAL', RX.subtotal), c(`${cpt.elements.length} elemento(s)`, RX.subtotal), c('', RX.subtotal), c('', RX.subtotal), c(cpt.total, { ...RX.subtotal, ...RX.qty }), c(cpt.unit, RX.subtotal), c(cpt.cuadra ? 'Cuadra con el concepto' : 'NO CUADRA con el concepto', RX.subtotal)], W));
    rows.push(pad([c('Cantidad del concepto', RX.label), c(''), c(''), c(''), c(cpt.qty, RX.qty), c(cpt.unit)], W));
    rows.push(pad([], W));
  });
  return [{ sheet: 'GENERADORES', rows, widths: [26, 46, 12, 12, 12, 9, 30], stickyRowsCount: headRow }];
}

/* ================================ EXPLOSION ================================ */
export function renderExplosionPdf(model, { logo = null } = {}){
  const h = model.header, money = makeMoney(h.moneda);
  const k = createReport({ reportLabel: REPORT_LABEL.EXPLOSION, header: h, draft: model.draft, logo });
  const sm = model.summary || {};
  const alcance = model.scope === EXPLOSION_SCOPE.PRESUPUESTO
    ? `Presupuesto — ${sm.conceptosConApu || 0} concepto(s) con APU; cantidad = cantidad vigente del concepto. Excluidos: ${sm.conceptosSinApu || 0} sin APU, ${sm.conceptosConApuNoDisponible || 0} con APU no disponible, ${sm.apusFueraDelPresupuesto || 0} APU(s) fuera del presupuesto.`
    : `Proyecto — ${sm.conceptosConApu || 0} concepto(s) con APU + ${sm.apusIndependientes || 0} APU(s) independiente(s).`;
  k.cover({ title: 'Explosión de insumos', subtitle: BRAND.full, fields: [...coverFields(h, documentRevision(h)), ['Alcance', alcance]], note: 'Cantidades e importes calculados por el motor de Explosión (misma población y cantidades que el Presupuesto). Cada insumo conserva su trazabilidad Insumo → APU → Concepto → Capítulo.' });
  if(model.empty){ k.section('Explosión de insumos'); k.empty(model.empty); return k.finish(); }
  k.section('Resumen');
  k.table({ columns: [{ head: 'Grupo', w: 3 }, { head: 'Renglones', w: 1, align: 'right' }, { head: 'Importe', w: 1.5, align: 'right' }],
    rows: [...model.sections.map(s => ({ cells: [s.title, String(s.rows.length), money(s.total)] })), { cells: ['TOTAL DE INSUMOS', String(model.sections.reduce((a, s) => a + s.rows.length, 0)), money(model.grandTotal)], kind: 'total' }] });
  model.sections.forEach(sec => {
    k.section(sec.title);
    if(!sec.rows.length){ k.empty(`Sin ${sec.title.toLowerCase()} en este alcance.`); return; }
    const rows = [];
    sec.rows.forEach(r => {
      rows.push({ cells: [r.clave || '—', r.descripcion, r.unidad, r.cantidad == null ? 'N/D' : fmtQty(r.cantidad), r.precio == null ? 'N/D' : money(r.precio), money(r.importe)] });
      r.origenes.forEach(o => rows.push({ cells: ['', `» ${o.capitulo || 'Sin capítulo'} > ${o.concepto || 'APU independiente'} > APU ${o.apu}`, '', o.cantidad == null ? '' : fmtQty(o.cantidad), '', money(o.importe)], kind: 'trace' }));
    });
    rows.push({ cells: ['', `Total ${sec.title}`, '', '', '', money(sec.total)], kind: 'subtotal' });
    k.table({ columns: [{ head: 'Clave', w: 1 }, { head: 'Descripción / trazabilidad', w: 4 }, { head: 'Unidad', w: 0.8 }, { head: 'Cantidad total', w: 1.1, align: 'right' }, { head: 'Precio', w: 1.2, align: 'right' }, { head: 'Importe', w: 1.4, align: 'right' }], rows });
  });
  return k.finish();
}
export function renderExplosionXlsx(model){
  const h = model.header, MF = { format: moneyFormat(h.moneda) }, W = 9;
  const rev = documentRevision(h);
  const sheets = [];
  const resumen = headerBlock({ header: h, reportLabel: `${REPORT_LABEL.EXPLOSION} — Resumen`, revision: rev, draft: model.draft, width: 4 }).rows;
  if(model.empty) resumen.push(pad([c(model.empty, RX.note)], 4));
  else{
    resumen.push(pad([c('Grupo', RX.head), c('Renglones', RX.head), c('Importe', RX.head)], 4));
    model.sections.forEach(s => resumen.push(pad([c(s.title), c(s.rows.length), c(s.total, MF)], 4)));
    resumen.push(pad([c('TOTAL DE INSUMOS', RX.total), c(model.sections.reduce((a, s) => a + s.rows.length, 0), RX.total), c(model.grandTotal, { ...RX.total, ...MF })], 4));
    resumen.push(pad([], 4));
    resumen.push(pad([c(`Alcance: ${model.scope} — ${model.summary?.conceptosConApu || 0} concepto(s) con APU; cantidad = cantidad vigente del concepto.`, { ...RX.note, columnSpan: 4 })], 4));
  }
  sheets.push({ sheet: 'RESUMEN', rows: resumen, widths: [36, 14, 18, 12] });
  model.sections.forEach(sec => {
    const hb = headerBlock({ header: h, reportLabel: `${REPORT_LABEL.EXPLOSION} — ${sec.title}`, revision: rev, draft: model.draft, width: W });
    const rows = hb.rows, headRow = hb.nextRow;
    rows.push(pad(['Clave', 'Descripción', 'Unidad', 'Cantidad total', 'Precio unitario', 'Importe', 'Capítulo', 'Concepto', 'APU'].map(t => c(t, RX.head)), W));
    if(!sec.rows.length) rows.push(pad([c(`Sin ${sec.title.toLowerCase()} en este alcance.`, RX.note)], W));
    sec.rows.forEach(r => {
      rows.push(pad([c(r.clave || '—'), c(r.descripcion, { wrap: true }), c(r.unidad), r.cantidad == null ? c('N/D') : c(r.cantidad, RX.qty4), r.precio == null ? c('N/D') : c(r.precio, MF), c(r.importe, MF), c(''), c(''), c('')], W));
      r.origenes.forEach(o => rows.push(pad([c(''), c(`  ↳ ${o.label}`, RX.trace), c(''), o.cantidad == null ? c('') : c(o.cantidad, { ...RX.trace, ...RX.qty4 }), c(''), c(o.importe, { ...RX.trace, ...MF }), c(o.capitulo || '', RX.trace), c(o.concepto || '', RX.trace), c(o.apu || '', RX.trace)], W)));
    });
    rows.push(pad([c('', RX.total), c(`Total ${sec.title}`, RX.total), c('', RX.total), c('', RX.total), c('', RX.total), c(sec.total, { ...RX.total, ...MF }), c('', RX.total), c('', RX.total), c('', RX.total)], W));
    sheets.push({ sheet: sec.title.toUpperCase().slice(0, 31), rows, widths: [14, 46, 9, 15, 16, 18, 22, 30, 16], stickyRowsCount: headRow, autoFilter: `A${headRow}:${cellRef(W - 1, rows.length)}`, orientation: 'landscape' });
  });
  return sheets;
}

/* ========================= CATALOGO DE CONCEPTOS ========================= */
export function renderCatalogPdf(model, { logo = null } = {}){
  const h = model.header, money = makeMoney(h.moneda);
  const k = createReport({ reportLabel: REPORT_LABEL.CATALOGO, header: h, draft: model.draft, logo });
  k.section(REPORT_LABEL.CATALOGO);
  k.kv([['Proyecto', h.proyecto], ['Cliente', h.cliente], ['Ubicación', h.ubicacion], ['Fecha', h.fecha], ['Conceptos', String(model.rows.length)], ['Revisión', documentRevision(h)]]);
  if(model.empty){ k.empty(model.empty); return k.finish(); }
  const rows = [];
  model.chapters.forEach(ch => {
    rows.push({ cells: [ch.label], kind: 'group' });
    ch.rows.forEach(r => rows.push({ cells: [r.clave || '—', r.concept, r.unit, fmtQty(r.qty), r.hasApu ? money(r.pu) : (r.apuStatus === APU_STATUS.APU_NO_DISPONIBLE ? 'APU no disp.' : 'Sin APU'), r.hasApu ? money(r.importe) : '—'], color: r.stale ? [178, 34, 34] : null }));
  });
  rows.push({ cells: ['', 'TOTAL', '', '', '', money(model.total)], kind: 'total' });
  k.table({ columns: [{ head: 'Clave', w: 1.1 }, { head: 'Descripción', w: 4.3 }, { head: 'Unidad', w: 0.8 }, { head: 'Cantidad', w: 1.1, align: 'right' }, { head: 'P.U. asociado', w: 1.3, align: 'right' }, { head: 'Importe', w: 1.4, align: 'right' }], rows });
  return k.finish();
}
export function renderCatalogXlsx(model){
  const h = model.header, MF = { format: moneyFormat(h.moneda) }, W = 9;
  const hb = headerBlock({ header: h, reportLabel: REPORT_LABEL.CATALOGO, revision: documentRevision(h), draft: model.draft, width: W });
  const rows = hb.rows, headRow = hb.nextRow;
  rows.push(pad(['Clave', 'Descripción', 'Unidad', 'Cantidad', 'P.U. asociado', 'Importe', 'Capítulo', 'Origen de cantidad', 'APU'].map(t => c(t, RX.head)), W));
  if(model.empty) rows.push(pad([c(model.empty, RX.note)], W));
  model.rows.forEach(r => rows.push(pad([c(r.clave || '—'), c(r.concept, { wrap: true }), c(r.unit), c(r.qty, RX.qty), r.hasApu ? c(r.pu, MF) : c(r.apuStatus === APU_STATUS.APU_NO_DISPONIBLE ? 'APU no disponible' : 'Sin APU', RX.note), r.hasApu ? c(r.importe, MF) : c(''), c(r.capitulo), c(r.origenCantidad, r.stale ? RX.draft : RX.trace), c(r.apuId || '')], W)));
  if(!model.empty) rows.push(pad([c('', RX.total), c('TOTAL', RX.total), c('', RX.total), c('', RX.total), c('', RX.total), c(model.total, { ...RX.total, ...MF }), c('', RX.total), c('', RX.total), c('', RX.total)], W));
  return [{ sheet: 'CATALOGO', rows, widths: [13, 52, 9, 13, 16, 18, 22, 34, 16], stickyRowsCount: headRow, autoFilter: `A${headRow}:${cellRef(W - 1, Math.max(headRow, rows.length - 1))}` }];
}

/* ============================ RESUMEN EJECUTIVO ============================ */
export function renderExecutiveSummaryPdf(model, { logo = null } = {}){
  const h = model.header, money = makeMoney(h.moneda);
  const k = createReport({ reportLabel: REPORT_LABEL.RESUMEN, header: h, draft: model.draft, logo });
  k.section('Datos del proyecto');
  k.kv([['Proyecto', h.proyecto], ['Cliente', h.cliente], ['Ubicación', h.ubicacion], ['Moneda', h.moneda], ['Responsable', h.responsable], ['Fecha de emisión', h.generadoEn], ['Última actualización de datos', model.updatedAt || 'Sin registro'], ['Revisión', documentRevision(h)]]);
  if(model.empty){ k.empty(model.empty); return k.finish(); }
  const kp = model.kpis;
  k.section('Indicadores del presupuesto');
  k.kv([['Capítulos', String(kp.chapters)], ['Conceptos', String(kp.concepts)], ['APUs vinculados', String(kp.apusVinculados)], ['Conceptos sin APU', String(kp.conceptosSinApu)],
    ['Costo directo', money(kp.costoDirecto)], [kp.ivaAplica ? 'Importe (antes de IVA)' : 'Costo total', money(kp.importe)], ...(kp.ivaAplica ? [['IVA', money(kp.iva)], ['Total con IVA', money(kp.total)]] : [])]);
  k.section('Principales capítulos por importe');
  k.table({ columns: [{ head: 'Capítulo', w: 3 }, { head: 'Conceptos', w: 0.9, align: 'right' }, { head: 'Importe', w: 1.5, align: 'right' }, { head: '% del total', w: 1, align: 'right' }],
    rows: model.topChapters.map(t => ({ cells: [t.label, String(t.concepts), money(t.importe), fmtPct(t.pct)] })) });
  const q = model.quantification;
  k.section('Estado de cuantificación');
  k.kv([['Conceptos con cantidad desde generadores', String(q.byQuantitySource.GENERADORES)], ['Conceptos con cantidad desde plano', String(q.byQuantitySource.PLANO)], ['Conceptos con captura manual', String(q.byQuantitySource.MANUAL)], ['Levantamientos', String(q.levantamientos)],
    ['Levantamientos con CAD autoritativo', String(q.modes.CAD)], ['Levantamientos mixtos (CAD + manual)', String(q.modes.MIXTO)], ['Levantamientos solo con captura manual', String(q.modes.MANUAL)]], { cols: 1 });
  k.section('Estado de generadores');
  k.kv([['Conceptos con generadores', String(model.generators.conceptos)], ['Con generadores desactualizados', String(model.generators.desactualizados)], ['Con generadores incompletos', String(model.generators.conIncompletos)]], { cols: 1 });
  if(model.draft) k.paragraph(staleNote(model.stale), { size: 7.4, color: [178, 34, 34] });
  if(model.intelligence){
    k.section('Indicadores de APU del proyecto');
    const LBL = { HIGH: 'Alta', MEDIUM: 'Media', LOW: 'Baja', INSUFFICIENT_EVIDENCE: 'Evidencia insuficiente', CRITICAL: 'Crítico', INFO: 'Informativo' };
    const RISK = { CRITICAL: 'Crítico', HIGH: 'Alto', MEDIUM: 'Medio', LOW: 'Bajo', INFO: 'Informativo' };
    const fmt = (o, map) => Object.entries(o).map(([k2, v]) => `${map[k2] || k2}: ${v} concepto(s)`).join(' · ') || 'Sin datos';
    k.kv([['Confianza del APU (Confidence Engine)', fmt(model.intelligence.confidence, LBL)], ['Riesgo de costo (Bid Risk)', fmt(model.intelligence.bidRisk, RISK)]], { cols: 1 });
  }
  k.paragraph('Resumen determinista: todas las cifras provienen del Presupuesto (motor F2), los Números Generadores (F3) y los Levantamientos (F4) del proyecto. No se generan conclusiones con IA.', { size: 7, color: [110, 118, 128], style: 'italic' });
  return k.finish();
}

/* ========================= MEMORIA DE CUANTIFICACION ========================= */
export function renderQuantificationMemoryPdf(model, { logo = null } = {}){
  const h = model.header;
  const k = createReport({ reportLabel: REPORT_LABEL.MEMORIA, header: h, draft: model.draft, logo });
  k.section(REPORT_LABEL.MEMORIA);
  k.kv([['Proyecto', h.proyecto], ['Cliente', h.cliente], ['Ubicación', h.ubicacion], ['Fecha', h.fecha], ['Revisión', documentRevision(h)]]);
  if(model.empty){ k.empty(model.empty); return k.finish(); }
  k.paragraph('Fuente de cantidad: CAD / GENERADORES = geometría del plano autoritativo del servidor; CAPTURA MANUAL = medidas capturadas en el levantamiento. Las dimensiones DEFAULT no fueron medidas y deben confirmarse en obra.', { size: 7.2, color: [110, 118, 128] });
  model.surveys.forEach(s => {
    k.subsection(`Levantamiento: ${s.name} · ${s.mode === 'CAD_AUTHORITATIVE' ? 'CAD autoritativo' : s.mode === 'MIXTO' ? 'Mixto (CAD + captura manual)' : 'Captura manual'}${s.revision != null ? ` · rev. ${s.revision}` : ''}`);
    k.table({ columns: [{ head: 'Espacio', w: 1.6 }, { head: 'Fuente', w: 1.5 }, { head: 'Plano (rev.)', w: 1.2 }, { head: 'Piso m²', w: 0.9, align: 'right' }, { head: 'Muros netos m²', w: 1.1, align: 'right' }, { head: 'Escala', w: 1.1 }],
      rows: s.spaces.map(sp => ({ cells: [sp.name, sp.origin === 'CAD' ? 'CAD' : 'CAPTURA MANUAL', sp.planoId ? `rev. ${sp.planoRevision ?? '—'}` : '—', sp.q ? fmtQty(sp.q.floorArea) : 'pendiente', sp.q ? fmtQty(sp.q.wallNetArea) : 'pendiente', sp.scaleConfirmed === false ? 'SIN CONFIRMAR' : sp.origin === 'CAD' ? 'Confirmada' : '—'], color: sp.scaleConfirmed === false ? [178, 34, 34] : null })) });
    s.spaces.filter(sp => sp.dims.length).forEach(sp => {
      k.paragraph(`Procedencia de dimensiones — ${sp.name}${sp.defaults.length ? ` (${sp.defaults.length} DEFAULT)` : ''}`, { size: 7.6, style: 'bold', color: [11, 47, 74] });
      k.table({ columns: [{ head: 'Elemento', w: 1 }, { head: 'Dimensión', w: 1.6 }, { head: 'Valor (m)', w: 1, align: 'right' }, { head: 'Procedencia', w: 2 }],
        rows: sp.dims.map(d => ({ cells: [d.element, d.dimension, d.value == null ? '—' : fmtQty(d.value), sourceText(d.source)], color: d.source === 'DEFAULT' ? [178, 34, 34] : null })) });
    });
  });
  k.section('Cantidad por concepto y fuente');
  const g = model.generators;
  if(!g.concepts.length) k.empty('Sin conceptos con cantidad desde generadores.');
  g.concepts.forEach(cpt => {
    k.subsection(`${cpt.clave ? `${cpt.clave} · ` : ''}${cpt.concept} — ${fmtQty(cpt.qty)} ${cpt.unit} · Fuente: GENERADORES${cpt.stale ? ' · DESACTUALIZADOS' : ''}`);
    k.table({ columns: GEN_COLUMNS, rows: generatorRows(cpt) });
  });
  k.paragraph(`Conceptos por fuente de cantidad: generadores ${model.byQuantitySource.GENERADORES || 0} · plano ${model.byQuantitySource.PLANO || 0} · captura manual ${model.byQuantitySource.MANUAL || 0}.`, { size: 7.4 });
  return k.finish();
}
