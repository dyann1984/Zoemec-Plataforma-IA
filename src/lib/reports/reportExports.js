/* F5 -- Carga de datos AUTORITATIVOS y orquestacion de exportaciones del
   Centro de Reportes. Todos los datos llegan por la API del servidor con el
   token del usuario: el aislamiento empresa/proyecto lo aplica el servidor
   (assertProjectAccess / canAccessOrgScopedDoc), nunca el cliente. */
import { apiGetSafe, apiPost } from '../../services/apiClient.js';
import { loadProjectApus, loadProjectMeta } from '../apuProjectDossierData.js';
import { loadProjectConceptos } from '../explosionInputs.js';
import { buildAPUWorkbookSheets, exportAPUPdfMaster } from '../apuExportV2.js';
import {
  REPORT_TYPE, REPORT_LABEL, buildReportHeader, buildBudgetReportModel, buildCatalogReportModel, buildGeneratorsReportModel,
  buildExplosionReportModel, buildExecutiveSummaryModel, buildQuantificationMemoryModel, buildApuReportInput, reportAvailability
} from './reportModels.js';
import { renderBudgetPdf, renderBudgetXlsx, renderGeneratorsPdf, renderGeneratorsXlsx, renderExplosionPdf, renderExplosionXlsx,
  renderCatalogPdf, renderCatalogXlsx, renderExecutiveSummaryPdf, renderQuantificationMemoryPdf } from './reportRenderers.js';
import { writeWorkbookBytes, saveBytes } from './reportXlsxKit.js';
import { loadOfficialLogo, pngSize } from './reportPdfKit.js';

export async function loadReportData(projectId){
  if(!projectId) throw new Error('Selecciona un proyecto para generar reportes.');
  const [project, conceptos, apuDocs, presupuestos, levs, planos] = await Promise.all([
    loadProjectMeta(projectId), loadProjectConceptos(projectId), loadProjectApus(projectId),
    apiGetSafe(`/api/presupuestos?projectId=${encodeURIComponent(projectId)}`),
    apiGetSafe(`/api/levantamientos?projectId=${encodeURIComponent(projectId)}`),
    apiGetSafe(`/api/plano-takeoffs?projectId=${encodeURIComponent(projectId)}`)
  ]);
  if(!project) throw new Error('No se pudo cargar el proyecto (o no tienes acceso a él).');
  const presupuesto = (presupuestos?.presupuestos || []).filter(p => !p.archivedAt).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0] || null;
  const planosById = Object.fromEntries((planos?.planoTakeoffs || []).map(p => [p.id, p]));
  return { projectId, project, conceptos, apuDocs, presupuesto, levantamientos: levs?.levantamientos || [], planosById };
}

/* Todos los modelos salen de UNA carga de datos: el Resumen, el Catalogo y el
   Presupuesto comparten la misma vista del presupuesto. */
export function buildAllReportModels(data, { generatedBy = null, generatedAt = new Date() } = {}){
  const header = buildReportHeader({ project: data.project, presupuesto: data.presupuesto, generatedAt, generatedBy });
  const budget = buildBudgetReportModel({ conceptos: data.conceptos, apuDocs: data.apuDocs, header });
  const catalog = buildCatalogReportModel({ budget });
  const generators = buildGeneratorsReportModel({ conceptos: data.conceptos, header, planosById: data.planosById });
  const explosion = buildExplosionReportModel({ conceptos: data.conceptos, apuDocs: data.apuDocs, header });
  const summary = buildExecutiveSummaryModel({ budget, conceptos: data.conceptos, levantamientos: data.levantamientos, presupuesto: data.presupuesto });
  const memory = buildQuantificationMemoryModel({ levantamientos: data.levantamientos, planosById: data.planosById, conceptos: data.conceptos, header });
  const apuInput = buildApuReportInput({ conceptos: data.conceptos, apuDocs: data.apuDocs });
  const models = { header, budget, catalog, generators, explosion, summary, memory, apuInput };
  return { ...models, availability: reportAvailability(models) };
}

/* Atajo para los botones de las pantallas (Presupuesto, Explosiones): carga
   los datos autoritativos del servidor y exporta con el renderizador comun. */
export async function exportProjectReport(projectId, type, format, { generatedBy = null } = {}){
  const models = buildAllReportModels(await loadReportData(projectId), { generatedBy });
  const model = models[MODEL_OF[type]];
  if(model?.empty) throw new Error(model.empty);
  return generateReport(models, type, format);
}

/* Explosion desde el panel: se usa EXACTAMENTE el objeto que se ve en
   pantalla (computeScopedExplosion ya calculado), solo se agrega encabezado. */
export async function exportExplosionFromScreen(projectId, explosion, format, { generatedBy = null } = {}){
  const data = await loadReportData(projectId);
  const models = buildAllReportModels(data, { generatedBy });
  models.explosion = buildExplosionReportModel({ conceptos: data.conceptos, header: models.header, explosion });
  if(models.explosion.empty) throw new Error(models.explosion.empty);
  return generateReport(models, REPORT_TYPE.EXPLOSION, format);
}

const FILE_BASE = { PRESUPUESTO: 'PRESUPUESTO', GENERADORES: 'NUMEROS-GENERADORES', APU: 'APU', EXPLOSION: 'EXPLOSION-INSUMOS', CATALOGO: 'CATALOGO-CONCEPTOS', RESUMEN: 'RESUMEN-EJECUTIVO', MEMORIA: 'MEMORIA-CUANTIFICACION' };
export const reportFileName = (type, format, header, draft) =>
  `${String(header.proyecto || header.projectId || 'proyecto').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')}-${FILE_BASE[type]}${draft ? '-BORRADOR' : ''}-ZOEMEC.${format === 'PDF' ? 'pdf' : 'xlsx'}`;

const MODEL_OF = { PRESUPUESTO: 'budget', GENERADORES: 'generators', EXPLOSION: 'explosion', CATALOGO: 'catalog', RESUMEN: 'summary', MEMORIA: 'memory', APU: 'apuInput' };
const PDF = { PRESUPUESTO: renderBudgetPdf, GENERADORES: renderGeneratorsPdf, EXPLOSION: renderExplosionPdf, CATALOGO: renderCatalogPdf, RESUMEN: renderExecutiveSummaryPdf, MEMORIA: renderQuantificationMemoryPdf };
const XLSX = { PRESUPUESTO: renderBudgetXlsx, GENERADORES: renderGeneratorsXlsx, EXPLOSION: renderExplosionXlsx, CATALOGO: renderCatalogXlsx };
const EVENT_SCOPE = { PRESUPUESTO: 'PRESUPUESTO', CATALOGO: 'PRESUPUESTO', EXPLOSION: 'EXPLOSION' };

/* Genera (y opcionalmente descarga) un reporte. Devuelve { doc | bytes,
   sheets, fileName, draft }. `logo` = dataURL del logo oficial (si falta,
   se carga de /images/zoemec-logo-oficial.png). */
export async function generateReport(models, type, format, { logo, writeXlsxFileImpl, save = true } = {}){
  const model = models[MODEL_OF[type]];
  if(!model) throw new Error(`Reporte desconocido: ${type}`);
  const header = models.header;
  const draft = Boolean(model.draft);
  const fileName = reportFileName(type, format, header, draft);
  const logoData = logo === undefined ? await loadOfficialLogo() : logo;
  let out;
  if(type === REPORT_TYPE.APU){
    if(model.empty) throw new Error(model.empty);
    const company = { name: header.proyecto, client: header.cliente, address: header.ubicacion, responsible: header.responsable === 'No especificado' ? '' : header.responsable };
    if(format === 'PDF'){
      const size = logoData ? pngSize(logoData) : null;
      const { doc } = exportAPUPdfMaster(model.apus, { save: false, company: { ...company, logo: size ? { dataUrl: logoData, ratio: size.w / size.h } : null } });
      out = { doc };
    }else{
      const sheets = buildAPUWorkbookSheets(model.apus, { company });
      out = { sheets, bytes: await writeWorkbookBytes(sheets, writeXlsxFileImpl || (await import('write-excel-file/browser')).default) };
    }
  }else if(format === 'PDF'){
    if(!PDF[type]) throw new Error(`${REPORT_LABEL[type]} no tiene formato PDF.`);
    out = { doc: PDF[type](model, { logo: logoData }) };
  }else{
    if(!XLSX[type]) throw new Error(`${REPORT_LABEL[type]} no tiene formato XLSX.`);
    const sheets = XLSX[type](model);
    out = { sheets, bytes: await writeWorkbookBytes(sheets, writeXlsxFileImpl || (await import('write-excel-file/browser')).default) };
  }
  if(save){
    if(out.doc) out.doc.save(fileName);
    else saveBytes(out.bytes, fileName);
    try{ await apiPost('/api/export-events', { action: 'record', scope: EVENT_SCOPE[type] || 'PROJECT', projectId: header.projectId, format, mode: 'TECNICO' }); }catch{ /* auditoria secundaria */ }
  }
  return { ...out, fileName, draft };
}
