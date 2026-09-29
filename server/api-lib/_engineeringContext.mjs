import { computeZoemecIntelligence, summarizeIntelligence, runScenarioLab, buildScenarioLabChange } from '../../src/features/apu/zoemecIntelligence.js';
import { buildMemoryEvidence, MEMORY_TYPE } from '../../src/domain/technicalMemory.js';
import { calcAPUv2 } from '../../src/lib/apuCalc.js';

export function aiError(code, status = 400) { return Object.assign(new Error(code), { code, status }); }
export function assertScope(doc, identity) {
  if (!doc || (doc.organizationId
    ? doc.organizationId !== identity.organizationId || identity.memberStatus !== 'active'
    : doc.ownerUid !== identity.uid)) throw aiError('FORBIDDEN', 403);
}
export function cleanText(value, max = 400) {
  return String(value ?? '').replace(/https?:\/\/\S+/gi, '[enlace omitido]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[correo omitido]')
    .replace(/(?:Bearer\s+|sk-)[\w.-]+/gi, '[secreto omitido]').slice(0, max);
}
// Leaves become immutable evidence values. The model selects references; it never writes FACT values.
function flatten(value, path, add, depth = 0) {
  if (depth > 7 || value === undefined) return;
  if (value === null || ['number', 'boolean', 'string'].includes(typeof value)) {
    add(path, typeof value === 'string' ? cleanText(value) : value); return;
  }
  if (Array.isArray(value)) value.slice(0, 80).forEach((v, i) => flatten(v, `${path}.${i}`, add, depth + 1));
  else Object.entries(value).forEach(([k, v]) => {
    if (!/email|owner|user|createdBy|approvedBy|storage|url|token|secret/i.test(k)) flatten(v, `${path}.${k}`, add, depth + 1);
  });
}
export function buildEngineeringContext({ project, apus, identity, memory = [], evidence = [], scenario }) {
  assertScope(project, identity);
  if (!Array.isArray(apus) || apus.length > 20) throw aiError('CONTEXT_LIMIT', 413);
  const refs = []; const indicators = [];
  const add = (path, value) => {
    if (refs.length >= 3500) throw aiError('CONTEXT_LIMIT', 413);
    refs.push({ id: `E${refs.length + 1}`, path, value });
  };
  add('project.name', cleanText(project.nombre || project.name || 'Proyecto'));
  const missingData = ['Las fuentes de precio son declaraciones registradas; no se verifica su autenticidad externa.',
    'No se envían archivos, imágenes ni planos completos. La evidencia multimedia se limita a metadatos.',
    'Se analiza la versión guardada; los cambios locales pendientes no están incluidos.'];
  for (const doc of apus) {
    assertScope(doc, identity);
    if (doc.projectId !== project.id) throw aiError('FORBIDDEN', 403);
    const apu = structuredClone(doc.snapshot || {});
    const prefix = `apu.${doc.id}`;
    const eligibleMemory = memory.filter(e => e.scope === 'PROJECT' && e.context?.projectId === project.id && e.status === 'APPROVED');
    const queries = (apu.labor || []).filter(r => r.descripcion).map(r => ({ type: MEMORY_TYPE.APPROVED_YIELD,
      subject: { primaryActivity: apu.primaryActivity || undefined, resourceDescripcion: r.descripcion }, context: { projectId: project.id } }));
    const memoryEvidence = queries.length ? buildMemoryEvidence(eligibleMemory, queries) : undefined;
    const intelligence = computeZoemecIntelligence(apu, memoryEvidence);
    const summary = summarizeIntelligence(intelligence);
    indicators.push({ apuId: doc.id, concept: cleanText(apu.concept || apu.concepto), version: doc.currentVersion || null, ...summary });
    add(`${prefix}.concept`, cleanText(apu.concept || apu.concepto));
    add(`${prefix}.version`, doc.currentVersion || null);
    add(`${prefix}.quantity`, apu.cantidadObra ?? null);
    add(`${prefix}.unit`, cleanText(apu.unit || apu.unidad));
    add(`${prefix}.currency`, cleanText(apu.moneda || 'No registrada'));
    const location = apu.ubicacionEstructurada || {};
    flatten(Object.fromEntries(['country', 'state', 'city', 'municipality', 'pais', 'estado', 'ciudad', 'municipio'].filter(k => location[k] != null).map(k => [k, location[k]])), `${prefix}.regionalContext`, add);
    flatten(calcAPUv2(apu), `${prefix}.calculated`, add);
    flatten(intelligence, `${prefix}.engines`, add);
    for (const kind of ['materials', 'labor', 'equipment', 'consumables', 'seguridad']) {
      if ((apu[kind] || []).length > 80) throw aiError('CONTEXT_LIMIT', 413);
      (apu[kind] || []).forEach((row, i) => {
        const selected = {};
        for (const key of ['descripcion', 'unidad', 'consumo', 'precioUnitario', 'salarioBase', 'tarifa', 'rendimiento', 'priceStatus', 'regionalConfidence']) {
          if (row[key] !== undefined) selected[key] = row[key];
        }
        selected.fuente = Object.fromEntries(['proveedor', 'fecha', 'estado', 'region', 'tipo'].filter(k => row.fuente?.[k] !== undefined).map(k => [k, row.fuente[k]]));
        flatten(selected, `${prefix}.resource.${kind}.${i}`, add);
      });
    }
    if (!eligibleMemory.length) missingData.push(`APU ${doc.id}: sin memoria técnica aprobada del proyecto.`);
    if (scenario) {
      if (apus.length !== 1) throw aiError('SCENARIO_REQUIRES_APU');
      const change = buildScenarioLabChange(scenario);
      if (!change || !Number.isFinite(change.value) || Math.abs(change.value) > 100 || !['MATERIAL_PERCENT', 'LABOR_PERCENT', 'PRODUCTIVITY_PERCENT', 'WASTE_PERCENT'].includes(scenario.kind)) throw aiError('INVALID_SCENARIO');
      const result = runScenarioLab(apu, [change]);
      if (!result.ok) throw aiError('INVALID_SCENARIO');
      flatten({ delta: result.data.delta, confidence: result.data.confidence, bidRisk: result.data.bidRisk,
        appliedChanges: result.data.appliedChanges, warnings: result.data.warnings }, `${prefix}.scenario`, add);
    }
  }
  for (const item of evidence) {
    assertScope(item, identity);
    if (item.projectId !== project.id) throw aiError('FORBIDDEN', 403);
    flatten({ kind: item.kind, status: item.status }, `evidence.${item.id}`, add);
  }
  if (!apus.length) missingData.push('ZOEMEC no dispone de evidencia suficiente para responder con confianza. No hay APUs guardados.');
  const context = { project: { name: cleanText(project.nombre || project.name), demo: project.isDemo === true }, refs, missingData };
  if (JSON.stringify(context).length > 130000) throw aiError('CONTEXT_LIMIT', 413);
  return { context, indicators };
}
