/* F5 -- MODELOS del Centro de Reportes (logica pura, sin jsPDF ni red).
   REPORTAR != RECALCULAR: cada modelo se arma SOLO con resultados de los
   motores autoritativos existentes y los renderizadores PDF/XLSX leen el
   MISMO modelo (pantalla = PDF = XLSX por construccion):
     Presupuesto / Catalogo -> buildPresupuestoView (F2: buildBudgetScope +
                               aggregatePresupuesto; P.U. = calcAPUv2)
     Resumen de P.U.        -> breakdown que calcAPUv2 ya calculo (budgetScope)
     Generadores            -> buildGeneratorReport (F3) sobre lo PERSISTIDO
     Explosion              -> computeScopedExplosion (F2)
     Memoria                -> computeSurveyQuantities + cadModel persistido (F4)
   Ninguna formula de APU/generadores/presupuesto/explosion/CAD se repite. */
import { buildPresupuestoView } from '../../domain/presupuestoView.js';
import { computeScopedExplosion, EXPLOSION_SCOPE } from '../../domain/explosionData.js';
import { laborEconomicView } from '../../domain/laborExplosion.js';
import { originLabel } from '../../domain/explosionEngine.js';
import { capituloLabel } from '../../domain/presupuestoCapitulos.js';
import { formatLocationDisplay, hasAnyLocation } from '../../domain/geography.js';
import { fmtQ, rq, GENERATOR_STATUS } from '../../domain/quantityGenerators.js';
import { computeSurveyQuantities, spacePlanoId, QUANTITY_ORIGIN, GEOMETRY_MODE } from '../../domain/levantamientoCadLink.js';
import { DIMENSION_SOURCE, dimensionSourceLabel, wallHeightSource, wallThicknessSource, spaceCeilingHeightSource, computeSpaceMetrics } from '../../domain/cadModel.js';
import { buildGeneratorReport } from '../generatorsExport.js';

export const BRAND = Object.freeze({ name: 'ZOEMEC®', tagline: 'INGENIERÍA Y CONSTRUCCIÓN', full: 'ZOEMEC® Ingeniería y Construcción', logoPath: '/images/zoemec-logo-oficial.png' });
export const NOT_SPECIFIED = 'No especificado';

export const REPORT_TYPE = Object.freeze({
  PRESUPUESTO: 'PRESUPUESTO', GENERADORES: 'GENERADORES', APU: 'APU', EXPLOSION: 'EXPLOSION',
  CATALOGO: 'CATALOGO', RESUMEN: 'RESUMEN', MEMORIA: 'MEMORIA'
});
export const REPORT_LABEL = Object.freeze({
  PRESUPUESTO: 'Presupuesto', GENERADORES: 'Números Generadores', APU: 'Análisis de Precios Unitarios',
  EXPLOSION: 'Explosión de Insumos', CATALOGO: 'Catálogo de Conceptos', RESUMEN: 'Resumen Ejecutivo del Proyecto',
  MEMORIA: 'Memoria de Cuantificación'
});
export const DRAFT_MARK = 'BORRADOR — CANTIDADES PENDIENTES DE REVISIÓN';

/* ---------- formato unico (T18) ---------- */
export function makeMoney(currency = 'MXN'){
  const code = /^[A-Z]{3}$/.test(String(currency || '')) ? currency : 'MXN';
  const f = new Intl.NumberFormat('es-MX', { style: 'currency', currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n => f.format(Number(n) || 0);
}
export const fmtQty = n => fmtQ(n);
export const fmtPct = n => `${(Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
const fmtDate = d => new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDateTime = d => new Date(d).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/* ---------- encabezado (nunca inventa campos) ---------- */
export function buildReportHeader({ project = null, presupuesto = null, generatedAt = new Date(), generatedBy = null } = {}){
  const loc = project ? { country: project.locationCountry, state: project.locationState, city: project.locationCity } : {};
  const ubicacion = hasAnyLocation(loc) ? formatLocationDisplay(loc) : (String(project?.ubicacion || '').trim() || NOT_SPECIFIED);
  const moneda = project?.moneda || 'MXN';
  return {
    empresa: BRAND.full,
    proyecto: project?.name || NOT_SPECIFIED,
    projectId: project?.id || null,
    cliente: String(project?.client || project?.cliente || '').trim() || NOT_SPECIFIED,
    ubicacion,
    moneda,
    responsable: String(project?.responsable || project?.responsible || '').trim() || NOT_SPECIFIED,
    generadoPor: generatedBy || NOT_SPECIFIED,
    fecha: fmtDate(generatedAt),
    generadoEn: fmtDateTime(generatedAt),
    generatedAtIso: new Date(generatedAt).toISOString(),
    presupuestoVersion: presupuesto?.currentVersion || null,
    baselineVersion: presupuesto?.baselineVersion || null
  };
}

/* Revision del documento: se usa el versionado EXISTENTE (presupuesto V#,
   revisiones de plano/generadores); el reporte solo agrega su fecha. */
export function documentRevision(header, extra = []){
  const parts = [header.presupuestoVersion ? `Presupuesto ${header.presupuestoVersion}${header.baselineVersion ? ` (baseline ${header.baselineVersion})` : ''}` : 'Presupuesto: vista vigente (sin versión guardada)', ...extra];
  return `${parts.join(' · ')} · Emitido ${header.generadoEn}`;
}

/* ---------- estado BORRADOR (generadores desactualizados) ---------- */
export function staleConceptsOf(conceptos = []){
  return (conceptos || []).filter(c => c && !c.archivedAt && c.generatorsStale)
    .map(c => ({ id: c.id, clave: c.clave || '', concept: c.concept || '', unit: c.unit || '', qty: rq(c.qty),
      pending: Object.values(c.generatorStaleness || {}).filter(s => s?.stale).map(s => ({ fromQty: s.fromQty, toQty: s.toQty, planoRevision: s.planoRevision })) }));
}

/* ---------- PRESUPUESTO ---------- */
export function buildBudgetReportModel({ conceptos = [], apuDocs = [], header }){
  const view = buildPresupuestoView({ conceptos, apuDocs });
  const stale = staleConceptsOf(conceptos);
  const chapters = view.capituloSubtotals.map(cap => ({
    capitulo: cap.capitulo, label: cap.label, importe: cap.importe, direct: cap.direct, conceptCount: cap.conceptCount,
    rows: view.rows.filter(r => r.capitulo === cap.capitulo).map(r => ({
      conceptoId: r.conceptoId, clave: r.clave || '', concept: r.concept || '', unit: r.unit || '', qty: r.qty,
      pu: r.pu, importe: r.importe, hasApu: r.hasApu, apuId: r.apuId || null, apuStatus: r.apuStatus,
      origenCantidad: r.origenCantidad, quantitySource: r.quantitySource, stale: r.generatorsStale
    }))
  }));
  // Desglose del P.U. (RLOPSRM): componentes que calcAPUv2 YA calculo por
  // unidad, por la cantidad autoritativa. Suma = importe (no se agrega nada).
  const sum = key => view.rows.reduce((s, r) => s + (r.hasApu ? r.qty * (Number(r.breakdown?.[key]) || 0) : 0), 0);
  const iva = view.rows.reduce((s, r) => s + r.qty * (Number(r.iva) || 0), 0);
  const summary = {
    costoDirecto: view.costoDirectoTotal,
    indirectos: sum('indirect'), financiamiento: sum('finance'), utilidad: sum('utility'), cargos: sum('cargos'),
    subtotal: view.importeTotal, iva, total: view.importeTotal + iva, ivaAplica: iva > 0
  };
  const conceptCount = view.rows.length;
  return {
    type: REPORT_TYPE.PRESUPUESTO, header, chapters, summary, view,
    counts: { chapters: chapters.length, concepts: conceptCount, withApu: view.rows.filter(r => r.hasApu).length, withoutApu: view.rows.filter(r => !r.hasApu).length },
    stale, draft: stale.length > 0,
    empty: conceptCount === 0 ? 'Sin conceptos en el catálogo del proyecto: no hay presupuesto que emitir.' : null
  };
}

/* ---------- CATALOGO (mismo orden que el presupuesto) ---------- */
export function buildCatalogReportModel({ budget }){
  const rows = budget.chapters.flatMap(ch => ch.rows.map(r => ({ ...r, capitulo: ch.label })));
  return { type: REPORT_TYPE.CATALOGO, header: budget.header, chapters: budget.chapters, rows, total: budget.summary.subtotal, draft: budget.draft, stale: budget.stale,
    empty: rows.length ? null : 'Sin conceptos en el catálogo del proyecto.' };
}

/* ---------- GENERADORES (F3, persistidos) ---------- */
export function buildGeneratorsReportModel({ conceptos = [], header, planosById = {} }){
  const byId = new Map((conceptos || []).map(c => [c.id, c]));
  const concepts = buildGeneratorReport(conceptos).map(r => {
    const c = byId.get(r.conceptoId) || {};
    const gens = [...(c.generadores || [])].sort((a, b) => String(a.elementId).localeCompare(String(b.elementId), 'es', { numeric: true }));
    const last = (c.quantityHistory || []).slice(-1)[0] || null;
    const planoIds = [...new Set(gens.map(g => g.planoId).filter(Boolean))];
    return {
      ...r, capituloLabel: capituloLabel(r.capitulo), stale: Boolean(c.generatorsStale),
      staleness: Object.values(c.generatorStaleness || {}).filter(s => s?.stale),
      planos: planoIds.map(id => ({ id, name: planosById[id]?.fileName || id, revision: planosById[id]?.revision ?? null, usedRevision: last?.planoRevision ?? null })),
      elements: r.elements.map((e, i) => {
        const g = gens[i] || {};
        const defaults = Object.entries(g.dimensionSources || {}).filter(([, s]) => s === DIMENSION_SOURCE.DEFAULT).map(([k]) => k);
        return { ...e, elementId: g.elementId, defaults };
      })
    };
  });
  const stale = staleConceptsOf(conceptos);
  return { type: REPORT_TYPE.GENERADORES, header, concepts, stale, draft: stale.length > 0,
    empty: concepts.length ? null : 'Sin generadores disponibles: ningún concepto toma su cantidad de elementos del plano.' };
}

/* ---------- EXPLOSION (F2) ---------- */
function traceOf(o){
  return { capitulo: o.capituloLabel || o.capitulo || null, concepto: o.conceptoClave ? `${o.conceptoClave} ${o.conceptoDescripcion || ''}`.trim() : (o.conceptoDescripcion || null),
    apu: o.apuClave || o.apuId || null, label: originLabel(o) };
}
export function buildExplosionReportModel({ conceptos = [], apuDocs = [], header, explosion = null, scope = EXPLOSION_SCOPE.PRESUPUESTO }){
  const x = explosion || computeScopedExplosion({ conceptos, apuDocs, scope });
  const { materials, auxiliares, labor, machinery } = x.data;
  const eco = laborEconomicView(labor);
  const matRows = rows => rows.map(r => ({ clave: r.clave || '', descripcion: r.descripcion, unidad: r.unidad || '', cantidad: r.cantidadFinal, precio: r.precioUnitario, importe: r.importe,
    origenes: (r.origenes || []).map(o => ({ ...traceOf(o), cantidad: o.cantidadFinalAportada, importe: o.importeConsolidado })) }));
  const sections = [
    { key: 'materiales', title: 'Materiales', rows: matRows(materials) },
    { key: 'manoObra', title: 'Mano de obra', rows: labor.map((r, i) => ({ clave: r.clave || '', descripcion: r.descripcion, unidad: r.unidad || 'jor', cantidad: eco[i].jornadas, precio: eco[i].costoUnitarioPorJornada, importe: eco[i].importe,
      origenes: (r.origenes || []).map(o => ({ ...traceOf(o), cantidad: o.jornadasAportadas, importe: o.importeConsolidado })) })) },
    { key: 'maquinaria', title: 'Maquinaria y equipo', rows: [...machinery.maquinaria, ...machinery.equipo, ...machinery.herramientaMenor].map(r => ({ clave: r.clave || '', descripcion: r.descripcion, unidad: r.unidad || '', cantidad: r.horas, precio: r.tarifaReferencia, importe: r.importe,
      origenes: (r.origenes || []).map(o => ({ ...traceOf(o), cantidad: o.horasAportadas, importe: o.importeAportadoReal })) })) },
    { key: 'auxiliares', title: 'Auxiliares', rows: matRows(auxiliares) }
  ].map(s => ({ ...s, total: s.rows.reduce((a, r) => a + (Number(r.importe) || 0), 0) }));
  const stale = staleConceptsOf(conceptos);
  return { type: REPORT_TYPE.EXPLOSION, header, scope: x.scope, summary: x.summary, sections, explosion: x,
    grandTotal: sections.reduce((a, s) => a + s.total, 0), stale, draft: stale.length > 0,
    empty: x.lines.length ? null : 'Sin APUs asociados a conceptos del presupuesto: no hay insumos que explotar.' };
}

/* ---------- APU (exportador profesional existente) ---------- */
/* Un APU por concepto con APU disponible, evaluado con la cantidad
   autoritativa del concepto (regla F2: el P.U. del presupuesto es el de
   calcAPUv2 con concepto.qty). No se recalcula aqui: el exportador existente
   (finalizeProfessionalAPU/drawApuSections) hace su propio calculo canonico. */
export function buildApuReportInput({ conceptos = [], apuDocs = [] }){
  const view = buildPresupuestoView({ conceptos, apuDocs, withIntelligence: false });
  const docs = new Map((apuDocs || []).map(d => [String(d.id), d]));
  const apus = view.rows.filter(r => r.hasApu).map(r => {
    const d = docs.get(String(r.apuId));
    const snap = d?.snapshot || d;
    return snap ? { ...snap, id: d.id, cantidadObra: r.qty, conceptoClave: r.clave || '', capitulo: capituloLabel(r.capitulo) } : null;
  }).filter(Boolean);
  return { apus, view, empty: apus.length ? null : 'Sin APUs asociados a conceptos del proyecto.' };
}

/* ---------- MEMORIA DE CUANTIFICACION (F4) ---------- */
const SOURCE_TEXT = { [DIMENSION_SOURCE.MANUAL]: 'MEDIDO / MANUAL', [DIMENSION_SOURCE.SURVEY]: 'MEDIDO (levantamiento)', [DIMENSION_SOURCE.DETECTED]: 'DEL DIBUJO', [DIMENSION_SOURCE.IMPORTED]: 'IMPORTADO', [DIMENSION_SOURCE.DEFAULT]: 'DEFAULT (no medido)' };
export const sourceText = s => SOURCE_TEXT[s] || dimensionSourceLabel(s);

export function buildQuantificationMemoryModel({ levantamientos = [], planosById = {}, conceptos = [], header }){
  const surveys = (levantamientos || []).filter(s => !s.archivedAt).map(s => {
    const models = {};
    (s.spaces || []).forEach(sp => { const id = spacePlanoId(s, sp.id); if(id && planosById[id]?.snapshot?.cadModel) models[sp.id] = planosById[id].snapshot.cadModel; });
    const q = computeSurveyQuantities(s, models);
    return {
      id: s.id, name: s.name || s.id, mode: q.mode, revision: s.revision ?? null,
      spaces: q.rows.map(row => {
        const model = models[row.spaceId] || null;
        const plano = row.planoId ? planosById[row.planoId] : null;
        const spaceEl = model?.spaces?.[0] || null;
        const dims = [];
        if(model){
          if(spaceEl) dims.push({ element: spaceEl.id, dimension: 'altura de plafón', value: spaceEl.ceilingHeight ?? null, source: spaceCeilingHeightSource(spaceEl) });
          (model.walls || []).forEach(w => {
            dims.push({ element: w.id, dimension: 'altura', value: w.height, source: wallHeightSource(w) });
            dims.push({ element: w.id, dimension: 'espesor', value: w.thickness, source: wallThicknessSource(w) });
          });
        }
        return {
          spaceId: row.spaceId, name: row.name || row.spaceId, origin: row.origin,
          originLabel: row.origin === QUANTITY_ORIGIN.CAD ? 'CAD (plano autoritativo)' : 'Captura manual',
          planoId: row.planoId, planoRevision: plano?.revision ?? null, pending: row.pending,
          q: row.q, area: spaceEl && model ? computeSpaceMetrics(model, spaceEl).area : null,
          scaleConfirmed: row.q ? row.q.scaleConfirmed : null,
          dims, defaults: dims.filter(d => d.source === DIMENSION_SOURCE.DEFAULT)
        };
      })
    };
  });
  const generators = buildGeneratorsReportModel({ conceptos, header, planosById });
  const byQuantitySource = (conceptos || []).filter(c => !c.archivedAt).reduce((a, c) => { const k = c.quantitySource === 'GENERATORS' ? 'GENERADORES' : c.origenPlano ? 'PLANO' : 'MANUAL'; a[k] = (a[k] || 0) + 1; return a; }, {});
  const hasData = surveys.some(s => s.spaces.length) || generators.concepts.length > 0;
  return { type: REPORT_TYPE.MEMORIA, header, surveys, generators, byQuantitySource, draft: generators.draft, stale: generators.stale,
    empty: hasData ? null : 'Sin datos suficientes: el proyecto no tiene levantamientos ni conceptos cuantificados desde CAD/generadores.' };
}

/* ---------- RESUMEN EJECUTIVO (determinista, sin IA ni mocks) ---------- */
export function buildExecutiveSummaryModel({ budget, conceptos = [], levantamientos = [], presupuesto = null }){
  const rows = budget.view.rows;
  const total = budget.summary.subtotal;
  const topChapters = [...budget.chapters].sort((a, b) => b.importe - a.importe).slice(0, 5)
    .map(ch => ({ label: ch.label, importe: ch.importe, pct: total > 0 ? ch.importe / total * 100 : 0, concepts: ch.conceptCount }));
  const active = (conceptos || []).filter(c => !c.archivedAt);
  const withGenerators = active.filter(c => c.quantitySource === 'GENERATORS');
  const incompleteGens = withGenerators.filter(c => (c.generadores || []).some(g => g.status !== GENERATOR_STATUS.COMPLETO)).length;
  const surveys = (levantamientos || []).filter(s => !s.archivedAt);
  const count = (list, key) => list.reduce((a, x) => { const k = x[key]; if(k) a[k] = (a[k] || 0) + 1; return a; }, {});
  const dates = [...active.map(c => c.updatedAt), presupuesto?.updatedAt, ...surveys.map(s => s.updatedAt)].filter(Boolean).map(d => new Date(d).getTime()).filter(Number.isFinite);
  return {
    type: REPORT_TYPE.RESUMEN, header: budget.header, draft: budget.draft, stale: budget.stale,
    kpis: {
      chapters: budget.counts.chapters, concepts: budget.counts.concepts,
      apusVinculados: new Set(rows.filter(r => r.hasApu).map(r => r.apuId)).size,
      conceptosSinApu: budget.counts.withoutApu,
      costoDirecto: budget.summary.costoDirecto, importe: total, iva: budget.summary.iva, total: budget.summary.total, ivaAplica: budget.summary.ivaAplica
    },
    topChapters,
    quantification: {
      byQuantitySource: { GENERADORES: withGenerators.length, PLANO: active.filter(c => c.quantitySource !== 'GENERATORS' && c.origenPlano).length, MANUAL: active.filter(c => c.quantitySource !== 'GENERATORS' && !c.origenPlano).length },
      levantamientos: surveys.length,
      modes: { CAD: surveys.filter(s => s.geometryMode === GEOMETRY_MODE.CAD_AUTHORITATIVE).length, MIXTO: surveys.filter(s => s.geometryMode === GEOMETRY_MODE.MIXTO).length, MANUAL: surveys.filter(s => !s.geometryMode || s.geometryMode === GEOMETRY_MODE.LEGACY_MANUAL).length }
    },
    generators: { conceptos: withGenerators.length, desactualizados: budget.stale.length, conIncompletos: incompleteGens },
    // Indicadores REALES del proyecto: Confidence Engine / Bid Risk corridos
    // sobre los APUs vinculados (mismos que muestra la pantalla de Presupuesto).
    intelligence: rows.some(r => r.confidenceStatus || r.bidRiskSeverity)
      ? { confidence: count(rows.filter(r => r.hasApu), 'confidenceStatus'), bidRisk: count(rows.filter(r => r.hasApu), 'bidRiskSeverity') }
      : null,
    updatedAt: dates.length ? fmtDateTime(Math.max(...dates)) : null,
    presupuestoVersion: presupuesto?.currentVersion || null,
    empty: budget.counts.concepts ? null : 'Sin datos suficientes para el resumen: el proyecto no tiene conceptos.'
  };
}

/* ---------- disponibilidad (antes de exportar) ---------- */
export function reportAvailability({ budget, generators, explosion, catalog, summary, memory, apuInput }){
  const a = (model, formats) => ({ available: !model?.empty, reason: model?.empty || null, draft: Boolean(model?.draft), formats });
  return {
    PRESUPUESTO: a(budget, ['PDF', 'XLSX']), GENERADORES: a(generators, ['PDF', 'XLSX']), APU: a(apuInput, ['PDF', 'XLSX']),
    EXPLOSION: a(explosion, ['PDF', 'XLSX']), CATALOGO: a(catalog, ['PDF', 'XLSX']), RESUMEN: a(summary, ['PDF']), MEMORIA: a(memory, ['PDF'])
  };
}
