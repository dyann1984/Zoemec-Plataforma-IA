import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  explainApuDifference, coberturaFuentes, deriveRevisionStatus, applyRevisionDecision,
  suggestDeviationCategory, DEVIATION_CATEGORY, REVISION_STATUS,
  saveValidatedReference, queryValidatedReferences, applyRendimientoDecision, RENDIMIENTO_FUENTE,
  buildReviewRow, filterReviewRows, REVIEW_FILTER
} from './apuReview.js';

// localStorage minimo para node:test (no hay DOM en este runner)
class FakeStorage{
  constructor(){ this.map = new Map(); }
  getItem(k){ return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v){ this.map.set(k, String(v)); }
  removeItem(k){ this.map.delete(k); }
}
globalThis.localStorage = new FakeStorage();

function apuFixture(overrides = {}){
  return {
    clave: '524', concept: 'SUMINISTRO E INSTALACION DE LLAVE MEZCLADORA', unit: 'pza', family: 'plomeria',
    referencePU: 16373.28,
    calculated: { mo: 455, mat: 4413.83, equipo: 20, herramienta: 5.68, seguridad: 0, direct: 4894.51, indirect: 734.18, finance: 112.57, utility: 574.13, cargos: 28.6, pu: 6346.96, iva: 1015.51, total: 6346.96, importeTotal: 152327.04 },
    confidence: { score: 92, level: 'ALTA', dimensions: { precios: 81, rendimientos: 100, cantidades: 90, composicion: 80 }, pendingValidation: 0 },
    labor: [{ clave: 'MO-001', descripcion: 'Cuadrilla plomero', cuadrilla: 2, rendimiento: 2 }],
    materials: [], equipment: [], seguridad: [],
    ...overrides
  };
}

test('explainApuDifference descompone el PU calculado en componentes reales y no inventa un desglose del original', () => {
  const r = explainApuDifference(apuFixture());
  assert.equal(r.puCalculado, 6346.96);
  assert.equal(r.puOriginal, 16373.28);
  assert.ok(r.diferencia < 0);
  assert.ok(Math.abs(r.diferenciaPct - (-61.2)) < 1);
  assert.equal(r.componenteDominante.componente, 'materiales');
  assert.ok(r.componenteDominante.pctDelDirecto > 85);
  assert.match(r.nota, /no desglosa/);
});

test('explainApuDifference sin referencePU no fabrica una diferencia', () => {
  const r = explainApuDifference(apuFixture({ referencePU: 0 }));
  assert.equal(r.puOriginal, null);
  assert.equal(r.diferencia, null);
  assert.equal(r.diferenciaPct, null);
});

test('coberturaFuentes es 0 sin ninguna referencia ni proveedor', () => {
  const apu = apuFixture({ materials: [{ descripcion: 'x', costoRenglon: 100, fuente: {} }] });
  assert.equal(coberturaFuentes(apu), 0);
});

test('deriveRevisionStatus marca REQUIERE_REVISION por diferencia>25% aunque la confianza sea alta', () => {
  const r = deriveRevisionStatus(apuFixture());
  assert.equal(r.status, REVISION_STATUS.REQUIERE_REVISION);
  assert.ok(r.reasons.includes('diferencia_abs>25%'));
  // la confianza (92%) NO debe aparecer como motivo -- es alta, el problema es la diferencia
  assert.ok(!r.reasons.includes('confianza<70%'));
});

test('deriveRevisionStatus respeta una decision humana previa (REVISADO/VALIDADO_POR_USUARIO no se recalculan)', () => {
  const apu = { ...apuFixture(), revisionStatus: REVISION_STATUS.VALIDADO_POR_USUARIO };
  assert.equal(deriveRevisionStatus(apu), REVISION_STATUS.VALIDADO_POR_USUARIO);
});

test('applyRevisionDecision nunca la deriva el sistema: requiere status explicito y registra auditoria', () => {
  const apu = apuFixture();
  const next = applyRevisionDecision(apu, { status: REVISION_STATUS.REVISADO, usuario: 'diana', motivo: 'revisado con proveedor' });
  assert.equal(next.revisionStatus, REVISION_STATUS.REVISADO);
  assert.equal(next.revisionLog.length, 1);
  assert.equal(next.revisionLog[0].usuario, 'diana');
  assert.equal(next.revisionLog[0].version, 1);
  assert.throws(() => applyRevisionDecision(apu, { status: 'INVALIDO' }));
});

test('suggestDeviationCategory clasifica PRECIO cuando materiales domina y hay poca evidencia', () => {
  const apu = apuFixture({ materials: [{ descripcion: 'llave', costoRenglon: 4413.83, fuente: {}, priceRecord: { references: [] } }] });
  const s = suggestDeviationCategory(apu);
  assert.equal(s.categoria, DEVIATION_CATEGORY.PRECIO);
});

test('suggestDeviationCategory clasifica RENDIMIENTO cuando mano de obra domina con rendimiento bajo', () => {
  const apu = apuFixture({
    calculated: { ...apuFixture().calculated, mo: 400, mat: 50, equipo: 0, herramienta: 0, seguridad: 0, direct: 450 },
    labor: [{ clave: 'MO-001', descripcion: 'plomero', cuadrilla: 2, rendimiento: 4 }] // 0.5 jornada-cuadrilla/unidad
  });
  const s = suggestDeviationCategory(apu);
  assert.equal(s.categoria, DEVIATION_CATEGORY.RENDIMIENTO);
});

test('Base Historica ZOEMEC: guarda y consulta por tipoConcepto+unidad', () => {
  saveValidatedReference({ tipoConcepto: 'Impermeabilizacion', unidad: 'm2', campo: 'rendimiento', valor: { rendimiento: 20, cuadrilla: 2 }, usuario: 'diana' });
  const found = queryValidatedReferences({ tipoConcepto: 'impermeabilizacion', unidad: 'm2' });
  assert.equal(found.length, 1);
  assert.equal(found[0].campo, 'rendimiento');
});

test('saveValidatedReference exige campos obligatorios', () => {
  assert.throws(() => saveValidatedReference({ unidad: 'm2', campo: 'rendimiento', valor: 1 }));
});

test('applyRendimientoDecision marca el renglon como VALIDADO y no recalcula el APU por si sola', () => {
  const apu = apuFixture();
  const next = applyRendimientoDecision(apu, { laborIndex: 0, rendimiento: 25, cuadrilla: 2, confirmado: true, usuario: 'diana', guardarEnHistorico: false });
  assert.equal(next.labor[0].rendimientoFuente, RENDIMIENTO_FUENTE.VALIDADO);
  assert.equal(next.labor[0].rendimiento, 25);
  // el resto del APU (calculated) no se toco -- eso lo hace finalizeProfessionalAPU despues
  assert.equal(next.calculated, apu.calculated);
});

test('explainApuDifference identifica el recurso INDIVIDUAL dominante, no solo la categoria', () => {
  const apu = apuFixture({ materials: [
    { clave: 'MAT-001', descripcion: 'Llave mezcladora Helvex HM-17', costoRenglon: 4236.58, priceRecord: { references: [{ match: { verdict: 'ALTO', score: 90 } }] } },
    { clave: 'MAT-002', descripcion: 'Cinta teflon', costoRenglon: 1.25 }
  ] });
  const r = explainApuDifference(apu);
  assert.equal(r.recursoDominante.clave, 'MAT-001');
  assert.equal(r.recursoDominante.nRefsAlto, 1);
  assert.equal(r.recursoDominante.evidenciaAlto, true);
});

test('suggestDeviationCategory: materiales dominante CON referencia ALTO pero diferencia grande -> ESPECIFICACION (no PRECIO)', () => {
  const apu = apuFixture({ materials: [
    { clave: 'MAT-001', descripcion: 'Llave mezcladora Helvex HM-17', costoRenglon: 4413.83, priceRecord: { references: [{ match: { verdict: 'ALTO', score: 92 } }] } }
  ] });
  const s = suggestDeviationCategory(apu);
  assert.equal(s.categoria, DEVIATION_CATEGORY.ESPECIFICACION);
  assert.match(s.evidencia[0], /HM-17/);
  assert.match(s.evidencia[0], /referencia/);
});

test('suggestDeviationCategory: materiales dominante con referencias que NO califican ALTO -> FUENTE', () => {
  const apu = apuFixture({ materials: [
    { clave: 'MAT-001', descripcion: 'Membrana SBS', costoRenglon: 4413.83, priceRecord: { references: [{ match: { verdict: 'MEDIO', score: 70 } }, { match: { verdict: 'BAJO', score: 40 } }] } }
  ] });
  const s = suggestDeviationCategory(apu);
  assert.equal(s.categoria, DEVIATION_CATEGORY.FUENTE);
});

test('suggestDeviationCategory: materiales dominante SIN ninguna referencia -> PRECIO', () => {
  const apu = apuFixture({ materials: [{ clave: 'MAT-001', descripcion: 'Membrana SBS', costoRenglon: 4413.83 }] });
  const s = suggestDeviationCategory(apu);
  assert.equal(s.categoria, DEVIATION_CATEGORY.PRECIO);
});

test('buildReviewRow expone confianza tecnica, confianza de precios y diferencia absoluta por separado', () => {
  const apu = apuFixture({ confidence: { ...apuFixture().confidence, presentation: { confianzaTecnica: 80, confianzaPrecios: 81, confianzaRendimientos: 100, coberturaFuentes: 8 } } });
  const row = buildReviewRow(apu);
  assert.equal(row.confianzaTecnica, 80);
  assert.equal(row.confianzaPrecios, 81);
  assert.ok(row.diferenciaAbsoluta < 0);
});

test('buildReviewRow + filterReviewRows arma la bandeja con los filtros pedidos', () => {
  const rows = [apuFixture(), apuFixture({ clave: '318', referencePU: 314.32, calculated: { ...apuFixture().calculated, pu: 309.13, total: 309.13 }, confidence: { score: 65, level: 'MEDIA', dimensions: { precios: 13, rendimientos: 100, cantidades: 80, composicion: 80 }, pendingValidation: 1 } })]
    .map(buildReviewRow);
  const diff25 = filterReviewRows(rows, REVIEW_FILTER.DIFERENCIA_25);
  assert.equal(diff25.length, 1);
  assert.equal(diff25[0].clave, '524');
  const pendientes = filterReviewRows(rows, REVIEW_FILTER.PRECIOS_PENDIENTES);
  assert.equal(pendientes.length, 1);
  assert.equal(pendientes[0].clave, '318');
  assert.equal(filterReviewRows(rows, REVIEW_FILTER.TODOS).length, 2);
});
