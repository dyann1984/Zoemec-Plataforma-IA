import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consolidateProjectVaultAlerts } from './projectVaultAlerts.js';

test('sin ninguna fuente, bandeja vacia (nunca lanza)', () => {
  assert.deepEqual(consolidateProjectVaultAlerts({}), []);
});

test('alertas de Control Presupuestal se mapean 1:1 con su severidad', () => {
  const controlPresupuestalAlerts = [{ type: 'SOBREPRESUPUESTO', severity: 'CRITICAL', message: 'x' }];
  const alerts = consolidateProjectVaultAlerts({ controlPresupuestalAlerts });
  assert.equal(alerts[0].priority, 'CRITICA');
  assert.equal(alerts[0].source, 'CONTROL_PRESUPUESTAL');
});

test('Bid Risk LOW se descarta de la bandeja consolidada (ruido), HIGH/CRITICAL si aparecen', () => {
  const bidRiskProject = { topRisks: [
    { apuId: 'A1', concept: 'Bajo', severity: 'LOW', estimatedExposure: 100 },
    { apuId: 'A2', concept: 'Alto', severity: 'HIGH', estimatedExposure: 5000 }
  ] };
  const alerts = consolidateProjectVaultAlerts({ bidRiskProject });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].apuId, 'A2');
  assert.equal(alerts[0].priority, 'ALTA');
});

test('Confidence LOW -> MEDIA, INSUFFICIENT_EVIDENCE -> ALTA (peor que solo bajo, no hay con que evaluar)', () => {
  const confidenceProject = { perApu: [
    { apuId: 'A1', concept: 'Bajo', status: 'LOW', score: 40 },
    { apuId: 'A2', concept: 'Sin evidencia', status: 'INSUFFICIENT_EVIDENCE', score: null },
    { apuId: 'A3', concept: 'Alto', status: 'HIGH', score: 90 }
  ] };
  const alerts = consolidateProjectVaultAlerts({ confidenceProject });
  assert.equal(alerts.length, 2, 'HIGH no genera alerta');
  const byApu = Object.fromEntries(alerts.map(a => [a.apuId, a.priority]));
  assert.equal(byApu.A1, 'MEDIA');
  assert.equal(byApu.A2, 'ALTA');
});

test('la bandeja consolidada se ordena por prioridad, CRITICA primero', () => {
  const controlPresupuestalAlerts = [{ severity: 'LOW', message: 'baja' }, { severity: 'CRITICAL', message: 'critica' }];
  const bidRiskProject = { topRisks: [{ apuId: 'A1', concept: 'x', severity: 'MEDIUM', estimatedExposure: 0 }] };
  const alerts = consolidateProjectVaultAlerts({ controlPresupuestalAlerts, bidRiskProject });
  const priorities = alerts.map(a => a.priority);
  const rank = { CRITICA: 4, ALTA: 3, MEDIA: 2, BAJA: 1 };
  for(let i = 1; i < priorities.length; i++) assert.ok(rank[priorities[i - 1]] >= rank[priorities[i]]);
});
