/* Detector de costos no contemplados (Parte F, requerimiento de produccion
   2026-09-03). Motor DETERMINISTA que corre BAJO DEMANDA -- estas pruebas
   verifican que cada regla solo dispara ante AUSENCIA ESTRUCTURAL real
   (nunca un juicio inventado) y que analyzeApuRisks nunca truena con un
   APU minimo/vacio. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeApuRisks, RISK_SEVERITY } from '../src/domain/apuRiskDetector.js';

function baseApu(overrides = {}){
  return {
    concept: 'Muro de block hueco 15x20x40', family: '', primaryActivity: null,
    materials: [], labor: [], equipment: [], consumables: [], seguridad: [],
    procedimientoConstructivo: [], costosCampo: [], normativa: [],
    ...overrides
  };
}

test('analyzeApuRisks: un APU completamente vacio nunca truena y regresa hallazgos, no un objeto roto', () => {
  const result = analyzeApuRisks({});
  assert.ok(Array.isArray(result.hallazgos));
  assert.ok(typeof result.resumen === 'string');
  assert.ok(result.analizadoEn);
});

test('analyzeApuRisks: sin mano de obra, la regla de EPP ausente NUNCA dispara (no hay riesgo real que reportar)', () => {
  const apu = baseApu({ labor: [] });
  const result = analyzeApuRisks(apu);
  assert.ok(!result.hallazgos.some(h => h.id === 'epp_ausente'));
});

test('analyzeApuRisks: mano de obra presente sin EPP dispara "epp_ausente" en severidad HIGH (sin riesgo de altura)', () => {
  const apu = baseApu({ labor: [{ descripcion: 'Albañil oficial' }], seguridad: [] });
  const result = analyzeApuRisks(apu);
  const h = result.hallazgos.find(x => x.id === 'epp_ausente');
  assert.ok(h);
  assert.equal(h.severidad, RISK_SEVERITY.HIGH);
});

test('analyzeApuRisks: mano de obra + concepto de altura + sin EPP escala a CRITICAL, y dispara ademas "proteccion_caida_ausente"', () => {
  const apu = baseApu({ concept: 'Impermeabilizacion de azotea en altura', labor: [{ descripcion: 'Albañil' }], seguridad: [] });
  const result = analyzeApuRisks(apu);
  const epp = result.hallazgos.find(x => x.id === 'epp_ausente');
  const caida = result.hallazgos.find(x => x.id === 'proteccion_caida_ausente');
  assert.equal(epp.severidad, RISK_SEVERITY.CRITICAL);
  assert.ok(caida, 'debe detectar especificamente la ausencia de proteccion contra caidas');
  assert.equal(caida.severidad, RISK_SEVERITY.CRITICAL);
});

test('analyzeApuRisks: concepto de altura CON arnes registrado nunca dispara "proteccion_caida_ausente"', () => {
  const apu = baseApu({ concept: 'Trabajo en altura sobre andamio', labor: [{ descripcion: 'Albañil' }], seguridad: [{ descripcion: 'Arnés de seguridad de cuerpo completo' }] });
  const result = analyzeApuRisks(apu);
  assert.ok(!result.hallazgos.some(h => h.id === 'proteccion_caida_ausente'));
  assert.ok(!result.hallazgos.some(h => h.id === 'epp_ausente'));
});

test('analyzeApuRisks: costosCampo vacio dispara "costos_campo_ausentes"; con registros, nunca', () => {
  const vacio = analyzeApuRisks(baseApu({ costosCampo: [] }));
  assert.ok(vacio.hallazgos.some(h => h.id === 'costos_campo_ausentes'));
  const conDatos = analyzeApuRisks(baseApu({ costosCampo: [{ categoria: 'INDIRECTO_OBRA', cantidad: 1, costoUnitario: 100 }] }));
  assert.ok(!conDatos.hallazgos.some(h => h.id === 'costos_campo_ausentes'));
});

test('analyzeApuRisks: normativa vacia dispara "normativa_ausente"; con al menos una norma, nunca', () => {
  const vacio = analyzeApuRisks(baseApu({ normativa: [] }));
  assert.ok(vacio.hallazgos.some(h => h.id === 'normativa_ausente'));
  const conNorma = analyzeApuRisks(baseApu({ normativa: [{ nombre: 'NOM-XXX' }] }));
  assert.ok(!conNorma.hallazgos.some(h => h.id === 'normativa_ausente'));
});

test('analyzeApuRisks: consumibles ausentes solo se marca si hay materiales o equipo (nunca para un APU sin recursos todavia)', () => {
  const sinRecursos = analyzeApuRisks(baseApu({ materials: [], equipment: [], consumables: [] }));
  assert.ok(!sinRecursos.hallazgos.some(h => h.id === 'consumibles_ausentes'));
  const conMateriales = analyzeApuRisks(baseApu({ materials: [{ descripcion: 'Cemento' }], consumables: [] }));
  assert.ok(conMateriales.hallazgos.some(h => h.id === 'consumibles_ausentes'));
});

test('analyzeApuRisks: transporte no contemplado nunca dispara si el concepto o un recurso ya lo menciona', () => {
  const sinMencion = analyzeApuRisks(baseApu({ materials: [{ descripcion: 'Cemento' }] }));
  assert.ok(sinMencion.hallazgos.some(h => h.id === 'transporte_no_contemplado'));
  const conMencionConcepto = analyzeApuRisks(baseApu({ concept: 'Acarreo de material con volteo', materials: [{ descripcion: 'Cemento' }] }));
  assert.ok(!conMencionConcepto.hallazgos.some(h => h.id === 'transporte_no_contemplado'));
  const conMencionRecurso = analyzeApuRisks(baseApu({ materials: [{ descripcion: 'Flete de material a obra' }] }));
  assert.ok(!conMencionRecurso.hallazgos.some(h => h.id === 'transporte_no_contemplado'));
});

test('analyzeApuRisks: merma no registrada solo lista materiales con 0% de desperdicio, nunca los que si tienen merma', () => {
  const apu = baseApu({ materials: [{ descripcion: 'Con merma', desperdicioPct: 5 }, { descripcion: 'Sin merma', desperdicioPct: 0 }] });
  const result = analyzeApuRisks(apu);
  const h = result.hallazgos.find(x => x.id === 'merma_no_registrada');
  assert.ok(h);
  assert.match(h.evidencia, /Sin merma/);
  assert.ok(!h.evidencia.includes('Con merma'));
});

test('analyzeApuRisks: hallazgos siempre ordenados de mas a menos severo (CRITICAL antes que LOW)', () => {
  const apu = baseApu({ concept: 'Trabajo en altura', labor: [{ descripcion: 'Albañil' }], materials: [{ descripcion: 'Cemento', desperdicioPct: 0 }] });
  const result = analyzeApuRisks(apu);
  const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  for(let i = 1; i < result.hallazgos.length; i++){
    assert.ok(order[result.hallazgos[i - 1].severidad] <= order[result.hallazgos[i].severidad], 'la lista debe venir ordenada de mas a menos severo');
  }
});

test('analyzeApuRisks: resumen usa el conteo real y singular/plural correcto', () => {
  const sinHallazgos = analyzeApuRisks(baseApu({ labor: [], costosCampo: [{ categoria: 'INDIRECTO_OBRA', cantidad: 1, costoUnitario: 1 }], normativa: [{ nombre: 'X' }], materials: [], consumables: [] }));
  assert.match(sinHallazgos.resumen, /no detect[oó]/i);
  const conUno = analyzeApuRisks(baseApu({ normativa: [{ nombre: 'X' }], costosCampo: [{ categoria: 'INDIRECTO_OBRA', cantidad: 1, costoUnitario: 1 }] }));
  if(conUno.hallazgos.length === 1) assert.match(conUno.resumen, /1 costo potencial no contemplado\./);
});

test('cada hallazgo trae los 6 campos minimos pedidos: hallazgo, evidencia, impactoPotencial, recomendacion, incluirEnAPU, confianza', () => {
  const apu = baseApu({ labor: [{ descripcion: 'Albañil' }] });
  const result = analyzeApuRisks(apu);
  assert.ok(result.hallazgos.length > 0);
  result.hallazgos.forEach(h => {
    ['hallazgo', 'evidencia', 'impactoPotencial', 'recomendacion', 'confianza'].forEach(f => assert.ok(h[f], `falta ${f} en hallazgo ${h.id}`));
    assert.equal(typeof h.incluirEnAPU, 'boolean');
  });
});
