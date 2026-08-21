import test from 'node:test';
import assert from 'node:assert/strict';
import { validateElement, validateTakeoffResponse, assertPageLimit, MAX_ELEMENTS_PER_ANALYSIS, MAX_ELEMENTS_JSON_BYTES, MAX_PAGES_PER_ANALYSIS } from './_planoValidate.mjs';

function rawElement(overrides = {}){
  return {
    tipo: 'muro', descripcion: 'Muro de block hueco 15cm entre ejes A-B',
    cantidadPropuesta: 126.4, unidad: 'm²', confianzaIA: 82,
    pagina: 2, evidencia: 'Cota de 12.64 x 10.00 m visible en el eje A-B, pagina 2.',
    fuenteEscala: 'cotas_texto', observaciones: '',
    ...overrides
  };
}

test('validateElement: caso valido (escala valida) se acepta y queda PROPUESTO_POR_IA, no verificado', () => {
  const { ok, element } = validateElement(rawElement(), { numPages: 5 });
  assert.equal(ok, true);
  assert.equal(element.cantidadPropuesta, 126.4);
  assert.equal(element.estado, 'PROPUESTO_POR_IA'); // nunca "verificado" solo por tener escala
});

test('validateElement: sin escala determinada, la cantidad se anula y pasa a REQUIERE_REVISION aunque el modelo la haya propuesto', () => {
  const { ok, element } = validateElement(rawElement({ fuenteEscala: 'no_determinada', cantidadPropuesta: 126.4, unidad: 'm²' }), { numPages: 5 });
  assert.equal(ok, true);
  assert.equal(element.cantidadPropuesta, null);
  assert.equal(element.estado, 'REQUIERE_REVISION');
});

test('validateElement: tipo fuera del enum controlado se rechaza', () => {
  const { ok, reason } = validateElement(rawElement({ tipo: 'techo_falso' }), { numPages: 5 });
  assert.equal(ok, false);
  assert.match(reason, /tipo invalido/);
});

test('validateElement: fuenteEscala fuera de enum se rechaza', () => {
  const { ok, reason } = validateElement(rawElement({ fuenteEscala: 'a_ojo' }), { numPages: 5 });
  assert.equal(ok, false);
  assert.match(reason, /fuenteEscala invalida/);
});

test('validateElement: cantidad negativa se rechaza (no se corrige a 0, se descarta)', () => {
  const { ok, reason } = validateElement(rawElement({ cantidadPropuesta: -5 }), { numPages: 5 });
  assert.equal(ok, false);
  assert.match(reason, /cantidadPropuesta invalida/);
});

test('validateElement: cantidad NaN/Infinity se rechaza', () => {
  assert.equal(validateElement(rawElement({ cantidadPropuesta: NaN }), { numPages: 5 }).ok, false);
  assert.equal(validateElement(rawElement({ cantidadPropuesta: Infinity }), { numPages: 5 }).ok, false);
});

test('validateElement: pagina invalida (0, fuera de rango, no entera) se rechaza, no se persiste', () => {
  assert.equal(validateElement(rawElement({ pagina: 0 }), { numPages: 5 }).ok, false);
  assert.equal(validateElement(rawElement({ pagina: 6 }), { numPages: 5 }).ok, false);
  assert.equal(validateElement(rawElement({ pagina: 2.5 }), { numPages: 5 }).ok, false);
});

test('validateElement: confianzaIA fuera de 0-100 se rechaza', () => {
  assert.equal(validateElement(rawElement({ confianzaIA: 150 }), { numPages: 5 }).ok, false);
  assert.equal(validateElement(rawElement({ confianzaIA: -1 }), { numPages: 5 }).ok, false);
});

test('validateElement: descripcion o evidencia vacias se rechazan (campo obligatorio)', () => {
  assert.equal(validateElement(rawElement({ descripcion: '' }), { numPages: 5 }).ok, false);
  assert.equal(validateElement(rawElement({ evidencia: '   ' }), { numPages: 5 }).ok, false);
});

test('validateElement: cantidad propuesta sin unidad se rechaza', () => {
  assert.equal(validateElement(rawElement({ unidad: '' }), { numPages: 5 }).ok, false);
});

test('validateElement: sin cantidad propuesta (null), la unidad puede faltar', () => {
  const { ok, element } = validateElement(rawElement({ cantidadPropuesta: null, unidad: '', fuenteEscala: 'no_determinada' }), { numPages: 5 });
  assert.equal(ok, true);
  assert.equal(element.cantidadPropuesta, null);
});

test('validateElement: el modelo no puede auto-asignarse un estado; siempre lo calcula el validador', () => {
  const { element } = validateElement(rawElement({ estado: 'VALIDADO_POR_USUARIO' }), { numPages: 5 });
  assert.equal(element.estado, 'PROPUESTO_POR_IA'); // el campo "estado" enviado por el modelo se ignora por completo
});

test('validateTakeoffResponse: respuesta fuera de schema (sin arreglo elementos) da error controlado, sin elementos', () => {
  const result = validateTakeoffResponse({ algoDistinto: true }, { numPages: 5 });
  assert.equal(result.ok, false);
  assert.ok(result.error);
  assert.deepEqual(result.elementos, []);
});

test('validateTakeoffResponse: separa validos e invalidos, nunca mezcla uno invalido como si fuera confiable', () => {
  const parsed = { elementos: [rawElement(), rawElement({ tipo: 'invalido' }), rawElement({ pagina: 99 })] };
  const result = validateTakeoffResponse(parsed, { numPages: 5 });
  assert.equal(result.ok, true);
  assert.equal(result.elementos.length, 1);
  assert.equal(result.elementosInvalidos.length, 2);
});

test('validateTakeoffResponse: mas de MAX_ELEMENTS_PER_ANALYSIS produce resultadoParcial y conserva los de mayor confianza', () => {
  const many = Array.from({ length: MAX_ELEMENTS_PER_ANALYSIS + 5 }, (_, i) => rawElement({ confianzaIA: i }));
  const result = validateTakeoffResponse({ elementos: many }, { numPages: 5 });
  assert.equal(result.ok, true);
  assert.equal(result.elementos.length, MAX_ELEMENTS_PER_ANALYSIS);
  assert.equal(result.resultadoParcial, true);
  assert.equal(result.elementosDescartados, 5);
  // se quedan los de mayor confianzaIA (99,98,...), no los primeros del arreglo
  assert.ok(result.elementos.every(e => e.confianzaIA >= 5));
});

test('validateTakeoffResponse: si el JSON serializado excede el presupuesto de tamano, se trunca con resultadoParcial=true', () => {
  const huge = Array.from({ length: 10 }, (_, i) => rawElement({ observaciones: 'x'.repeat(200000), confianzaIA: i }));
  const result = validateTakeoffResponse({ elementos: huge }, { numPages: 5 });
  assert.equal(result.ok, true);
  assert.equal(result.resultadoParcial, true);
  assert.ok(result.elementosDescartados > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(result.elementos), 'utf8') <= MAX_ELEMENTS_JSON_BYTES);
});

test('assertPageLimit: un PDF de hasta 10 paginas se permite', () => {
  assert.doesNotThrow(() => assertPageLimit(MAX_PAGES_PER_ANALYSIS));
  assert.doesNotThrow(() => assertPageLimit(1));
});

test('assertPageLimit: un PDF de mas de 10 paginas se rechaza de forma controlada, con el mensaje exacto aprobado', () => {
  assert.throws(
    () => assertPageLimit(MAX_PAGES_PER_ANALYSIS + 1),
    (err) => {
      assert.equal(err.status, 413);
      assert.match(err.message, /admite hasta 10 paginas/);
      return true;
    }
  );
  assert.throws(() => assertPageLimit(50));
});

test('validateTakeoffResponse: caso vacio real (sin elementos detectados) no es un error', () => {
  const result = validateTakeoffResponse({ elementos: [] }, { numPages: 3 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.elementos, []);
  assert.equal(result.resultadoParcial, false);
});
