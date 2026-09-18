import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESUPUESTO_CAPITULOS, PRESUPUESTO_CAPITULO_KEYS, isKnownCapitulo, capituloLabel, normalizeCapitulo } from './presupuestoCapitulos.js';

test('lista de capitulos incluye los 9 solicitados mas OTROS, en orden', () => {
  assert.deepEqual(PRESUPUESTO_CAPITULO_KEYS, [
    'PRELIMINARES', 'CIMENTACION', 'ESTRUCTURA', 'ALBANILERIA', 'INSTALACIONES',
    'ACABADOS', 'CANCELERIA_CARPINTERIA', 'OBRAS_EXTERIORES', 'LIMPIEZA', 'OTROS'
  ]);
  assert.equal(PRESUPUESTO_CAPITULOS.length, 10);
});

test('isKnownCapitulo/capituloLabel', () => {
  assert.equal(isKnownCapitulo('CIMENTACION'), true);
  assert.equal(isKnownCapitulo('INVENTADO'), false);
  assert.equal(capituloLabel('CIMENTACION'), 'Cimentación');
  assert.equal(capituloLabel('INVENTADO'), 'Otros');
});

test('normalizeCapitulo acepta texto libre con acentos/mayusculas', () => {
  assert.equal(normalizeCapitulo('cimentación'), 'CIMENTACION');
  assert.equal(normalizeCapitulo('Albañilería'), 'ALBANILERIA');
  assert.equal(normalizeCapitulo('obras exteriores'), 'OBRAS_EXTERIORES');
  assert.equal(normalizeCapitulo('carpinteria'), 'CANCELERIA_CARPINTERIA');
});

test('normalizeCapitulo nunca lanza y cae a OTROS con texto desconocido/vacio', () => {
  assert.equal(normalizeCapitulo(''), 'OTROS');
  assert.equal(normalizeCapitulo(null), 'OTROS');
  assert.equal(normalizeCapitulo('algo sin relacion'), 'OTROS');
});
