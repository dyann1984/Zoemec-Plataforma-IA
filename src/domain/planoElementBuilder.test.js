import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVectorWallElement, attachAiOrigin, recalibrateVectorElement, resolveEffectiveDimension, VECTOR_WALL_CONFIDENCE } from './planoElementBuilder.js';
import { PLANO_ELEMENT_STATES, PLANO_ELEMENT_ORIGIN, ESCALA_FUENTES, applyPlanoElementReview } from './planoReview.js';
import { validateElement } from '../../server/api-lib/_planoValidate.mjs';

function fakeWall(overrides = {}){
  return { id: 'vec-wall-1', page: 1, segments: [{ x1: 0, y1: 0, x2: 300, y2: 0 }], bbox: { x0: 0, y0: 0, x1: 300, y1: 0 }, lengthPt: 300, ...overrides };
}

test('buildVectorWallElement: con escala resuelta, calcula la longitud REAL y queda DETECTADO_VECTORIAL', () => {
  const el = buildVectorWallElement(fakeWall(), { resolvedScale: { fuente: ESCALA_FUENTES.ESCALA_GRAFICA, realUnitsPerPdfPoint: 0.01, evidencia: 'ESCALA 1:X' } });
  assert.equal(el.estado, PLANO_ELEMENT_STATES.DETECTADO_VECTORIAL);
  assert.equal(el.origin, PLANO_ELEMENT_ORIGIN.VECTOR_DETECTED);
  assert.equal(el.cantidadPropuesta, 3); // 300pt * 0.01 m/pt
  assert.equal(el.dimension.longitud, 3);
  assert.equal(el.unidad, 'm');
  assert.equal(el.confianzaIA, VECTOR_WALL_CONFIDENCE);
});

test('buildVectorWallElement: sin escala resuelta, NUNCA propone cantidad (regla dura, misma que IA)', () => {
  const el = buildVectorWallElement(fakeWall(), { resolvedScale: { fuente: ESCALA_FUENTES.NO_DETERMINADA, realUnitsPerPdfPoint: null } });
  assert.equal(el.cantidadPropuesta, null);
  assert.equal(el.fuenteEscala, ESCALA_FUENTES.NO_DETERMINADA);
  // enforceScaleRule fuerza REQUIERE_REVISION incluso para geometria vectorial real
  assert.equal(el.estado, PLANO_ELEMENT_STATES.REQUIERE_REVISION);
});

test('buildVectorWallElement: el elemento resultante pasa el validador existente de _planoValidate.mjs sin cambios', () => {
  const el = buildVectorWallElement(fakeWall(), { resolvedScale: { fuente: ESCALA_FUENTES.COTAS_TEXTO, realUnitsPerPdfPoint: 0.02, evidencia: 'cota' } });
  // validateElement es el validador ESTRICTO de RC4 -- si un elemento vectorial
  // no lo pasa, la API rechazaria un dato real solo por incompatibilidad de forma.
  const result = validateElement(el);
  assert.equal(result.ok, true, result.reason);
});

test('buildVectorWallElement conserva geometria completa (segments+bbox) para el visor', () => {
  const wall = fakeWall({ segments: [{ x1: 0, y1: 0, x2: 150, y2: 0 }, { x1: 150, y1: 0, x2: 300, y2: 0 }] });
  const el = buildVectorWallElement(wall, { resolvedScale: { fuente: ESCALA_FUENTES.ESCALA_GRAFICA, realUnitsPerPdfPoint: 0.01 } });
  assert.equal(el.geometry.kind, 'segments');
  assert.equal(el.geometry.segments.length, 2);
});

test('TEST QA 5 (aplicado) -- recalibrateVectorElement recalcula un muro con la escala manual del usuario, usando la MISMA geometria', () => {
  const original = buildVectorWallElement(fakeWall(), { resolvedScale: { fuente: ESCALA_FUENTES.NO_DETERMINADA, realUnitsPerPdfPoint: null } });
  assert.equal(original.cantidadPropuesta, null); // sin escala, no propone nada
  const recalibrated = recalibrateVectorElement(original, { fuente: ESCALA_FUENTES.REFERENCIA_USUARIO, realUnitsPerPdfPoint: 0.02, evidencia: 'Punto A a Punto B = 6m' });
  assert.equal(recalibrated.cantidadPropuesta, 6); // 300pt * 0.02
  assert.equal(recalibrated.fuenteEscala, ESCALA_FUENTES.REFERENCIA_USUARIO);
  assert.equal(recalibrated.estado, PLANO_ELEMENT_STATES.DETECTADO_VECTORIAL);
});

test('recalibrateVectorElement nunca toca un elemento ya revisado por un humano (VALIDADO/CORREGIDO/RECHAZADO)', () => {
  const original = buildVectorWallElement(fakeWall(), { resolvedScale: { fuente: ESCALA_FUENTES.ESCALA_GRAFICA, realUnitsPerPdfPoint: 0.01 } });
  const validated = { ...original, estado: PLANO_ELEMENT_STATES.VALIDADO_POR_USUARIO, validatedBy: 'diana@zoemec.com' };
  const result = recalibrateVectorElement(validated, { fuente: ESCALA_FUENTES.REFERENCIA_USUARIO, realUnitsPerPdfPoint: 0.05 });
  assert.equal(result, validated); // sin cambios: la decision humana ya es definitiva
});

test('recalibrateVectorElement nunca inventa una cantidad para un elemento de IA sin evidencia propia', () => {
  const aiElement = attachAiOrigin({ tipo: 'ventana', descripcion: 'x', cantidadPropuesta: null, unidad: '', confianzaIA: 50, pagina: 1, evidencia: 'e', fuenteEscala: ESCALA_FUENTES.NO_DETERMINADA, observaciones: '', estado: PLANO_ELEMENT_STATES.REQUIERE_REVISION }, {});
  const result = recalibrateVectorElement(aiElement, { fuente: ESCALA_FUENTES.REFERENCIA_USUARIO, realUnitsPerPdfPoint: 0.02 });
  assert.equal(result, aiElement); // sin cambios: no es VECTOR_DETECTED
});

test('REGRESION QA -- corregir un muro (cantidadCorregida) SI cambia la dimension efectiva usada por la cuantificacion', () => {
  const original = buildVectorWallElement(fakeWall({ lengthPt: 200 }), { resolvedScale: { fuente: ESCALA_FUENTES.ESCALA_GRAFICA, realUnitsPerPdfPoint: 0.0175 } });
  assert.equal(original.dimension.longitud, 3.5); // 200pt * 0.0175
  const corregido = applyPlanoElementReview(original, { state: PLANO_ELEMENT_STATES.CORREGIDO_POR_USUARIO, validatedBy: 'diana@zoemec.com', cantidadCorregida: 3.65 });
  // dimension.longitud (crudo) sigue siendo el original -- eso es correcto,
  // preserva el dato tal cual se detecto; lo que debe cambiar es la
  // dimension EFECTIVA que consume la UI/cuantificacion.
  assert.equal(corregido.dimension.longitud, 3.5);
  assert.equal(resolveEffectiveDimension(corregido).longitud, 3.65);
});

test('resolveEffectiveDimension: sin correccion, regresa la dimension tal cual', () => {
  const el = buildVectorWallElement(fakeWall(), { resolvedScale: { fuente: ESCALA_FUENTES.ESCALA_GRAFICA, realUnitsPerPdfPoint: 0.01 } });
  assert.deepEqual(resolveEffectiveDimension(el), el.dimension);
});

test('resolveEffectiveDimension: un tipo sin mapeo conocido (otro) nunca adivina a que campo va la correccion', () => {
  const el = { tipo: 'otro', dimension: { area: 5 }, cantidadCorregida: 9 };
  assert.deepEqual(resolveEffectiveDimension(el), { area: 5 });
});

test('attachAiOrigin: adjunta origin/bbox/dimension sin alterar los campos ya validados', () => {
  const validated = validateElement({
    tipo: 'ventana', descripcion: 'Ventana tipica 1.20x1.20', cantidadPropuesta: 4, unidad: 'pza',
    confianzaIA: 70, pagina: 1, evidencia: 'Simbolo repetido 4 veces en fachada norte', fuenteEscala: ESCALA_FUENTES.COTAS_TEXTO, observaciones: ''
  }).element;
  const el = attachAiOrigin(validated, { bbox: { x0: 0.1, y0: 0.2, x1: 0.15, y1: 0.25 }, fileName: 'plano.pdf' });
  assert.equal(el.origin, PLANO_ELEMENT_ORIGIN.AI_APPROXIMATION);
  assert.equal(el.geometry.kind, 'bbox');
  assert.equal(el.dimension.piezas, 4);
  assert.equal(el.tipo, 'ventana'); // el campo original nunca se pierde
  assert.equal(el.descripcion, 'Ventana tipica 1.20x1.20');
});
