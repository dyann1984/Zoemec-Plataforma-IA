import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALERT_SEVERITY, ALERT_STATUS, SENTINEL_ALERT_TYPE, isLegalSentinelAlertTransition,
  computeAlertIdentity, makeSentinelAlert, validateSentinelAlert
} from './sentinelAlertSchema.js';

test('computeAlertIdentity es estable: projectId + alertType + entidad afectada -- el mismo triple siempre produce el mismo id', () => {
  const a = computeAlertIdentity({ projectId: 'PRO-1', alertType: 'FORECAST_SOBRE_PRESUPUESTO', affectedEntity: { type: 'CONCEPTO', id: 'C-1' } });
  const b = computeAlertIdentity({ projectId: 'PRO-1', alertType: 'FORECAST_SOBRE_PRESUPUESTO', affectedEntity: { type: 'CONCEPTO', id: 'C-1' } });
  assert.equal(a, b);
});

test('computeAlertIdentity distingue por entidad afectada -- dos conceptos distintos nunca colisionan', () => {
  const a = computeAlertIdentity({ projectId: 'PRO-1', alertType: 'COMPROMISO_EXCESIVO', affectedEntity: { type: 'CONCEPTO', id: 'C-1' } });
  const b = computeAlertIdentity({ projectId: 'PRO-1', alertType: 'COMPROMISO_EXCESIVO', affectedEntity: { type: 'CONCEPTO', id: 'C-2' } });
  assert.notEqual(a, b);
});

test('computeAlertIdentity sin entidad afectada (alerta de proyecto completo) usa un sufijo fijo PROJECT', () => {
  const a = computeAlertIdentity({ projectId: 'PRO-1', alertType: 'CAMBIO_PROJECT_HEALTH', affectedEntity: null });
  assert.ok(a.endsWith('PROJECT'));
});

test('makeSentinelAlert arranca en NUEVA con firstDetectedAt/lastSeenAt/id derivados de la identidad', () => {
  const a = makeSentinelAlert({
    projectId: 'PRO-1', alertType: SENTINEL_ALERT_TYPE.FORECAST_SOBRE_PRESUPUESTO, severity: ALERT_SEVERITY.ALTA,
    title: 'Forecast excede presupuesto vigente', message: 'x', actionRoute: { module: 'control-presupuestal' }
  });
  assert.equal(a.status, ALERT_STATUS.NUEVA);
  assert.ok(a.firstDetectedAt);
  assert.equal(a.id, a.identity);
});

test('validateSentinelAlert exige projectId, alertType/severity/status validos, titulo y ruta de accion (seccion 8: nunca sin ruta)', () => {
  const base = makeSentinelAlert({ projectId: 'PRO-1', alertType: SENTINEL_ALERT_TYPE.PAGO_PENDIENTE, severity: ALERT_SEVERITY.MEDIA, title: 'x', actionRoute: { module: 'control-presupuestal' } });
  assert.equal(validateSentinelAlert(base).valid, true);
  assert.equal(validateSentinelAlert({ ...base, projectId: null }).valid, false);
  assert.equal(validateSentinelAlert({ ...base, alertType: 'INVENTADO' }).valid, false);
  assert.equal(validateSentinelAlert({ ...base, actionRoute: null }).valid, false, 'sin ruta de accion, nunca es valida');
});

test('transiciones: NUEVA -> EN_REVISION/RESUELTA/DESCARTADA legales; RESUELTA y DESCARTADA son terminales para el usuario', () => {
  assert.equal(isLegalSentinelAlertTransition('NUEVA', 'EN_REVISION'), true);
  assert.equal(isLegalSentinelAlertTransition('NUEVA', 'RESUELTA'), true);
  assert.equal(isLegalSentinelAlertTransition('NUEVA', 'DESCARTADA'), true);
  assert.equal(isLegalSentinelAlertTransition('EN_REVISION', 'NUEVA'), true, 'se puede reabrir explicitamente desde revision');
  assert.equal(isLegalSentinelAlertTransition('RESUELTA', 'NUEVA'), false, 'una alerta resuelta por el usuario no se reabre manualmente -- eso lo hace el reconciliador si la condicion reaparece');
  assert.equal(isLegalSentinelAlertTransition('DESCARTADA', 'EN_REVISION'), false);
});
