import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConceptText, parseConceptListText, conceptVariablesFromParsed, parseCatalogRows } from './excelImport.js';
import { findCatalogMatches } from '../domain/catalogLookup.js';

test('parseConceptText no interpreta proporcion 1:4 ni dimensiones como P.U.',()=>{
  const parsed=parseConceptText('Suministro y colocación de muro de block hueco de concreto de 15 x 20 x 40 cm, asentado con mortero cemento-arena 1:4.');
  assert.equal(parsed.referencePU,0);
  assert.equal(parsed.qty,1);
});

test('parseConceptText conserva cantidad y P.U. explicitos despues de la unidad',()=>{
  const parsed=parseConceptText('Muro de block 15 x 20 x 40 cm con mortero 1:4 m2 25 $816.89');
  assert.equal(parsed.unit,'m²');
  assert.equal(parsed.qty,25);
  assert.equal(parsed.referencePU,816.89);
});

test('parseConceptText reconoce la unidad m² sin confundir el superindice con cantidad',()=>{
  const parsed=parseConceptText('Muro de block m² 25 $816.89');
  assert.equal(parsed.unit,'m²');
  assert.equal(parsed.qty,25);
  assert.equal(parsed.referencePU,816.89);
});

// --- Test G: unidad pegada al numero, sin espacio ---
test('parseConceptText reconoce 64m2 (sin espacio) como cantidad 64 / unidad m²',()=>{
  const parsed=parseConceptText('demolicion de loseta 64m2');
  assert.equal(parsed.qty,64);
  assert.equal(parsed.unit,'m²');
  assert.equal(parsed.referencePU,0);
});

// --- Test H: volumen pegado + distancia nunca se vuelve cantidad/P.U. ---
test('parseConceptText: 1.5m3 distancia 25m -> qty 1.5/unit m³, la distancia no contamina referencePU',()=>{
  const parsed=parseConceptText('acarreo de loseta 1.5m3 distancia 25m');
  assert.equal(parsed.qty,1.5);
  assert.equal(parsed.unit,'m³');
  assert.equal(parsed.referencePU,0);
});

// --- Test I: sustantivo de conteo (costales) como unidad operativa ---
test('parseConceptText: 46 costales distancia 25m -> qty 46/unit costal',()=>{
  const parsed=parseConceptText('acarreo de 46 costales distancia 25m');
  assert.equal(parsed.qty,46);
  assert.equal(parsed.unit,'costal');
  assert.equal(parsed.referencePU,0);
});

// --- Test J: una distancia nunca sustituye la cantidad principal ---
test('parseConceptText: la distancia nunca reemplaza la cantidad principal aunque sea el unico otro numero',()=>{
  const parsed=parseConceptText('acarreo de material distancia 40m');
  assert.notEqual(parsed.qty,40);
  assert.equal(parsed.qty,1);
});

// --- Test M: la descripcion original NUNCA pierde texto tecnico (distancia, volumen, etc.) ---
test('Test M: originalDescription/concept conservan el texto completo, incluida la distancia despues de la unidad',()=>{
  const parsed=parseConceptText('acarreo de loseta 1.5m3 distancia 25m');
  assert.ok(parsed.originalDescription.toLowerCase().includes('distancia 25m'), `originalDescription perdio la distancia: "${parsed.originalDescription}"`);
  assert.equal(parsed.concept, parsed.originalDescription, 'concept debe ser exactamente originalDescription, nunca una version recortada');
});

// --- Test N: variables estructuradas de volumen + distancia ---
test('Test N: 1.5m3 distancia 25m -> volume=1.5/volumeUnit=m³, distance=25/distanceUnit=m',()=>{
  const parsed=parseConceptText('acarreo de loseta 1.5m3 distancia 25m');
  assert.equal(parsed.volume,1.5);
  assert.equal(parsed.volumeUnit,'m³');
  assert.equal(parsed.distance,25);
  assert.equal(parsed.distanceUnit,'m');
  assert.equal(parsed.pieceCount,null);
});

// --- Test O: variables estructuradas de conteo de piezas + distancia ---
test('Test O: 46 costales distancia 25m -> pieceCount=46/pieceUnit=costal, distance=25',()=>{
  const parsed=parseConceptText('acarreo de 46 costales distancia 25m');
  assert.equal(parsed.pieceCount,46);
  assert.equal(parsed.pieceUnit,'costal');
  assert.equal(parsed.distance,25);
  assert.equal(parsed.distanceUnit,'m');
  assert.equal(parsed.volume,null);
});

// --- Test Q: la distancia jamas se interpreta como quantity/referencePU/volumen ---
test('Test Q: la distancia nunca se interpreta como quantity, referencePU o volumen',()=>{
  const parsed=parseConceptText('acarreo de material distancia 40m');
  assert.equal(parsed.quantity,1);
  assert.equal(parsed.referencePU,0);
  assert.equal(parsed.volume,null);
  assert.equal(parsed.pieceCount,null);
  assert.equal(parsed.distance,40);
});

test('conceptVariablesFromParsed adjunta las variables sin pisar concept/unit/qty existentes',()=>{
  const parsed=parseConceptText('acarreo de 46 costales distancia 25m');
  const variables=conceptVariablesFromParsed(parsed);
  assert.equal(variables.quantity,46);
  assert.equal(variables.pieceCount,46);
  assert.equal(variables.pieceUnit,'costal');
  assert.equal(variables.distance,25);
  assert.equal(variables.originalDescription,parsed.originalDescription);
});

// --- Test D: segmentacion de texto pegado con varios formatos de numeracion ---
test('parseConceptListText segmenta renglones numerados "1-" en conceptos independientes',()=>{
  const text=[
    '1-Movimiento de mueble',
    '2-demolicion de loseta 64m2',
    '3-acarreo 46 costales distancia 25m',
    '4-acarreo de loseta 1.5m3 distancia 25m',
    '5-aplicación de adhesivo 64m2',
    '6-colocación de loseta 64m2'
  ].join('\n');
  const { concepts } = parseConceptListText(text);
  assert.equal(concepts.length,6);
  assert.equal(concepts[0].concept,'Movimiento de mueble');
  assert.equal(concepts[1].qty,64);
  assert.equal(concepts[1].unit,'m²');
  assert.equal(concepts[2].qty,46);
  assert.equal(concepts[2].unit,'costal');
  assert.equal(concepts[3].qty,1.5);
  assert.equal(concepts[3].unit,'m³');
  assert.equal(concepts[3].referencePU,0);
});

test('parseConceptListText segmenta "1." y "01 " ademas de "1-"',()=>{
  const dot=parseConceptListText('1. Movimiento de mueble\n2. Demolición de loseta');
  assert.equal(dot.concepts.length,2);
  const zeroPad=parseConceptListText('01 Movimiento de mueble\n02 Demolición de loseta');
  assert.equal(zeroPad.concepts.length,2);
  assert.equal(zeroPad.concepts[0].concept,'Movimiento de mueble');
});

// Caso Fase 5 del ticket: "02 demolicion..." en minuscula, sin puntuacion --
// el contexto de lista (mayoria de renglones con forma de indice) debe
// reconocerlo, no solo la mayuscula.
test('parseConceptListText: numeracion "01 "/"02 "/"03 " sin puntuacion se reconoce por CONTEXTO aunque la palabra siguiente sea minuscula',()=>{
  const { concepts } = parseConceptListText([
    '01 Movimiento de mueble',
    '02 demolicion de loseta 64m2',
    '03 acarreo 46 costales distancia 25m'
  ].join('\n'));
  assert.equal(concepts.length,3);
  assert.equal(concepts[0].concept,'Movimiento de mueble');
  assert.equal(concepts[1].concept,'demolicion de loseta 64m2');
  assert.equal(concepts[1].qty,64); assert.equal(concepts[1].unit,'m²');
  assert.equal(concepts[2].concept,'acarreo 46 costales distancia 25m');
  assert.equal(concepts[2].qty,46); assert.equal(concepts[2].unit,'costal');
});

// Falso positivo explicito del ticket: "25 m² de piso" nunca debe
// interpretarse como el indice "25", ni siquiera dentro de un bloque que
// por lo demas es una lista numerada.
test('parseConceptListText: "25 m² de piso" nunca se confunde con un indice de lista, ni en contexto numerado',()=>{
  const { concepts } = parseConceptListText([
    '1-Movimiento de mueble',
    '2-demolicion de loseta 64m2',
    '25 m² de piso adicional en pasillo'
  ].join('\n'));
  assert.equal(concepts.length,3);
  assert.equal(concepts[2].concept,'25 m² de piso adicional en pasillo', 'el "25" debe quedar como cantidad del concepto, no recortarse como indice');
  assert.equal(concepts[2].qty,25);
  assert.equal(concepts[2].unit,'m²');
});

test('parseConceptListText segmenta por salto de linea simple, sin numeracion',()=>{
  const { concepts } = parseConceptListText('Movimiento de mueble\nDemolición de loseta 64m2');
  assert.equal(concepts.length,2);
});

test('parseConceptListText devuelve un solo concepto cuando el texto trae un solo renglon (sin cambiar el camino existente)',()=>{
  const { concepts } = parseConceptListText('Muro de block m² 25 $816.89');
  assert.equal(concepts.length,1);
  assert.equal(concepts[0].qty,25);
});

test('parseConceptListText nunca fusiona renglones distintos en un solo concepto',()=>{
  const text=['Movimiento de mueble','Demolición de loseta 64m2','Aplicación de adhesivo 64m2'].join('\n');
  const { concepts } = parseConceptListText(text);
  assert.equal(concepts.length,3);
  // Ningun concepto individual debe contener el texto de MAS de uno de los
  // 3 renglones originales (eso indicaria que dos renglones se fusionaron
  // en un solo item, en vez de quedar como 3 items independientes).
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  concepts.forEach(c=>{
    const n = norm(c.concept);
    const hits = ['mueble','demolici','adhesivo'].filter(kw=>n.includes(kw)).length;
    assert.ok(hits<=1, `concepto fusionado detectado: "${c.concept}"`);
  });
});

// --- parseCatalogRows: preservacion de clave/categoria/estado/proveedor/
// fecha/sinonimos/rendimiento (gap reportado 2026-08-27: el parser solo
// extraia {desc,unidad,precio} y descartaba en silencio cualquier otra
// columna, aunque el Excel la trajera -- obligaba al pipeline de matching
// (findCatalogMatches, catalogLookup.js) a depender siempre de fuzzy_token,
// nunca de clave_exacta/alias_sinonimo/categoria_unidad). Estas pruebas
// verifican SOLO el importador (parseCatalogRows) y, al final, el
// round-trip real hasta catalogLookup.js -- no tocan apuGeneration.js. ---

test('parseCatalogRows preserva clave, categoria, estado, proveedor/fuente, fecha, sinonimos y rendimiento cuando el Excel los trae', () => {
  const rows = [
    ['Clave', 'Descripcion', 'Unidad', 'Precio', 'Categoria', 'Estado', 'Proveedor', 'Fecha', 'Sinonimos', 'Rendimiento'],
    ['MAT-IMPER-01', 'Impermeabilizante acrílico elastomérico', 'L', '145', 'Impermeabilizacion', 'verificado', 'Proveedor XYZ', '2026-08-01', 'pintura impermeabilizante; sellador acrilico para azotea', '']
  ];
  const catalog = parseCatalogRows(rows);
  assert.equal(catalog.length, 1);
  const item = catalog[0];
  assert.equal(item.desc, 'Impermeabilizante acrílico elastomérico');
  assert.equal(item.unidad, 'L');
  assert.equal(item.precio, 145);
  assert.equal(item.clave, 'MAT-IMPER-01');
  assert.equal(item.categoria, 'Impermeabilizacion');
  assert.equal(item.estado, 'VERIFICADO');
  assert.equal(item.fuente, 'Proveedor XYZ');
  assert.equal(item.fecha, '2026-08-01');
  assert.deepEqual(item.sinonimos, ['pintura impermeabilizante', 'sellador acrilico para azotea']);
  assert.equal(item.rendimiento, undefined, 'columna Rendimiento vacia en este renglon: no se fabrica un valor');
});

test('parseCatalogRows NUNCA eleva un registro a VERIFICADO por defecto: solo con coincidencia textual explicita', () => {
  const rows = [
    ['Clave', 'Descripcion', 'Unidad', 'Precio', 'Estado'],
    ['MAT-01', 'Cemento gris', 'kg', '10', ''],
    ['MAT-02', 'Cal hidratada', 'kg', '8', 'Cotización pendiente'],
    ['MAT-03', 'Arena', 'm³', '480', 'Verificado por Juan']
  ];
  const catalog = parseCatalogRows(rows);
  assert.equal(catalog[0].estado, undefined, 'celda de Estado vacia: no se fabrica ningun estado');
  assert.equal(catalog[1].estado, 'COTIZACIÓN PENDIENTE', 'un estado real no reconocido se preserva tal cual (mayusculas), nunca se descarta ni se convierte en VERIFICADO');
  assert.equal(catalog[2].estado, 'VERIFICADO', 'coincidencia textual real de "verificado" (aunque venga con mas texto) si se reconoce');
});

test('parseCatalogRows: archivo minimo sin clave/categoria/estado sigue funcionando exactamente igual que antes (compatibilidad con catalogos anteriores)', () => {
  const rows = [
    ['Descripcion', 'Unidad', 'Precio'],
    ['Cemento gris CPC 30R', 'kg', '10.5'],
    ['Arena lavada', 'm³', '480']
  ];
  const catalog = parseCatalogRows(rows);
  assert.equal(catalog.length, 2);
  assert.deepEqual(Object.keys(catalog[0]).sort(), ['desc', 'precio', 'unidad'], 'sin columnas extra en el Excel, el objeto no debe traer clave/categoria/estado/etc. inventados');
  assert.equal(catalog[0].desc, 'Cemento gris CPC 30R');
  assert.equal(catalog[0].precio, 10.5);
});

test('parseCatalogRows: archivo sin ningun encabezado reconocible (fallback posicional) tampoco fabrica clave/categoria', () => {
  const rows = [
    ['Cemento gris CPC 30R', 'kg', '10.5'],
    ['Arena lavada', 'm³', '480']
  ];
  const catalog = parseCatalogRows(rows);
  assert.equal(catalog.length, 2);
  assert.ok(!('clave' in catalog[0]) && !('categoria' in catalog[0]), 'sin fila de encabezado real, nunca se adivina una columna de clave/categoria por posicion');
});

test('parseCatalogRows reconoce aliases razonables de encabezado (CODIGO, CÓDIGO, ID, CATEGORÍA, ESTADO) sin importar mayusculas/acentos', () => {
  const variants = [
    ['CODIGO', 'DESCRIPCION', 'UNIDAD', 'PRECIO', 'CATEGORIA'],
    ['CÓDIGO', 'Descripcion', 'Unidad', 'Precio', 'CATEGORÍA'],
    ['ID', 'Descripcion', 'Unidad', 'Precio', 'Categoria'],
    ['Cve', 'Descripcion', 'Unidad', 'Precio', 'Categoria']
  ];
  for (const header of variants) {
    const rows = [header, ['MAT-01', 'Cemento gris', 'kg', '10', 'Cimentacion']];
    const catalog = parseCatalogRows(rows);
    assert.equal(catalog[0].clave, 'MAT-01', `alias de encabezado de clave no reconocido: "${header[0]}"`);
    assert.equal(catalog[0].categoria, 'Cimentacion', `alias de encabezado de categoria no reconocido: "${header[4]}"`);
  }
});

test('Round-trip real: Excel -> parseCatalogRows -> catalogLookup -- clave/categoria/sinonimos preservados SI participan en un metodo de match mas fuerte que fuzzy_token', () => {
  const rows = [
    ['Clave', 'Descripcion', 'Unidad', 'Precio', 'Categoria', 'Sinonimos'],
    ['MAT-IMPER-01', 'Impermeabilizante acrílico elastomérico', 'L', '145', 'Impermeabilizacion', 'Impermeabilizante acrílico']
  ];
  const catalog = parseCatalogRows(rows);

  // 1) clave_exacta: SOLO alcanzable si quien construye la consulta conoce
  // la clave de antemano (no es el caso de apuGeneration.js#useCat hoy,
  // que solo busca por descripcion -- ver reporte). Se prueba aqui la
  // CAPACIDAD del catalogo ya parseado, no un cambio de useCat (fuera de
  // alcance de esta correccion, que es estrictamente del importador).
  const byClave = findCatalogMatches(catalog, { desc: 'cualquier texto', clave: 'MAT-IMPER-01' });
  assert.equal(byClave.matchMethod, 'clave_exacta');
  assert.equal(byClave.confidence, 1);
  assert.equal(byClave.match.clave, 'MAT-IMPER-01');

  // 2) categoria_unidad: alcanzable en cuanto la categoria SI viaja en la
  // consulta (misma nota que arriba).
  const byCategoria = findCatalogMatches(catalog, { desc: 'impermeabilizante generico', categoria: 'Impermeabilizacion', unidad: 'L' });
  assert.equal(byCategoria.matchMethod, 'categoria_unidad');

  // 3) alias_sinonimo: este SI es el camino real de apuGeneration.js#useCat
  // (consulta solo con {desc, tipo}) una vez que el sinonimo viene del
  // Excel real -- antes del fix, "sinonimos" se descartaba en el import y
  // esta misma consulta caia forzosamente a fuzzy_token (confianza 0.667).
  const bySinonimo = findCatalogMatches(catalog, { desc: 'Impermeabilizante acrílico' });
  assert.equal(bySinonimo.matchMethod, 'alias_sinonimo');
  assert.equal(bySinonimo.confidence, 0.95);
  assert.ok(bySinonimo.confidence > 0.667, 'debe ser una confianza mayor que la de fuzzy_token, no solo distinta');
});
