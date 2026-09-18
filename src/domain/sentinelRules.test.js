import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSentinelRules } from './sentinelRules.js';
import { validateSentinelAlert, SENTINEL_ALERT_TYPE as TYPE, ALERT_SEVERITY as SEV } from './sentinelAlertSchema.js';

function baseRow(overrides = {}){
  return { conceptoId: 'C1', clave: 'ALB-1', concept: 'Muro', unit: 'm²', presupuestoVigente: 10000, comprometido: 0, ejecutado: 0, avanceFisicoPct: null, avanceFinancieroPct: null, desviacionFisicoFinanciero: null, ...overrides };
}

test('sin ningun insumo, no genera ninguna alerta (nunca lanza)', () => {
  assert.deepEqual(evaluateSentinelRules({ projectId: 'PRO-1' }), []);
});

test('toda alerta generada es VALIDA (siempre trae actionRoute -- seccion 8: nunca sin ruta)', () => {
  const alerts = evaluateSentinelRules({
    projectId: 'PRO-1',
    controlPresupuestalRows: [baseRow({ comprometido: 9600, presupuestoVigente: 10000 })],
    controlPresupuestalTotals: { vigente: 10000, eac: 15000, variacion: 5000, variacionPct: 50 },
    changeOrders: [{ id: 'CO-1', folio: 'CO-001', status: 'EN_REVISION', concept: 'x' }]
  });
  assert.ok(alerts.length > 0);
  alerts.forEach(a => assert.equal(validateSentinelAlert(a).valid, true, `alerta invalida: ${JSON.stringify(a)}`));
});

test('PRESUPUESTO_POR_AGOTARSE: <=5% disponible -> ALTA; <=15% -> MEDIA; >15% no alerta; ya agotado (<=0%) no es esta regla', () => {
  const rows = [
    baseRow({ conceptoId: 'C-ALTA', presupuestoVigente: 10000, comprometido: 9600, ejecutado: 0 }), // 4% disponible
    baseRow({ conceptoId: 'C-MEDIA', presupuestoVigente: 10000, comprometido: 8800, ejecutado: 0 }), // 12% disponible
    baseRow({ conceptoId: 'C-SANO', presupuestoVigente: 10000, comprometido: 5000, ejecutado: 0 }), // 50% disponible
    baseRow({ conceptoId: 'C-AGOTADO', presupuestoVigente: 10000, comprometido: 10500, ejecutado: 0 }) // ya negativo
  ];
  const alerts = evaluateSentinelRules({ projectId: 'PRO-1', controlPresupuestalRows: rows }).filter(a => a.alertType === TYPE.PRESUPUESTO_POR_AGOTARSE);
  const byId = Object.fromEntries(alerts.map(a => [a.affectedEntity.id, a.severity]));
  assert.equal(byId['C-ALTA'], SEV.ALTA);
  assert.equal(byId['C-MEDIA'], SEV.MEDIA);
  assert.equal(byId['C-SANO'], undefined);
  assert.equal(byId['C-AGOTADO'], undefined, 'ya agotado es CONCEPTO_AGOTADO de Fase E, no esta regla');
});

test('FORECAST_SOBRE_PRESUPUESTO: umbrales 5/15/30% documentados', () => {
  const sev = (variacionPct) => evaluateSentinelRules({ projectId: 'PRO-1', controlPresupuestalTotals: { vigente: 10000, eac: 10000 * (1 + variacionPct / 100), variacion: 0, variacionPct } })
    .find(a => a.alertType === TYPE.FORECAST_SOBRE_PRESUPUESTO)?.severity;
  assert.equal(sev(3), SEV.BAJA);
  assert.equal(sev(10), SEV.MEDIA);
  assert.equal(sev(20), SEV.ALTA);
  assert.equal(sev(35), SEV.CRITICA);
  assert.equal(sev(-5), undefined, 'variacion negativa (bajo presupuesto) nunca genera esta alerta');
});

test('AVANCE_FISICO_RETRASADO vs AVANCE_FINANCIERO_DESALINEADO: misma desviacion, direccion opuesta', () => {
  const rows = [
    baseRow({ conceptoId: 'C-ATRASO', avanceFisicoPct: 20, avanceFinancieroPct: 50, desviacionFisicoFinanciero: -30 }),
    baseRow({ conceptoId: 'C-DESALINEADO', avanceFisicoPct: 60, avanceFinancieroPct: 20, desviacionFisicoFinanciero: 40 }),
    baseRow({ conceptoId: 'C-OK', avanceFisicoPct: 50, avanceFinancieroPct: 48, desviacionFisicoFinanciero: 2 })
  ];
  const alerts = evaluateSentinelRules({ projectId: 'PRO-1', controlPresupuestalRows: rows });
  assert.ok(alerts.some(a => a.alertType === TYPE.AVANCE_FISICO_RETRASADO && a.affectedEntity.id === 'C-ATRASO'));
  assert.ok(alerts.some(a => a.alertType === TYPE.AVANCE_FINANCIERO_DESALINEADO && a.affectedEntity.id === 'C-DESALINEADO'));
  assert.ok(!alerts.some(a => a.affectedEntity?.id === 'C-OK'), 'una desviacion pequeña (2pp) no genera alerta');
});

test('COMPROMISO_EXCESIVO reusa las alertas ya calculadas por Control Presupuestal, nunca reevalua', () => {
  const controlPresupuestalAlerts = [{ type: 'COMPROMETIDO_EXCESIVO', severity: 'MEDIUM', conceptoId: 'C1', message: 'x' }, { type: 'SOBREPRESUPUESTO', severity: 'CRITICAL', message: 'y' }];
  const alerts = evaluateSentinelRules({ projectId: 'PRO-1', controlPresupuestalAlerts });
  assert.equal(alerts.filter(a => a.alertType === TYPE.COMPROMISO_EXCESIVO).length, 1, 'solo el tipo COMPROMETIDO_EXCESIVO se traduce, no cualquier alerta de Control Presupuestal');
});

test('SOBRECONSUMO_CONCEPTO: solo las filas con hasOverconsumption:true generan alerta', () => {
  const overconsumptionRows = [
    { resourceKey: 'R1', descripcion: 'Cemento', hasOverconsumption: true, severity: SEV.ALTA, comparisonLabel: 'comprada', actual: 120, presupuestada: 100, desviacionPct: 20, fuente: 'comprometido', impactoEstimado: 500 },
    { resourceKey: 'R2', descripcion: 'Grava', hasOverconsumption: false }
  ];
  const alerts = evaluateSentinelRules({ projectId: 'PRO-1', overconsumptionRows });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].affectedEntity.id, 'R1');
});

test('ORDEN_CAMBIO_PENDIENTE: solo EN_REVISION genera alerta', () => {
  const changeOrders = [{ id: 'CO-1', status: 'EN_REVISION' }, { id: 'CO-2', status: 'APROBADA' }, { id: 'CO-3', status: 'BORRADOR' }];
  const alerts = evaluateSentinelRules({ projectId: 'PRO-1', changeOrders }).filter(a => a.alertType === TYPE.ORDEN_CAMBIO_PENDIENTE);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].affectedEntity.id, 'CO-1');
});

test('PRECIO_ANOMALO reusa Bid Risk (categorias PRICE_WITHOUT_EVIDENCE/REGIONAL_PRICE_RISK), nunca recompara precios', () => {
  const bidRiskProject = { topRisks: [
    { apuId: 'A1', concept: 'x', severity: 'CRITICAL', estimatedExposure: 1000, topFindings: [{ category: 'PRICE_WITHOUT_EVIDENCE', description: 'd', reason: 'r', recommendation: 'rec' }] },
    { apuId: 'A2', concept: 'y', severity: 'HIGH', estimatedExposure: 200, topFindings: [{ category: 'AGGRESSIVE_PRODUCTIVITY' }] }
  ] };
  const alerts = evaluateSentinelRules({ projectId: 'PRO-1', bidRiskProject }).filter(a => a.alertType === TYPE.PRECIO_ANOMALO);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].affectedEntity.id, 'A1');
  assert.equal(alerts[0].severity, SEV.CRITICA);
});

test('CONFIANZA_PRECIO_BAJA: LOW -> MEDIA, INSUFFICIENT_EVIDENCE -> ALTA', () => {
  const confidenceProject = { perApu: [{ apuId: 'A1', concept: 'x', status: 'LOW', score: 40 }, { apuId: 'A2', concept: 'y', status: 'INSUFFICIENT_EVIDENCE', score: null }, { apuId: 'A3', concept: 'z', status: 'HIGH', score: 90 }] };
  const alerts = evaluateSentinelRules({ projectId: 'PRO-1', confidenceProject }).filter(a => a.alertType === TYPE.CONFIANZA_PRECIO_BAJA);
  assert.equal(alerts.length, 2);
  assert.equal(alerts.find(a => a.affectedEntity.id === 'A1').severity, SEV.MEDIA);
  assert.equal(alerts.find(a => a.affectedEntity.id === 'A2').severity, SEV.ALTA);
});

test('DOCUMENTO_FALTANTE y DATO_CRITICO_SIN_CONFIRMAR leen la calidad de datos de Fase F, nunca recalculan', () => {
  const dataQuality = { dimensions: [
    { key: 'documentos', label: 'Documentos', present: false },
    { key: 'ubicacion', label: 'Ubicación', present: false },
    { key: 'presupuesto', label: 'Presupuesto', present: true }
  ] };
  const alerts = evaluateSentinelRules({ projectId: 'PRO-1', dataQuality });
  assert.ok(alerts.some(a => a.alertType === TYPE.DOCUMENTO_FALTANTE));
  assert.ok(alerts.some(a => a.alertType === TYPE.DATO_CRITICO_SIN_CONFIRMAR && a.affectedEntity.id === 'ubicacion'));
  assert.ok(!alerts.some(a => a.alertType === TYPE.DATO_CRITICO_SIN_CONFIRMAR && a.affectedEntity.id === 'presupuesto'));
});

test('ESTIMACION_PENDIENTE: escalada por edad real (dias desde createdAt) -- BAJA >7d, MEDIA >14d, ALTA >30d', () => {
  const now = '2026-03-01T00:00:00.000Z';
  const estimates = [
    { id: 'E1', numero: 1, status: 'BORRADOR', createdAt: '2026-02-27T00:00:00.000Z', importeBruto: 100, totalEstimado: 100 }, // 2 dias, no alerta
    { id: 'E2', numero: 2, status: 'BORRADOR', createdAt: '2026-02-20T00:00:00.000Z', importeBruto: 100, totalEstimado: 100 }, // 9 dias, BAJA
    { id: 'E3', numero: 3, status: 'BORRADOR', createdAt: '2026-02-10T00:00:00.000Z', importeBruto: 100, totalEstimado: 100 }, // 19 dias, MEDIA
    { id: 'E4', numero: 4, status: 'BORRADOR', createdAt: '2026-01-01T00:00:00.000Z', importeBruto: 100, totalEstimado: 100 } // 59 dias, ALTA
  ];
  const alerts = evaluateSentinelRules({ projectId: 'PRO-1', estimates, now }).filter(a => a.alertType === TYPE.ESTIMACION_PENDIENTE);
  const byId = Object.fromEntries(alerts.map(a => [a.affectedEntity.id, a.severity]));
  assert.equal(byId.E1, undefined);
  assert.equal(byId.E2, SEV.BAJA);
  assert.equal(byId.E3, SEV.MEDIA);
  assert.equal(byId.E4, SEV.ALTA);
});

test('PAGO_PENDIENTE: solo estimaciones AUTORIZADA con saldo real sin pagar (prorrateo de pagos reales)', () => {
  const estimates = [
    { id: 'E1', numero: 1, status: 'AUTORIZADA', totalEstimado: 1000 },
    { id: 'E2', numero: 2, status: 'AUTORIZADA', totalEstimado: 500 },
    { id: 'E3', numero: 3, status: 'BORRADOR', totalEstimado: 999 }
  ];
  const payments = [{ estimacionId: 'E1', monto: 1000 }, { estimacionId: 'E2', monto: 100 }];
  const alerts = evaluateSentinelRules({ projectId: 'PRO-1', estimates, payments }).filter(a => a.alertType === TYPE.PAGO_PENDIENTE);
  assert.equal(alerts.length, 1, 'E1 ya esta completamente pagada, E3 no esta autorizada -- solo E2 queda pendiente');
  assert.equal(alerts[0].affectedEntity.id, 'E2');
  assert.ok(Math.abs(alerts[0].evidence.saldo - 400) < 1e-6);
});

test('CAMBIO_PROJECT_HEALTH: solo si la diferencia contra el ultimo snapshot supera 8 puntos; sin snapshot previo, nunca alerta', () => {
  const health = { score: 60, level: 'RIESGO', drivers: [{ key: 'costos' }] };
  const sinPrevio = evaluateSentinelRules({ projectId: 'PRO-1', health, previousHealthSnapshot: null });
  assert.ok(!sinPrevio.some(a => a.alertType === TYPE.CAMBIO_PROJECT_HEALTH));

  const pequeñoCambio = evaluateSentinelRules({ projectId: 'PRO-1', health, previousHealthSnapshot: { score: 65, level: 'ATENCION' } });
  assert.ok(!pequeñoCambio.some(a => a.alertType === TYPE.CAMBIO_PROJECT_HEALTH));

  const empeoro = evaluateSentinelRules({ projectId: 'PRO-1', health, previousHealthSnapshot: { score: 85, level: 'SALUDABLE' } });
  const alertaEmpeoro = empeoro.find(a => a.alertType === TYPE.CAMBIO_PROJECT_HEALTH);
  assert.ok(alertaEmpeoro);
  assert.equal(alertaEmpeoro.severity, SEV.ALTA, 'una caida de 25 puntos es severidad ALTA (>=20)');

  const mejoro = evaluateSentinelRules({ projectId: 'PRO-1', health: { score: 90, level: 'SALUDABLE' }, previousHealthSnapshot: { score: 60, level: 'RIESGO' } });
  assert.equal(mejoro.find(a => a.alertType === TYPE.CAMBIO_PROJECT_HEALTH).severity, SEV.INFO, 'una mejora nunca se marca como problema, es informativa');
});

test('Garantias: POR_VENCER/VENCIDA/DOCUMENTACION_GARANTIA_FALTANTE usan el MISMO motor Sentinel', () => {
  const componentsWithWarrantyStatus = [
    { id: 'CMP-1', nombre: 'Bomba', warrantyStatus: 'POR_VENCER', diasRestantes: 10, documentoGarantiaUrl: null },
    { id: 'CMP-2', nombre: 'Elevador', warrantyStatus: 'VENCIDA', diasRestantes: -30, documentoGarantiaUrl: 'https://x' },
    { id: 'CMP-3', nombre: 'HVAC', warrantyStatus: 'VIGENTE', diasRestantes: 300, documentoGarantiaUrl: 'https://x' }
  ];
  const alerts = evaluateSentinelRules({ projectId: 'PRO-1', componentsWithWarrantyStatus });
  assert.ok(alerts.some(a => a.alertType === TYPE.GARANTIA_POR_VENCER && a.affectedEntity.id === 'CMP-1' && a.severity === SEV.ALTA));
  assert.ok(alerts.some(a => a.alertType === TYPE.GARANTIA_VENCIDA && a.affectedEntity.id === 'CMP-2'));
  assert.ok(alerts.some(a => a.alertType === TYPE.DOCUMENTACION_GARANTIA_FALTANTE && a.affectedEntity.id === 'CMP-1'), 'CMP-1 no tiene documento adjunto');
  assert.ok(!alerts.some(a => a.alertType === TYPE.DOCUMENTACION_GARANTIA_FALTANTE && a.affectedEntity.id === 'CMP-2'), 'CMP-2 si tiene documento adjunto');
  assert.ok(!alerts.some(a => a.affectedEntity?.id === 'CMP-3'), 'garantia vigente sin problema nunca genera alerta de garantia');
});
