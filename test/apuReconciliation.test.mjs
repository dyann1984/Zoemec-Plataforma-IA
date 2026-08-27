import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileAPU, DEFAULT_RECONCILIATION_TOLERANCE } from '../src/lib/apuReconciliation.js';
import { makeEmptyAPUv2 } from '../src/domain/apuSchema.js';
import { calcAPUv2 } from '../src/lib/apuCalc.js';

function realApu(){
  const apu = makeEmptyAPUv2();
  Object.assign(apu, { concept: 'Muro de block hueco', unit: 'm²', cantidadObra: 25 });
  apu.materials = [{ clave: 'MAT-001', descripcion: 'Block hueco', unidad: 'pza', consumo: 12.5, desperdicioPct: 5, precioUnitario: 15.5, fuente: {} }];
  apu.labor = [{ clave: 'MO-001', descripcion: 'Albañil', unidad: 'jor', cuadrilla: 2, rendimiento: 8, salarioBase: 400, fsr: 1.85, fuente: {} }];
  apu.equipment = [{ clave: 'EQ-001', descripcion: 'Andamio', unidad: 'día', cantidad: 1, tarifa: 120, fuente: {} }];
  apu.herramientaMenor = { modo: 'porcentaje', porcentaje: 3, detalle: [] };
  apu.factores = { indCampo: 8, indOficina: 6, finance: 1.5, utility: 10, cargos: 0, iva: 16 };
  return apu;
}

test('reconcileAPU: un APU real y coherente pasa los dos controles sin claimedTotals', () => {
  const result = reconcileAPU(realApu());
  assert.equal(result.ok, true);
  assert.deepEqual(result.diffs, []);
});

test('reconcileAPU: SUMA(insumos) siempre coincide con costo directo (correcto por construccion en calcAPUv2)', () => {
  const apu = realApu();
  const fresh = calcAPUv2(apu);
  const sumaInsumos = fresh.mat + fresh.mo + fresh.equipo + fresh.herramienta + fresh.consumibles + fresh.seguridad;
  assert.ok(Math.abs(sumaInsumos - fresh.direct) <= DEFAULT_RECONCILIATION_TOLERANCE);
});

test('reconcileAPU: claimedTotals desactualizado (de una version anterior del APU) se detecta como divergencia real', () => {
  const apu = realApu();
  const staleTotals = calcAPUv2(apu); // "lo que ya se exporto/guardo"
  // El usuario edita un renglon DESPUES de ese calculo (ej. sube el precio
  // del material) -- el documento ya exportado con staleTotals ahora
  // diverge del recalculo fresco.
  apu.materials[0].precioUnitario = 999;
  const result = reconcileAPU(apu, { claimedTotals: staleTotals });
  assert.equal(result.ok, false);
  assert.ok(result.diffs.some(d => d.code === 'totales_desactualizados'));
});

test('reconcileAPU: respeta la tolerancia configurada (diferencias diminutas de redondeo no cuentan como error)', () => {
  const apu = realApu();
  const fresh = calcAPUv2(apu);
  const almostSameTotals = { ...fresh, pu: fresh.pu + 0.005 };
  const result = reconcileAPU(apu, { claimedTotals: almostSameTotals, tolerance: 0.01 });
  assert.equal(result.ok, true);
});

test('reconcileAPU: una diferencia mayor a la tolerancia SI se reporta', () => {
  const apu = realApu();
  const fresh = calcAPUv2(apu);
  const wrongTotals = { ...fresh, pu: fresh.pu + 50 };
  const result = reconcileAPU(apu, { claimedTotals: wrongTotals, tolerance: 0.01 });
  assert.equal(result.ok, false);
  assert.ok(result.diffs.some(d => d.code === 'totales_desactualizados' && d.field === 'pu'));
});
