/* Material & Price Intelligence 2.1 -- regla 8: confianza de precio a
   partir de senales observables (technicalMatch, cantidad de fuentes,
   recencia, dispersion, presentacion comparable), no de la opinion del LLM. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computePriceConfidence, PRICE_CONFIDENCE } from './priceConfidence.js';

test('sin referencias -> UNVERIFIED', () => {
  const { level, reasons } = computePriceConfidence({ references: [] });
  assert.equal(level, PRICE_CONFIDENCE.UNVERIFIED);
  assert.ok(reasons.length > 0);
});

test('solo referencias MEDIO/BAJO (sin ALTO) -> LOW', () => {
  const { level } = computePriceConfidence({ references: [{ match: { verdict: 'MEDIO' } }, { match: { verdict: 'BAJO' } }] });
  assert.equal(level, PRICE_CONFIDENCE.LOW);
});

test('2+ referencias ALTO, recientes, baja dispersion -> HIGH', () => {
  const { level, reasons } = computePriceConfidence({
    references: [{ match: { verdict: 'ALTO' } }, { match: { verdict: 'ALTO' } }],
    recencyDays: 5, dispersionPct: 0.05
  });
  assert.equal(level, PRICE_CONFIDENCE.HIGH);
  assert.ok(reasons.some(r => /ALTO/.test(r)));
});

test('1 sola referencia ALTO -> MEDIUM (se requieren al menos 2 fuentes concordantes para HIGH)', () => {
  const { level } = computePriceConfidence({ references: [{ match: { verdict: 'ALTO' } }], recencyDays: 2 });
  assert.equal(level, PRICE_CONFIDENCE.MEDIUM);
});

test('referencias ALTO pero fuente obsoleta (>180 dias) -> MEDIUM, nunca HIGH', () => {
  const { level, reasons } = computePriceConfidence({
    references: [{ match: { verdict: 'ALTO' } }, { match: { verdict: 'ALTO' } }],
    recencyDays: 250
  });
  assert.equal(level, PRICE_CONFIDENCE.MEDIUM);
  assert.ok(reasons.some(r => /antiguedad/i.test(r)));
});

test('referencias ALTO con dispersion alta entre precios -> MEDIUM, nunca HIGH', () => {
  const { level, reasons } = computePriceConfidence({
    references: [{ match: { verdict: 'ALTO' } }, { match: { verdict: 'ALTO' } }],
    recencyDays: 3, dispersionPct: 0.55
  });
  assert.equal(level, PRICE_CONFIDENCE.MEDIUM);
  assert.ok(reasons.some(r => /dispersion.*alta/i.test(r)));
});

test('referencias ALTO pero ninguna con presentacion comparable con certeza -> LOW', () => {
  const { level } = computePriceConfidence({
    references: [{ match: { verdict: 'ALTO' }, presentacionComparable: false }]
  });
  assert.equal(level, PRICE_CONFIDENCE.LOW);
});
