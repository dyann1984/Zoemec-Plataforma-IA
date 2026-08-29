/* ZOEMEC AUDITOR (Fase 1): pruebas del motor consolidado. Reusa el mismo
   pipeline real de generacion que constructionSystems.test.js (makeAPUFromConcept
   -> migrateLegacyApuToV2 -> finalizeProfessionalAPU) para fixtures realistas,
   en vez de objetos armados a mano que podrian no reflejar la forma real de
   un APU generado. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runApuAudit, AUDIT_SEVERITY } from './apuAuditor.js';
import { makeAPUFromConcept } from './apuGeneration.js';
import { finalizeProfessionalAPU } from './apuProfessional.js';
import { migrateLegacyApuToV2 } from './apuSchema.js';

function apuFixture(overrides = {}){
  return {
    concept: 'Concepto de prueba', unit: 'm2', cantidadObra: 10,
    materials: [], labor: [], equipment: [], consumables: [], seguridad: [],
    factores: {}, ...overrides
  };
}

test('runApuAudit: "acero sin acero" produce un finding CRITICAL y bloquea el estado global', () => {
  const badApu = apuFixture({ primaryActivity: 'acero', materials: [{ descripcion: 'Cemento gris' }] });
  const result = runApuAudit(badApu);
  const finding = result.findings.find(f => f.code === 'discipline_missing_expected_resource');
  assert.ok(finding, 'debe reportar el recurso de disciplina faltante');
  assert.equal(finding.severity, AUDIT_SEVERITY.CRITICAL);
  assert.equal(result.status, 'REQUIERE_REVISION_CRITICA');
  assert.ok(result.summary.critical >= 1);
});

test('runApuAudit: un APU real generado (acero) no trae ningun finding CRITICAL', () => {
  const goodApu = finalizeProfessionalAPU(migrateLegacyApuToV2(makeAPUFromConcept('Acero de refuerzo fy=4200', [])));
  const result = runApuAudit(goodApu);
  assert.equal(result.summary.critical, 0);
  assert.notEqual(result.status, 'REQUIERE_REVISION_CRITICA');
});

test('runApuAudit: APU vacio produce CRITICAL por falta de mano de obra, unidad y concepto', () => {
  const empty = apuFixture({ concept: '', unit: '' });
  const result = runApuAudit(empty);
  const codes = result.findings.filter(f => f.severity === AUDIT_SEVERITY.CRITICAL).map(f => f.code);
  assert.ok(codes.includes('missing_labor'));
  assert.ok(codes.includes('missing_unit'));
  assert.ok(codes.includes('missing_concept'));
  assert.equal(result.status, 'REQUIERE_REVISION_CRITICA');
});

test('runApuAudit: renglon duplicado se clasifica LOW, precio sin fuente se clasifica MEDIUM', () => {
  const apu = apuFixture({
    labor: [{ descripcion: 'Oficial albanil', cuadrilla: 1, rendimiento: 10, salarioBase: 400, fsr: 1.8 }],
    materials: [
      { descripcion: 'Cemento gris', consumo: 1, unidad: 'saco', precioUnitario: 220, fuente: {} },
      { descripcion: 'Cemento gris', consumo: 1, unidad: 'saco', precioUnitario: 220, fuente: {} }
    ]
  });
  const result = runApuAudit(apu);
  const duplicate = result.findings.find(f => f.code === 'duplicate_resource');
  assert.ok(duplicate);
  assert.equal(duplicate.severity, AUDIT_SEVERITY.LOW);
  const noSource = result.findings.filter(f => f.code === 'price_without_source');
  assert.ok(noSource.length >= 1);
  assert.ok(noSource.every(f => f.severity === AUDIT_SEVERITY.MEDIUM));
});

test('runApuAudit: codigo de esquema no catalogado (verified_without_source) cae a CRITICAL por defecto, no se pierde en silencio', () => {
  const apu = apuFixture({
    materials: [{ descripcion: 'Varilla 3/8', consumo: 1, unidad: 'kg', precioUnitario: 25, fuente: { estado: 'VERIFICADO' } }]
  });
  const result = runApuAudit(apu);
  const finding = result.findings.find(f => f.code === 'verified_without_source');
  assert.ok(finding, 'validateApuSchemaV2 debe reportar VERIFICADO sin fuente');
  assert.equal(finding.severity, AUDIT_SEVERITY.CRITICAL);
});

test('runApuAudit: summary cuenta exactamente los findings por severidad', () => {
  const badApu = apuFixture({ primaryActivity: 'acero', materials: [{ descripcion: 'Cemento gris' }] });
  const result = runApuAudit(badApu);
  const total = result.summary.critical + result.summary.high + result.summary.medium + result.summary.low + result.summary.info;
  assert.equal(total, result.findings.length);
});

test('runApuAudit: APU limpio sin ningun issue devuelve VALIDADO y findings vacio', () => {
  const fuente = { proveedor: 'Proveedor X', fecha: new Date().toISOString() };
  const apu = apuFixture({
    labor: [{ descripcion: 'Oficial albanil', cuadrilla: 1, rendimiento: 10, salarioBase: 400, fsr: 1.8, fuente }],
    materials: [{ descripcion: 'Cemento gris', consumo: 1, unidad: 'saco', precioUnitario: 220, fuente }]
  });
  const result = runApuAudit(apu);
  assert.equal(result.status, 'VALIDADO');
  assert.deepEqual(result.findings, []);
});
