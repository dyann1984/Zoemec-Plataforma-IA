/* Dossier APU Auditable -- ensamblador XLSX (Fase 8). Workbook nuevo,
   independiente de exportAPUExcelV2 (que sigue exactamente igual para el
   boton "Descargar Excel" existente) -- reusa los mismos helpers de celda/
   estilo (xcell/fcell/XLS/exportWorkbookExcel, src/lib/apuExport.js) sin
   reinventarlos. Cada hoja solo se agrega si hay datos reales para ella
   (regla 15 del spec: "no crear hojas vacias"). */
import writeXlsxFileBrowser from 'write-excel-file/browser';
import { xcell, XLS, exportWorkbookExcel, money, num } from './apuExport.js';
import { calcMaterialRow, calcLaborRow, calcEquipmentRow, calcConsumableRow } from './apuCalc.js';
import { buildDossierData } from './apuDossierData.js';
import { shortHash } from '../domain/snapshotHash.js';
import { apiPost } from '../services/apiClient.js';

const asCell = (value, style = {}) => xcell(value, style);
const pad = (row, width) => { const full = [...row]; while(full.length < width) full.push(null); return full; };
// write-excel-file rechaza un formato NUMERICO (XLS.money/XLS.qty) sobre una
// celda cuyo valor termino siendo texto (el fallback "NO ESTIMABLE"/"NO
// CALCULABLE"/"—" cuando el numero real es null) -- este helper aplica el
// estilo numerico SOLO cuando el valor es un numero real, nunca sobre el
// texto de reemplazo.
const moneyCell = (value, fallbackText) => value != null ? asCell(value, XLS.money) : asCell(fallbackText);

function buildPortadaSheet(data, meta){
  const rows = [];
  const add = row => rows.push(pad(row, 4));
  const kv = (label, value) => add([asCell(label, XLS.label), asCell(value ?? 'Por definir', { wrap: true })]);
  add([asCell('ZOEMEC -- DOSSIER TECNICO AUDITABLE', { columnSpan: 4, ...XLS.title }), null, null, null]);
  add([]);
  kv('Proyecto', meta.proyecto);
  kv('Cliente', meta.cliente);
  kv('Concepto', data.snapshot.concept);
  kv('Unidad', data.snapshot.unit);
  kv('Version', data.revision || 'Sin version guardada');
  kv('Fecha', meta.fecha);
  kv('Autor', data.createdBy || meta.autor);
  kv('Estado', data.snapshot.validationStatus);
  kv('Snapshot hash (corto)', `${shortHash(data.snapshotHash)}...`);
  add([]);
  add([asCell(data.verificationLabel, { columnSpan: 4, fontWeight: 'bold', color: '#ffffff', backgroundColor: data.source === 'SERVER_VERSION' ? '#166534' : '#B45309', align: 'center' }), null, null, null]);
  return { sheet: 'PORTADA', rows, widths: [28, 40, 20, 20], stickyRowsCount: 0, orientation: 'portrait' };
}

function buildResumenSheet(data){
  const t = data.snapshot.calculated || {};
  const rows = [];
  const add = row => rows.push(pad(row, 2));
  const kv = (label, value) => add([asCell(label, XLS.label), asCell(value ?? '—', {})]);
  add([asCell('RESUMEN EJECUTIVO', { columnSpan: 2, ...XLS.title }), null]);
  add([]);
  kv('Precio unitario', money(t.pu));
  kv('Cantidad de obra', num(data.snapshot.cantidadObra));
  kv('Importe proyecto', t.importeTotal != null ? money(t.importeTotal) : 'NO CALCULABLE');
  kv('Materiales', money(t.mat));
  kv('Mano de obra', money(t.mo));
  kv('Equipo', money(t.equipo));
  kv('Herramienta/consumibles', money((t.herramienta || 0) + (t.consumibles || 0)));
  if(t.indirect != null) kv('Indirectos', money(t.indirect));
  if(t.utility != null) kv('Utilidad', money(t.utility));
  add([]);
  kv('Confidence', data.confidence.score != null ? `${data.confidence.score}% (${data.confidence.status})` : 'EVIDENCIA INSUFICIENTE');
  kv('Bid Risk', data.bidRisk.severity);
  kv('Exposicion estimada', Number.isFinite(data.bidRisk.estimatedExposure) && data.bidRisk.estimatedExposure > 0 ? money(data.bidRisk.estimatedExposure) : 'NO ESTIMABLE');
  kv('Findings CRITICAL/HIGH/MEDIUM/LOW', `${data.audit.summary.critical}/${data.audit.summary.high}/${data.audit.summary.medium}/${data.audit.summary.low}`);
  return { sheet: 'RESUMEN', rows, widths: [30, 30], stickyRowsCount: 0, orientation: 'portrait' };
}

const RESOURCE_LABEL = { materials: 'MATERIALES', labor: 'MANO DE OBRA', equipment: 'EQUIPO', consumables: 'CONSUMIBLES-HERRAMIENTA' };
// Importe REAL por renglon: reusa las mismas funciones de costo que ya usa
// todo el motor (apuCalc.js, tambien consumidas por apuChallenge.js) --
// nunca una formula aproximada tipo "cantidad*precio" que ignoraria
// desperdicio/FSR/integracion y podria no cuadrar con calcAPUv2 (regla P
// del spec: "valores monetarios correctos").
const ROW_COST_FN = { materials: calcMaterialRow, labor: calcLaborRow, equipment: calcEquipmentRow, consumables: calcConsumableRow };
function buildResourceSheet(kind, snapshot){
  const rows = Array.isArray(snapshot[kind]) ? snapshot[kind] : [];
  if(!rows.length) return null;
  const out = [];
  out.push(pad([asCell(RESOURCE_LABEL[kind], { columnSpan: 8, ...XLS.title })], 8));
  out.push(pad(['Clave', 'Descripcion', 'Unidad', 'Cantidad/Consumo', 'Rendimiento', 'Precio unitario', 'Importe', 'Estado'].map(h => asCell(h, XLS.head)), 8));
  rows.forEach(r => {
    const precio = Number(r.precioUnitario ?? r.salarioBase ?? r.tarifa ?? 0);
    const cantidad = Number(r.consumo ?? r.cantidad ?? 1);
    const importe = Number(ROW_COST_FN[kind]?.(r, {})) || 0;
    out.push(pad([
      asCell(r.clave || '—'), asCell(r.descripcion || '—'), asCell(r.unidad || '—'),
      asCell(cantidad, XLS.qty),
      // XLS.qty trae un formato NUMERICO -- aplicarlo a la celda cuando no
      // hay rendimiento (renglon de materiales/consumibles, que no lo
      // tienen) la dejaria como texto "—" con formato de numero, y
      // write-excel-file rechaza esa combinacion (formato numerico sobre
      // celda de texto). Solo se aplica el estilo si el valor es numero real.
      r.rendimiento != null ? asCell(r.rendimiento, XLS.qty) : asCell('—'),
      asCell(precio, XLS.money), asCell(importe, XLS.money), asCell(r.fuente?.estado || 'SIN ESTADO')
    ], 8));
  });
  return { sheet: RESOURCE_LABEL[kind], rows: out, widths: [12, 34, 10, 14, 12, 14, 14, 16], stickyRowsCount: 2, orientation: 'landscape' };
}

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
function buildAuditoriaSheet(data){
  if(!data.audit.findings.length) return null;
  const sorted = [...data.audit.findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const rows = [pad(['Severidad', 'Categoria', 'Descripcion', 'Evidencia', 'Recomendacion'].map(h => asCell(h, XLS.head)), 5)];
  sorted.forEach(f => rows.push(pad([asCell(f.severity), asCell(f.category), asCell(f.message, { wrap: true }), asCell(f.evidence || '—'), asCell(f.recommendation || '—', { wrap: true })], 5)));
  return { sheet: 'AUDITORIA', rows, widths: [12, 20, 44, 24, 34], stickyRowsCount: 1, orientation: 'landscape' };
}

const DECISION_LABEL = { MAINTAIN: 'MANTENIDO', JUSTIFY: 'JUSTIFICADO', CORRECT: 'CORREGIDO', DISMISS: 'DESCARTADO' };
function buildChallengeSheet(data){
  if(!data.challenge.challenges.length) return null;
  const rows = [pad(['Severidad', 'Categoria', 'Hallazgo', 'Impacto unit.', 'Impacto proyecto', 'Estado', 'Actor', 'Verificacion servidor'].map(h => asCell(h, XLS.head)), 8)];
  data.challenge.challenges.forEach(c => {
    const d = c.decision;
    rows.push(pad([
      asCell(c.severity), asCell(c.category), asCell(c.title, { wrap: true }),
      moneyCell(c.unitImpact, 'NO CALCULABLE'),
      moneyCell(c.projectImpact, 'NO ESTIMABLE'),
      asCell(d ? (DECISION_LABEL[d.decision] || d.decision) : 'PENDIENTE'),
      asCell(d ? (d.actorEmail || d.actorUid) : '—'),
      asCell(d ? d.verificationStatus : '—')
    ], 8));
  });
  return { sheet: 'CHALLENGE', rows, widths: [12, 14, 40, 14, 16, 14, 20, 22], stickyRowsCount: 1, orientation: 'landscape' };
}

function buildConfidenceSheet(data){
  const rows = [pad(['Dimension', 'Score', 'Estado', 'Razones/faltantes'].map(h => asCell(h, XLS.head)), 4)];
  Object.entries(data.confidence.dimensions).forEach(([name, dim]) => {
    const notes = [...dim.reasons, ...dim.missingData.map(m => `Sin datos: ${m}`)].join(' | ') || '—';
    rows.push(pad([asCell(name), asCell(dim.score == null ? 'EVIDENCIA INSUFICIENTE' : `${dim.score}%`), asCell(dim.status), asCell(notes, { wrap: true })], 4));
  });
  return { sheet: 'CONFIDENCE', rows, widths: [22, 20, 22, 60], stickyRowsCount: 1, orientation: 'landscape' };
}

function buildBidRiskSheet(data){
  if(!data.bidRisk.findings.length) return null;
  const sorted = [...data.bidRisk.findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const rows = [pad(['Severidad', 'Categoria', 'Descripcion', 'Impacto unit.', 'Impacto proyecto', 'Recomendacion'].map(h => asCell(h, XLS.head)), 6)];
  sorted.forEach(f => rows.push(pad([
    asCell(f.severity), asCell(f.category), asCell(f.description, { wrap: true }),
    moneyCell(f.unitImpact, 'NO ESTIMABLE'),
    moneyCell(f.projectImpact, 'NO ESTIMABLE'),
    asCell(f.recommendation || '—', { wrap: true })
  ], 6)));
  return { sheet: 'BID RISK', rows, widths: [12, 20, 40, 14, 16, 34], stickyRowsCount: 1, orientation: 'landscape' };
}

function buildEvidenciaSheet(snapshot){
  const rows = [pad(['Recurso', 'Estado', 'Fecha', 'Origen'].map(h => asCell(h, XLS.head)), 4)];
  let count = 0;
  ['materials', 'labor', 'equipment', 'consumables'].forEach(kind => {
    (snapshot[kind] || []).forEach(r => {
      count++;
      rows.push(pad([asCell(r.descripcion || '—'), asCell(r.fuente?.estado || 'SIN ESTADO'), asCell(r.fuente?.fecha || '—'), asCell(r.fuente?.proveedor || r.fuente?.sourceName || '—')], 4));
    });
  });
  if(!count) return null;
  return { sheet: 'EVIDENCIA', rows, widths: [40, 18, 14, 26], stickyRowsCount: 1, orientation: 'landscape' };
}

function buildMemoriaSheet(data){
  if(!data.memoryApproved.length && !data.memoryAnnex.length) return null;
  const rows = [pad(['Estado', 'Tipo', 'Recurso/Disciplina', 'Valor', 'Aprobado por'].map(h => asCell(h, XLS.head)), 5)];
  data.memoryApproved.forEach(e => rows.push(pad([asCell('APPROVED'), asCell(e.type), asCell(e.subject?.resourceDescripcion || e.subject?.primaryActivity || '—'), asCell(`${e.value} ${e.unit || ''}`), asCell(e.approvedBy || '—')], 5)));
  data.memoryAnnex.forEach(e => rows.push(pad([asCell(e.status), asCell(e.type), asCell(e.subject?.resourceDescripcion || e.subject?.primaryActivity || '—'), asCell(`${e.value} ${e.unit || ''}`), asCell('—')], 5)));
  return { sheet: 'MEMORIA', rows, widths: [14, 22, 30, 16, 22], stickyRowsCount: 1, orientation: 'landscape' };
}

function buildHistorialSheet(data){
  if(data.versions.length < 2) return null;
  const rows = [pad(['Version', 'Fecha', 'Autor', 'Motivo', 'P.U.'].map(h => asCell(h, XLS.head)), 5)];
  data.versions.forEach(v => rows.push(pad([asCell(v.version), asCell(v.at || v.createdAt || '—'), asCell(v.user || '—'), asCell(v.reason || '—', { wrap: true }), moneyCell(v.unitPrice, '—')], 5)));
  if(data.versionDiff?.changes?.length){
    rows.push(pad([]));
    rows.push(pad([asCell(`Cambios relevantes: ${data.versionDiff.fromVersion} -> ${data.versionDiff.toVersion}`, { columnSpan: 5, ...XLS.section })], 5));
    rows.push(pad(['Campo', 'Antes', 'Despues'].map(h => asCell(h, XLS.head)), 5));
    data.versionDiff.changes.forEach(c => rows.push(pad([asCell(c.field), asCell(String(c.before)), asCell(String(c.after))], 5)));
  }
  return { sheet: 'HISTORIAL', rows, widths: [10, 16, 16, 34, 14], stickyRowsCount: 1, orientation: 'landscape' };
}

/* Entrada principal -- mismo criterio de registro de evento que
   apuDossierPdf.js (regla 22: solo si la fuente es una version server-side). */
export async function exportApuAuditDossierExcel({ apu, apuId, apuVersionId, projectId, company = {}, mode = 'TECNICO', fileName, writeXlsxFileImpl } = {}){
  const data = await buildDossierData({ apu, apuId, apuVersionId, projectId, mode });
  const meta = {
    proyecto: company?.name || data.snapshot.proyecto || '', cliente: company?.client || data.snapshot.cliente || '',
    fecha: new Date().toLocaleDateString('es-MX'), autor: company?.responsible || company?.email || ''
  };

  const sheets = [
    buildPortadaSheet(data, meta),
    buildResumenSheet(data),
    buildResourceSheet('materials', data.snapshot),
    buildResourceSheet('labor', data.snapshot),
    buildResourceSheet('equipment', data.snapshot),
    buildResourceSheet('consumables', data.snapshot),
    buildAuditoriaSheet(data),
    buildChallengeSheet(data),
    buildConfidenceSheet(data),
    buildBidRiskSheet(data),
    ...(mode === 'TECNICO' ? [buildEvidenciaSheet(data.snapshot)] : []),
    buildMemoriaSheet(data),
    buildHistorialSheet(data)
  ].filter(Boolean);

  await exportWorkbookExcel(sheets, fileName || `${data.snapshot.clave || data.apuId || 'APU'}-DOSSIER-AUDITABLE-ZOEMEC.xlsx`, writeXlsxFileImpl || writeXlsxFileBrowser);

  if(data.source === 'SERVER_VERSION'){
    try{
      await apiPost('/api/export-events', {
        action: 'record', projectId: data.projectId, apuId: data.apuId, apuVersionId: data.versionId,
        snapshotHash: data.snapshotHash, format: 'XLSX', mode
      });
    }catch{ /* el archivo ya se genero; un fallo de auditoria secundaria no revierte la exportacion */ }
  }

  return { sheets, data };
}
