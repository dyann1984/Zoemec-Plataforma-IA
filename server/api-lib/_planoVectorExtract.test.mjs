/* Prueba de integracion REAL: genera PDFs de verdad con jsPDF (ya
   dependencia del proyecto) y verifica que extractVectorGeometry extrae
   segmentos/texto reales via pdfjs-dist -- nunca un mock del formato de
   pdfjs. Cubre TEST QA 1 (PDF vectorial) y TEST QA 2 (PDF escaneado, sin
   geometria vectorial aprovechable) end-to-end contra el extractor real. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { extractVectorGeometry } from './_planoVectorExtract.mjs';
import { hasUsableVectorGeometry, groupSegmentsIntoWalls, detectGraphicScale } from '../../src/domain/planoVectorGeometry.js';

// PNG rojo solido de 2x2 px, construido a mano con zlib (fixture minima real,
// sin depender de un archivo externo ni de una libreria de imagenes).
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP4z8DwnwGMgRQAH+4D/dJQfRoAAAAASUVORK5CYII=';

function buildVectorPdfBuffer(){
  const doc = new jsPDF({ unit: 'pt', format: [600, 400] });
  doc.setLineWidth(1);
  doc.line(50, 50, 250, 50);   // muro horizontal, 200pt
  doc.line(250, 50, 250, 200); // muro vertical, 150pt
  doc.line(250, 200, 50, 200); // cierra el rectangulo (3er lado)
  doc.line(50, 200, 50, 50);   // 4to lado
  doc.line(250, 200, 350, 200); // muro adicional (plano con mas de 1 cuarto)
  doc.line(350, 200, 350, 320);
  doc.setFontSize(10);
  doc.text('ESCALA 1:50', 50, 380);
  return Buffer.from(doc.output('arraybuffer'));
}

function buildScannedPdfBuffer(){
  const doc = new jsPDF({ unit: 'pt', format: [600, 400] });
  // Una imagen rasterizada ocupando la pagina, SIN ningun trazo vectorial ni
  // texto -- equivalente real a un plano escaneado metido en un PDF.
  doc.addImage(`data:image/png;base64,${TINY_PNG_BASE64}`, 'PNG', 0, 0, 600, 400);
  return Buffer.from(doc.output('arraybuffer'));
}

test('TEST QA 1 -- PDF vectorial real: extractVectorGeometry recupera segmentos reales y el dominio los usa', async () => {
  const buffer = buildVectorPdfBuffer();
  const extracted = await extractVectorGeometry(buffer, { maxPages: 10 });
  assert.equal(extracted.numPages, 1);
  assert.ok(extracted.allSegments.length >= 4, `se esperaban al menos 4 segmentos, hubo ${extracted.allSegments.length}`);
  assert.equal(hasUsableVectorGeometry(extracted.allSegments), true);

  const walls = groupSegmentsIntoWalls(extracted.allSegments);
  assert.ok(walls.length >= 1);
  // Las longitudes reales (200pt y 150pt) deben aparecer entre las corridas
  // detectadas (con tolerancia de redondeo de pdfjs).
  const lengths = walls.map(w => Math.round(w.lengthPt));
  assert.ok(lengths.some(l => Math.abs(l - 200) <= 2), `no se encontro un muro de ~200pt entre ${lengths.join(',')}`);
  assert.ok(lengths.some(l => Math.abs(l - 150) <= 2), `no se encontro un muro de ~150pt entre ${lengths.join(',')}`);

  const graphicScale = detectGraphicScale(extracted.allTextItems);
  assert.ok(graphicScale, 'debia detectar "ESCALA 1:50" en el texto real del PDF');
  assert.equal(graphicScale.fuente, 'escala_grafica');
});

test('TEST QA 2 -- PDF escaneado real (solo imagen, sin trazos): sin geometria vectorial aprovechable', async () => {
  const buffer = buildScannedPdfBuffer();
  const extracted = await extractVectorGeometry(buffer, { maxPages: 10 });
  assert.equal(extracted.numPages, 1);
  assert.equal(hasUsableVectorGeometry(extracted.allSegments), false);
  assert.equal(extracted.allTextItems.length, 0); // sin capa de texto: es una imagen, no OCR
});

test('extractVectorGeometry nunca lanza por un PDF vacio/minimo (defensivo)', async () => {
  const doc = new jsPDF({ unit: 'pt', format: [600, 400] });
  const buffer = Buffer.from(doc.output('arraybuffer'));
  const extracted = await extractVectorGeometry(buffer, { maxPages: 10 });
  assert.equal(extracted.allSegments.length, 0);
  assert.equal(hasUsableVectorGeometry(extracted.allSegments), false);
});

test('extractVectorGeometry respeta maxPages sin leer paginas de mas', async () => {
  const doc = new jsPDF({ unit: 'pt', format: [600, 400] });
  doc.text('pagina 1', 10, 10);
  doc.addPage(); doc.text('pagina 2', 10, 10);
  doc.addPage(); doc.text('pagina 3', 10, 10);
  const buffer = Buffer.from(doc.output('arraybuffer'));
  const extracted = await extractVectorGeometry(buffer, { maxPages: 2 });
  assert.equal(extracted.numPages, 3); // el documento SI tiene 3 paginas
  assert.equal(extracted.pages.length, 2); // pero solo se leyeron 2
});
