import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEmptyAPUv2 } from './apuSchema.js';
import { computeConceptStatus, CONCEPT_STATUS, conceptStatusLabel } from './apuCompletionStatus.js';

function fuente(estado){
  return { proveedor: estado === 'VERIFICADO' ? 'Proveedor real' : null, fecha: estado === 'VERIFICADO' ? '2026-01-01' : null, region: null, estado };
}

function baseApu(overrides = {}){
  const apu = makeEmptyAPUv2();
  Object.assign(apu, { concept: 'Concepto de prueba', unit: 'm²', cantidadObra: 10 }, overrides);
  return apu;
}

test('computeConceptStatus: APU vacio (sin renglones/concepto) es INCOMPLETO, no ERROR', () => {
  const apu = makeEmptyAPUv2();
  const status = computeConceptStatus(apu, { issues: [] });
  assert.equal(status, CONCEPT_STATUS.INCOMPLETO);
});

test('computeConceptStatus: cantidadObra en 0 es INCOMPLETO aunque el resto del APU este lleno', () => {
  const apu = baseApu({ cantidadObra: 0 });
  apu.materials = [{ clave: 'MAT-001', descripcion: 'x', unidad: 'pza', consumo: 1, desperdicioPct: 0, precioUnitario: 10, fuente: fuente('ASUMIDO') }];
  apu.labor = [{ clave: 'MO-001', descripcion: 'y', unidad: 'jor', cuadrilla: 1, rendimiento: 1, salarioBase: 300, fsr: 1, fuente: fuente('ASUMIDO') }];
  const status = computeConceptStatus(apu, { issues: [] });
  assert.equal(status, CONCEPT_STATUS.INCOMPLETO);
});

test('computeConceptStatus: un issue de severidad error es ERROR, sin importar los demas datos', () => {
  const apu = baseApu();
  apu.materials = [{ clave: 'MAT-001', descripcion: 'x', unidad: 'pza', consumo: 1, desperdicioPct: 0, precioUnitario: 10, fuente: fuente('ASUMIDO') }];
  apu.labor = [{ clave: 'MO-001', descripcion: 'y', unidad: 'jor', cuadrilla: 1, rendimiento: 1, salarioBase: 300, fsr: 1, fuente: fuente('ASUMIDO') }];
  const status = computeConceptStatus(apu, { issues: [{ code: 'missing_unit', severity: 'error', message: 'x' }] });
  assert.equal(status, CONCEPT_STATUS.ERROR);
});

test('computeConceptStatus: un issue SIN severity declarada (ej. missing_integration, una nota informativa) NUNCA es ERROR por si solo -- caso real encontrado generando evidencia: todo APU de plantilla con equipo cae aqui', () => {
  const apu = baseApu();
  apu.materials = [{ clave: 'MAT-001', descripcion: 'x', unidad: 'pza', consumo: 1, desperdicioPct: 0, precioUnitario: 10, fuente: fuente('ASUMIDO') }];
  apu.labor = [{ clave: 'MO-001', descripcion: 'y', unidad: 'jor', cuadrilla: 1, rendimiento: 1, salarioBase: 300, fsr: 1, fuente: fuente('ASUMIDO') }];
  const status = computeConceptStatus(apu, { issues: [{ code: 'missing_integration', kind: 'equipment', index: 0, message: 'sin severity' }] });
  assert.notEqual(status, CONCEPT_STATUS.ERROR);
  assert.equal(status, CONCEPT_STATUS.COMPLETO_CON_SUPUESTOS);
});

test('computeConceptStatus: una reconciliacion matematica rota es ERROR', () => {
  const apu = baseApu();
  apu.materials = [{ clave: 'MAT-001', descripcion: 'x', unidad: 'pza', consumo: 1, desperdicioPct: 0, precioUnitario: 10, fuente: fuente('ASUMIDO') }];
  apu.labor = [{ clave: 'MO-001', descripcion: 'y', unidad: 'jor', cuadrilla: 1, rendimiento: 1, salarioBase: 300, fsr: 1, fuente: fuente('ASUMIDO') }];
  const status = computeConceptStatus(apu, { issues: [] }, { ok: false, diffs: [{ code: 'suma_insumos_vs_costo_directo' }] });
  assert.equal(status, CONCEPT_STATUS.ERROR);
});

test('computeConceptStatus: un renglon REQUIERE_VALIDACION en fuente.estado produce REQUIERE_VALIDACION', () => {
  const apu = baseApu();
  apu.materials = [{ clave: 'MAT-001', descripcion: 'x', unidad: 'pza', consumo: 1, desperdicioPct: 0, precioUnitario: 10, fuente: fuente('REQUIERE_VALIDACION') }];
  apu.labor = [{ clave: 'MO-001', descripcion: 'y', unidad: 'jor', cuadrilla: 1, rendimiento: 1, salarioBase: 300, fsr: 1, fuente: fuente('ASUMIDO') }];
  const status = computeConceptStatus(apu, { issues: [] });
  assert.equal(status, CONCEPT_STATUS.REQUIERE_VALIDACION);
});

test('computeConceptStatus: renglones ASUMIDO/ESTIMADO_IA sin errores producen COMPLETO_CON_SUPUESTOS', () => {
  const apu = baseApu();
  apu.materials = [{ clave: 'MAT-001', descripcion: 'x', unidad: 'pza', consumo: 1, desperdicioPct: 0, precioUnitario: 10, fuente: fuente('ASUMIDO') }];
  apu.labor = [{ clave: 'MO-001', descripcion: 'y', unidad: 'jor', cuadrilla: 1, rendimiento: 1, salarioBase: 300, fsr: 1, fuente: fuente('ESTIMADO_IA') }];
  const status = computeConceptStatus(apu, { issues: [] });
  assert.equal(status, CONCEPT_STATUS.COMPLETO_CON_SUPUESTOS);
});

test('computeConceptStatus: todos los renglones VERIFICADO/IMPORTADO, sin issues, es COMPLETO', () => {
  const apu = baseApu();
  apu.materials = [{ clave: 'MAT-001', descripcion: 'x', unidad: 'pza', consumo: 1, desperdicioPct: 0, precioUnitario: 10, fuente: fuente('VERIFICADO') }];
  apu.labor = [{ clave: 'MO-001', descripcion: 'y', unidad: 'jor', cuadrilla: 1, rendimiento: 1, salarioBase: 300, fsr: 1, fuente: fuente('IMPORTADO') }];
  const status = computeConceptStatus(apu, { issues: [] });
  assert.equal(status, CONCEPT_STATUS.COMPLETO);
});

test('conceptStatusLabel: expone las 5 etiquetas del spec, en español, con acentos', () => {
  assert.equal(conceptStatusLabel(CONCEPT_STATUS.COMPLETO), 'COMPLETO');
  assert.equal(conceptStatusLabel(CONCEPT_STATUS.COMPLETO_CON_SUPUESTOS), 'COMPLETO CON SUPUESTOS');
  assert.equal(conceptStatusLabel(CONCEPT_STATUS.REQUIERE_VALIDACION), 'REQUIERE VALIDACIÓN');
  assert.equal(conceptStatusLabel(CONCEPT_STATUS.INCOMPLETO), 'INCOMPLETO');
  assert.equal(conceptStatusLabel(CONCEPT_STATUS.ERROR), 'ERROR');
});
