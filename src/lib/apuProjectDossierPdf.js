/* Dossier de Proyecto/Multi-APU -- ensamblador PDF (Fase 8 Parte 2). Reusa
   tal cual, sin reimplementar, los dibujadores de seccion por-APU ya
   exportados de apuDossierPdf.js (drawConfidence/drawAuditoria/
   drawChallenge/drawBidRisk/drawMemoria) y la matriz tecnica completa
   (drawApuSections, apuExportV2.js) para cada "DETALLE APU N" -- solo se
   agregan aqui las secciones NUEVAS de nivel proyecto (portada/resumen/
   ranking/top findings/distribucion de confidence/escenarios). Ningun
   motor se toca: todo lo que se dibuja ya vino calculado de
   buildProjectDossierData (apuProjectDossierData.js). */
import { jsPDF } from 'jspdf';
import { money } from './apuExport.js';
import { drawApuSections } from './apuExportV2.js';
import {
  newSectionDrawer, pdfText,
  drawConfidence, drawAuditoria, drawChallenge, drawBidRisk, drawMemoria
} from './apuDossierPdf.js';
import { buildProjectDossierData } from './apuProjectDossierData.js';
import { shortHash } from '../domain/snapshotHash.js';
import { apiPost } from '../services/apiClient.js';

function drawPortada(doc, data, meta){
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 16;
  doc.setFillColor(42, 23, 64); doc.rect(0, 0, W, 62, 'F');
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
  doc.text('ZOEMEC', W / 2, 28, { align: 'center' });
  doc.setFontSize(11); doc.text('DOSSIER DE PROYECTO -- MULTI-APU', W / 2, 40, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.text(pdfText(`${data.apuEntries.length} APU(s) incluidos`), W / 2, 50, { align: 'center' });

  let y = 78; doc.setTextColor(30);
  const field = (label, value) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(pdfText(label), M, y);
    doc.setFont('helvetica', 'normal'); doc.text(pdfText(value ?? 'Por definir'), M + 55, y);
    y += 8;
  };
  field('Proyecto:', meta.proyecto);
  field('Cliente:', meta.cliente);
  field('Fecha:', meta.fecha);
  field('Numero de APUs:', data.apuEntries.length);
  field('Importe total:', money(data.importeProyectoTotal));
  field('Manifest hash:', `${shortHash(data.dossierManifest.manifestHash)}...`);
  y += 8;
  doc.setTextColor(90); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.4);
  doc.text(doc.splitTextToSize(pdfText('Este dossier refleja las versiones server-side ACTUALES de cada APU al momento de su generacion (ver Manifest Hash para verificar exactamente cuales).'), W - 2 * M), M, y);
}

function drawResumenProyecto(doc, data, meta){
  doc.addPage();
  const s = newSectionDrawer(doc, meta);
  s.title('RESUMEN EJECUTIVO DEL PROYECTO');
  s.kv('Numero de APUs', data.apuEntries.length);
  s.kv('Importe total del proyecto', money(data.importeProyectoTotal));
  s.kv('Confidence -- HIGH/MEDIUM/LOW/INSUF.', `${data.projectConfidence.high}/${data.projectConfidence.medium}/${data.projectConfidence.low}/${data.projectConfidence.insufficientEvidence}`);
  s.kv('Bid Risk -- LOW/MEDIUM/HIGH/CRITICAL', `${data.projectBidRisk.low}/${data.projectBidRisk.medium}/${data.projectBidRisk.high}/${data.projectBidRisk.critical}`);
  s.kv('Exposicion estimada total', data.projectBidRisk.estimatedExposure > 0 ? money(data.projectBidRisk.estimatedExposure) : 'NO ESTIMABLE');
  const reviewCount = data.ranking.filter(r => r.reviewRequired).length;
  s.kv('APUs que requieren revision prioritaria', reviewCount);
  return s;
}

function drawRankingRiesgo(doc, data, meta){
  doc.addPage();
  const s = newSectionDrawer(doc, meta);
  s.title('RANKING DE RIESGO DE APUs');
  s.table(['Concepto', 'Unidad', 'P.U.', 'Importe', 'Confidence', 'Bid Risk', 'Exposicion', 'Crit.', 'Revision'],
    data.ranking.map(r => [r.concept, r.unit, r.pu != null ? money(r.pu) : '—', r.importeTotal != null ? money(r.importeTotal) : '—',
      r.confidenceScore != null ? `${r.confidenceScore}%` : 'INSUF.', r.bidRiskSeverity,
      r.estimatedExposure > 0 ? money(r.estimatedExposure) : '—', r.criticalFindings, r.reviewRequired ? 'SI' : 'NO']),
    [2.4, 0.8, 1, 1.2, 1, 1, 1.2, 0.7, 0.9]);
  return s;
}

function drawTopFindings(doc, data, meta){
  doc.addPage();
  const s = newSectionDrawer(doc, meta);
  s.title('TOP FINDINGS DEL PROYECTO');
  if(!data.topFindings.length){ s.emptyNote('Sin hallazgos de riesgo en ningun APU del proyecto.'); return s; }
  s.table(['Severidad', 'APU', 'Descripcion', 'Impacto proyecto'],
    data.topFindings.map(f => [f.severity, f.concept, f.description, f.projectImpact != null ? money(f.projectImpact) : 'NO ESTIMABLE']),
    [1, 2, 3.6, 1.4]);
  return s;
}

function drawConfidenceDistribucion(doc, data, meta){
  doc.addPage();
  const s = newSectionDrawer(doc, meta);
  s.title('DISTRIBUCION DE CONFIDENCE');
  s.kv('HIGH', data.projectConfidence.high);
  s.kv('MEDIUM', data.projectConfidence.medium);
  s.kv('LOW', data.projectConfidence.low);
  s.kv('EVIDENCIA INSUFICIENTE', data.projectConfidence.insufficientEvidence);
  s.kv('Score promedio', data.projectConfidence.averageScore != null ? `${data.projectConfidence.averageScore}%` : 'NO CALCULABLE');
  return s;
}

function drawEscenarios(doc, data, meta){
  doc.addPage();
  const s = newSectionDrawer(doc, meta);
  s.title('ESCENARIOS SELECCIONADOS');
  if(!data.scenarios.length && !data.projectScenario){ s.emptyNote('Sin escenarios seleccionados para este dossier.'); return s; }
  if(data.scenarios.length){
    s.paragraph('SIMULACION -- NO MODIFICA EL APU BASE.');
    s.table(['Escenario', 'APU', 'Costo base', 'Costo escenario', 'Delta', 'Confidence antes/despues', 'Bid Risk antes/despues'],
      data.scenarios.map(sc => [sc.name, sc.concept, sc.baseCost != null ? money(sc.baseCost) : '—', sc.scenarioCost != null ? money(sc.scenarioCost) : '—',
        sc.delta?.unitDelta != null ? money(sc.delta.unitDelta) : '—', `${sc.confidenceBefore} -> ${sc.confidenceAfter}`, `${sc.bidRiskBefore} -> ${sc.bidRiskAfter}`]),
      [1.4, 1.6, 1, 1, 1, 1.4, 1.4]);
  }
  if(data.projectScenario){
    s.y += 4;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); s.ensure(6);
    doc.text('ESCENARIO DE PROYECTO -- SIMULACION -- NO MODIFICA NINGUN APU BASE', s.M, s.y); s.y += 6;
    s.kv('APUs afectados', data.projectScenario.affectedApus.length);
    s.kv('APUs no afectados', data.projectScenario.unaffectedApus.length);
    s.kv('Delta total del proyecto', data.projectScenario.totalProjectDelta != null ? money(data.projectScenario.totalProjectDelta) : 'NO ESTIMABLE');
    if(data.projectScenario.topImpacts.length){
      s.table(['APU', 'Delta unitario', 'Delta proyecto'],
        data.projectScenario.topImpacts.map(t => [t.concept, t.unitDelta != null ? money(t.unitDelta) : '—', t.projectDelta != null ? money(t.projectDelta) : '—']),
        [2, 1.2, 1.2]);
    }
  }
  return s;
}

function drawDetalleApuPortada(doc, entry, meta){
  doc.addPage();
  const s = newSectionDrawer(doc, meta);
  s.title(`DETALLE APU ${meta.index} de ${meta.total}: ${entry.concept}`);
  s.kv('Clave', entry.snapshot.clave || entry.apuId);
  s.kv('Unidad', entry.unit);
  s.kv('Version', entry.versionId || 'Sin version');
  s.kv('P.U.', entry.pu != null ? money(entry.pu) : 'NO CALCULABLE');
  s.kv('Importe', entry.importeTotal != null ? money(entry.importeTotal) : 'NO CALCULABLE');
  s.kv('Snapshot hash', `${shortHash(entry.snapshotHash)}...`);
  return s;
}

function drawAnexoTecnico(doc, data, meta){
  doc.addPage();
  const s = newSectionDrawer(doc, meta);
  s.title('ANEXO TECNICO');
  s.kv('Manifest hash (completo)', data.dossierManifest.manifestHash);
  s.paragraph(`APUs incluidos (id@version): ${data.dossierManifest.apuVersionIds.join(', ')}`);
  s.paragraph('El manifest hash identifica exactamente el conjunto de versiones de APU y opciones usadas para generar este dossier. Dos generaciones con el mismo proyecto, versiones y opciones producen el mismo manifest hash.');
  return s;
}

/* Entrada principal. `selectedScenarios`/`projectScenario` -- ver
   apuProjectDossierData.js. Registra el evento de exportacion de PROYECTO
   (scope=PROJECT, api/export-events.mjs) -- nunca el de un solo APU. */
export async function exportProjectDossierPdf({ projectId, mode = 'TECNICO', selectedScenarios = [], projectScenario = null, company = {}, save = true, fileName } = {}){
  const data = await buildProjectDossierData({ projectId, mode, selectedScenarios, projectScenario });
  const meta = {
    proyecto: company?.name || data.project?.name || '', cliente: company?.client || data.project?.client || '',
    clave: data.projectId, versionLabel: 'PROYECTO', fecha: new Date().toLocaleDateString('es-MX'),
    autor: company?.responsible || company?.email || ''
  };

  const doc = new jsPDF('portrait', 'mm', 'a4');
  drawPortada(doc, data, meta);
  drawResumenProyecto(doc, data, meta).footer();
  drawRankingRiesgo(doc, data, meta).footer();
  drawTopFindings(doc, data, meta).footer();
  drawConfidenceDistribucion(doc, data, meta).footer();
  drawEscenarios(doc, data, meta).footer();

  data.apuEntries.forEach((entry, i) => {
    const apuMeta = { ...meta, clave: entry.snapshot.clave || entry.apuId, versionLabel: entry.versionId || 'BORRADOR', index: i + 1, total: data.apuEntries.length };
    drawDetalleApuPortada(doc, entry, apuMeta).footer();
    doc.addPage();
    const matrixResult = drawApuSections(doc, entry.snapshot, { startY: 12, startPage: doc.getNumberOfPages() });
    doc.setPage(matrixResult.endPage);
    const entryData = { ...entry, source: 'SERVER_VERSION' };
    [drawConfidence, drawAuditoria, drawChallenge, drawBidRisk, drawMemoria].forEach(fn => {
      const s = fn(doc, entryData, apuMeta); if(s) s.footer();
    });
  });

  drawAnexoTecnico(doc, data, meta).footer();

  const total = doc.internal.getNumberOfPages();
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 14;
  for(let i = 1; i <= total; i++){
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(120);
    doc.text(pdfText(`Pagina ${i} de ${total}`), W - M, H - 6, { align: 'right' });
  }

  if(save !== false) doc.save(fileName || `${data.projectId}-DOSSIER-PROYECTO-ZOEMEC.pdf`);

  try{
    await apiPost('/api/export-events', {
      action: 'record', scope: 'PROJECT', projectId: data.projectId,
      apuVersionIds: data.dossierManifest.apuVersionIds, snapshotHashes: data.dossierManifest.snapshotHashes,
      selectedScenarioIds: data.dossierManifest.selectedScenarioIds, manifestHash: data.dossierManifest.manifestHash,
      format: 'PDF', mode
    });
  }catch{ /* el archivo ya se genero; un fallo de auditoria secundaria no revierte la exportacion */ }

  return { doc, data };
}
