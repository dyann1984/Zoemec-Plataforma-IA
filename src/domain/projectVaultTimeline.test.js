import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectVaultTimeline, describeTimelineEvent } from './projectVaultTimeline.js';

test('sin registros, timeline vacia (nunca lanza)', () => {
  assert.deepEqual(buildProjectVaultTimeline([]), []);
});

test('ordena por fecha descendente (mas reciente primero)', () => {
  const records = [
    { source: 'APU', action: 'APU_CREATED', at: '2026-01-01T00:00:00.000Z' },
    { source: 'PRESUPUESTO', action: 'PRESUPUESTO_BASELINE_APPROVED', at: '2026-03-01T00:00:00.000Z' },
    { source: 'PLANO', action: 'PLANO_TAKEOFF_CREATED', at: '2026-02-01T00:00:00.000Z' }
  ];
  const timeline = buildProjectVaultTimeline(records);
  assert.deepEqual(timeline.map(t => t.action), ['PRESUPUESTO_BASELINE_APPROVED', 'PLANO_TAKEOFF_CREATED', 'APU_CREATED']);
});

test('registros sin fecha valida se descartan silenciosamente, nunca rompen el orden de los demas', () => {
  const records = [
    { source: 'APU', action: 'APU_CREATED', at: 'no-es-fecha' },
    { source: 'APU', action: 'APU_CREATED' },
    { source: 'PLANO', action: 'PLANO_TAKEOFF_CREATED', at: '2026-01-01T00:00:00.000Z' }
  ];
  const timeline = buildProjectVaultTimeline(records);
  assert.equal(timeline.length, 1);
});

test('respeta el limite pedido', () => {
  const records = Array.from({ length: 10 }, (_, i) => ({ source: 'APU', action: 'APU_CREATED', at: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` }));
  const timeline = buildProjectVaultTimeline(records, { limit: 3 });
  assert.equal(timeline.length, 3);
});

test('describeTimelineEvent: etiquetas conocidas por tipo de evento', () => {
  assert.equal(describeTimelineEvent({ source: 'PRESUPUESTO', action: 'PRESUPUESTO_BASELINE_APPROVED' }), 'Baseline aprobado');
  assert.equal(describeTimelineEvent({ source: 'ORDEN_CAMBIO', action: 'CHANGE_ORDER_STATUS_CHANGED', newStatus: 'APROBADA' }), 'Orden de cambio aprobada');
  assert.equal(describeTimelineEvent({ source: 'ORDEN_CAMBIO', action: 'CHANGE_ORDER_STATUS_CHANGED', newStatus: 'RECHAZADA' }), 'Orden de cambio rechazada');
  assert.equal(describeTimelineEvent({ source: 'AVANCE', action: 'PROGRESS_ENTRY_CREATED', meta: { motivo: 'Avance julio' } }), 'Avance registrado: Avance julio');
  assert.equal(describeTimelineEvent({ source: 'EXPORTACION', action: 'EXPORT_EVENT', meta: { scope: 'PRESUPUESTO', format: 'PDF' } }), 'Exportacion generada (PRESUPUESTO, PDF)');
});

test('describeTimelineEvent: un evento desconocido nunca lanza, cae al nombre crudo de la accion', () => {
  assert.equal(describeTimelineEvent({ source: 'ALGO_NUEVO', action: 'ALGO_PASO' }), 'ALGO_PASO');
});

test('cada evento final trae su label calculado, listo para renderizar', () => {
  const timeline = buildProjectVaultTimeline([{ source: 'PLANO', action: 'PLANO_TAKEOFF_CREATED', at: '2026-01-01T00:00:00.000Z', actor: 'ana@zoemec.test' }]);
  assert.equal(timeline[0].label, 'Plano cargado');
  assert.equal(timeline[0].actor, 'ana@zoemec.test');
});
