import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileSentinelAlerts } from './sentinelDeduplication.js';
import { makeSentinelAlert } from './sentinelAlertSchema.js';

function candidate(overrides = {}){
  return makeSentinelAlert({ projectId: 'PRO-1', alertType: 'FORECAST_SOBRE_PRESUPUESTO', severity: 'ALTA', title: 't', message: 'm', actionRoute: { module: 'x' }, ...overrides });
}

test('identidad nueva -> se crea, arranca en NUEVA', () => {
  const { toCreate, toUpdate, toAutoResolve } = reconcileSentinelAlerts([candidate()], []);
  assert.equal(toCreate.length, 1);
  assert.equal(toCreate[0].status, 'NUEVA');
  assert.equal(toUpdate.length, 0);
  assert.equal(toAutoResolve.length, 0);
});

test('la condicion persiste (misma identidad, alerta activa) -> se actualiza, nunca se duplica ni se pierde firstDetectedAt', () => {
  const existing = { ...candidate(), status: 'NUEVA', firstDetectedAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z' };
  const { toCreate, toUpdate } = reconcileSentinelAlerts([candidate({ severity: 'CRITICA' })], [existing], { now: '2026-02-01T00:00:00.000Z' });
  assert.equal(toCreate.length, 0, 'nunca crea una segunda alerta para la misma identidad');
  assert.equal(toUpdate.length, 1);
  assert.equal(toUpdate[0].firstDetectedAt, '2026-01-01T00:00:00.000Z', 'la fecha de primera deteccion nunca se pierde');
  assert.equal(toUpdate[0].lastSeenAt, '2026-02-01T00:00:00.000Z');
  assert.equal(toUpdate[0].severity, 'CRITICA', 'la severidad se refresca con la corrida actual');
  assert.equal(toUpdate[0].status, 'NUEVA', 'una alerta activa conserva su estado, la reconciliacion no lo toca');
});

test('una alerta EN_REVISION que sigue activa conserva EN_REVISION (nunca la regresa a NUEVA)', () => {
  const existing = { ...candidate(), status: 'EN_REVISION', firstDetectedAt: '2026-01-01T00:00:00.000Z' };
  const { toUpdate } = reconcileSentinelAlerts([candidate()], [existing]);
  assert.equal(toUpdate[0].status, 'EN_REVISION');
});

test('la condicion desaparece -> la alerta activa se auto-resuelve, nunca se borra', () => {
  const existing = { ...candidate(), status: 'NUEVA', identity: candidate().identity };
  const { toAutoResolve, toUpdate, toCreate } = reconcileSentinelAlerts([], [existing]);
  assert.equal(toAutoResolve.length, 1);
  assert.equal(toAutoResolve[0].status, 'RESUELTA');
  assert.equal(toAutoResolve[0].resolvedBy, 'system');
  assert.ok(toAutoResolve[0].resolution);
  assert.equal(toUpdate.length, 0);
  assert.equal(toCreate.length, 0);
});

test('una alerta ya RESUELTA que no reaparece nunca se toca de nuevo (no se auto-resuelve dos veces)', () => {
  const existing = { ...candidate(), status: 'RESUELTA', resolvedAt: '2026-01-01T00:00:00.000Z' };
  const { toAutoResolve, toUpdate } = reconcileSentinelAlerts([], [existing]);
  assert.equal(toAutoResolve.length, 0);
  assert.equal(toUpdate.length, 0);
});

test('la condicion REAPARECE tras haber sido RESUELTA -> se reabre a NUEVA, conserva la resolucion anterior como contexto (no se borra historial)', () => {
  const resolved = { ...candidate(), status: 'RESUELTA', resolvedAt: '2026-01-15T00:00:00.000Z', resolvedBy: 'ana@zoemec.test', resolution: 'Se corrigió el presupuesto.' };
  const { toUpdate, toCreate } = reconcileSentinelAlerts([candidate()], [resolved], { now: '2026-02-01T00:00:00.000Z' });
  assert.equal(toCreate.length, 0);
  assert.equal(toUpdate.length, 1);
  assert.equal(toUpdate[0].status, 'NUEVA');
  assert.equal(toUpdate[0].resolvedAt, '2026-01-15T00:00:00.000Z', 'la resolucion anterior no se borra, queda como contexto historico');
  assert.equal(toUpdate[0].resolvedBy, 'ana@zoemec.test');
  assert.equal(toUpdate[0].reopenedAt, '2026-02-01T00:00:00.000Z');
  assert.equal(toUpdate[0].reopenedFromStatus, 'RESUELTA');
});

test('una alerta DESCARTADA que reaparece tambien se reabre (la persistencia de una decision manual no bloquea una recurrencia real)', () => {
  const dismissed = { ...candidate(), status: 'DESCARTADA' };
  const { toUpdate } = reconcileSentinelAlerts([candidate()], [dismissed]);
  assert.equal(toUpdate[0].status, 'NUEVA');
  assert.equal(toUpdate[0].reopenedFromStatus, 'DESCARTADA');
});

test('escenario mixto: una identidad nueva, una persistente, una que desaparece -- cada una cae en su bucket correcto', () => {
  const persistente = candidate({ alertType: 'PAGO_PENDIENTE', affectedEntity: { type: 'ESTIMACION', id: 'E1' } });
  const desaparece = candidate({ alertType: 'ORDEN_CAMBIO_PENDIENTE', affectedEntity: { type: 'ORDEN_CAMBIO', id: 'CO-1' } });
  const nueva = candidate({ alertType: 'CONFIANZA_PRECIO_BAJA', affectedEntity: { type: 'APU', id: 'A1' } });
  const existingPersistente = { ...persistente, status: 'NUEVA' };
  const existingDesaparece = { ...desaparece, status: 'EN_REVISION' };
  const { toCreate, toUpdate, toAutoResolve } = reconcileSentinelAlerts([persistente, nueva], [existingPersistente, existingDesaparece]);
  assert.equal(toCreate.length, 1);
  assert.equal(toCreate[0].identity, nueva.identity);
  assert.equal(toUpdate.length, 1);
  assert.equal(toUpdate[0].identity, persistente.identity);
  assert.equal(toAutoResolve.length, 1);
  assert.equal(toAutoResolve[0].identity, desaparece.identity);
});
