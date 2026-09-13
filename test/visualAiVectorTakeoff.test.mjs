/* Prueba de integracion REAL del pipeline "PDF vectorial primero" (Fase B):
   PDF real (jsPDF) -> extractVectorGeometry real (pdfjs-dist) -> resolucion
   de escala real -> fusion con una respuesta de IA INYECTADA (sin red, sin
   OPENAI_API_KEY) -- runVectorTakeoffAnalysis acepta `aiCompletionFn` para
   esto exacto. Cubre de punta a punta: TEST QA 1, 3, 4, 5 y la regla
   "la IA complementa, nunca sustituye geometria disponible". */
import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { runVectorTakeoffAnalysis } from '../api/visual-ai.mjs';
import { PLANO_ELEMENT_STATES, PLANO_ELEMENT_ORIGIN, ESCALA_FUENTES } from '../src/domain/planoReview.js';

function pdfDataUrl(buffer){ return `data:application/pdf;base64,${buffer.toString('base64')}`; }

function buildPlanoConEscala(){
  const doc = new jsPDF({ unit: 'pt', format: [600, 400] });
  doc.line(50, 50, 250, 50);
  doc.line(250, 50, 250, 200);
  doc.line(250, 200, 50, 200);
  doc.line(50, 200, 50, 50);
  doc.line(250, 120, 350, 120);
  doc.line(350, 120, 350, 250);
  doc.setFontSize(10);
  doc.text('ESCALA 1:50', 50, 380);
  return Buffer.from(doc.output('arraybuffer'));
}

function buildPlanoSinTrazos(){
  const doc = new jsPDF({ unit: 'pt', format: [600, 400] });
  doc.setFontSize(10);
  doc.text('Plano sin geometria vectorial util', 50, 50);
  return Buffer.from(doc.output('arraybuffer'));
}

function fakeAiWithDoor(){
  return async () => ({
    parsed: {
      elementos: [{
        tipo: 'puerta', descripcion: 'Puerta de acceso principal 0.90x2.10', cantidadPropuesta: 1, unidad: 'pza',
        confianzaIA: 72, pagina: 1, evidencia: 'Simbolo de puerta visible en el muro sur', fuenteEscala: ESCALA_FUENTES.ESCALA_GRAFICA,
        observaciones: '', bbox: { x0: 0.3, y0: 0.4, x1: 0.35, y1: 0.42 }
      }],
      resumenAnalisis: 'Plano de una habitacion con acceso principal.'
    },
    usage: { inputTokens: 100, outputTokens: 50 }
  });
}

test('TEST QA 1 y complemento de IA -- vector detecta muros reales, IA solo complementa (nunca repite muros)', async () => {
  const buffer = buildPlanoConEscala();
  const result = await runVectorTakeoffAnalysis({
    fileName: 'planta.pdf', mimeType: 'application/pdf', dataBase64: pdfDataUrl(buffer),
    aiCompletionFn: fakeAiWithDoor()
  });

  assert.equal(result.vectorSummary.hasUsableVectorGeometry, true);
  assert.equal(result.resolvedScale.fuente, ESCALA_FUENTES.ESCALA_GRAFICA);

  const muros = result.elementos.filter(e => e.tipo === 'muro');
  const puertas = result.elementos.filter(e => e.tipo === 'puerta');
  assert.ok(muros.length >= 2, `se esperaban al menos 2 muros vectoriales, hubo ${muros.length}`);
  assert.ok(muros.every(m => m.origin === PLANO_ELEMENT_ORIGIN.VECTOR_DETECTED && m.estado === PLANO_ELEMENT_STATES.DETECTADO_VECTORIAL));
  assert.equal(puertas.length, 1);
  assert.equal(puertas[0].origin, PLANO_ELEMENT_ORIGIN.AI_APPROXIMATION);
  assert.equal(puertas[0].estado, PLANO_ELEMENT_STATES.PROPUESTO_POR_IA);
  assert.deepEqual(puertas[0].geometry, { kind: 'bbox', bbox: { x0: 0.3, y0: 0.4, x1: 0.35, y1: 0.42 } });

  // La longitud real usa la escala 1:50 resuelta -- un muro de 200pt debe
  // dar 200 * (50*0.0254/72) ≈ 3.53 m (dentro de tolerancia de agrupado).
  const largo = muros.find(m => Math.abs(m.cantidadPropuesta - 3.527) < 0.05);
  assert.ok(largo, `no se encontro un muro de ~3.53m entre ${muros.map(m => m.cantidadPropuesta)}`);
});

test('sin geometria vectorial aprovechable: la IA sigue proponiendo elementos (nunca se bloquea el analisis)', async () => {
  const buffer = buildPlanoSinTrazos();
  const result = await runVectorTakeoffAnalysis({
    fileName: 'sin-trazos.pdf', mimeType: 'application/pdf', dataBase64: pdfDataUrl(buffer),
    aiCompletionFn: fakeAiWithDoor()
  });
  assert.equal(result.vectorSummary.hasUsableVectorGeometry, false);
  assert.equal(result.elementos.filter(e => e.tipo === 'muro').length, 0);
  assert.equal(result.elementos.filter(e => e.tipo === 'puerta').length, 1);
});

test('TEST QA 5 -- calibracion manual: sin escala grafica/cota, la referencia del usuario resuelve la escala de los muros vectoriales', async () => {
  const doc = new jsPDF({ unit: 'pt', format: [600, 400] });
  doc.line(0, 0, 100, 0); doc.line(100, 0, 100, 80); doc.line(100, 80, 0, 80); doc.line(0, 80, 0, 0);
  doc.line(100, 40, 200, 40); doc.line(200, 40, 200, 120);
  const buffer = Buffer.from(doc.output('arraybuffer'));
  const result = await runVectorTakeoffAnalysis({
    fileName: 'sin-escala.pdf', mimeType: 'application/pdf', dataBase64: pdfDataUrl(buffer),
    manualCalibration: { pixelDistance: 100, realDistance: 4.2, evidencia: 'Punto A a Punto B = 4.20 m' }
  });
  assert.equal(result.resolvedScale.fuente, ESCALA_FUENTES.REFERENCIA_USUARIO);
  const muro100pt = result.elementos.find(m => Math.abs(m.geometry?.bbox ? (m.geometry.bbox.x1 - m.geometry.bbox.x0) : 0 - 100) >= 0 && Math.abs(m.cantidadPropuesta - 4.2) < 0.01);
  assert.ok(muro100pt, `se esperaba un muro de ~4.20m calibrado manualmente entre ${result.elementos.filter(e=>e.tipo==='muro').map(m=>m.cantidadPropuesta)}`);
});

test('TEST QA 4 -- sin ESCALA_GRAFICA, sin cota y sin calibracion manual: los muros vectoriales quedan REQUIERE_REVISION, nunca con cantidad inventada', async () => {
  const doc = new jsPDF({ unit: 'pt', format: [600, 400] });
  doc.line(0, 0, 300, 0); doc.line(300, 0, 300, 200); doc.line(300, 200, 0, 200); doc.line(0, 200, 0, 0);
  doc.line(300, 80, 420, 80); doc.line(420, 80, 420, 220);
  const buffer = Buffer.from(doc.output('arraybuffer'));
  const result = await runVectorTakeoffAnalysis({ fileName: 'sin-nada.pdf', mimeType: 'application/pdf', dataBase64: pdfDataUrl(buffer) });
  assert.equal(result.resolvedScale.fuente, ESCALA_FUENTES.NO_DETERMINADA);
  const muros = result.elementos.filter(e => e.tipo === 'muro');
  assert.ok(muros.length >= 1);
  muros.forEach(m => {
    assert.equal(m.cantidadPropuesta, null);
    assert.equal(m.estado, PLANO_ELEMENT_STATES.REQUIERE_REVISION);
  });
});

test('sin OPENAI_API_KEY y sin aiCompletionFn inyectado: el analisis vectorial funciona igual, sin llamar IA', async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try{
    const buffer = buildPlanoConEscala();
    const result = await runVectorTakeoffAnalysis({ fileName: 'planta.pdf', mimeType: 'application/pdf', dataBase64: pdfDataUrl(buffer) });
    assert.ok(result.elementos.filter(e => e.tipo === 'muro').length >= 1);
    assert.equal(result.elementos.filter(e => e.origin === PLANO_ELEMENT_ORIGIN.AI_APPROXIMATION).length, 0);
  }finally{
    if(originalKey) process.env.OPENAI_API_KEY = originalKey;
  }
});

test('entrada imagen (no PDF): sin geometria vectorial posible, escala queda NO_DETERMINADA con evidencia explicita', async () => {
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP4z8DwnwGMgRQAH+4D/dJQfRoAAAAASUVORK5CYII=';
  const result = await runVectorTakeoffAnalysis({
    fileName: 'foto.png', mimeType: 'image/png', dataBase64: `data:image/png;base64,${tinyPngBase64}`,
    aiCompletionFn: fakeAiWithDoor()
  });
  assert.equal(result.resolvedScale.fuente, ESCALA_FUENTES.NO_DETERMINADA);
  assert.match(result.resolvedScale.evidencia, /no es PDF/);
  assert.equal(result.elementos.filter(e => e.tipo === 'muro').length, 0);
  assert.equal(result.elementos.filter(e => e.tipo === 'puerta').length, 1);
});
