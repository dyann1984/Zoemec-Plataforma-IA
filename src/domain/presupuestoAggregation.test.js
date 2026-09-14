import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregatePresupuesto } from './presupuestoAggregation.js';
import { calcAPUv2 } from '../lib/apuCalc.js';

test('importe = cantidad x precio unitario por renglon', () => {
  const { rows } = aggregatePresupuesto([
    { conceptoId: 'C1', capitulo: 'CIMENTACION', qty: 10, pu: 500, direct: 300, apuId: 'A1' }
  ]);
  assert.equal(rows[0].importe, 5000);
  assert.equal(rows[0].directoImporte, 3000);
  assert.equal(rows[0].hasApu, true);
});

test('costoDirectoTotal e importeTotal suman sobre TODOS los renglones', () => {
  const { costoDirectoTotal, importeTotal } = aggregatePresupuesto([
    { capitulo: 'CIMENTACION', qty: 10, pu: 500, direct: 300, apuId: 'A1' },
    { capitulo: 'ALBANILERIA', qty: 20, pu: 200, direct: 120, apuId: 'A2' }
  ]);
  assert.equal(costoDirectoTotal, 10 * 300 + 20 * 120);
  assert.equal(importeTotal, 10 * 500 + 20 * 200);
});

test('subtotales agrupados por capitulo, en el orden fijo de PRESUPUESTO_CAPITULOS', () => {
  const { capituloSubtotals } = aggregatePresupuesto([
    { capitulo: 'ALBANILERIA', qty: 1, pu: 100, direct: 60, apuId: 'A1' },
    { capitulo: 'CIMENTACION', qty: 1, pu: 200, direct: 120, apuId: 'A2' },
    { capitulo: 'CIMENTACION', qty: 1, pu: 50, direct: 30, apuId: 'A3' }
  ]);
  assert.deepEqual(capituloSubtotals.map(c => c.capitulo), ['CIMENTACION', 'ALBANILERIA']);
  const cim = capituloSubtotals.find(c => c.capitulo === 'CIMENTACION');
  assert.equal(cim.importe, 250);
  assert.equal(cim.conceptCount, 2);
});

test('un concepto sin APU asociado (PENDIENTE) aparece con importe 0, nunca se excluye', () => {
  const { rows, capituloSubtotals } = aggregatePresupuesto([
    { capitulo: 'ACABADOS', qty: 5, apuId: null }
  ]);
  assert.equal(rows[0].hasApu, false);
  assert.equal(rows[0].importe, 0);
  assert.equal(capituloSubtotals.find(c => c.capitulo === 'ACABADOS').conceptCount, 1);
});

test('un capitulo desconocido/texto libre cae en OTROS, nunca rompe la agregacion', () => {
  const { capituloSubtotals } = aggregatePresupuesto([
    { capitulo: 'algo raro', qty: 1, pu: 10, direct: 5, apuId: 'A1' }
  ]);
  assert.deepEqual(capituloSubtotals.map(c => c.capitulo), ['OTROS']);
});

test('sin renglones, totales en 0 y sin subtotales', () => {
  const result = aggregatePresupuesto([]);
  assert.equal(result.costoDirectoTotal, 0);
  assert.equal(result.importeTotal, 0);
  assert.deepEqual(result.capituloSubtotals, []);
});

test('valores no numericos (NaN/undefined) nunca se propagan como NaN', () => {
  const { rows } = aggregatePresupuesto([
    { capitulo: 'CIMENTACION', qty: 'x', pu: undefined, direct: null, apuId: 'A1' }
  ]);
  assert.equal(rows[0].qty, 0);
  assert.equal(rows[0].importe, 0);
  assert.ok(Number.isFinite(rows[0].importe));
});

/* PRUEBA ESPECIFICA (Fase D.1, punto 6): con un APU real (calcAPUv2, MISMO
   motor que produce cada APU del catalogo) que tiene merma/indirectos/
   financiamiento/utilidad/cargos/IVA conocidos, confirma que el Presupuesto
   usa esos totales TAL CUAL -- nunca vuelve a aplicar ninguno de esos
   porcentajes una segunda vez. Si aggregatePresupuesto reaplicara merma o la
   cascada, el importe NO coincidiria con qty x apu.calculado.pu. */
test('el Presupuesto usa direct/pu del APU tal cual -- merma/indirectos/financiamiento/utilidad/cargos/IVA nunca se reaplican', () => {
  const apu = {
    cantidadObra: 1,
    materials: [{ descripcion: 'Cemento gris', consumo: 10, desperdicioPct: 10, precioUnitario: 100, unidad: 'saco', integracion: 'POR_UNIDAD_OBRA' }],
    labor: [{ descripcion: 'Albañil', cuadrilla: 1, rendimiento: 8, salarioBase: 380, fsr: 1.65 }],
    equipment: [], consumables: [], seguridad: [],
    factores: { indCampo: 8, indOficina: 7, finance: 2, utility: 10, cargos: 0.5, iva: 16 }
  };
  const totals = calcAPUv2(apu);
  // El material solo, con 10% de merma: 10 x 1.10 x 100 = 1100 -- confirma
  // que la merma YA esta adentro de `direct` antes de llegar al presupuesto.
  const materialConMerma = 10 * 1.10 * 100;
  assert.ok(totals.direct > materialConMerma, 'direct debe incluir tambien mano de obra, no solo el material');
  assert.ok(totals.pu > totals.direct, 'pu debe ser mayor a direct: ya trae indirectos/financiamiento/utilidad/cargos aplicados UNA vez');

  const qty = 25;
  const { rows, costoDirectoTotal, importeTotal } = aggregatePresupuesto([
    { conceptoId: 'C1', capitulo: 'ALBANILERIA', qty, pu: totals.pu, direct: totals.direct, iva: totals.iva, apuId: 'A1' }
  ]);

  // Formula unica permitida en esta capa: cantidad x P.U. = importe.
  assert.equal(rows[0].importe, qty * totals.pu);
  assert.equal(importeTotal, qty * totals.pu);
  assert.equal(costoDirectoTotal, qty * totals.direct);

  // Prueba negativa explicita: si esta capa reaplicara la cascada de
  // indirectos/utilidad/cargos (un bug de "doble aplicacion"), el importe
  // seria mayor que qty x pu -- nunca debe serlo.
  const pctCascadaTotal = (8 + 7 + 2 + 10 + 0.5) / 100; // suma de los mismos rubros, solo para construir el valor "incorrecto"
  const importeSiSeReaplicaraLaCascada = qty * totals.pu * (1 + pctCascadaTotal);
  assert.notEqual(rows[0].importe, importeSiSeReaplicaraLaCascada);

  // Prueba negativa explicita para merma: si el presupuesto volviera a
  // aplicar el 10% de desperdicio sobre el costo directo, costoDirectoTotal
  // no coincidiria con qty x direct.
  const costoDirectoSiSeReaplicaraLaMerma = qty * totals.direct * 1.10;
  assert.notEqual(costoDirectoTotal, costoDirectoSiSeReaplicaraLaMerma);

  // El IVA tampoco se recalcula aqui -- se preserva tal cual vino del APU
  // (solo informativo a este nivel, ver presupuestoAggregation.js).
  assert.equal(rows[0].iva, totals.iva);
});
