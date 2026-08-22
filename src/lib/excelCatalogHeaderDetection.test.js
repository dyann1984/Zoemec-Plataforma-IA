/* DEFECTO 2 (reporte real): el detector de catalogos no puede depender de
   encabezados literales exactos "Clave/Descripcion/Unidad/Cantidad" en la
   fila 1, y NUNCA debe adivinar columnas por posicion cuando la confianza
   estructural no alcanza el umbral -- en ese caso debe reportar un
   diagnostico util (que hojas y encabezados se encontraron), nunca
   silenciar el fallo ni inventar un concepto. Estas pruebas usan
   directamente extractConceptsFromSheetRows/extractConceptsFromWorkbookRows
   (logica pura, sin lectura de archivo) para cubrir la matriz de
   equivalencias y los casos de diagnostico sin depender de un archivo real. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractConceptsFromSheetRows, extractConceptsFromWorkbookRows, formatCatalogDiagnostic } from './excelImport.js';

function rows(...arr){ return arr; }

test('reconoce Codigo/Descripcion/Unidad/Cantidad clasico (fila 1)', () => {
  const { concepts, diagnostic } = extractConceptsFromSheetRows(rows(
    ['Codigo','Descripcion','Unidad','Cantidad'],
    ['A-1','Suministro y colocacion de piso ceramico 30x30 cm', 'm2', 120]
  ), 'Hoja1');
  assert.equal(diagnostic, null);
  assert.equal(concepts.length, 1);
  assert.equal(concepts[0].code, 'A-1');
  assert.equal(concepts[0].unit, 'm²');
  assert.equal(concepts[0].qty, 120);
});

test('reconoce equivalencias habituales: No. / Descripcion del concepto / U.M. / Volumen, encabezado NO en fila 1', () => {
  const { concepts, diagnostic } = extractConceptsFromSheetRows(rows(
    ['PROYECTO DE PRUEBA'],
    ['Cliente: Institucion sanitizada'],
    [],
    ['No.','Descripcion del concepto','U.M.','Volumen','Observaciones'],
    ['12','Suministro e instalacion de tuberia hidraulica de 1 pulgada, PVC hidraulico', 'ML', 45.5, '']
  ), 'Hoja2');
  assert.equal(diagnostic, null);
  assert.equal(concepts.length, 1);
  assert.equal(concepts[0].code, '12');
  assert.equal(concepts[0].unit, 'ml');
  assert.equal(concepts[0].qty, 45.5);
});

test('reconoce Partida / Concepto / Und. / Cantidad (otra variante habitual)', () => {
  const { concepts, diagnostic } = extractConceptsFromSheetRows(rows(
    ['Partida','Concepto','Und.','Cantidad','P.U.','Importe'],
    ['3','Demolicion de firme de concreto de 10 cm de espesor por medios manuales', 'M2', 88, 45, 3960]
  ), 'Hoja3');
  assert.equal(diagnostic, null);
  assert.equal(concepts.length, 1);
  assert.equal(concepts[0].code, '3');
  assert.equal(concepts[0].unit, 'm²');
});

test('columnas adicionales (Tipo, Clasificacion, Observaciones) no interfieren con la deteccion', () => {
  const { concepts } = extractConceptsFromSheetRows(rows(
    ['Clave','Descripcion','Tipo','Unidad','Cantidad','P.U. PROFORMA','Importe','Clasificacion','Observaciones'],
    ['7','Suministro y aplicacion de pintura vinilica en muros interiores, dos manos', 'ACABADO', 'M2', 250, 85.5, 21375, '1', '']
  ), 'Hoja4');
  assert.equal(concepts.length, 1);
  assert.equal(concepts[0].qty, 250);
  assert.equal(concepts[0].referencePU, 85.5);
});

test('claves duplicadas dentro de la misma hoja se conservan como renglones independientes (no se sacrifica el arreglo anterior)', () => {
  const { concepts } = extractConceptsFromSheetRows(rows(
    ['Clave','Descripcion','Unidad','Cantidad'],
    ['100','Suministro e instalacion de llave de nariz cromada de 1/2 pulgada', 'PZA', 10],
    ['100','Suministro e instalacion de llave de nariz cromada de 1/2 pulgada', 'PZA', 6]
  ), 'HojaDup');
  assert.equal(concepts.length, 2);
  assert.deepEqual(concepts.map(c=>c.qty).sort((a,b)=>a-b), [6,10]);
  assert.notEqual(concepts[0].rowNumber, concepts[1].rowNumber);
});

test('DIAGNOSTICO: hoja sin ninguna columna de descripcion/concepto reconocible -> nunca adivina por posicion', () => {
  const { concepts, diagnostic } = extractConceptsFromSheetRows(rows(
    ['Reporte fotografico de avance de obra'],
    ['Fecha', 'Zona', 'Responsable'],
    ['2026-01-01', 'Nivel 1', 'Ing. Perez']
  ), 'Fotos');
  assert.equal(concepts.length, 0);
  assert.ok(diagnostic);
  assert.equal(diagnostic.headerRow, null);
  assert.equal(diagnostic.descriptionFound, false);
  assert.equal(diagnostic.unitFound, false);
  assert.equal(diagnostic.qtyFound, false);
  assert.match(diagnostic.reason, /no se encontro ninguna columna de Descripcion\/Concepto/i);
});

test('DIAGNOSTICO: se reconoce Descripcion pero falta Unidad y Cantidad en esa fila -> reporta la fila exacta, no adivina', () => {
  const { concepts, diagnostic } = extractConceptsFromSheetRows(rows(
    ['Introduccion general del proyecto'],
    [],
    ['Descripcion', 'Responsable', 'Fecha'],
    ['Se realizaran trabajos de remodelacion general del inmueble', 'Ing. Lopez', '2026-01-01']
  ), 'Memoria');
  assert.equal(concepts.length, 0);
  assert.ok(diagnostic);
  assert.equal(diagnostic.headerRow, 3);
  assert.equal(diagnostic.descriptionFound, true);
  assert.equal(diagnostic.unitFound, false);
  assert.equal(diagnostic.qtyFound, false);
  assert.match(diagnostic.reason, /unidad ni de cantidad/i);
});

test('formatCatalogDiagnostic: produce el formato exacto pedido (Hoja / Encabezado candidato / Descripcion / Unidad / Cantidad)', () => {
  const { diagnostic } = extractConceptsFromSheetRows(rows(
    ['Titulo'], [], [], [], [], [],
    ['Descripcion', 'Otra columna'],
    ['Texto de un renglon cualquiera sin unidad ni cantidad', 'x']
  ), 'Catalogo');
  const text = formatCatalogDiagnostic(diagnostic);
  assert.match(text, /^Hoja: Catalogo$/m);
  assert.match(text, /^Filas inspeccionadas: \d+$/m);
  assert.match(text, /^Encabezado candidato: fila 7$/m);
  assert.match(text, /^Descripcion: detectada$/m);
  assert.match(text, /^Unidad: no detectada$/m);
  assert.match(text, /^Cantidad: no detectada$/m);
  assert.match(text, /^Motivo: .+$/m);
});

test('NUNCA adivina columnas por posicion: una celda que coincide por casualidad con un token de unidad no genera un concepto', () => {
  // "M" (unidad valida) aparece en una tabla que en realidad describe otra
  // cosa (dimensiones de un local), sin ningun encabezado de catalogo real.
  const { concepts, diagnostic } = extractConceptsFromSheetRows(rows(
    ['Ficha tecnica del local comercial'],
    ['Ancho', 'M', '8', 'Alto', 'M', '3'],
    ['Superficie util aproximada del local segun plano arquitectonico adjunto']
  ), 'Ficha');
  assert.equal(concepts.length, 0, 'no debe inventar un concepto a partir de una coincidencia posicional de "M"');
  assert.ok(diagnostic);
});

test('extractConceptsFromWorkbookRows agrega diagnostics por hoja cuando ninguna produce conceptos', () => {
  const { concepts, diagnostics } = extractConceptsFromWorkbookRows([
    { sheetName: 'PORTADA', rows: rows(['Proyecto de prueba'], ['Cliente: X']) },
    { sheetName: 'NOTAS', rows: rows(['Notas generales'], ['Ninguna observacion adicional']) }
  ]);
  assert.equal(concepts.length, 0);
  assert.equal(diagnostics.length, 2);
  assert.equal(diagnostics[0].sheetName, 'PORTADA');
  assert.equal(diagnostics[1].sheetName, 'NOTAS');
});
