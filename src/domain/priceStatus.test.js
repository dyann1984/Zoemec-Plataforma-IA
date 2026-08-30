/* Material & Price Intelligence 2.1 -- regla 3: PRICE_STATUS. TEST 9-10
   obligatorios del spec (QUOTATION_REQUIRED, VERIFIED_MARKET), mas cobertura
   de MARKET_REFERENCE/AI_ESTIMATE_UNVERIFIED/NO_PRICE y el mapeo de vuelta a
   APU_DATA_STATE (compatibilidad con el motor existente). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { derivePriceStatus, priceStatusToLegacyState, PRICE_STATUS } from './priceStatus.js';
import { APU_DATA_STATE } from './apuSchema.js';

test('TEST 9 -- equipo/material especializado sin precio publico defendible -> QUOTATION_REQUIRED', () => {
  const status = derivePriceStatus({ price: 45000, references: [], requiresQuotation: true });
  assert.equal(status, PRICE_STATUS.QUOTATION_REQUIRED);
});

test('TEST 10 -- referencia comercial exacta y verificable (ALTO) -> VERIFIED_MARKET', () => {
  const status = derivePriceStatus({
    price: 82, references: [{ proveedor: 'The Home Depot Mexico', match: { verdict: 'ALTO' } }]
  });
  assert.equal(status, PRICE_STATUS.VERIFIED_MARKET);
});

test('precio $0 SIEMPRE es NO_PRICE, incluso con referencias ALTO (un $0 nunca es un precio valido)', () => {
  const status = derivePriceStatus({ price: 0, references: [{ match: { verdict: 'ALTO' } }] });
  assert.equal(status, PRICE_STATUS.NO_PRICE);
});

test('precio negativo o NaN tambien es NO_PRICE', () => {
  assert.equal(derivePriceStatus({ price: -10 }), PRICE_STATUS.NO_PRICE);
  assert.equal(derivePriceStatus({ price: NaN }), PRICE_STATUS.NO_PRICE);
  assert.equal(derivePriceStatus({ price: undefined }), PRICE_STATUS.NO_PRICE);
});

test('referencias MEDIO/BAJO sin ninguna ALTO -> MARKET_REFERENCE (evidencia existe, requiere validacion)', () => {
  const status = derivePriceStatus({
    price: 120, references: [{ match: { verdict: 'MEDIO' } }, { match: { verdict: 'BAJO' } }]
  });
  assert.equal(status, PRICE_STATUS.MARKET_REFERENCE);
});

test('sin ninguna referencia -> AI_ESTIMATE_UNVERIFIED (nunca se presenta como precio real de mercado)', () => {
  const status = derivePriceStatus({ price: 350, references: [] });
  assert.equal(status, PRICE_STATUS.AI_ESTIMATE_UNVERIFIED);
});

test('estado VERIFICADO/IMPORTADO (fuente real de catalogo) -> VERIFIED_MARKET sin depender de busqueda web', () => {
  assert.equal(derivePriceStatus({ estado: 'VERIFICADO', price: 100, references: [] }), PRICE_STATUS.VERIFIED_MARKET);
  assert.equal(derivePriceStatus({ estado: 'IMPORTADO', price: 100, references: [] }), PRICE_STATUS.VERIFIED_MARKET);
});

test('mapeo a APU_DATA_STATE preserva compatibilidad con el motor existente (Challenge/Auditor/BidRisk/Confidence)', () => {
  assert.equal(priceStatusToLegacyState(PRICE_STATUS.VERIFIED_MARKET), APU_DATA_STATE.VERIFICADO);
  assert.equal(priceStatusToLegacyState(PRICE_STATUS.AI_ESTIMATE_UNVERIFIED), APU_DATA_STATE.ESTIMADO_IA);
  assert.equal(priceStatusToLegacyState(PRICE_STATUS.MARKET_REFERENCE), APU_DATA_STATE.REQUIERE_VALIDACION);
  assert.equal(priceStatusToLegacyState(PRICE_STATUS.QUOTATION_REQUIRED), APU_DATA_STATE.REQUIERE_VALIDACION);
  assert.equal(priceStatusToLegacyState(PRICE_STATUS.NO_PRICE), APU_DATA_STATE.REQUIERE_VALIDACION);
});
