/* Explosion de materiales/mano de obra/maquinaria -- ensamblador PDF (Fase
   A, punto 4/PDF del pedido). Reusa TAL CUAL jsPDF + newSectionDrawer/
   pdfText/money (apuDossierPdf.js/apuExport.js) -- mismo dibujador de
   secciones/tablas que ya usan el APU individual y el Dossier de Proyecto,
   ningun renderizador nuevo. */
import { jsPDF } from 'jspdf';
import { money } from './apuExport.js';
import { newSectionDrawer, pdfText } from './apuDossierPdf.js';
import { apiPost } from '../services/apiClient.js';
import { loadProjectMeta } from './apuProjectDossierData.js';
import { laborEconomicView, laborResourceView } from '../domain/laborExplosion.js';
import { loadScopedExplosion, assertExplosionHasLines, EXPLOSION_SCOPE } from './explosionInputs.js';
import { originLabel } from '../domain/explosionEngine.js';

const RULE_LABEL = { UNICO: 'Unico', MAYOR_CONFIANZA: 'Mayor confianza', EMPATE_MEDIANA: 'Empate -> mediana' };

function drawPortada(doc, meta, data){
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 16;
  doc.setFillColor(11, 47, 74); doc.rect(0, 0, W, 62, 'F');
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
  doc.text('ZOEMEC', W / 2, 28, { align: 'center' });
  doc.setFontSize(11); doc.text('EXPLOSION DE MATERIALES, MANO DE OBRA Y MAQUINARIA', W / 2, 40, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.text(pdfText(`${data.apuCount} APU(s) consolidados`), W / 2, 50, { align: 'center' });
  let y = 78; doc.setTextColor(30);
  const field = (label, value) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(pdfText(label), M, y); doc.setFont('helvetica', 'normal'); doc.text(pdfText(value ?? 'Por definir'), M + 55, y); y += 8; };
  field('Proyecto:', meta.proyecto);
  field('Cliente:', meta.cliente);
  field('Fecha:', meta.fecha);
  field('Alcance:', data.scope === EXPLOSION_SCOPE.PRESUPUESTO ? 'Presupuesto (cantidad vigente de cada concepto)' : 'Proyecto (conceptos + APUs independientes)');
  field('Conceptos con APU:', data.summary?.conceptosConApu ?? 0);
  if(data.scope !== EXPLOSION_SCOPE.PRESUPUESTO) field('APUs independientes:', data.summary?.apusIndependientes ?? 0);
  else field('Excluidos:', `${data.summary?.conceptosSinApu ?? 0} sin APU, ${data.summary?.conceptosConApuNoDisponible ?? 0} con APU no disponible, ${data.summary?.apusFueraDelPresupuesto ?? 0} APU(s) fuera`);
  field('Materiales consolidados:', data.materials.length);
  field('Oficios de mano de obra:', data.labor.length);
  field('Importe materiales:', money(data.materials.reduce((s, r) => s + r.importe, 0)));
  field('Importe mano de obra:', money(data.labor.reduce((s, r) => s + r.importe, 0)));
}

function drawMaterialSection(doc, meta, title, rows){
  doc.addPage();
  const s = newSectionDrawer(doc, meta);
  s.title(title);
  if(!rows.length){ s.emptyNote('Sin renglones para este proyecto.'); return s; }
  s.table(
    ['Clave', 'Descripcion', 'Unidad', 'Cant. final', 'P.U.', 'Importe', 'Regla', 'Conf.'],
    rows.map(r => [r.clave || '(sin clave)', r.descripcion, r.unidad, r.cantidadFinal.toFixed(2), money(r.precioUnitario), money(r.importe), RULE_LABEL[r.reconciliationRule] || r.reconciliationRule, `${Math.round(r.confianza)}%`]),
    [1.2, 3, 0.8, 1, 1, 1.2, 1.4, 0.8]
  );
  s.kv('Importe total', money(rows.reduce((s2, r) => s2 + r.importe, 0)));
  return s;
}

function drawLaborSection(doc, meta, rows){
  doc.addPage();
  const s = newSectionDrawer(doc, meta);
  s.title('MANO DE OBRA');
  if(!rows.length){ s.emptyNote('Sin mano de obra para este proyecto.'); return s; }
  const economica = laborEconomicView(rows);
  const recursos = laborResourceView(rows);
  s.paragraph('Vista economica y vista de recursos provienen del MISMO calculo -- nunca se recalculan por separado.');
  s.table(
    ['Oficio', 'Categoria', 'Costo/jornada', 'Jornadas', 'Horas', 'Importe'],
    rows.map((r, i) => [economica[i].oficio, economica[i].categoria, money(economica[i].costoUnitarioPorJornada), economica[i].jornadas.toFixed(2), recursos[i].horas.toFixed(1), money(economica[i].importe)]),
    [2.2, 1.2, 1.2, 1, 1, 1.4]
  );
  s.kv('Importe total', money(rows.reduce((s2, r) => s2 + r.importe, 0)));
  return s;
}

function drawMachinerySection(doc, meta, machinery){
  doc.addPage();
  const s = newSectionDrawer(doc, meta);
  s.title('MAQUINARIA Y EQUIPO');
  const all = [
    ...machinery.maquinaria.map(r => ({ ...r, categoria: 'MAQUINARIA PESADA' })),
    ...machinery.equipo.map(r => ({ ...r, categoria: 'EQUIPO' })),
    ...machinery.herramientaMenor.map(r => ({ ...r, categoria: 'HERRAMIENTA MENOR' }))
  ];
  if(!all.length){ s.emptyNote('Sin maquinaria/equipo/herramienta menor para este proyecto.'); return s; }
  s.table(
    ['Categoria', 'Clave', 'Descripcion', 'Horas', 'Importe'],
    all.map(r => [r.categoria, r.clave || '(sin clave)', r.descripcion, r.horas != null ? r.horas.toFixed(1) : 'N/D', money(r.importe)]),
    [1.4, 1.2, 2.6, 0.8, 1.4]
  );
  s.kv('Importe total', money(all.reduce((s2, r) => s2 + r.importe, 0)));
  return s;
}

/* F2: contribuciones individuales (INSUMO -> CAPITULO > CONCEPTO > APU),
   mismas cifras que "Ver desglose" en pantalla y que las filas indentadas
   del XLSX. */
function drawContributionsSection(doc, meta, title, rows){
  doc.addPage();
  const s = newSectionDrawer(doc, meta);
  s.title(title);
  const flat = rows.flatMap(r => (r.origenes || []).map(o => [r.descripcion, r.unidad, originLabel(o), (o.cantidadFinalAportada ?? 0).toFixed(4), money(o.importeConsolidado ?? o.importeAportadoReal ?? 0)]));
  if(!flat.length){ s.emptyNote('Sin contribuciones.'); return s; }
  s.table(['Insumo', 'Unidad', 'Capitulo > Concepto > APU (cantidad)', 'Cantidad aportada', 'Importe'], flat, [2, 0.7, 3.6, 1.1, 1.2]);
  return s;
}

/* `explosion` (opcional) = objeto YA calculado (computeScopedExplosion) que
   muestra el panel -- el PDF usa exactamente esos datos. `scope`:
   PRESUPUESTO | PROYECTO (default PROYECTO, comportamiento historico). */
export async function exportExplosionPdf({ projectId, company = {}, save = true, fileName, scope = EXPLOSION_SCOPE.PROYECTO, explosion = null } = {}){
  if(!projectId) throw new Error('Falta projectId para generar la Explosion.');
  const [loaded, project] = await Promise.all([explosion ? Promise.resolve(explosion) : loadScopedExplosion({ projectId, scope }), loadProjectMeta(projectId)]);
  assertExplosionHasLines(loaded);
  const { materials, auxiliares, labor, machinery } = loaded.data;
  const data = { materials, auxiliares, labor, machinery, apuCount: loaded.summary?.apusDistintos ?? 0, scope: loaded.scope, summary: loaded.summary };
  const meta = {
    proyecto: company?.name || project?.name || '', cliente: company?.client || project?.client || '',
    clave: projectId, versionLabel: 'EXPLOSION', fecha: new Date().toLocaleDateString('es-MX')
  };

  const doc = new jsPDF('portrait', 'mm', 'a4');
  drawPortada(doc, meta, data);
  drawMaterialSection(doc, meta, 'MATERIALES', materials).footer();
  drawLaborSection(doc, meta, labor).footer();
  drawMachinerySection(doc, meta, machinery).footer();
  drawMaterialSection(doc, meta, 'AUXILIARES', auxiliares).footer();
  drawContributionsSection(doc, meta, 'CONTRIBUCIONES POR CONCEPTO -- MATERIALES', materials).footer();

  const total = doc.internal.getNumberOfPages();
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 14;
  for(let i = 1; i <= total; i++){
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(120);
    doc.text(pdfText(`Pagina ${i} de ${total}`), W - M, H - 6, { align: 'right' });
  }

  if(save !== false) doc.save(fileName || `${projectId}-EXPLOSION${loaded.scope === EXPLOSION_SCOPE.PRESUPUESTO ? '-PRESUPUESTO' : ''}-ZOEMEC.pdf`);

  try{
    await apiPost('/api/export-events', { action: 'record', scope: 'EXPLOSION', projectId, format: 'PDF', mode: 'TECNICO' });
  }catch{ /* el archivo ya se genero; un fallo de auditoria secundaria no revierte la exportacion */ }

  return { doc, data, project, explosion: loaded };
}
