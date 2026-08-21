import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConceptText } from './excelImport.js';

test('parseConceptText no interpreta proporcion 1:4 ni dimensiones como P.U.',()=>{
  const parsed=parseConceptText('Suministro y colocación de muro de block hueco de concreto de 15 x 20 x 40 cm, asentado con mortero cemento-arena 1:4.');
  assert.equal(parsed.referencePU,0);
  assert.equal(parsed.qty,1);
});

test('parseConceptText conserva cantidad y P.U. explicitos despues de la unidad',()=>{
  const parsed=parseConceptText('Muro de block 15 x 20 x 40 cm con mortero 1:4 m2 25 $816.89');
  assert.equal(parsed.unit,'m²');
  assert.equal(parsed.qty,25);
  assert.equal(parsed.referencePU,816.89);
});

test('parseConceptText reconoce la unidad m² sin confundir el superindice con cantidad',()=>{
  const parsed=parseConceptText('Muro de block m² 25 $816.89');
  assert.equal(parsed.unit,'m²');
  assert.equal(parsed.qty,25);
  assert.equal(parsed.referencePU,816.89);
});
