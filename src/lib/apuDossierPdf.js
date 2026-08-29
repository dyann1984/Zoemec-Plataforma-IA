/* Dossier APU Auditable -- ensamblador PDF (Fase 8). Compone, sobre UN solo
   documento jsPDF, la portada/resumen/hash/disclaimer NUEVOS de esta fase
   mas la matriz tecnica ya existente (drawApuSections, reusada tal cual,
   NUNCA reimplementada -- ver apuExportV2.js) y las secciones de
   Auditor/Challenge/Confidence/Bid Risk/Memoria/Historial que antes solo
   vivian en la UI (ZoemecIntelligencePanel.jsx). No se toca ningun motor:
   este archivo solo dibuja lo que buildDossierData (apuDossierData.js) ya
   calculo. */
import { jsPDF } from 'jspdf';
import { money, num } from './apuExport.js';
import { drawApuSections } from './apuExportV2.js';
import { buildDossierData } from './apuDossierData.js';
import { shortHash } from '../domain/snapshotHash.js';
import { apiPost } from '../services/apiClient.js';

export const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
export const pdfText = value => String(value ?? '').replace(/²/g, '2').replace(/³/g, '3').replace(/±/g, '+/-').normalize('NFD').replace(/[̀-ͯ]/g, '');

export function newSectionDrawer(doc, meta){
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 14;
  let y = 20;
  const footer = () => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(120);
    doc.text(pdfText(`${meta.proyecto || 'Sin proyecto'} | ${meta.clave || ''} | ${meta.versionLabel} | ${meta.fecha}`), M, H - 6);
    doc.text('ZOEMEC', W - M, H - 6, { align: 'right' });
  };
  const ensure = h => { if(y + h > H - 14){ footer(); doc.addPage(); y = 20; } };
  const title = text => {
    ensure(14);
    doc.setFillColor(18, 63, 120); doc.rect(M, y, W - 2 * M, 9, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text(pdfText(text), M + 3, y + 6.3);
    y += 13; doc.setTextColor(25);
  };
  const kv = (label, value) => {
    ensure(6);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.text(pdfText(label), M, y);
    doc.setFont('helvetica', 'normal'); doc.text(pdfText(value ?? '—'), M + 62, y);
    y += 5.5;
  };
  const paragraph = text => {
    const lines = doc.splitTextToSize(pdfText(text), W - 2 * M);
    ensure(lines.length * 4 + 2);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6);
    doc.text(lines, M, y); y += lines.length * 4 + 2;
  };
  const table = (heads, rows, widthsRatio) => {
    const ratios = widthsRatio || heads.map(() => 1);
    const totalRatio = ratios.reduce((a, b) => a + b, 0);
    const colW = ratios.map(r => (W - 2 * M) * r / totalRatio);
    const colX = [M]; colW.forEach((w, i) => { if(i < colW.length - 1) colX.push(colX[i] + w); });
    ensure(6);
    doc.setFillColor(230, 230, 235); doc.rect(M, y, W - 2 * M, 5.5, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8); doc.setTextColor(25);
    heads.forEach((h, i) => doc.text(pdfText(h), colX[i] + 1, y + 3.8));
    y += 6.5;
    doc.setFont('helvetica', 'normal');
    rows.forEach(row => {
      const wrapped = row.map((v, i) => doc.splitTextToSize(pdfText(v), colW[i] - 2));
      const rh = Math.max(4.4, Math.max(...wrapped.map(w => w.length)) * 3.1);
      ensure(rh);
      wrapped.forEach((lines, i) => doc.text(lines, colX[i] + 1, y + 3));
      y += rh;
    });
    y += 3;
  };
  const emptyNote = text => { doc.setFont('helvetica', 'italic'); doc.setFontSize(7.4); doc.setTextColor(120); ensure(5); doc.text(pdfText(text), M, y); y += 6; doc.setTextColor(25); };
  const addPageBreak = () => { footer(); doc.addPage(); y = 20; };
  return { get y(){ return y; }, set y(v){ y = v; }, W, H, M, footer, ensure, title, kv, paragraph, table, emptyNote, addPageBreak };
}

function drawPortada(doc, data, meta){
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 16;
  doc.setFillColor(42, 23, 64); doc.rect(0, 0, W, 62, 'F');
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
  doc.text('ZOEMEC', W / 2, 28, { align: 'center' });
  doc.setFontSize(11); doc.text('DOSSIER TECNICO AUDITABLE', W / 2, 40, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.text(pdfText(data.verificationLabel), W / 2, 50, { align: 'center' });

  let y = 78; doc.setTextColor(30);
  const field = (label, value) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(pdfText(label), M, y);
    doc.setFont('helvetica', 'normal'); doc.text(pdfText(value ?? 'Por definir'), M + 55, y);
    y += 8;
  };
  field('Proyecto:', meta.proyecto);
  field('Cliente:', meta.cliente);
  field('Concepto:', data.snapshot.concept);
  field('Unidad:', data.snapshot.unit);
  field('Version:', data.revision || 'Sin version guardada');
  field('Fecha:', meta.fecha);
  field('Autor:', data.createdBy || meta.autor);
  field('Estado:', data.snapshot.validationStatus);
  field('Snapshot hash:', shortHash(data.snapshotHash) + '...');

  y += 10;
  const labelColor = data.source === 'SERVER_VERSION' ? [7, 140, 90] : [200, 120, 0];
  doc.setFillColor(...labelColor); doc.roundedRect(M, y, W - 2 * M, 14, 2, 2, 'F');
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text(pdfText(data.verificationLabel), W / 2, y + 9.5, { align: 'center' });
  y += 26;

  doc.setTextColor(90); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.4);
  const disclaimer = 'El presente documento refleja la informacion, fuentes, parametros y version indicados en el momento de su generacion.'
    + (data.source === 'LOCAL_DRAFT' ? ' Este documento se genero desde un borrador local sin respaldo server-side: debe validarse antes de usarse como referencia formal.' : '');
  doc.text(doc.splitTextToSize(pdfText(disclaimer), W - 2 * M), M, y);
}

function drawResumen(doc, data, meta){
  doc.addPage();
  const s = newSectionDrawer(doc, meta);
  s.title('RESUMEN EJECUTIVO');
  const t = data.snapshot.calculated || {};
  s.kv('Precio unitario', money(t.pu));
  s.kv('Cantidad de obra', num(data.snapshot.cantidadObra));
  s.kv('Importe proyecto', t.importeTotal != null ? money(t.importeTotal) : 'NO CALCULABLE');
  s.kv('Materiales', money(t.mat));
  s.kv('Mano de obra', money(t.mo));
  s.kv('Equipo', money(t.equipo));
  s.kv('Herramienta/consumibles', money((t.herramienta || 0) + (t.consumibles || 0)));
  if(t.indirect != null) s.kv('Indirectos', money(t.indirect));
  if(t.utility != null) s.kv('Utilidad', money(t.utility));
  s.y += 3;
  s.kv('Confidence', data.confidence.score != null ? `${data.confidence.score}% (${data.confidence.status})` : 'EVIDENCIA INSUFICIENTE');
  s.kv('Bid Risk', data.bidRisk.severity);
  s.kv('Exposicion estimada', Number.isFinite(data.bidRisk.estimatedExposure) && data.bidRisk.estimatedExposure > 0 ? money(data.bidRisk.estimatedExposure) : 'NO ESTIMABLE');
  s.kv('Findings CRITICAL', data.audit.summary.critical);
  s.kv('Findings HIGH', data.audit.summary.high);
  s.kv('Findings MEDIUM', data.audit.summary.medium);
  s.kv('Findings LOW', data.audit.summary.low);
  return s;
}

export function drawConfidence(doc, data, meta){
  doc.addPage();
  const s = newSectionDrawer(doc, meta);
  s.title('CONFIANZA DEL APU');
  if(data.confidence.score == null) s.emptyNote('EVIDENCIA INSUFICIENTE para calcular un score global.');
  else s.kv('Score global', `${data.confidence.score}% (${data.confidence.status}) -- ${data.confidence.recommendation}`);
  Object.entries(data.confidence.dimensions).forEach(([name, dim]) => {
    s.ensure(8);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text(pdfText(`${name}: ${dim.score == null ? 'EVIDENCIA INSUFICIENTE' : `${dim.score}% (${dim.status})`}`), s.M, s.y); s.y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    dim.reasons.forEach(r => s.paragraph(`- ${r}`));
    if(dim.missingData.length) s.paragraph(`Sin datos: ${dim.missingData.join(', ')}`);
  });
  return s;
}

export function drawAuditoria(doc, data, meta){
  doc.addPage();
  const s = newSectionDrawer(doc, meta);
  s.title('AUDITORIA TECNICA');
  if(!data.audit.findings.length){ s.emptyNote('Sin hallazgos.'); return s; }
  const sorted = [...data.audit.findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  s.table(['Severidad', 'Categoria', 'Descripcion', 'Evidencia', 'Recomendacion'],
    sorted.map(f => [f.severity, f.category, f.message, f.evidence || '—', f.recommendation || '—']),
    [1, 1.4, 3, 1.6, 2]);
  return s;
}

const DECISION_LABEL = { MAINTAIN: 'MANTENIDO', JUSTIFY: 'JUSTIFICADO', CORRECT: 'CORREGIDO', DISMISS: 'DESCARTADO' };
export function drawChallenge(doc, data, meta){
  doc.addPage();
  const s = newSectionDrawer(doc, meta);
  s.title('ZOEMEC CHALLENGE');
  if(!data.challenge.challenges.length){ s.emptyNote('Sin cuestionamientos.'); return s; }
  data.challenge.challenges.forEach(c => {
    s.ensure(10);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text(pdfText(`[${c.severity}] ${c.title}`), s.M, s.y); s.y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    s.paragraph(`Baseline: ${c.baselineSource} | Impacto unitario: ${c.unitImpact != null ? money(c.unitImpact) : 'NO CALCULABLE'} | Impacto proyecto: ${c.projectImpact != null ? money(c.projectImpact) : 'NO ESTIMABLE'}`);
    if(c.decision){
      const d = c.decision;
      s.paragraph(`Estado: ${DECISION_LABEL[d.decision] || d.decision} -- ${d.actorEmail || d.actorUid} -- ${d.updatedAt || d.createdAt}${d.reason ? ` -- "${d.reason}"` : ''}`);
      s.paragraph(`Verificacion servidor: ${d.verificationStatus}${d.clientMismatch ? ' (discrepancia cliente/servidor detectada, se conservo el valor del servidor)' : ''}`);
      if(d.decision === 'CORRECT'){
        s.paragraph(`Relacion de versiones: version origen ${meta.versionLabel}${d.applicationStatus ? `, aplicacion: ${d.applicationStatus}` : ''}`);
      }
    }else{
      s.paragraph('Estado: PENDIENTE (sin decision profesional registrada).');
    }
    s.y += 2;
  });
  return s;
}

export function drawBidRisk(doc, data, meta){
  doc.addPage();
  const s = newSectionDrawer(doc, meta);
  s.title('RIESGO DE LICITACION / COSTO');
  s.kv('Severidad global', data.bidRisk.severity);
  s.kv('Exposicion estimada', Number.isFinite(data.bidRisk.estimatedExposure) && data.bidRisk.estimatedExposure > 0 ? money(data.bidRisk.estimatedExposure) : 'NO ESTIMABLE');
  if(!data.bidRisk.findings.length){ s.emptyNote('Sin hallazgos de riesgo.'); return s; }
  const sorted = [...data.bidRisk.findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  s.table(['Severidad', 'Categoria', 'Descripcion', 'Impacto unit.', 'Impacto proyecto', 'Recomendacion'],
    sorted.map(f => [f.severity, f.category, f.description, f.unitImpact != null ? money(f.unitImpact) : 'NO ESTIMABLE', f.projectImpact != null ? money(f.projectImpact) : 'NO ESTIMABLE', f.recommendation || '—']),
    [0.9, 1.3, 2.6, 1, 1, 1.8]);
  return s;
}

export function drawMemoria(doc, data, meta){
  if(!data.memoryApproved.length && !data.memoryAnnex.length) return null;
  doc.addPage();
  const s = newSectionDrawer(doc, meta);
  s.title('MEMORIA TECNICA APLICABLE');
  if(data.memoryApproved.length){
    s.table(['Tipo', 'Recurso/Disciplina', 'Valor', 'Aprobado por'],
      data.memoryApproved.map(e => [e.type, e.subject?.resourceDescripcion || e.subject?.primaryActivity || '—', `${e.value} ${e.unit || ''}`, e.approvedBy || '—']),
      [1.4, 2, 1, 1.6]);
  }else{
    s.emptyNote('Sin memoria APROBADA aplicable a este APU.');
  }
  if(data.memoryAnnex.length){
    s.y += 3;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.6); s.ensure(6);
    doc.text('ANEXO -- revision interna (no aprobado, modo tecnico completo)', s.M, s.y); s.y += 5;
    s.table(['Estado', 'Tipo', 'Recurso/Disciplina', 'Valor'],
      data.memoryAnnex.map(e => [e.status, e.type, e.subject?.resourceDescripcion || e.subject?.primaryActivity || '—', `${e.value} ${e.unit || ''}`]),
      [1, 1.4, 2.2, 1.4]);
  }
  return s;
}

export function drawProvenance(doc, data, meta){
  doc.addPage();
  const s = newSectionDrawer(doc, meta);
  s.title('TRAZABILIDAD DE DATOS');
  const rows = [];
  ['materials', 'labor', 'equipment', 'consumables'].forEach(kind => {
    (data.snapshot[kind] || []).forEach(r => {
      rows.push([r.descripcion || '—', r.fuente?.estado || 'SIN ESTADO', r.fuente?.fecha || '—', r.fuente?.proveedor || r.fuente?.sourceName || '—']);
    });
  });
  if(!rows.length){ s.emptyNote('Sin renglones con provenance registrada.'); return s; }
  s.table(['Recurso', 'Estado', 'Fecha', 'Origen'], rows, [2, 1.2, 1, 1.6]);
  return s;
}

export function drawHistorial(doc, data, meta){
  if(data.versions.length < 2) return null;
  doc.addPage();
  const s = newSectionDrawer(doc, meta);
  s.title('HISTORIAL DE VERSIONES');
  s.table(['Version', 'Fecha', 'Autor', 'Motivo', 'P.U.'],
    data.versions.map(v => [v.version, v.at || v.createdAt || '—', v.user || '—', v.reason || '—', money(v.unitPrice)]),
    [0.8, 1.4, 1.4, 2.4, 1]);
  if(data.versionDiff?.changes?.length){
    s.y += 3;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.6); s.ensure(6);
    doc.text(pdfText(`Cambios relevantes: ${data.versionDiff.fromVersion} -> ${data.versionDiff.toVersion}`), s.M, s.y); s.y += 5;
    s.table(['Campo', 'Antes', 'Despues'], data.versionDiff.changes.map(c => [c.field, String(c.before), String(c.after)]), [1.4, 1, 1]);
  }else if(data.versionDiff){
    s.emptyNote('Sin cambios relevantes detectados respecto a la version anterior.');
  }
  return s;
}

function drawHashDisclaimer(doc, data, meta){
  doc.addPage();
  const s = newSectionDrawer(doc, meta);
  s.title('INTEGRIDAD Y AVISO TECNICO');
  s.kv('Snapshot hash (completo)', data.snapshotHash);
  s.paragraph('El hash identifica el snapshot tecnico utilizado para generar este dossier.');
  s.y += 4;
  s.paragraph('El presente documento refleja la informacion, fuentes, parametros y version indicados en el momento de su generacion.');
  if(data.confidence.score == null || data.confidence.status !== 'HIGH'){
    s.paragraph('Este APU contiene datos estimados o con evidencia incompleta: deben validarse antes de usarse como base contractual definitiva.');
  }
  s.paragraph('Las inferencias generadas por IA en esta plataforma nunca se presentan como datos certificados.');
  return s;
}

/* Entrada principal (regla 22: registra el evento de exportacion cuando la
   fuente es una version server-side -- nunca si es un borrador local, para
   no fingir trazabilidad server-side de algo que no la tiene). */
export async function exportApuAuditDossierPdf({ apu, apuId, apuVersionId, projectId, company = {}, mode = 'TECNICO', save = true, fileName } = {}){
  const data = await buildDossierData({ apu, apuId, apuVersionId, projectId, mode });
  const meta = {
    proyecto: company?.name || data.snapshot.proyecto || '', cliente: company?.client || data.snapshot.cliente || '',
    clave: data.snapshot.clave || data.apuId || '', versionLabel: data.revision || 'BORRADOR',
    fecha: new Date().toLocaleDateString('es-MX'), autor: company?.responsible || company?.email || ''
  };

  const doc = new jsPDF('portrait', 'mm', 'a4');
  drawPortada(doc, data, meta);
  drawResumen(doc, data, meta).footer();
  doc.addPage();
  const matrixResult = drawApuSections(doc, data.snapshot, { startY: 12, startPage: doc.getNumberOfPages() });
  doc.setPage(matrixResult.endPage);

  const sections = [drawConfidence, drawAuditoria, drawChallenge, drawBidRisk, drawMemoria];
  if(mode === 'TECNICO') sections.push(drawProvenance);
  sections.push(drawHistorial, drawHashDisclaimer);
  sections.forEach(fn => { const s = fn(doc, data, meta); if(s) s.footer(); });

  const total = doc.internal.getNumberOfPages();
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 14;
  for(let i = 1; i <= total; i++){
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(120);
    doc.text(pdfText(`Pagina ${i} de ${total}`), W - M, H - 6, { align: 'right' });
  }

  if(save !== false) doc.save(fileName || `${meta.clave || 'APU'}-DOSSIER-AUDITABLE-ZOEMEC.pdf`);

  if(data.source === 'SERVER_VERSION'){
    try{
      await apiPost('/api/export-events', {
        action: 'record', projectId: data.projectId, apuId: data.apuId, apuVersionId: data.versionId,
        snapshotHash: data.snapshotHash, format: 'PDF', mode
      });
    }catch{ /* el archivo ya se genero; un fallo de auditoria secundaria no revierte la exportacion */ }
  }

  return { doc, data };
}
