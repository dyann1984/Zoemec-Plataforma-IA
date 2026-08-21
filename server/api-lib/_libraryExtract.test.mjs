import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import writeXlsxFileNode from 'write-excel-file/node';
import { rowsToInsumos, extractExcelInsumos, extractCsvInsumos, extractPdfText, extractLibraryContent, countPdfPages } from './_libraryExtract.mjs';

async function buildXlsxBuffer(rows){
  const data = rows.map(row => row.map(cell => ({ value: cell })));
  const writer = await writeXlsxFileNode(data);
  return writer.toBuffer();
}

test('rowsToInsumos detecta encabezado real (descripcion/precio/unidad) y extrae filas', () => {
  const rows = [
    ['Clave', 'Descripcion', 'Unidad', 'Precio'],
    ['MAT-001', 'Block hueco 15x20x40', 'pza', 15.5],
    ['MAT-002', 'Cemento portland tipo I', 'bulto', 180]
  ];
  const insumos = rowsToInsumos(rows);
  assert.equal(insumos.length, 2);
  assert.equal(insumos[0].desc, 'Block hueco 15x20x40');
  assert.equal(insumos[0].unidad, 'pza');
  assert.equal(insumos[0].precio, 15.5);
  assert.equal(insumos[0].clave, 'MAT-001');
  assert.ok(insumos[0].confidence >= 60, 'confianza mayor cuando hay encabezado reconocido');
});

test('rowsToInsumos usa heuristica posicional cuando no hay encabezado reconocible', () => {
  const rows = [
    ['Arena lavada m3', 'm3', 450],
    ['Grava 19mm', 'm3', 520]
  ];
  const insumos = rowsToInsumos(rows);
  assert.equal(insumos.length, 2);
  assert.equal(insumos[0].desc, 'Arena lavada m3');
  assert.equal(insumos[0].precio, 450);
  assert.ok(insumos[0].confidence < 60, 'confianza menor sin encabezado reconocido');
});

test('rowsToInsumos descarta filas sin precio positivo o sin descripcion', () => {
  const rows = [
    ['Descripcion', 'Precio'],
    ['Item valido', 100],
    ['Item sin precio', 0],
    ['', 50]
  ];
  const insumos = rowsToInsumos(rows);
  assert.equal(insumos.length, 1);
  assert.equal(insumos[0].desc, 'Item valido');
});

test('rowsToInsumos regresa vacio para entradas vacias/invalidas', () => {
  assert.deepEqual(rowsToInsumos([]), []);
  assert.deepEqual(rowsToInsumos(null), []);
});

test('extractExcelInsumos: xlsx real generado con write-excel-file se extrae correctamente', async () => {
  const buffer = await buildXlsxBuffer([
    ['Descripcion', 'Unidad', 'Precio'],
    ['Cemento portland tipo I, bolsa 50 kg', 'bulto', 180],
    ['Arena lavada para mortero', 'm3', 450]
  ]);
  const result = await extractExcelInsumos(buffer);
  assert.equal(result.status, 'done');
  assert.equal(result.method, 'excel');
  assert.equal(result.contentInsumos.length, 2);
  assert.equal(result.contentInsumos[0].precio, 180);
});

test('extractExcelInsumos: xlsx sin filas reconocibles regresa status "empty" (nunca inventa insumos)', async () => {
  const buffer = await buildXlsxBuffer([
    ['Solo texto', 'sin numeros aqui'],
    ['Otra fila', 'tampoco']
  ]);
  const result = await extractExcelInsumos(buffer);
  assert.equal(result.status, 'empty');
  assert.equal(result.contentInsumos.length, 0);
  assert.ok(result.error);
});

test('extractCsvInsumos: CSV real se extrae correctamente', async () => {
  const csv = 'Descripcion,Unidad,Precio\nBlock hueco 15x20x40,pza,15.5\nCemento portland,bulto,180\n';
  const result = await extractCsvInsumos(Buffer.from(csv, 'utf8'));
  assert.equal(result.status, 'done');
  assert.equal(result.method, 'csv');
  assert.equal(result.contentInsumos.length, 2);
});

test('extractPdfText: PDF real (texto) generado con jsPDF se extrae correctamente', async () => {
  const doc = new jsPDF();
  doc.text('Salario minimo 2026: $315.04 diarios', 10, 20);
  const buffer = Buffer.from(doc.output('arraybuffer'));
  const result = await extractPdfText(buffer);
  assert.equal(result.status, 'done');
  assert.equal(result.method, 'pdf-text');
  assert.match(result.contentText, /315\.04/);
});

test('extractPdfText: buffer que no es un PDF valido regresa status "error", nunca lanza', async () => {
  const result = await extractPdfText(Buffer.from('esto no es un pdf'));
  assert.equal(result.status, 'error');
  assert.ok(result.error);
});

test('extractLibraryContent: docx queda marcado unsupported sin bloquear el resto de Biblioteca', async () => {
  const result = await extractLibraryContent({ buffer: Buffer.from('x'), ext: 'docx' });
  assert.equal(result.status, 'unsupported');
  assert.equal(result.method, 'none');
});

test('countPdfPages: cuenta correctamente un PDF real de 1 pagina (usado por el tope de 10 paginas de Takeoff)', async () => {
  const doc = new jsPDF(); doc.text('pagina unica', 10, 20);
  const buffer = Buffer.from(doc.output('arraybuffer'));
  const numPages = await countPdfPages(buffer);
  assert.equal(numPages, 1);
});

test('countPdfPages: cuenta correctamente un PDF real de varias paginas', async () => {
  const doc = new jsPDF();
  doc.text('pagina 1', 10, 20); doc.addPage(); doc.text('pagina 2', 10, 20); doc.addPage(); doc.text('pagina 3', 10, 20);
  const buffer = Buffer.from(doc.output('arraybuffer'));
  const numPages = await countPdfPages(buffer);
  assert.equal(numPages, 3);
});

test('extractLibraryContent: enruta xlsx/csv/pdf a su extractor correspondiente', async () => {
  const xlsxBuffer = await buildXlsxBuffer([['Descripcion', 'Precio'], ['Item', 10]]);
  const xlsx = await extractLibraryContent({ buffer: xlsxBuffer, ext: 'xlsx' });
  assert.equal(xlsx.method, 'excel');

  const csv = await extractLibraryContent({ buffer: Buffer.from('Descripcion,Precio\nItem,10\n'), ext: 'csv' });
  assert.equal(csv.method, 'csv');

  const doc = new jsPDF(); doc.text('texto de prueba', 10, 20);
  const pdf = await extractLibraryContent({ buffer: Buffer.from(doc.output('arraybuffer')), ext: 'pdf' });
  assert.equal(pdf.method, 'pdf-text');
});
