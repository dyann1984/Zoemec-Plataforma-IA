/* Reporte Ejecutivo del Proyecto (Fase F, seccion 16). Deliberadamente
   CONCISO -- portada, datos generales, Project Health, presupuesto, avance,
   principales riesgos, cambios, forecast, Construction DNA resumido, fecha
   de corte -- NUNCA un dump de todas las tablas del Vault (esas viven en
   sus propios exportadores: presupuestoExport.js, apuProjectDossierPdf.js,
   explosionPdf.js, etc., cada uno ya registra su propio evento). Mismo
   patron de exportacion que presupuestoExport.js: jsPDF con `doc.text`
   posicionado a mano, write-excel-file con las celdas de apuExport.js, y
   registro del evento via /api/export-events con scope:'VAULT'. */
import { jsPDF } from 'jspdf';
import { money, xcell, XLS, exportWorkbookExcel } from './apuExport.js';
import { apiPost } from '../services/apiClient.js';
import { fetchProjectVaultForExport } from './projectVaultData.js';

async function recordExportEvent(projectId, format){
  if(!projectId) return;
  try{ await apiPost('/api/export-events', { action: 'record', scope: 'VAULT', projectId, format, mode: 'TECNICO' }); }
  catch{ /* el archivo ya se genero; un fallo de auditoria secundaria no revierte la exportacion */ }
}

function pct(n){ return n == null ? 'Sin información' : `${Number(n).toFixed(1)}%`; }
function safeMoney(n){ return n == null ? 'Sin información' : money(n); }
function fechaCorte(){ return new Date().toLocaleString('es-MX'); }

export function exportProjectVaultPDF({ vault, company = {}, save = true, fileName } = {}){
  const { project, resumenEjecutivo: r, health, alerts, baselineComparison: bc, constructionDna } = vault;
  const doc = new jsPDF();
  let y = 16;
  const line = (text, opts = {}) => { doc.text(String(text), 14, y, opts); y += 6; };
  const section = (title) => { if(y > 250){ doc.addPage(); y = 18; } y += 2; doc.setFont(undefined, 'bold'); doc.setFontSize(11); line(title); doc.setFont(undefined, 'normal'); doc.setFontSize(9); };

  doc.setFontSize(16); doc.text(company.name || 'ZOEMEC', 14, y); y += 10;
  doc.setFontSize(13); doc.text('REPORTE EJECUTIVO DEL PROYECTO', 14, y); y += 8;
  doc.setFontSize(10); doc.text(project?.name || project?.id || '', 14, y); y += 6;
  doc.setFontSize(8); doc.text(`Fecha de corte: ${fechaCorte()}`, 14, y); y += 10;

  doc.setFontSize(9);
  section('Datos generales');
  line(`Cliente: ${r.client || 'Sin información'}`);
  line(`Ubicación: ${r.ubicacion || 'Sin información'}`);
  line(`Tipo de obra: ${r.tipoDeObra || 'Sin información'}`);
  line(`Etapa: ${r.etapa || 'Sin información'}`);
  line(`Superficie: ${r.superficie || 'Sin información'}`);

  section('Project Health');
  line(`Project Health: ${health.score}/100 (${health.label})`);
  Object.entries(health.dimensions).forEach(([key, d]) => line(`  ${key}: ${d.score}${d.insufficientData ? ' (sin datos suficientes)' : ''}`));
  if(health.drivers?.length){
    line('Que esta bajando el score:');
    health.drivers.forEach(d => (d.reasons || []).forEach(reason => line(`  - ${reason}`)));
  }

  section('Presupuesto');
  line(`Baseline: ${safeMoney(r.presupuestoBaseline)}`);
  line(`Vigente: ${safeMoney(r.presupuestoVigente)}`);
  line(`Variación: ${safeMoney(bc.variacion)} (${pct(bc.variacionPct)})`);
  line(`Ejecutado: ${safeMoney(r.ejecutado)}`);
  line(`Pagado: ${safeMoney(r.pagado)}`);

  section('Avance');
  line(`Avance físico: ${pct(r.avanceFisicoPct)}`);
  line(`Avance financiero: ${pct(r.avanceFinancieroPct)}`);

  section('Forecast al cierre');
  line(`Costo estimado al cierre (EAC): ${safeMoney(r.forecast)}`);

  section('Principales riesgos');
  if(!alerts.length) line('Sin alertas activas.');
  else alerts.slice(0, 8).forEach(a => line(`[${a.priority}] ${a.message}`, { maxWidth: 180 }));

  section('Cambios');
  if(!bc.cantidadesModificadas.length) line('Sin ordenes de cambio aprobadas.');
  else bc.cantidadesModificadas.forEach(c => line(`${c.folio || ''} ${c.clave || ''}: ${c.cantidadAnterior} -> ${c.cantidadNueva}`));
  if(bc.plazo.impactoTiempoDiasTotal != null) line(`Impacto en plazo acumulado: ${bc.plazo.impactoTiempoDiasTotal} dias`);

  section('Construction DNA (resumen)');
  if(!constructionDna) line('Sin Construction DNA generado todavia.');
  else{
    line(`Version: ${constructionDna.currentVersion}`);
    const dna = constructionDna.snapshot;
    const familias = dna?.costos?.familiasPrincipales?.value || [];
    if(familias.length) line(`Familias de costo principales: ${familias.map(f => f.label).join(', ')}`);
    const sistemas = ['cimentacion', 'estructura', 'muros', 'cubiertas', 'acabados'].filter(k => dna?.sistemaConstructivo?.[k]?.value);
    if(sistemas.length) line(`Sistema constructivo detectado: ${sistemas.join(', ')}`);
  }

  if(save !== false) doc.save(fileName || `${project?.id || 'proyecto'}-REPORTE-EJECUTIVO-ZOEMEC.pdf`);
  recordExportEvent(project?.id, 'PDF');
  return doc;
}

function buildVaultSheetRows(vault){
  const { project, resumenEjecutivo: r, health, alerts, baselineComparison: bc } = vault;
  const rows = [
    [xcell('REPORTE EJECUTIVO DEL PROYECTO', XLS.title)],
    [xcell(project?.name || project?.id || '', XLS.subtitle)],
    [xcell(`Fecha de corte: ${fechaCorte()}`, XLS.note)],
    [],
    [xcell('Project Health', XLS.section)],
    ['Score', 'Nivel', ...Object.keys(health.dimensions)].map(h => xcell(h, XLS.head)),
    [health.score, health.label, ...Object.values(health.dimensions).map(d => d.score)],
    [],
    [xcell('Presupuesto', XLS.section)],
    ['Baseline', 'Vigente', 'Variación', 'Ejecutado', 'Pagado', 'Forecast (EAC)'].map(h => xcell(h, XLS.head)),
    [xcell(r.presupuestoBaseline, XLS.money), xcell(r.presupuestoVigente, XLS.money), xcell(bc.variacion, XLS.money), xcell(r.ejecutado, XLS.money), xcell(r.pagado, XLS.money), xcell(r.forecast, XLS.money)],
    [],
    [xcell('Avance', XLS.section)],
    ['Avance físico %', 'Avance financiero %'].map(h => xcell(h, XLS.head)),
    [r.avanceFisicoPct, r.avanceFinancieroPct],
    [],
    [xcell('Principales riesgos', XLS.section)],
    ['Prioridad', 'Mensaje'].map(h => xcell(h, XLS.head)),
    ...alerts.slice(0, 15).map(a => [a.priority, a.message]),
    [],
    [xcell('Cambios aprobados', XLS.section)],
    ['Folio', 'Clave', 'Cantidad anterior', 'Cantidad nueva'].map(h => xcell(h, XLS.head)),
    ...bc.cantidadesModificadas.map(c => [c.folio || '', c.clave || '', c.cantidadAnterior, c.cantidadNueva])
  ];
  return rows;
}

export async function exportProjectVaultExcel({ vault, writeXlsxFileImpl } = {}){
  const rows = buildVaultSheetRows(vault);
  const sheets = [{ sheet: 'REPORTE EJECUTIVO', rows, widths: [16, 30, 14, 14, 14, 14] }];
  await exportWorkbookExcel(sheets, `${vault.project?.id || 'proyecto'}-REPORTE-EJECUTIVO-ZOEMEC.xlsx`, writeXlsxFileImpl)
    .catch(() => alert('No pude generar el Excel. Inténtalo de nuevo.'));
  await recordExportEvent(vault.project?.id, 'XLSX');
}

export { fetchProjectVaultForExport };
