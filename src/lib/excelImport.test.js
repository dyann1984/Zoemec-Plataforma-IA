import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConceptText, parseConceptListText, conceptVariablesFromParsed } from './excelImport.js';

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
