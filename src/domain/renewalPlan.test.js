import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRenewalPlan } from './renewalPlan.js';

test('sin componentes, todos los horizontes quedan vacios y sin total (nunca inventa un gasto)', () => {
  const plan = buildRenewalPlan([]);
  plan.horizons.forEach(h => { assert.equal(h.totalCost, 0); assert.equal(h.hasItems, false); });
  assert.deepEqual(plan.unreliableComponents, []);
});

test('componentes sin proyeccion confiable se listan aparte, nunca suman a ningun horizonte', () => {
  const rows = [{ componentId: 'C1', confiable: false, reason: 'Sin proyección confiable.' }];
  const plan = buildRenewalPlan(rows);
  assert.equal(plan.unreliableComponents.length, 1);
  plan.horizons.forEach(h => assert.equal(h.totalCost, 0));
});

test('un componente que vence en 6 meses aparece en next12Months, next3Years, next5Years y next10Years -- todos los horizontes que lo cubren', () => {
  const rows = [{ componentId: 'C1', confiable: true, aniosRestantes: 0, costoProyectado: 1000 }];
  const plan = buildRenewalPlan(rows);
  const byKey = Object.fromEntries(plan.horizons.map(h => [h.key, h]));
  assert.equal(byKey.next12Months.hasItems, true);
  assert.equal(byKey.next12Months.totalCost, 1000);
  assert.equal(byKey.next3Years.totalCost, 1000);
  assert.equal(byKey.next5Years.totalCost, 1000);
  assert.equal(byKey.next10Years.totalCost, 1000);
});

test('un componente que vence en 7 años solo aparece en next10Years', () => {
  const rows = [{ componentId: 'C1', confiable: true, aniosRestantes: 7, costoProyectado: 2000 }];
  const plan = buildRenewalPlan(rows);
  const byKey = Object.fromEntries(plan.horizons.map(h => [h.key, h]));
  assert.equal(byKey.next5Years.hasItems, false);
  assert.equal(byKey.next10Years.hasItems, true);
  assert.equal(byKey.next10Years.totalCost, 2000);
});
