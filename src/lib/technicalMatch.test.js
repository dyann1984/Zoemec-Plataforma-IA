import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreReference, evaluateReferences, extractMeasurement, MATCH_VERDICT } from './technicalMatch.js';

test('extractMeasurement reconoce numero+unidad en texto libre', () => {
  assert.deepEqual(extractMeasurement('Disco diamantado 14 pulgadas'), { value: 14, unit: 'pulgadas' });
  assert.deepEqual(extractMeasurement('saco de 25 kg'), { value: 25, unit: 'kg' });
  assert.equal(extractMeasurement('sin numero reconocible'), null);
});

test('referencia con especificacion coincidente da ALTO', () => {
  const ficha = { keywordsObligatorias: ['disco'], material: 'diamante', dimensiones: '14 pulgadas', uso: 'ranurado' };
  const ref = { tipoProducto: 'Disco diamantado 14 pulgadas', material: 'diamante', dimension: '14 pulgadas', contextoUso: 'ranurado de piso', presentacionComparable: true };
  const result = scoreReference(ficha, ref);
  assert.equal(result.verdict, MATCH_VERDICT.ALTO);
  assert.ok(result.score >= 85);
});

test('CLAVE 45 golden regression: maquina completa en vez de disco se rechaza (BAJO)', () => {
  const ficha = { keywordsObligatorias: ['disco'], material: 'diamante', dimensiones: '4.5 pulgadas', uso: 'ranurado', keywordsExcluyentes: ['amoladora completa', 'esmeril angular completo', 'kit de herramienta'] };
  const ref = { tipoProducto: 'Amoladora angular electrica 800W', descripcionEncontrada: 'esmeril angular completo con motor', presentacionComparable: true };
  const result = scoreReference(ficha, ref);
  assert.equal(result.verdict, MATCH_VERDICT.BAJO);
  assert.ok(result.rejectReason.includes('excluyente'));
});

test('dimension fuera de tolerancia baja el puntaje aunque el tipo de producto coincida', () => {
  const ficha = { keywordsObligatorias: ['disco'], dimensiones: '4.5 pulgadas' };
  const ref = { tipoProducto: 'disco de corte', dimension: '14 pulgadas', presentacionComparable: true };
  const result = scoreReference(ficha, ref);
  assert.ok(result.score < 85, `esperaba <85, obtuvo ${result.score}`);
});

test('presentacion no comparable rechaza sin importar el resto', () => {
  const ficha = { keywordsObligatorias: ['cemento'], material: 'portland' };
  const ref = { tipoProducto: 'cemento portland', material: 'portland', presentacionComparable: false };
  const result = scoreReference(ficha, ref);
  assert.equal(result.verdict, MATCH_VERDICT.BAJO);
  assert.equal(result.comparable, false);
  assert.match(result.rejectReason, /no comparable/i);
});

test('fuente de salario minimo general limita a MEDIO una categoria laboral especializada', () => {
  const ficha = { keywordsObligatorias: ['soldador'], uso: 'soldadura', requiereFuenteEspecializada: true };
  const ref = { tipoProducto: 'soldador certificado', contextoUso: 'soldadura', tipoFuenteSalarial: 'salario_minimo_general', presentacionComparable: true };
  const result = scoreReference(ficha, ref);
  assert.equal(result.verdict, MATCH_VERDICT.MEDIO);
  assert.ok(result.score <= 84);
});

test('evaluateReferences separa aceptadas/auxiliares/rechazadas sin perder ninguna', () => {
  const ficha = { keywordsObligatorias: ['disco'], dimensiones: '4.5 pulgadas', keywordsExcluyentes: ['maquina completa'] };
  const referencias = [
    { proveedor: 'A', tipoProducto: 'disco 4.5 pulgadas', dimension: '4.5 pulgadas', presentacionComparable: true },
    { proveedor: 'B', tipoProducto: 'disco', dimension: '9 pulgadas', presentacionComparable: true },
    { proveedor: 'C', tipoProducto: 'maquina completa amoladora', presentacionComparable: true }
  ];
  const { scored, aceptadas, auxiliares, rechazadas } = evaluateReferences(ficha, referencias);
  assert.equal(scored.length, 3);
  assert.equal(aceptadas.length + auxiliares.length + rechazadas.length, 3);
  assert.ok(aceptadas.some(r => r.proveedor === 'A'));
  assert.ok(rechazadas.some(r => r.proveedor === 'C'));
});
