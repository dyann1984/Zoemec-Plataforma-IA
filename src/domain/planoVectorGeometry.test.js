import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasUsableVectorGeometry, filterSignificantSegments, groupSegmentsIntoWalls,
  detectGraphicScale, detectCotaScaleCandidates, resolveScale
} from './planoVectorGeometry.js';
import { ESCALA_FUENTES } from './planoReview.js';

function seg(x1, y1, x2, y2, page = 1){ return { x1, y1, x2, y2, page }; }

test('TEST QA 1 -- PDF vectorial: suficientes segmentos largos -> geometria aprovechable', () => {
  const segments = [
    seg(0, 0, 200, 0), seg(200, 0, 200, 150), seg(200, 150, 0, 150), seg(0, 150, 0, 0),
    seg(50, 0, 50, 150), seg(120, 0, 160, 0)
  ];
  assert.equal(hasUsableVectorGeometry(segments), true);
});

test('TEST QA 2 -- PDF escaneado (sin operadores de trazo, solo imagen): sin geometria aprovechable', () => {
  assert.equal(hasUsableVectorGeometry([]), false);
  // Un PDF escaneado puede traer 1-2 lineas decorativas del marco/membrete,
  // nunca suficientes para pasar el umbral real.
  assert.equal(hasUsableVectorGeometry([seg(0, 0, 500, 0), seg(0, 0, 0, 700)]), false);
});

test('filterSignificantSegments descarta ruido decorativo (achurado/flechas muy cortas)', () => {
  const segments = [seg(0, 0, 3, 0), seg(0, 0, 200, 0)];
  const filtered = filterSignificantSegments(segments);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].x2, 200);
});

test('TEST QA 6 -- deteccion de muro: segmentos colineales conectados se agrupan en UNA corrida', () => {
  // Dos segmentos que forman una sola linea recta de 0,0 a 300,0 (con un
  // "empalme" en 150,0, comun cuando el CAD parte una polilinea en tramos).
  const segments = [seg(0, 0, 150, 0), seg(150, 0, 300, 0)];
  const walls = groupSegmentsIntoWalls(segments);
  assert.equal(walls.length, 1);
  assert.ok(Math.abs(walls[0].lengthPt - 300) < 0.001);
});

test('groupSegmentsIntoWalls: dos muros que se cruzan en esquina NO se fusionan (angulos distintos)', () => {
  const segments = [seg(0, 0, 200, 0), seg(200, 0, 200, 150)]; // esquina en (200,0)
  const walls = groupSegmentsIntoWalls(segments);
  assert.equal(walls.length, 2);
});

test('groupSegmentsIntoWalls: segmentos aislados (sin conexion) quedan como corridas independientes', () => {
  const segments = [seg(0, 0, 100, 0), seg(500, 500, 650, 500)];
  const walls = groupSegmentsIntoWalls(segments);
  assert.equal(walls.length, 2);
});

test('TEST QA 3 -- PDF con escala declarada: detectGraphicScale la reconoce y calcula m/pt', () => {
  const textItems = [{ str: 'ESCALA 1:50', x: 10, y: 10, width: 60, height: 8, page: 1 }];
  const scale = detectGraphicScale(textItems);
  assert.ok(scale);
  assert.equal(scale.fuente, ESCALA_FUENTES.ESCALA_GRAFICA);
  // 1:50 -> 1 punto PDF (1/72 in) representa 50 puntos reales -> metros/pt:
  assert.ok(Math.abs(scale.realUnitsPerPdfPoint - (50 * 0.0254 / 72)) < 1e-9);
});

test('TEST QA 4 -- PDF sin escala: ni grafica ni cota ni referencia de usuario -> NO_DETERMINADA', () => {
  const resolved = resolveScale({ graphicScale: null, cotaCandidates: [], referenciaUsuario: null });
  assert.equal(resolved.fuente, ESCALA_FUENTES.NO_DETERMINADA);
  assert.equal(resolved.realUnitsPerPdfPoint, null);
});

test('detectCotaScaleCandidates correlaciona una cota de texto con el segmento mas cercano', () => {
  const segments = [seg(0, 100, 420, 100)]; // longitud 420pt
  const textItems = [{ str: '4.20 m', x: 190, y: 105, width: 30, height: 8, page: 1 }];
  const candidates = detectCotaScaleCandidates(textItems, segments);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].fuente, ESCALA_FUENTES.COTAS_TEXTO);
  // 4.20 m en 420pt -> 0.01 m/pt
  assert.ok(Math.abs(candidates[0].realUnitsPerPdfPoint - 0.01) < 1e-9);
});

test('detectCotaScaleCandidates ignora una cota demasiado lejos de cualquier trazo', () => {
  const segments = [seg(0, 100, 420, 100)];
  const textItems = [{ str: '4.20 m', x: 5000, y: 5000, width: 30, height: 8, page: 1 }];
  assert.equal(detectCotaScaleCandidates(textItems, segments).length, 0);
});

test('resolveScale: prioridad estricta -- escala grafica gana sobre cota y sobre referencia de usuario', () => {
  const resolved = resolveScale({
    graphicScale: { fuente: ESCALA_FUENTES.ESCALA_GRAFICA, realUnitsPerPdfPoint: 0.02, evidencia: 'ESCALA 1:100' },
    cotaCandidates: [{ fuente: ESCALA_FUENTES.COTAS_TEXTO, realUnitsPerPdfPoint: 0.01, evidencia: 'cota' }],
    referenciaUsuario: { realUnitsPerPdfPoint: 0.05, evidencia: 'manual' }
  });
  assert.equal(resolved.fuente, ESCALA_FUENTES.ESCALA_GRAFICA);
  assert.equal(resolved.realUnitsPerPdfPoint, 0.02);
});

test('resolveScale: sin escala grafica, la cota detectada gana sobre la referencia del usuario', () => {
  const resolved = resolveScale({
    graphicScale: null,
    cotaCandidates: [{ fuente: ESCALA_FUENTES.COTAS_TEXTO, realUnitsPerPdfPoint: 0.01, evidencia: 'cota' }],
    referenciaUsuario: { realUnitsPerPdfPoint: 0.05, evidencia: 'manual' }
  });
  assert.equal(resolved.fuente, ESCALA_FUENTES.COTAS_TEXTO);
});

test('TEST QA 5 -- calibracion manual: sin grafica ni cota, la referencia confirmada por el usuario se usa', () => {
  const resolved = resolveScale({ graphicScale: null, cotaCandidates: [], referenciaUsuario: { realUnitsPerPdfPoint: 0.03, evidencia: 'Punto A a Punto B = 4.20 m' } });
  assert.equal(resolved.fuente, ESCALA_FUENTES.REFERENCIA_USUARIO);
  assert.equal(resolved.realUnitsPerPdfPoint, 0.03);
});
