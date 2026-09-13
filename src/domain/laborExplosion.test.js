import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLaborExplosion, laborEconomicView, laborResourceView, laborCategory, summarizeLaborExplosion } from './laborExplosion.js';

function makeApu({ id, organizationId = 'org-1', cantidadObra = 1, labor = [] }){
  return { id, organizationId, projectId: 'proj-1', snapshot: { clave: `APU-${id}`, concept: `Concepto ${id}`, cantidadObra, materials: [], labor, equipment: [], herramientaMenor: { modo: 'porcentaje', porcentaje: 0, detalle: [] } } };
}
function laborRow(overrides = {}){
  return {
    clave: 'MO-OFICIAL-ALBANIL', descripcion: 'Oficial albañil', unidad: 'jor',
    cuadrilla: 1, rendimiento: 8, jornada: 8, cantidad: 0,
    salarioBase: 400, fsr: 1.2, priceRecord: { confidence: 60 }, fuente: {},
    ...overrides
  };
}

test('laborCategory clasifica oficios conocidos sin sustituir la descripcion real', () => {
  assert.equal(laborCategory('Oficial albañil'), 'OFICIAL');
  assert.equal(laborCategory('Ayudante general'), 'AYUDANTE');
  assert.equal(laborCategory('Operador de retroexcavadora'), 'OPERADOR');
  assert.equal(laborCategory('Topógrafo'), 'ESPECIALISTA');
  assert.equal(laborCategory('Cocinero de campamento'), 'OTRO');
});

test('TEST QA 6 -- mano de obra repetida en varios APU se consolida en jornadas totales', () => {
  // cuadrilla=1, rendimiento=8 -> 1/8 jornada por unidad de concepto
  const apu1 = makeApu({ id: '1', cantidadObra: 656, labor: [laborRow()] }); // 656/8 = 82 jornadas
  const rows = buildLaborExplosion([apu1]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].totalJornadas, 82);
});

test('TEST QA 6 -- consolida el MISMO oficio a traves de varios APU (ejemplo del enunciado)', () => {
  const apuAlbanil = makeApu({ id: '1', cantidadObra: 656, labor: [laborRow()] }); // 82 jornadas
  const apuAyudante = makeApu({ id: '2', cantidadObra: 768, labor: [laborRow({ clave: 'MO-AYUDANTE', descripcion: 'Ayudante', rendimiento: 8 })] }); // 96 jornadas
  const rows = buildLaborExplosion([apuAlbanil, apuAyudante]);
  assert.equal(rows.length, 2);
  const albanil = rows.find(r => r.descripcion === 'Oficial albañil');
  const ayudante = rows.find(r => r.descripcion === 'Ayudante');
  assert.equal(Math.round(albanil.totalJornadas), 82);
  assert.equal(Math.round(ayudante.totalJornadas), 96);
});

test('dos vistas (Economica/Recursos) leen el MISMO motor, nunca recalculan distinto', () => {
  const apu = makeApu({ id: '1', cantidadObra: 16, labor: [laborRow()] });
  const rows = buildLaborExplosion([apu]);
  const economica = laborEconomicView(rows);
  const recursos = laborResourceView(rows);
  assert.equal(economica[0].jornadas, recursos[0].jornadas);
  assert.equal(economica[0].importe, rows[0].importe);
});

test('trabajadoresEquivalentes nunca se inventa sin duracion real del proyecto', () => {
  const apu = makeApu({ id: '1', cantidadObra: 16, labor: [laborRow()] });
  const rows = buildLaborExplosion([apu]);
  const sinDuracion = laborResourceView(rows);
  assert.equal(sinDuracion[0].trabajadoresEquivalentes, null);
  assert.ok(sinDuracion[0].trabajadoresEquivalentesNota);
  const conDuracion = laborResourceView(rows, { projectWorkingDays: 20 });
  assert.equal(conDuracion[0].trabajadoresEquivalentes, rows[0].totalJornadas / 20);
});

test('reconciliacion de mano de obra: la suma del desglose iguala el total (TEST QA 10)', () => {
  const apu1 = makeApu({ id: '1', cantidadObra: 10, labor: [laborRow({ salarioBase: 400 })] });
  const apu2 = makeApu({ id: '2', cantidadObra: 20, labor: [laborRow({ salarioBase: 450, priceRecord: { confidence: 90 } })] });
  const rows = buildLaborExplosion([apu1, apu2]);
  const suma = rows[0].origenes.reduce((s, o) => s + o.importeConsolidado, 0);
  assert.equal(suma, rows[0].importe);
});

test('summarizeLaborExplosion agrega totales', () => {
  const apu = makeApu({ id: '1', cantidadObra: 8, labor: [laborRow()] });
  const rows = buildLaborExplosion([apu]);
  const summary = summarizeLaborExplosion(rows);
  assert.equal(summary.totalOficios, 1);
  assert.equal(summary.totalJornadas, rows[0].totalJornadas);
});
