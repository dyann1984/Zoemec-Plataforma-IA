/* Dossier de Proyecto/Multi-APU -- ensamblador XLSX (Fase 8 Parte 2). Regla
   OBLIGATORIA (seccion 5 del spec): una hoja por concepto -- reusa tal cual
   buildProfessionalAPUSheet + disambiguateSheetNames + safeSheet
   (apuExportV2.js, ya probadas en Fase 6/7) para nunca regresar al bug
   historico de combinar varios conceptos en menos hojas de las debidas.
   Orden de hojas generales (seccion 6, exacto): PORTADA, RESUMEN PROYECTO,
   RANKING RIESGO, AUDITORIA GLOBAL, CHALLENGE GLOBAL, CONFIDENCE, BID RISK,
   HISTORIAL/VERSIONES, ESCENARIOS -- despues una hoja principal POR APU,
   nombrada con prefijo ordinal (001_, 002_, ...). Ninguna hoja se crea
   vacia (misma regla que apuDossierXlsx.js). */
import writeXlsxFileBrowser from 'write-excel-file/browser';
import { xcell, XLS, exportWorkbookExcel, money } from './apuExport.js';
import { buildProfessionalAPUSheet, disambiguateSheetNames, safeSheet } from './apuExportV2.js';
import { buildProjectDossierData } from './apuProjectDossierData.js';
import { shortHash } from '../domain/snapshotHash.js';
import { apiPost } from '../services/apiClient.js';

const asCell = (value, style = {}) => xcell(value, style);
const pad = (row, width) => { const full = [...row]; while(full.length < width) full.push(null); return full; };
const moneyCell = (value, fallbackText) => value != null ? asCell(value, XLS.money) : asCell(fallbackText);
const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

function buildPortadaSheet(data, meta){
  const rows = [];
  const add = row => rows.push(pad(row, 4));
  const kv = (label, value) => add([asCell(label, XLS.label), asCell(value ?? 'Por definir', { wrap: true })]);
  add([asCell('ZOEMEC -- DOSSIER DE PROYECTO (MULTI-APU)', { columnSpan: 4, ...XLS.title }), null, null, null]);
  add([]);
  kv('Proyecto', meta.proyecto);
  kv('Cliente', meta.cliente);
  kv('Fecha', meta.fecha);
  kv('Numero de APUs', data.apuEntries.length);
  kv('Importe total', money(data.importeProyectoTotal));
  kv('Manifest hash (corto)', `${shortHash(data.dossierManifest.manifestHash)}...`);
  return { sheet: 'PORTADA', rows, widths: [28, 40, 20, 20], stickyRowsCount: 0, orientation: 'portrait' };
}

function buildResumenProyectoSheet(data){
  const rows = [];
  const add = row => rows.push(pad(row, 2));
  const kv = (label, value) => add([asCell(label, XLS.label), asCell(value ?? '—', {})]);
  add([asCell('RESUMEN PROYECTO', { columnSpan: 2, ...XLS.title }), null]);
  add([]);
  kv('Numero de APUs', data.apuEntries.length);
  kv('Importe total del proyecto', money(data.importeProyectoTotal));
  kv('Confidence HIGH', data.projectConfidence.high);
  kv('Confidence MEDIUM', data.projectConfidence.medium);
  kv('Confidence LOW', data.projectConfidence.low);
  kv('Confidence EVIDENCIA INSUFICIENTE', data.projectConfidence.insufficientEvidence);
  kv('Bid Risk LOW', data.projectBidRisk.low);
  kv('Bid Risk MEDIUM', data.projectBidRisk.medium);
  kv('Bid Risk HIGH', data.projectBidRisk.high);
  kv('Bid Risk CRITICAL', data.projectBidRisk.critical);
  kv('Exposicion estimada total', data.projectBidRisk.estimatedExposure > 0 ? money(data.projectBidRisk.estimatedExposure) : 'NO ESTIMABLE');
  kv('APUs que requieren revision prioritaria', data.ranking.filter(r => r.reviewRequired).length);
  return { sheet: 'RESUMEN PROYECTO', rows, widths: [34, 24], stickyRowsCount: 0, orientation: 'portrait' };
}

function buildRankingRiesgoSheet(data){
  const rows = [pad(['Concepto', 'Unidad', 'P.U.', 'Importe', 'Confidence', 'Bid Risk', 'Exposicion', 'Findings criticos', 'Revision prioritaria'].map(h => asCell(h, XLS.head)), 9)];
  data.ranking.forEach(r => rows.push(pad([
    asCell(r.concept, { wrap: true }), asCell(r.unit), moneyCell(r.pu, 'NO CALCULABLE'), moneyCell(r.importeTotal, 'NO CALCULABLE'),
    asCell(r.confidenceScore != null ? `${r.confidenceScore}%` : 'EVIDENCIA INSUFICIENTE'), asCell(r.bidRiskSeverity),
    moneyCell(r.estimatedExposure > 0 ? r.estimatedExposure : null, 'NO ESTIMABLE'), asCell(r.criticalFindings), asCell(r.reviewRequired ? 'SI' : 'NO')
  ], 9)));
  return { sheet: 'RANKING RIESGO', rows, widths: [30, 10, 14, 16, 16, 12, 16, 12, 14], stickyRowsCount: 1, orientation: 'landscape' };
}

function buildAuditoriaGlobalSheet(data){
  const rows = [pad(['APU', 'Severidad', 'Categoria', 'Descripcion', 'Evidencia', 'Recomendacion'].map(h => asCell(h, XLS.head)), 6)];
  let count = 0;
  data.apuEntries.forEach(e => {
    [...e.audit.findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)).forEach(f => {
      count++;
      rows.push(pad([asCell(e.concept), asCell(f.severity), asCell(f.category), asCell(f.message, { wrap: true }), asCell(f.evidence || '—'), asCell(f.recommendation || '—', { wrap: true })], 6));
    });
  });
  if(!count) return null;
  return { sheet: 'AUDITORIA GLOBAL', rows, widths: [26, 12, 18, 40, 22, 30], stickyRowsCount: 1, orientation: 'landscape' };
}

const DECISION_LABEL = { MAINTAIN: 'MANTENIDO', JUSTIFY: 'JUSTIFICADO', CORRECT: 'CORREGIDO', DISMISS: 'DESCARTADO' };
function buildChallengeGlobalSheet(data){
  const rows = [pad(['APU', 'Severidad', 'Categoria', 'Hallazgo', 'Impacto proyecto', 'Estado'].map(h => asCell(h, XLS.head)), 6)];
  let count = 0;
  data.apuEntries.forEach(e => {
    e.challenge.challenges.forEach(c => {
      count++;
      const d = c.decision;
      rows.push(pad([asCell(e.concept), asCell(c.severity), asCell(c.category), asCell(c.title, { wrap: true }), moneyCell(c.projectImpact, 'NO ESTIMABLE'), asCell(d ? (DECISION_LABEL[d.decision] || d.decision) : 'PENDIENTE')], 6));
    });
  });
  if(!count) return null;
  return { sheet: 'CHALLENGE GLOBAL', rows, widths: [26, 12, 16, 40, 16, 16], stickyRowsCount: 1, orientation: 'landscape' };
}

function buildConfidenceSheet(data){
  const rows = [pad(['APU', 'Score', 'Estado'].map(h => asCell(h, XLS.head)), 3)];
  data.apuEntries.forEach(e => rows.push(pad([asCell(e.concept), asCell(e.confidence.score != null ? `${e.confidence.score}%` : 'EVIDENCIA INSUFICIENTE'), asCell(e.confidence.status)], 3)));
  rows.push(pad([]));
  rows.push(pad([asCell('Score promedio del proyecto', XLS.label), asCell(data.projectConfidence.averageScore != null ? `${data.projectConfidence.averageScore}%` : 'NO CALCULABLE')], 3));
  return { sheet: 'CONFIDENCE', rows, widths: [34, 16, 22], stickyRowsCount: 1, orientation: 'landscape' };
}

function buildBidRiskSheet(data){
  const rows = [pad(['APU', 'Severidad', 'Exposicion estimada'].map(h => asCell(h, XLS.head)), 3)];
  data.apuEntries.forEach(e => rows.push(pad([asCell(e.concept), asCell(e.bidRisk.severity), moneyCell(e.bidRisk.estimatedExposure > 0 ? e.bidRisk.estimatedExposure : null, 'NO ESTIMABLE')], 3)));
  rows.push(pad([]));
  rows.push(pad([asCell('Exposicion estimada total del proyecto', XLS.label), asCell(data.projectBidRisk.estimatedExposure > 0 ? money(data.projectBidRisk.estimatedExposure) : 'NO ESTIMABLE')], 3));
  return { sheet: 'BID RISK', rows, widths: [34, 16, 22], stickyRowsCount: 1, orientation: 'landscape' };
}

function buildHistorialSheet(data){
  const rows = [pad(['APU', 'Version actual', 'Creado', 'Ultima actualizacion'].map(h => asCell(h, XLS.head)), 4)];
  data.apuEntries.forEach(e => rows.push(pad([asCell(e.concept), asCell(e.versionId || '—'), asCell(e.createdAt || '—'), asCell(e.updatedAt || '—')], 4)));
  return { sheet: 'HISTORIAL Y VERSIONES', rows, widths: [34, 16, 20, 20], stickyRowsCount: 1, orientation: 'landscape' };
}

function buildEscenariosSheet(data){
  if(!data.scenarios.length && !data.projectScenario) return null;
  const rows = [];
  if(data.scenarios.length){
    rows.push(pad([asCell('SIMULACION -- NO MODIFICA EL APU BASE', { columnSpan: 7, ...XLS.section })], 7));
    rows.push(pad(['Escenario', 'APU', 'Costo base', 'Costo escenario', 'Delta', 'Confidence antes/despues', 'Bid Risk antes/despues'].map(h => asCell(h, XLS.head)), 7));
    data.scenarios.forEach(sc => rows.push(pad([
      asCell(sc.name), asCell(sc.concept), moneyCell(sc.baseCost, '—'), moneyCell(sc.scenarioCost, '—'),
      moneyCell(sc.delta?.unitDelta, '—'), asCell(`${sc.confidenceBefore} -> ${sc.confidenceAfter}`), asCell(`${sc.bidRiskBefore} -> ${sc.bidRiskAfter}`)
    ], 7)));
  }
  if(data.projectScenario){
    rows.push(pad([]));
    rows.push(pad([asCell('ESCENARIO DE PROYECTO -- SIMULACION -- NO MODIFICA NINGUN APU BASE', { columnSpan: 7, ...XLS.section })], 7));
    rows.push(pad([asCell('APUs afectados', XLS.label), asCell(data.projectScenario.affectedApus.length)], 7));
    rows.push(pad([asCell('APUs no afectados', XLS.label), asCell(data.projectScenario.unaffectedApus.length)], 7));
    rows.push(pad([asCell('Delta total del proyecto', XLS.label), moneyCell(data.projectScenario.totalProjectDelta, 'NO ESTIMABLE')], 7));
    if(data.projectScenario.topImpacts.length){
      rows.push(pad(['APU', 'Delta unitario', 'Delta proyecto'].map(h => asCell(h, XLS.head)), 7));
      data.projectScenario.topImpacts.forEach(t => rows.push(pad([asCell(t.concept), moneyCell(t.unitDelta, '—'), moneyCell(t.projectDelta, '—')], 7)));
    }
  }
  return { sheet: 'ESCENARIOS', rows, widths: [18, 26, 14, 14, 12, 20, 20], stickyRowsCount: 0, orientation: 'landscape' };
}

/* Una hoja por concepto (regla OBLIGATORIA, seccion 5): reusa
   buildProfessionalAPUSheet TAL CUAL (ya prueba "una hoja completa por
   APU", Fase 6/7) y solo renombra con un prefijo ordinal estable --
   disambiguateSheetNames sigue siendo quien resuelve colisiones de nombre
   (dos conceptos truncados al mismo texto de 31 caracteres), nunca se
   reimplementa esa logica. */
function buildConceptSheets(apuEntries){
  const named = apuEntries.map((e, i) => {
    const built = buildProfessionalAPUSheet(e.snapshot);
    const ordinal = String(i + 1).padStart(3, '0');
    return { ...built, sheet: safeSheet(`${ordinal}_${e.concept || e.snapshot.clave || 'APU'}`) };
  });
  return disambiguateSheetNames(named);
}

/* Entrada principal -- registra el evento de exportacion de PROYECTO
   (scope=PROJECT, api/export-events.mjs), nunca el de un solo APU. */
export async function exportProjectDossierExcel({ projectId, mode = 'TECNICO', selectedScenarios = [], projectScenario = null, company = {}, fileName, writeXlsxFileImpl } = {}){
  const data = await buildProjectDossierData({ projectId, mode, selectedScenarios, projectScenario });
  const meta = { proyecto: company?.name || data.project?.name || '', cliente: company?.client || data.project?.client || '', fecha: new Date().toLocaleDateString('es-MX') };

  const sheets = [
    buildPortadaSheet(data, meta),
    buildResumenProyectoSheet(data),
    buildRankingRiesgoSheet(data),
    buildAuditoriaGlobalSheet(data),
    buildChallengeGlobalSheet(data),
    buildConfidenceSheet(data),
    buildBidRiskSheet(data),
    buildHistorialSheet(data),
    buildEscenariosSheet(data),
    ...buildConceptSheets(data.apuEntries)
  ].filter(Boolean);

  await exportWorkbookExcel(sheets, fileName || `${data.projectId}-DOSSIER-PROYECTO-ZOEMEC.xlsx`, writeXlsxFileImpl || writeXlsxFileBrowser);

  try{
    await apiPost('/api/export-events', {
      action: 'record', scope: 'PROJECT', projectId: data.projectId,
      apuVersionIds: data.dossierManifest.apuVersionIds, snapshotHashes: data.dossierManifest.snapshotHashes,
      selectedScenarioIds: data.dossierManifest.selectedScenarioIds, manifestHash: data.dossierManifest.manifestHash,
      format: 'XLSX', mode
    });
  }catch{ /* el archivo ya se genero; un fallo de auditoria secundaria no revierte la exportacion */ }

  return { sheets, data };
}
