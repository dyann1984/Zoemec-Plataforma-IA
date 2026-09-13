import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanoQuantification, summarizePlanoQuantification } from './planoQuantification.js';
import { PLANO_ELEMENT_STATES } from './planoReview.js';

function el(overrides = {}){
  return {
    id: 'el-1', tipo: 'muro', estado: PLANO_ELEMENT_STATES.VALIDADO_POR_USUARIO,
    dimension: { longitud: 10, area: 25 }, confianza: 80,
    ...overrides
  };
}

test('TEST QA 8 -- un elemento RECHAZADO nunca cuenta en la cuantificacion', () => {
  const q = buildPlanoQuantification([el({ estado: PLANO_ELEMENT_STATES.RECHAZADO })]);
  assert.equal(q.muros.mLineal, 0);
  assert.equal(q.totalPendientes, 1);
  assert.equal(q.excluidos[0].motivo, 'Rechazado por revision humana: nunca cuenta.');
});

test('DETECTADO_VECTORIAL y PROPUESTO_POR_IA sin revisar tampoco cuentan (solo confirmados)', () => {
  const q = buildPlanoQuantification([
    el({ id: 'a', estado: PLANO_ELEMENT_STATES.DETECTADO_VECTORIAL }),
    el({ id: 'b', estado: PLANO_ELEMENT_STATES.PROPUESTO_POR_IA }),
    el({ id: 'c', estado: PLANO_ELEMENT_STATES.REQUIERE_REVISION })
  ]);
  assert.equal(q.muros.mLineal, 0);
  assert.equal(q.totalPendientes, 3);
});

test('TEST QA 7 -- un elemento CORREGIDO_POR_USUARIO SI cuenta, con el valor corregido (via dimension actualizada)', () => {
  const q = buildPlanoQuantification([el({ estado: PLANO_ELEMENT_STATES.CORREGIDO_POR_USUARIO, dimension: { longitud: 15, area: 30 } })]);
  assert.equal(q.muros.mLineal, 15);
  assert.equal(q.muros.m2, 30);
  assert.equal(q.totalConfirmados, 1);
});

test('REGRESION QA -- un muro corregido via cantidadCorregida (flujo real de la UI) usa el valor CORREGIDO en el total, no el original', () => {
  // Mismo shape que produce PlanoTakeoffWorkspace: dimension.longitud queda
  // con el valor ORIGINAL detectado, cantidadCorregida trae la correccion.
  const q = buildPlanoQuantification([el({ estado: PLANO_ELEMENT_STATES.CORREGIDO_POR_USUARIO, dimension: { longitud: 3.5 }, cantidadCorregida: 3.65 })]);
  assert.equal(q.muros.mLineal, 3.65);
});

test('TEST QA 10 -- cuantificacion final: suma muros/pisos/puertas/ventanas de varios elementos confirmados', () => {
  const elementos = [
    el({ id: 'm1', tipo: 'muro', dimension: { longitud: 10, area: 25 } }),
    el({ id: 'm2', tipo: 'muro', dimension: { longitud: 6, area: 15 } }),
    el({ id: 'p1', tipo: 'piso', dimension: { area: 40 } }),
    el({ id: 'l1', tipo: 'losa', dimension: { area: 40, volumen: 4.8 } }),
    el({ id: 'd1', tipo: 'puerta', dimension: { piezas: 1 } }),
    el({ id: 'd2', tipo: 'puerta', dimension: { piezas: 1 } }),
    el({ id: 'v1', tipo: 'ventana', dimension: { piezas: 3 } }) // grupo de 3 ventanas iguales
  ];
  const q = buildPlanoQuantification(elementos);
  assert.equal(q.muros.mLineal, 16);
  assert.equal(q.muros.m2, 40);
  assert.equal(q.pisos.m2, 40);
  assert.equal(q.losas.m2, 40);
  assert.equal(q.losas.m3, 4.8);
  assert.equal(q.puertas.piezas, 2);
  assert.equal(q.ventanas.piezas, 3);

  const summary = summarizePlanoQuantification(q);
  assert.match(summary.muros, /16 m/);
  assert.match(summary.pisos, /40 m²/);
  assert.match(summary.puertas, /2 pza/);
  assert.match(summary.ventanas, /3 pza/);
});

test('habitacion con perimetro se suma en perimetroTotal', () => {
  const q = buildPlanoQuantification([el({ id: 'h1', tipo: 'habitacion', dimension: { area: 20, perimetro: 18 } })]);
  assert.equal(q.perimetroTotal, 18);
});

test('un elemento sin dimension.area no inventa 0 en silencio -- queda en camposFaltantes', () => {
  const q = buildPlanoQuantification([el({ dimension: { longitud: 10 } })]); // muro sin area
  assert.equal(q.muros.m2, 0);
  assert.ok(q.camposFaltantes.some(f => f.campo === 'area'));
});

test('confianzaMin registra la confianza mas baja del grupo, para exponer el elemento mas fragil', () => {
  const q = buildPlanoQuantification([
    el({ id: 'a', confianza: 90 }),
    el({ id: 'b', confianza: 55 })
  ]);
  assert.equal(q.muros.confianzaMin, 55);
});
