/* Exportadores PDF/Excel del Presupuesto (Fase D). Mismo criterio que
   exportBudgetExcel/exportBudgetPDF (src/lib/apuExport.js): toma la
   agregacion YA calculada (src/domain/presupuestoAggregation.js#aggregatePresupuesto,
   ejecutada sobre datos que a su vez vienen de calcAPU/calcAPUv2 -- nunca
   una formula de costo paralela aqui) y solo la formatea. Agrupa por
   capitulo con subtotales, agrega columnas de APU asociado/confianza/Bid
   Risk/origen que el presupuesto simple de main.jsx nunca tuvo. Registra el
   evento de exportacion (scope:'PRESUPUESTO', ver
   server/api-lib/_route-export-events.mjs) igual que el resto de
   exportadores server-conscientes de la app. */
import { jsPDF } from 'jspdf';
import { money, num, xcell, XLS, exportWorkbookExcel } from './apuExport.js';
import { capituloLabel } from '../domain/presupuestoCapitulos.js';
import { apiPost } from '../services/apiClient.js';

async function recordExportEvent(presupuesto, format){
  if(!presupuesto?.projectId) return;
  try{
    await apiPost('/api/export-events', { action: 'record', scope: 'PRESUPUESTO', projectId: presupuesto.projectId, format, mode: 'TECNICO' });
  }catch{ /* el archivo ya se genero; un fallo de auditoria secundaria no revierte la exportacion */ }
}

function buildPresupuestoSheetRows(aggregation, presupuesto, projectName){
  const rows = [
    [xcell('PRESUPUESTO', XLS.title)],
    [xcell(projectName || presupuesto?.projectId || '', XLS.subtitle)],
    [xcell(`Versión ${presupuesto?.currentVersion || ''}${presupuesto?.baselineVersion ? ` · Baseline: ${presupuesto.baselineVersion}` : ''}`, XLS.note)],
    [],
    ['Clave', 'Capítulo', 'Descripción', 'Unidad', 'Cantidad', 'P.U.', 'Importe', 'APU asociado', 'Confianza', 'Bid Risk', 'Origen cantidad', 'Origen precio'].map(h => xcell(h, XLS.head))
  ];
  aggregation.capituloSubtotals.forEach(cap => {
    rows.push([xcell(cap.label, XLS.section)]);
    aggregation.rows.filter(r => r.capitulo === cap.capitulo).forEach(r => {
      rows.push([
        r.clave || '', capituloLabel(r.capitulo), r.concept || '', r.unit || '', xcell(r.qty, XLS.qty),
        xcell(r.pu, XLS.money), xcell(r.importe, XLS.money), r.apuId || (r.hasApu ? 'Sí' : 'Pendiente'),
        r.confidenceStatus || '', r.bidRiskSeverity || '', r.origenCantidad || '', r.origenPrecio || ''
      ]);
    });
    rows.push([xcell(`Subtotal ${cap.label}`, XLS.total), '', '', '', '', '', xcell(cap.importe, XLS.total)]);
  });
  rows.push([]);
  rows.push([xcell('Costo directo total', XLS.total), '', '', '', '', '', xcell(aggregation.costoDirectoTotal, XLS.total)]);
  rows.push([xcell('IMPORTE TOTAL', XLS.grand), '', '', '', '', '', xcell(aggregation.importeTotal, XLS.grand)]);
  return rows;
}

export async function exportPresupuestoExcel({ presupuesto, aggregation, projectName, writeXlsxFileImpl } = {}){
  const rows = buildPresupuestoSheetRows(aggregation, presupuesto, projectName);
  const sheets = [{ sheet: 'PRESUPUESTO', rows, widths: [12, 16, 40, 8, 10, 12, 14, 16, 12, 12, 16, 16] }];
  await exportWorkbookExcel(sheets, `${presupuesto?.projectId || 'proyecto'}-PRESUPUESTO-ZOEMEC.xlsx`, writeXlsxFileImpl)
    .catch(() => alert('No pude generar el Excel. Inténtalo de nuevo.'));
  await recordExportEvent(presupuesto, 'XLSX');
}

export function exportPresupuestoPDF({ presupuesto, aggregation, projectName, company = {}, save = true, fileName } = {}){
  const doc = new jsPDF();
  let y = 16;
  doc.setFontSize(16); doc.text(company.name || 'ZOEMEC', 14, y);
  doc.setFontSize(13); doc.text('PRESUPUESTO', 14, y + 14);
  doc.setFontSize(9); doc.text(projectName || presupuesto?.projectId || '', 14, y + 22);
  doc.text(`Versión ${presupuesto?.currentVersion || ''}${presupuesto?.baselineVersion ? ` · Baseline: ${presupuesto.baselineVersion}` : ''}`, 14, y + 28);
  y += 40;
  doc.setFontSize(8);
  aggregation.capituloSubtotals.forEach(cap => {
    if(y > 265){ doc.addPage(); y = 18; }
    doc.setFont(undefined, 'bold'); doc.text(cap.label, 14, y); doc.setFont(undefined, 'normal'); y += 7;
    aggregation.rows.filter(r => r.capitulo === cap.capitulo).forEach(r => {
      if(y > 275){ doc.addPage(); y = 18; }
      doc.text(String(r.clave || ''), 14, y);
      doc.text(String(r.concept || ''), 32, y, { maxWidth: 90 });
      doc.text(String(r.unit || ''), 125, y);
      doc.text(String(r.qty), 138, y);
      doc.text(money(r.pu), 155, y);
      doc.text(money(r.importe), 178, y);
      y += 7;
    });
    doc.setFont(undefined, 'bold');
    doc.text(`Subtotal ${cap.label}`, 125, y, { maxWidth: 40 });
    doc.text(money(cap.importe), 178, y);
    doc.setFont(undefined, 'normal');
    y += 10;
  });
  if(y > 260){ doc.addPage(); y = 18; }
  doc.setFont(undefined, 'bold');
  doc.text('Costo directo total', 125, y); doc.text(money(aggregation.costoDirectoTotal), 178, y); y += 8;
  doc.text('IMPORTE TOTAL', 125, y); doc.text(money(aggregation.importeTotal), 178, y);
  if(save !== false) doc.save(fileName || `${presupuesto?.projectId || 'proyecto'}-PRESUPUESTO-ZOEMEC.pdf`);
  recordExportEvent(presupuesto, 'PDF');
  return doc;
}
