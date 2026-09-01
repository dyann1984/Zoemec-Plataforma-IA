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

/* Bug real (auditoria forense sobre CATALOGO ALBAÑILERIAS KI RESIDENCES
   REV_01.xlsx): una fila sin clave que en realidad es el encabezado de la
   SIGUIENTE subseccion (ej. "SARDINELES PARA CANCELERÍA", que antecede al
   concepto 1313000011) se pegaba como continuacion de texto al concepto
   ANTERIOR (PUA877), porque looksLikeContinuationRow no distinguia "texto
   que completa una oracion cortada por el wrap de columna de Excel" de
   "encabezado de la siguiente subseccion" -- ambos vienen sin clave/unidad/
   cantidad y en mayusculas en este tipo de catalogo, asi que MAYUSCULAS por
   si solas nunca alcanzan. La señal real es si la oracion pendiente YA
   estaba completa (termina en punto/dos puntos/cierre) antes de esta fila:
   una continuacion real solo ocurre a media oracion. */
test('CASO 1 -- continuacion real de descripcion (oracion cortada por el wrap de columna) SIGUE concatenandose', () => {
  const { concepts } = extractConceptsFromSheetRows(rows(
    ['Código','Concepto','Unidad','Cantidad'],
    ['1502000021', 'MURO DE 15Cm. ESP. DE BLOCK HUECO DE 15x20x40Cm. ASENTADO CON MORTERO CEM-ARENA 1:5. INCLUYE: MATERIALES, ANDAMIOS, MANO DE OBRA EQUIPO, HERRAMIENTA Y TODO LO', 'M2', 14.85],
    [null, 'NECESARIO PARA SU CORRECTA EJECUCION.', null, null]
  ), 'ALBAÑILERIAS');
  assert.equal(concepts.length, 1);
  assert.match(concepts[0].concept, /HERRAMIENTA Y TODO LO NECESARIO PARA SU CORRECTA EJECUCION\.$/);
});

test('CASO 2 -- fila de encabezado de subseccion sin clave, entre dos conceptos validos, NO se concatena al concepto anterior', () => {
  const { concepts } = extractConceptsFromSheetRows(rows(
    ['Código','Concepto','Unidad','Cantidad'],
    ['PUA877', 'NICHO SOBRE MURO A UNA ALTURA DE 2.50 MTS PARA VÁLVULA ESFÉRICA, INCLUYE: MATERIALES, MANO DE OBRA, EQUIPO Y HERRAMIENTA.', 'PZA', 63],
    [null, 'SARDINELES PARA CANCELERÍA', null, null],
    ['1313000011', "SARDINEL DE 15X10 CMS CON CONCRETO F'C=100KG/CM2, INCLUYE: COLADO, VIBRADO, CURADO, MANO DE OBRA Y TODO LO NECESARIO PARA SU CORRECTA EJECUCION.", 'ML', 160]
  ), 'ALBAÑILERIAS');
  assert.equal(concepts.length, 2);
  assert.equal(concepts[0].code, 'PUA877');
  assert.doesNotMatch(concepts[0].concept, /SARDINELES/);
  assert.match(concepts[0].concept, /HERRAMIENTA\.$/);
  assert.equal(concepts[1].code, '1313000011');
});

test('CASO 4 y 5 -- catalogo real ALBAÑILERIAS: PUA877 ya no absorbe "SARDINELES PARA CANCELERÍA" y 1313000011 sigue presente', () => {
  const { concepts } = extractConceptsFromSheetRows(rows(
    ['Código','Concepto','Unidad','Cantidad'],
    ['PUA877', 'NICHO SOBRE MURO A UNA ALTURA DE 2.50 MTS DE MEDIDAS 20X20X7 CMS PARA VÁLVULA ESFÉRICA TIPO PESADA EN PVC DE 1/2 PULGADA PARA CEMENTAR, INCLUYE: MATERIALES, MANO DE OBRA, EQUIPO Y HERRAMIENTA.', 'PZA', 63],
    [null, 'Total NICHO PARA INSTALACIONES HVAC', null, null],
    [],
    [null, 'SARDINELES PARA CANCELERÍA', null, null],
    ['1313000011', "SARDINEL DE 15X10 CMS CON CONCRETO F'C=100KG/CM2 EN TERRAZA CON CEMENTO NORMAL, TAMAÑO MÁXIMO DE AGREGADO 3/4, ELABORADO EN OBRA CON REVOLVEDORA, VIBRADOR, INCLUYE: COLADO, VIBRADO, CURADO, CIMBRADO, DESCIMBRADO, HERRAMIENTA MENOR, MANO DE OBRA Y TODO LO NECESARIO PARA SU CORRECTA EJECUCION.", 'ML', 160]
  ), 'ALBAÑILERIAS');
  const pua877 = concepts.find(c => c.code === 'PUA877');
  const sardinel = concepts.find(c => c.code === '1313000011');
  assert.ok(pua877, 'PUA877 debe seguir presente');
  assert.doesNotMatch(pua877.concept, /SARDINELES PARA CANCELER[IÍ]A/i, 'PUA877 no debe absorber el encabezado de la siguiente subseccion');
  assert.equal(pua877.qty, 63, 'la cantidad de PUA877 no debe alterarse por el fix');
  assert.ok(sardinel, '1313000011 (SARDINEL) sigue existiendo correctamente');
  assert.equal(sardinel.qty, 160);
});

test('CASO 3 y 6 -- catalogo multi-nivel (misma forma que KI RESIDENCES): encabezados de subseccion entre niveles no contaminan ni reducen el conteo de conceptos, claves y unidades', () => {
  // Estructura fiel al catalogo real: encabezado de nivel (C01/C02, sin
  // unidad/cantidad), N conceptos por nivel, fila "Total ..." de cierre, y
  // -- el caso que causaba el bug -- un encabezado de subseccion sin clave
  // que antecede a un concepto de una clave distinta.
  const { concepts } = extractConceptsFromSheetRows(rows(
    ['Código','Concepto','Unidad','Cantidad'],
    ['C01', 'ALBAÑILERÍA SOTANO', null, null],
    ['2101000014', 'APLANADO DE MURO CON MORTERO CEMENTOARENA 1:3, INCLUYE: MATERIALES Y MANO DE OBRA.', 'M2', 331.85],
    ['1502000021', 'MURO DE 15Cm. ESP. DE BLOCK HUECO, ASENTADO CON MORTERO CEM-ARENA 1:5. INCLUYE: MATERIALES, ANDAMIOS, MANO DE OBRA EQUIPO, HERRAMIENTA Y TODO LO', 'M2', 14.85],
    [null, 'NECESARIO PARA SU CORRECTA EJECUCION.', null, null],
    [null, 'Total ALBAÑILERÍA SOTANO', null, null],
    ['C02', 'ALBAÑILERÍA PLANTA BAJA', null, null],
    ['2101000014', 'APLANADO DE MURO CON MORTERO CEMENTOARENA 1:3, INCLUYE: MATERIALES Y MANO DE OBRA.', 'M2', 244.64],
    ['1502000021', 'MURO DE 15Cm. ESP. DE BLOCK HUECO, ASENTADO CON MORTERO CEM-ARENA 1:5. INCLUYE: MATERIALES, ANDAMIOS, MANO DE OBRA EQUIPO, HERRAMIENTA Y TODO LO', 'M2', 244.64],
    [null, 'NECESARIO PARA SU CORRECTA EJECUCION.', null, null],
    ['PUA877', 'NICHO SOBRE MURO A UNA ALTURA DE 2.50 MTS PARA VÁLVULA ESFÉRICA, INCLUYE: MATERIALES, MANO DE OBRA, EQUIPO Y HERRAMIENTA.', 'PZA', 63],
    [null, 'SARDINELES PARA CANCELERÍA', null, null],
    ['1313000011', "SARDINEL DE 15X10 CMS CON CONCRETO F'C=100KG/CM2, INCLUYE: COLADO, VIBRADO, MANO DE OBRA Y TODO LO NECESARIO PARA SU CORRECTA EJECUCION.", 'ML', 160]
  ), 'ALBAÑILERIAS');

  // 6 conceptos reales esperados: 2101000014 x2, 1502000021 x2, PUA877 x1, 1313000011 x1
  // (la fila placeholder ['PUA877'... sin unidad] no es un item valido -- se ignora, no se cuenta doble)
  const codes = concepts.map(c => c.code);
  assert.equal(codes.filter(c => c === '2101000014').length, 2);
  assert.equal(codes.filter(c => c === '1502000021').length, 2);
  assert.equal(codes.filter(c => c === 'PUA877').length, 1);
  assert.equal(codes.filter(c => c === '1313000011').length, 1);
  assert.equal(concepts.length, 6, 'ningun concepto real se pierde ni se duplica por el fix');

  const pua877 = concepts.find(c => c.code === 'PUA877');
  assert.doesNotMatch(pua877.concept, /SARDINELES/);
  assert.equal(concepts.every(c => c.unit), true, '112/112 en el catalogo real: todas las unidades siguen reconociendose');
  assert.equal(concepts.every(c => c.qty > 0), true, '112/112 en el catalogo real: todas las cantidades siguen siendo > 0');
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
