import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEmptyActivity, ACTIVITY_ORIGIN } from './activitySchema.js';
import { generateActivitiesFromCatalog, detectVigentDivergence, applyVigentDivergence } from './programaFromCatalog.js';
import { CHANGE_ORDER_STATUS, makeEmptyChangeOrder } from './changeOrderSchema.js';

const brickWallApu = {
  id: 'APU-M01', laborDetails: [{ cuadrilla: 1, rendimiento: 45, jornada: 8 }]
};

test('generateActivitiesFromCatalog: crea 1 actividad por concepto con rendimiento del APU', () => {
  const rows = [
    { conceptoId: 'CAT-1', apuId: 'APU-M01', clave: 'M-01', concept: 'Muro tabique', unit: 'm²', qty: 12.51, pu: 748.15, capitulo: 'ALBANILERIA' }
  ];
  const { created, skipped } = generateActivitiesFromCatalog({
    rows, existingActivities: [], apusById: new Map([['APU-M01', brickWallApu]]), projectId: 'PRJ-1'
  });
  assert.equal(created.length, 1);
  assert.equal(skipped.length, 0);
  const a = created[0];
  assert.equal(a.projectId, 'PRJ-1');
  assert.equal(a.conceptoId, 'CAT-1');
  assert.equal(a.apuId, 'APU-M01');
  assert.equal(a.unit, 'm²');
  assert.equal(a.cantidad, 12.51);
  assert.equal(a.rendimiento, 45);
  assert.equal(a.origen, ACTIVITY_ORIGIN.CATALOG);
  assert.equal(a.rendimientoFuente, 'APU');
  assert.equal(a.cantidadVigenteSnapshot, 12.51);
});

test('dedupe: renglones con conceptoId ya existente en actividades se saltan', () => {
  const rows = [{ conceptoId: 'CAT-1', apuId: 'APU-M01', clave: 'M-01', concept: 'Muro', unit: 'm²', qty: 10, pu: 100 }];
  const existing = [makeEmptyActivity({ projectId: 'PRJ-1', conceptoId: 'CAT-1', name: 'ya' })];
  const { created, skipped } = generateActivitiesFromCatalog({ rows, existingActivities: existing, projectId: 'PRJ-1' });
  assert.equal(created.length, 0);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0], 'CAT-1');
});

test('renglon sin conceptoId se ignora', () => {
  const rows = [{ conceptoId: null, apuId: 'APU-1' }];
  const { created, skipped } = generateActivitiesFromCatalog({ rows, projectId: 'PRJ-1' });
  assert.equal(created.length, 0);
});

test('renglon sin APU: actividad se crea con rendimiento null (nunca inventa)', () => {
  const rows = [{ conceptoId: 'CAT-X', apuId: null, unit: 'pza', qty: 5, concept: 'x' }];
  const { created } = generateActivitiesFromCatalog({ rows, projectId: 'PRJ-1' });
  assert.equal(created.length, 1);
  assert.equal(created[0].rendimiento, null);
  assert.equal(created[0].rendimientoFuente, null);
});

test('origenElementoId se hereda cuando viene del renglon (puente Fase 1)', () => {
  const rows = [{ conceptoId: 'CAT-1', apuId: 'APU-M01', clave: 'M-01', concept: 'M', unit: 'm²', qty: 10, origenElementoId: 'survey:LEV-1:SPC-1:M-01' }];
  const { created } = generateActivitiesFromCatalog({ rows, apusById: new Map([['APU-M01', brickWallApu]]), projectId: 'PRJ-1' });
  assert.equal(created[0].origenElementoId, 'survey:LEV-1:SPC-1:M-01');
});

test('detectVigentDivergence: OC aprobada suma delta -> divergence.cantidadVigente refleja el cambio', () => {
  const a = makeEmptyActivity({ projectId: 'P', conceptoId: 'CAT-EXC', name: 'Exc', cantidad: 480, rendimiento: 60 });
  a.cantidadVigenteSnapshot = 480;
  const oc = { ...makeEmptyChangeOrder({ projectId: 'P', conceptoId: 'CAT-EXC', cantidadAnterior: 480, cantidadNueva: 520, pu: 100, motivo: 'x', descripcion: 'y' }), status: CHANGE_ORDER_STATUS.APROBADA };
  const div = detectVigentDivergence({ activity: a, changeOrders: [oc] });
  assert.ok(div);
  assert.equal(div.cantidadVigente, 520);
  assert.equal(div.delta, 40);
  // Duracion sugerida: 520/60 = 8.6666...
  assert.equal(Math.round(div.duracionSugerida * 100) / 100, 8.67);
  assert.equal(div.puedeAutoActualizar, true);
});

test('detectVigentDivergence: OC en BORRADOR no cuenta', () => {
  const a = makeEmptyActivity({ projectId: 'P', conceptoId: 'CAT-EXC', cantidad: 480, rendimiento: 60 });
  a.cantidadVigenteSnapshot = 480;
  const oc = makeEmptyChangeOrder({ projectId: 'P', conceptoId: 'CAT-EXC', cantidadAnterior: 480, cantidadNueva: 520, pu: 100, motivo: 'x', descripcion: 'y' });
  const div = detectVigentDivergence({ activity: a, changeOrders: [oc] });
  assert.equal(div, null);
});

test('detectVigentDivergence: si actividad tiene duracionEditadaManual=true, puedeAutoActualizar=false', () => {
  const a = makeEmptyActivity({ projectId: 'P', conceptoId: 'CAT-EXC', cantidad: 480, rendimiento: 60 });
  a.cantidadVigenteSnapshot = 480;
  a.duracionEditadaManual = true;
  const oc = { ...makeEmptyChangeOrder({ projectId: 'P', conceptoId: 'CAT-EXC', cantidadAnterior: 480, cantidadNueva: 520, pu: 100, motivo: 'x', descripcion: 'y' }), status: CHANGE_ORDER_STATUS.APROBADA };
  const div = detectVigentDivergence({ activity: a, changeOrders: [oc] });
  assert.ok(div);
  assert.equal(div.puedeAutoActualizar, false);
});

test('applyVigentDivergence: actualiza cantidad y duracion, guarda snapshot', () => {
  const a = makeEmptyActivity({ projectId: 'P', conceptoId: 'CAT-EXC', cantidad: 480, rendimiento: 60 });
  a.cantidadVigenteSnapshot = 480; a.duracion = 8;
  const div = { cantidadAnterior: 480, cantidadVigente: 520, delta: 40, duracionSugerida: 8.6667, duracionActual: 8, puedeAutoActualizar: true };
  const next = applyVigentDivergence(a, div);
  assert.equal(next.cantidad, 520);
  assert.equal(next.cantidadVigenteSnapshot, 520);
  assert.equal(Math.round(next.duracion * 100) / 100, 8.67);
});
