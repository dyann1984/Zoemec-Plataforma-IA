/* Material & Price Intelligence 2.1 -- regla 9: control de consumo. TEST 14
   obligatorio del spec: al alcanzar MAX_PRICE_SEARCHES_PER_BATCH, no se
   hacen mas busquedas, los recursos pendientes quedan PRICE_SEARCH_DEFERRED
   y el procesamiento del resto del batch continua (nunca falla completo). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPriceSearchBudget, PRICE_SEARCH_DEFERRED } from './priceSearchBudget.js';

test('TEST 14 -- al alcanzar MAX_PRICE_SEARCHES_PER_BATCH, deja de permitir busquedas y marca DEFERRED sin fallar', () => {
  const budget = createPriceSearchBudget({ maxSearches: 3 });
  const results = [];
  for(let i = 0; i < 6; i++){
    if(budget.canSearch()){
      budget.recordSearch();
      results.push('SEARCHED');
    }else{
      results.push(budget.recordDeferred(`resource-${i}`).status);
    }
  }
  assert.deepEqual(results, ['SEARCHED', 'SEARCHED', 'SEARCHED', PRICE_SEARCH_DEFERRED, PRICE_SEARCH_DEFERRED, PRICE_SEARCH_DEFERRED]);
  assert.equal(budget.used, 3);
  assert.equal(budget.exhausted, true);
  assert.equal(budget.deferredResources.length, 3);
});

test('sin limite explicito (maxSearches:Infinity por defecto), nunca se agota', () => {
  const budget = createPriceSearchBudget();
  for(let i = 0; i < 100; i++) budget.recordSearch();
  assert.equal(budget.canSearch(), true);
  assert.equal(budget.exhausted, false);
});

test('remaining refleja el presupuesto restante en todo momento', () => {
  const budget = createPriceSearchBudget({ maxSearches: 5 });
  budget.recordSearch();
  budget.recordSearch();
  assert.equal(budget.remaining, 3);
});
