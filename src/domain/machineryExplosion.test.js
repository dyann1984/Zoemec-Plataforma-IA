import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMachineryExplosion, classifyEquipmentRow, MACHINERY_CATEGORY, summarizeMachineryExplosion } from './machineryExplosion.js';

function makeApu({ id, organizationId = 'org-1', cantidadObra = 1, equipment = [], labor = [], herramientaMenor }){
  return {
    id, organizationId, projectId: 'proj-1',
    snapshot: {
      clave: `APU-${id}`, concept: `Concepto ${id}`, cantidadObra, materials: [], labor, equipment,
      herramientaMenor: herramientaMenor || { modo: 'porcentaje', porcentaje: 3, detalle: [] }
    }
  };
}

test('TEST QA 7 -- clasificacion explicita y documentada de maquinaria vs equipo', () => {
  assert.equal(classifyEquipmentRow({ integracion: 'AMORTIZABLE' }), MACHINERY_CATEGORY.MAQUINARIA_PESADA);
  assert.equal(classifyEquipmentRow({ integracion: 'POR_JORNADA' }), MACHINERY_CATEGORY.MAQUINARIA_PESADA);
  assert.equal(classifyEquipmentRow({ integracion: 'POR_UNIDAD_OBRA' }), MACHINERY_CATEGORY.EQUIPO);
  assert.equal(classifyEquipmentRow({ integracion: 'POR_LOTE' }), MACHINERY_CATEGORY.EQUIPO);
  assert.equal(classifyEquipmentRow({}), MACHINERY_CATEGORY.EQUIPO); // default POR_UNIDAD_OBRA
});

test('TEST QA 7 -- maquinaria pesada (AMORTIZABLE) se consolida separada de equipo de apoyo', () => {
  const apu = makeApu({
    id: '1', cantidadObra: 100,
    equipment: [
      { clave: 'RETRO-01', descripcion: 'Retroexcavadora propia', unidad: 'm3', integracion: 'AMORTIZABLE', tarifa: 1500, cantidad: 1, factorUso: 1, vidaUtilDias: 1000, rendimientoDiario: 40, priceRecord: { confidence: 70 } },
      { clave: 'ANDAMIO-01', descripcion: 'Andamio tubular', unidad: 'm2', integracion: 'POR_UNIDAD_OBRA', tarifa: 5, cantidad: 1, priceRecord: { confidence: 50 } }
    ]
  });
  const { maquinaria, equipo } = buildMachineryExplosion([apu]);
  assert.equal(maquinaria.length, 1);
  assert.equal(equipo.length, 1);
  assert.equal(maquinaria[0].descripcion, 'Retroexcavadora propia');
  assert.equal(equipo[0].descripcion, 'Andamio tubular');
});

test('no mezcla herramienta menor dentro de maquinaria/equipo (estan modeladas por separado)', () => {
  const apu = makeApu({
    id: '1', cantidadObra: 10,
    equipment: [{ clave: 'EQ-1', descripcion: 'Vibrador de concreto', unidad: 'm3', integracion: 'POR_UNIDAD_OBRA', tarifa: 3, cantidad: 1 }],
    herramientaMenor: { modo: 'detalle', detalle: [{ clave: 'HM-1', descripcion: 'Cinceles y marros', unidad: 'jgo', cantidad: 1, valorAdquisicion: 500, depreciacionPct: 10 }] }
  });
  const { equipo, herramientaMenor } = buildMachineryExplosion([apu]);
  assert.equal(equipo.length, 1);
  assert.equal(herramientaMenor.length, 1);
  assert.notEqual(equipo[0].descripcion, herramientaMenor[0].descripcion);
});

test('TEST QA 8 -- herramienta menor modo detalle se consolida por clave a traves de varios APU', () => {
  const detalle = [{ clave: 'HM-CASCOS', descripcion: 'Set de herramienta manual', unidad: 'jgo', cantidad: 1, valorAdquisicion: 800, depreciacionPct: 15 }];
  const apu1 = makeApu({ id: '1', cantidadObra: 5, herramientaMenor: { modo: 'detalle', detalle } });
  const apu2 = makeApu({ id: '2', cantidadObra: 7, herramientaMenor: { modo: 'detalle', detalle } });
  const { herramientaMenor } = buildMachineryExplosion([apu1, apu2]);
  assert.equal(herramientaMenor.length, 1);
  assert.equal(herramientaMenor[0].apusOrigen.length, 2);
});

test('TEST QA 8 -- herramienta menor modo porcentaje consolida varios APU en UNA sola linea', () => {
  const labor = [{ descripcion: 'Oficial', unidad: 'jor', cantidad: 1, salarioBase: 400, fsr: 1 }];
  const apu1 = makeApu({ id: '1', cantidadObra: 10, labor, herramientaMenor: { modo: 'porcentaje', porcentaje: 3, detalle: [] } });
  const apu2 = makeApu({ id: '2', cantidadObra: 10, labor, herramientaMenor: { modo: 'porcentaje', porcentaje: 3, detalle: [] } });
  const { herramientaMenor } = buildMachineryExplosion([apu1, apu2]);
  assert.equal(herramientaMenor.length, 1);
  // 400 x 3% = 12 por unidad, x10 unidades x 2 APUs = 240
  assert.equal(herramientaMenor[0].importe, 240);
});

test('summarizeMachineryExplosion agrega las 3 categorias', () => {
  const apu = makeApu({
    id: '1', cantidadObra: 1,
    equipment: [{ clave: 'EQ-1', descripcion: 'Compactadora', unidad: 'm2', integracion: 'AMORTIZABLE', tarifa: 100, cantidad: 1, vidaUtilDias: 500, rendimientoDiario: 30, factorUso: 1 }]
  });
  const machinery = buildMachineryExplosion([apu]);
  const summary = summarizeMachineryExplosion(machinery);
  assert.equal(summary.totalMaquinaria, 1);
  assert.ok(summary.importeTotal > 0);
});

test('TEST QA 14 -- nunca consolida maquinaria de organizaciones distintas', () => {
  const apu1 = makeApu({ id: '1', organizationId: 'org-A' });
  const apu2 = makeApu({ id: '2', organizationId: 'org-B' });
  assert.throws(() => buildMachineryExplosion([apu1, apu2]), /organizaciones distintas/);
});
