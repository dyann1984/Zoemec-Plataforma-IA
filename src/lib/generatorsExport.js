/* F3 -- Exportador MINIMO de Numeros Generadores (PDF + XLSX). Reusa la
   infraestructura existente (jsPDF + newSectionDrawer/pdfText de
   apuDossierPdf.js; exportWorkbookExcel/xcell/XLS de apuExport.js). No es
   el Centro de Reportes (F5): solo reproduce, sin recalcular, lo que esta
   PERSISTIDO en cada concepto (generadores + qty). Pantalla, PDF y XLSX
   leen las mismas filas (buildGeneratorReport). */
import writeXlsxFileBrowser from 'write-excel-file/browser';
import { exportWorkbookExcel } from './apuExport.js';
import { rq, aggregateGenerators, QUANTITY_SOURCE_KIND } from '../domain/quantityGenerators.js';
import { buildReportHeader, buildGeneratorsReportModel } from './reports/reportModels.js';
import { renderGeneratorsPdf, renderGeneratorsXlsx } from './reports/reportRenderers.js';

/* Modelo del reporte: por concepto con generadores -> elementos con su
   operacion, deducciones, neto; total = SUM(neto contado) y verificacion
   contra concepto.qty (nunca se imprime un total que no cuadre sin decirlo). */
export function buildGeneratorReport(conceptos = []){
  return (Array.isArray(conceptos) ? conceptos : [])
    .filter(c => c && !c.archivedAt && c.quantitySource === QUANTITY_SOURCE_KIND.GENERATORS)
    .map(c => {
      const generators = [...(c.generadores || [])].sort((a, b) => String(a.elementId).localeCompare(String(b.elementId), 'es', { numeric: true }));
      const agg = aggregateGenerators(generators, c.unit);
      return {
        conceptoId: c.id, clave: c.clave || '', concept: c.concept || '', unit: c.unit || '', capitulo: c.capitulo || '',
        qty: rq(c.qty), total: agg.qty, cuadra: Math.abs(agg.qty - rq(c.qty)) < 0.00005,
        incomplete: agg.incomplete, inconsistent: agg.inconsistent, unitMismatch: agg.unitMismatch,
        elements: generators.map(g => ({
          code: g.elementCode, description: g.description, planoId: g.planoId, status: g.status,
          expression: g.operation?.expression || '', gross: g.grossQuantity, net: g.netQuantity, unit: g.unit,
          counted: agg.countedElementIds.includes(g.elementId),
          deductions: (g.deductions || []).map(d => ({ description: d.description, expression: d.operation?.expression || '', quantity: d.quantity, note: d.note || null })),
          issues: (g.issues || []).map(i => i.message)
        }))
      };
    });
}

/* F5: los exportadores de generadores DELEGAN en el renderizador unificado
   del Centro de Reportes (mismo encabezado/pie/logo que el resto de los
   reportes). Mismos nombres y mismo retorno ({doc|sheets, report}) que en
   F3; el modelo sigue siendo buildGeneratorReport (datos PERSISTIDOS). */
function generatorsModelFor({ conceptos, projectName, projectId, project }){
  const header = buildReportHeader({ project: project || { id: projectId, name: projectName || projectId } });
  const model = buildGeneratorsReportModel({ conceptos, header });
  if(model.empty) throw new Error('No hay conceptos con cantidad desde generadores para exportar.');
  return model;
}

export function exportGeneratorsPdf({ conceptos = [], projectName = '', projectId = '', project = null, logo = null, save = true, fileName } = {}){
  const model = generatorsModelFor({ conceptos, projectName, projectId, project });
  const doc = renderGeneratorsPdf(model, { logo });
  if(save !== false) doc.save(fileName || `${projectId || 'proyecto'}-NUMEROS-GENERADORES${model.draft ? '-BORRADOR' : ''}-ZOEMEC.pdf`);
  return { doc, report: buildGeneratorReport(conceptos), model };
}

export async function exportGeneratorsExcel({ conceptos = [], projectName = '', projectId = '', project = null, fileName, writeXlsxFileImpl } = {}){
  const model = generatorsModelFor({ conceptos, projectName, projectId, project });
  const sheets = renderGeneratorsXlsx(model);
  await exportWorkbookExcel(sheets, fileName || `${projectId || 'proyecto'}-NUMEROS-GENERADORES${model.draft ? '-BORRADOR' : ''}-ZOEMEC.xlsx`, writeXlsxFileImpl || writeXlsxFileBrowser);
  return { sheets, report: buildGeneratorReport(conceptos), model };
}
