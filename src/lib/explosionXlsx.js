/* Explosion de materiales/mano de obra/maquinaria -- ensamblador XLSX (Fase
   A, punto 4/Excel del pedido). Reusa TAL CUAL exportWorkbookExcel/xcell/XLS/
   money de apuExport.js (mismo motor de escritura que ya usan el APU
   individual y el Dossier de Proyecto) -- ninguna formula/estilo nuevo, solo
   se arman las filas a partir del resultado YA CALCULADO de
   materialExplosion.js/laborExplosion.js/machineryExplosion.js. Cada hoja es
   independiente (regla explicita del usuario), y el desglose por concepto
   (origenes[]) se imprime INDENTADO justo debajo de cada renglon consolidado
   -- misma informacion que "Ver desglose por concepto" en pantalla, para que
   el archivo exportado sea auditable sin abrir la app. */
import writeXlsxFileBrowser from 'write-excel-file/browser';
import { xcell, XLS, exportWorkbookExcel, money } from './apuExport.js';
import { apiPost } from '../services/apiClient.js';
import { loadProjectApus, loadProjectMeta } from './apuProjectDossierData.js';
import { laborEconomicView, laborResourceView } from '../domain/laborExplosion.js';
import { computeExplosionData } from '../domain/explosionData.js';

const asCell = (value, style = {}) => xcell(value, style);
const pad = (row, width) => { const full = [...row]; while(full.length < width) full.push(null); return full; };
const RULE_LABEL = { UNICO: 'Unico', MAYOR_CONFIANZA: 'Mayor confianza', EMPATE_MEDIANA: 'Empate -> mediana' };

function buildMaterialSheet(title, rows){
  const head = ['Clave', 'Descripcion', 'Unidad', 'Cantidad base', 'Desperdicio %', 'Cantidad final', 'Precio unitario', 'Importe', 'Regla de precio', 'Confianza', 'APUs de origen'];
  const out = [pad(head.map(h => asCell(h, XLS.head)), head.length)];
  if(!rows.length){
    out.push(pad([asCell('Sin renglones para este proyecto.', XLS.note)], head.length));
  }
  rows.forEach(r => {
    out.push(pad([
      asCell(r.clave || '(sin clave)'), asCell(r.descripcion, { wrap: true }), asCell(r.unidad),
      asCell(r.cantidadBase, XLS.qty), asCell(r.desperdicioPct / 100, XLS.pct), asCell(r.cantidadFinal, XLS.qty),
      asCell(r.precioUnitario, XLS.money), asCell(r.importe, XLS.money),
      asCell(RULE_LABEL[r.reconciliationRule] || r.reconciliationRule), asCell(`${Math.round(r.confianza)}%`),
      asCell(r.apusOrigen.length)
    ], head.length));
    r.origenes.forEach(o => {
      out.push(pad([
        asCell(''), asCell(`  → ${o.apuConcept || o.apuClave || o.apuId}`, { ...XLS.note, wrap: true }), asCell(''),
        asCell(o.cantidadBaseAportada, XLS.qty), asCell(''), asCell(o.cantidadFinalAportada, XLS.qty),
        asCell(o.precioUnitario, XLS.money), asCell(o.importeConsolidado, XLS.money),
        asCell(''), asCell(o.priceConfidence != null ? `${Math.round(o.priceConfidence)}%` : ''), asCell('')
      ], head.length));
    });
  });
  out.push(pad([asCell('TOTAL', XLS.total), null, null, null, null, null, null, asCell(rows.reduce((s, r) => s + r.importe, 0), { ...XLS.total, ...XLS.money })], head.length));
  return { sheet: title, rows: out, widths: [16, 32, 8, 12, 10, 12, 12, 14, 16, 10, 12], stickyRowsCount: 1, orientation: 'landscape' };
}

function buildLaborSheet(rows){
  const economica = laborEconomicView(rows);
  const recursos = laborResourceView(rows);
  const head = ['Oficio', 'Categoria', 'Costo/jornada', 'Jornadas', 'Cuadrilla', 'Horas', 'Importe', 'Regla de costo', 'Confianza', 'Conceptos de origen'];
  const out = [pad(head.map(h => asCell(h, XLS.head)), head.length)];
  if(!rows.length) out.push(pad([asCell('Sin mano de obra para este proyecto.', XLS.note)], head.length));
  rows.forEach((r, i) => {
    const recurso = recursos[i];
    out.push(pad([
      asCell(economica[i].oficio), asCell(economica[i].categoria),
      asCell(economica[i].costoUnitarioPorJornada, XLS.money), asCell(economica[i].jornadas, XLS.qty),
      asCell(Array.isArray(recurso.cuadrilla) ? recurso.cuadrilla.join('/') : (recurso.cuadrilla ?? '')),
      asCell(recurso.horas, XLS.qty), asCell(economica[i].importe, XLS.money),
      asCell(RULE_LABEL[r.reconciliationRule] || r.reconciliationRule), asCell(`${Math.round(r.confianza)}%`),
      asCell(r.apusOrigen.length)
    ], head.length));
    r.origenes.forEach(o => {
      out.push(pad([asCell(`  → ${o.apuConcept || o.apuClave || o.apuId}`, { ...XLS.note, wrap: true }), null, null, asCell(o.jornadasAportadas, XLS.qty)], head.length));
    });
  });
  out.push(pad([asCell('TOTAL', XLS.total), null, null, null, null, null, asCell(rows.reduce((s, r) => s + r.importe, 0), { ...XLS.total, ...XLS.money })], head.length));
  return { sheet: 'MANO DE OBRA', rows: out, widths: [26, 14, 14, 12, 12, 12, 14, 18, 10, 12], stickyRowsCount: 1, orientation: 'landscape' };
}

function buildMachinerySheet(machinery){
  const head = ['Categoria', 'Clave', 'Descripcion', 'Unidad', 'Horas', 'Tarifa referencia', 'Importe', 'APUs de origen'];
  const out = [pad(head.map(h => asCell(h, XLS.head)), head.length)];
  const sections = [['MAQUINARIA PESADA', machinery.maquinaria], ['EQUIPO', machinery.equipo], ['HERRAMIENTA MENOR', machinery.herramientaMenor]];
  let any = false;
  sections.forEach(([label, rows]) => {
    rows.forEach(r => {
      any = true;
      out.push(pad([
        asCell(label, XLS.section), asCell(r.clave || '(sin clave)'), asCell(r.descripcion, { wrap: true }), asCell(r.unidad || ''),
        r.horas != null ? asCell(r.horas, XLS.qty) : asCell('N/D'),
        r.tarifaReferencia != null ? asCell(r.tarifaReferencia, XLS.money) : asCell(''),
        asCell(r.importe, XLS.money),
        asCell(r.apusOrigen.length)
      ], head.length));
    });
  });
  if(!any) out.push(pad([asCell('Sin maquinaria/equipo/herramienta menor para este proyecto.', XLS.note)], head.length));
  const total = [...machinery.maquinaria, ...machinery.equipo, ...machinery.herramientaMenor].reduce((s, r) => s + r.importe, 0);
  out.push(pad([asCell('TOTAL', XLS.total), null, null, null, null, null, asCell(total, { ...XLS.total, ...XLS.money })], head.length));
  return { sheet: 'MAQUINARIA Y EQUIPO', rows: out, widths: [18, 16, 32, 8, 10, 14, 14, 12], stickyRowsCount: 1, orientation: 'landscape' };
}

export async function exportExplosionExcel({ projectId, company = {}, fileName, writeXlsxFileImpl } = {}){
  if(!projectId) throw new Error('Falta projectId para generar la Explosion.');
  const [apuDocs, project] = await Promise.all([loadProjectApus(projectId), loadProjectMeta(projectId)]);
  if(!apuDocs.length) throw new Error('El proyecto no tiene ningun APU guardado (server-side) para generar la Explosion.');
  const { materials, auxiliares, labor, machinery } = computeExplosionData(apuDocs);

  const sheets = [
    buildMaterialSheet('MATERIALES', materials),
    buildLaborSheet(labor),
    buildMachinerySheet(machinery),
    buildMaterialSheet('AUXILIARES', auxiliares)
  ];

  await exportWorkbookExcel(sheets, fileName || `${projectId}-EXPLOSION-ZOEMEC.xlsx`, writeXlsxFileImpl || writeXlsxFileBrowser);

  try{
    await apiPost('/api/export-events', { action: 'record', scope: 'EXPLOSION', projectId, format: 'XLSX', mode: 'TECNICO' });
  }catch{ /* el archivo ya se genero; un fallo de auditoria secundaria no revierte la exportacion */ }

  return { sheets, project, materials, auxiliares, labor, machinery };
}
