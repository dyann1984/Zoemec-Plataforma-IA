/* Explosion de materiales/mano de obra/maquinaria -- ensamblador PDF (Fase
   A, punto 4/PDF del pedido). Reusa TAL CUAL jsPDF + newSectionDrawer/
   pdfText/money (apuDossierPdf.js/apuExport.js) -- mismo dibujador de
   secciones/tablas que ya usan el APU individual y el Dossier de Proyecto,
   ningun renderizador nuevo. */
import { jsPDF } from 'jspdf';
import { money } from './apuExport.js';
import { newSectionDrawer, pdfText } from './apuDossierPdf.js';
import { apiPost } from '../services/apiClient.js';
import { loadProjectApus, loadProjectMeta } from './apuProjectDossierData.js';
import { computeExplosionData } from '../domain/explosionData.js';
import { laborEconomicView, laborResourceView } from '../domain/laborExplosion.js';

const RULE_LABEL = { UNICO: 'Unico', MAYOR_CONFIANZA: 'Mayor confianza', EMPATE_MEDIANA: 'Empate -> mediana' };

function drawPortada(doc, meta, data){
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 16;
  doc.setFillColor(42, 23, 64); doc.rect(0, 0, W, 62, 'F');
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

export async function exportExplosionPdf({ projectId, company = {}, save = true, fileName } = {}){
  if(!projectId) throw new Error('Falta projectId para generar la Explosion.');
  const [apuDocs, project] = await Promise.all([loadProjectApus(projectId), loadProjectMeta(projectId)]);
  if(!apuDocs.length) throw new Error('El proyecto no tiene ningun APU guardado (server-side) para generar la Explosion.');
  const { materials, auxiliares, labor, machinery } = computeExplosionData(apuDocs);
  const data = { materials, auxiliares, labor, machinery, apuCount: apuDocs.length };
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

  const total = doc.internal.getNumberOfPages();
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 14;
  for(let i = 1; i <= total; i++){
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(120);
    doc.text(pdfText(`Pagina ${i} de ${total}`), W - M, H - 6, { align: 'right' });
  }

  if(save !== false) doc.save(fileName || `${projectId}-EXPLOSION-ZOEMEC.pdf`);

  try{
    await apiPost('/api/export-events', { action: 'record', scope: 'EXPLOSION', projectId, format: 'PDF', mode: 'TECNICO' });
  }catch{ /* el archivo ya se genero; un fallo de auditoria secundaria no revierte la exportacion */ }

  return { doc, data, project };
}
