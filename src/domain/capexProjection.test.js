import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCapexProjection } from './capexProjection.js';

test('componente sin fecha/vida util/costo -> confiable:false con motivo explicito ("Sin proyeccion confiable")', () => {
  const [r] = computeCapexProjection([{ id: 'C1', nombre: 'Bomba sin datos' }]);
  assert.equal(r.confiable, false);
  assert.ok(r.reason.includes('Sin proyección confiable'));
  assert.equal(r.costoProyectado, null);
});

test('con datos completos, calcula año esperado de reemplazo y costo proyectado SIN inflacion por defecto (flat)', () => {
  const [r] = computeCapexProjection([{ id: 'C1', nombre: 'HVAC', fechaInstalacion: '2020-01-01T00:00:00.000Z', vidaUtilAnios: 10, costo: 50000 }], { now: '2026-01-01T00:00:00.000Z' });
  assert.equal(r.confiable, true);
  assert.equal(r.anioEsperadoReemplazo, 2030);
  assert.equal(r.aniosRestantes, 4);
  assert.equal(r.costoProyectado, 50000, 'sin tasa de inflacion explicita, el costo proyectado es el costo actual tal cual');
  assert.equal(r.inflationApplied, false);
});

test('con inflationRatePctPerYear EXPLICITO, aplica interes compuesto sobre la vida util -- nunca sin que el llamador lo pida', () => {
  const [r] = computeCapexProjection([{ id: 'C1', nombre: 'HVAC', fechaInstalacion: '2020-01-01T00:00:00.000Z', vidaUtilAnios: 10, costo: 50000 }], { now: '2026-01-01T00:00:00.000Z', inflationRatePctPerYear: 5 });
  assert.ok(Math.abs(r.costoProyectado - 50000 * Math.pow(1.05, 10)) < 1e-6);
  assert.equal(r.inflationApplied, true);
});

test('prioridad: <=1 año ALTA, <=3 MEDIA, >3 BAJA', () => {
  const now = '2026-01-01T00:00:00.000Z';
  const mk = (vidaUtilAnios) => computeCapexProjection([{ id: 'x', nombre: 'x', fechaInstalacion: '2020-01-01T00:00:00.000Z', vidaUtilAnios, costo: 1000 }], { now })[0];
  assert.equal(mk(6).prioridad, 'ALTA'); // 2026 restante 0
  assert.equal(mk(8).prioridad, 'MEDIA'); // 2028, restante 2
  assert.equal(mk(15).prioridad, 'BAJA'); // 2035, restante 9
});
