import test from 'node:test';
import assert from 'node:assert/strict';
import { MinimalDOMMatrix, ensurePdfEnvPolyfills } from './_pdfEnvPolyfill.mjs';

function close(a, b, eps = 1e-9){ return Math.abs(a - b) < eps; }

test('constructor: sin argumentos produce la matriz identidad', () => {
  const m = new MinimalDOMMatrix();
  assert.deepEqual([m.a, m.b, m.c, m.d, m.e, m.f], [1, 0, 0, 1, 0, 0]);
});

test('translate: mueve un punto exactamente por (tx,ty), sin alterar el original (no-self)', () => {
  const m = new MinimalDOMMatrix();
  const translated = m.translate(5, 7);
  const p = translated.transformPoint({ x: 10, y: 20 });
  assert.ok(close(p.x, 15) && close(p.y, 27));
  // el original no debe mutarse (translate, no translateSelf)
  assert.deepEqual([m.a, m.b, m.c, m.d, m.e, m.f], [1, 0, 0, 1, 0, 0]);
});

test('translateSelf: muta la matriz original', () => {
  const m = new MinimalDOMMatrix();
  m.translateSelf(3, 4);
  const p = m.transformPoint({ x: 0, y: 0 });
  assert.ok(close(p.x, 3) && close(p.y, 4));
});

test('scale: escala un punto correctamente', () => {
  const m = new MinimalDOMMatrix().scale(2, 3);
  const p = m.transformPoint({ x: 5, y: 5 });
  assert.ok(close(p.x, 10) && close(p.y, 15));
});

test('rotate: rota 90 grados un punto sobre el eje X', () => {
  const m = new MinimalDOMMatrix().rotate(90);
  const p = m.transformPoint({ x: 1, y: 0 });
  assert.ok(close(p.x, 0) && close(p.y, 1));
});

test('multiplySelf: compone dos transformaciones en el orden correcto (traslada, luego escala)', () => {
  // Igual que pdfjs-dist encadena: .translate(x,y).scale(fontSize,-fontSize)
  const m = new MinimalDOMMatrix().translate(10, 20).scale(2, -2);
  const p = m.transformPoint({ x: 1, y: 1 });
  // translate primero: (11,21); luego escala x2,-2 sobre la matriz COMPUESTA
  // (no sobre el punto ya trasladado directamente) -- verificado con la
  // formula de composicion de matrices, no con una suposicion ingenua.
  const expected = m; // referencia: recomputar manualmente abajo
  const composed = multiplyManually(
    multiplyManually(identity(), translationMatrix(10, 20)),
    scaleMatrix(2, -2)
  );
  const manualPoint = applyMatrix(composed, { x: 1, y: 1 });
  assert.ok(close(p.x, manualPoint.x) && close(p.y, manualPoint.y));
});

test('invertSelf: invertir y volver a aplicar produce la matriz identidad (round-trip)', () => {
  const m = new MinimalDOMMatrix().translate(5, -3).scale(2, 4).rotate(30);
  const original = { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f };
  const inv = new MinimalDOMMatrix(original).invertSelf();
  const roundTrip = m.multiply(inv); // deberia acercarse a la identidad... ojo con el orden
  // Verificacion real: aplicar m y luego su inversa a un punto debe regresar el punto original.
  const p = { x: 7, y: -2 };
  const transformed = m.transformPoint(p);
  const back = inv.transformPoint(transformed);
  assert.ok(close(back.x, p.x, 1e-6) && close(back.y, p.y, 1e-6));
});

test('preMultiplySelf: aplica other ANTES que this (orden invertido respecto a multiplySelf)', () => {
  const a = new MinimalDOMMatrix().translate(1, 0);
  const b = new MinimalDOMMatrix().scale(2, 2);
  const viaPre = new MinimalDOMMatrix(a).preMultiplySelf(b); // a = b x a
  const viaManual = multiplyManually(matrixOf(b), matrixOf(a));
  assert.ok(close(viaPre.a, viaManual.a) && close(viaPre.e, viaManual.e));
});

test('ensurePdfEnvPolyfills: instala globalThis.DOMMatrix solo si no existe', () => {
  const had = globalThis.DOMMatrix;
  delete globalThis.DOMMatrix;
  try{
    ensurePdfEnvPolyfills();
    assert.equal(globalThis.DOMMatrix, MinimalDOMMatrix);
    const custom = function CustomDOMMatrix(){};
    globalThis.DOMMatrix = custom;
    ensurePdfEnvPolyfills();
    assert.equal(globalThis.DOMMatrix, custom, 'no debe pisar un DOMMatrix ya presente (ej. entorno con canvas real)');
  }finally{
    if(had) globalThis.DOMMatrix = had; else delete globalThis.DOMMatrix;
  }
});

// --- helpers de verificacion manual independientes de la implementacion ---
function identity(){ return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
function translationMatrix(tx, ty){ return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }; }
function scaleMatrix(sx, sy){ return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }; }
function matrixOf(m){ return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f }; }
function multiplyManually(m1, m2){
  return {
    a: m1.a * m2.a + m1.c * m2.b, b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d, d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e, f: m1.b * m2.e + m1.d * m2.f + m1.f
  };
}
function applyMatrix(m, p){ return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }; }
