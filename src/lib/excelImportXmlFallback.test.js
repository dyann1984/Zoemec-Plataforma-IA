/* Pruebas de regresion del bug real descubierto con un catalogo real de un
   usuario: el parser XML de respaldo (usado cuando read-excel-file no puede
   leer el archivo) buscaba etiquetas SIN prefijo de namespace ('row', 'c',
   'sheet'), y fallaba en silencio (0 filas) contra un XLSX real cuyo XML
   interno prefija TODO con un namespace ('<x:row>', '<x:c>', '<x:sheet>').
   Estas pruebas fijan el comportamiento correcto: el resultado debe ser
   equivalente sin importar el prefijo (o su ausencia) usado por el archivo. */
import { DOMParser } from '@xmldom/xmldom';
// El codigo de produccion (parseXml en excelImport.js) usa el DOMParser
// GLOBAL, disponible de forma nativa en el navegador. En Node no existe:
// se provee este polyfill SOLO para que las pruebas puedan ejercitar la
// misma ruta de codigo real, sin reescribir ninguna logica de deteccion.
if(typeof globalThis.DOMParser === 'undefined') globalThis.DOMParser = DOMParser;

import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import {
  readXlsxXmlSheetBlocks,
  readXlsxXmlRows,
  readSpreadsheetSheetBlocks,
  readSpreadsheetRows,
} from './excelImport.js';

/* Construye un XLSX minimo valido en memoria, con el prefijo de namespace
   indicado (o ninguno) aplicado a TODAS las etiquetas del sheetML/workbook.
   `relAttrOrder` permite invertir el orden de los atributos Id/Target y
   name/r:id, para probar que la extraccion no asume un orden fijo. */
function makeXlsx({ prefix = '', relAttrOrder = 'normal', sharedStrings = null, cells } = {}){
  const p = prefix ? `${prefix}:` : '';
  const nsAttr = prefix
    ? `xmlns:${prefix}="http://schemas.openxmlformats.org/spreadsheetml/2006/main"`
    : 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const rowCells = cells.map(c => `<${p}c r="${c.ref}"${c.type ? ` t="${c.type}"` : ''}>${c.inline ? `<${p}is><${p}t>${c.inline}</${p}t></${p}is>` : `<${p}v>${c.v}</${p}v>`}</${p}c>`).join('');
  const sheetXml = `<?xml version="1.0"?><${p}worksheet ${nsAttr}><${p}sheetData><${p}row r="1">${rowCells}</${p}row></${p}sheetData></${p}worksheet>`;
  const wbAttr = `${nsAttr} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
  const sheetTag = relAttrOrder === 'reversed'
    ? `<${p}sheet r:id="rId1" name="Hoja Real" sheetId="1"/>`
    : `<${p}sheet name="Hoja Real" r:id="rId1" sheetId="1"/>`;
  const wbXml = `<?xml version="1.0"?><${p}workbook ${wbAttr}><${p}sheets>${sheetTag}</${p}sheets></${p}workbook>`;
  const relTag = relAttrOrder === 'reversed'
    ? `<Relationship Target="worksheets/sheet1.xml" Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>`
    : `<Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>`;
  const relsXml = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relTag}</Relationships>`;
  const contentTypes = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006-content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`;
  const rootRels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="xl/workbook.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/></Relationships>`;
  const files = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'xl/workbook.xml': strToU8(wbXml),
    'xl/_rels/workbook.xml.rels': strToU8(relsXml),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml),
  };
  if(sharedStrings){
    const sst = sharedStrings.map(s => `<${p}si><${p}t>${s}</${p}t></${p}si>`).join('');
    files['xl/sharedStrings.xml'] = strToU8(`<?xml version="1.0"?><${p}sst ${nsAttr} count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">${sst}</${p}sst>`);
  }
  return zipSync(files);
}

function makeFile(buffer, name = 'catalogo.xlsx'){
  return new File([buffer], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const CELLS = [
  { ref: 'A1', v: 'CLAVE-1', type: 'inlineStr', inline: 'CLAVE-1' },
  { ref: 'B1', v: 42 },
];

// Deliberadamente NO se limita a "x:" (el prefijo del archivo real que
// disparo el hallazgo): la correccion depende de Element.localName, no del
// texto literal del prefijo, asi que debe funcionar igual con cualquiera.
for(const prefix of ['', 'x', 'ss', 'a', 'ns1', 'foo']){
  test(`readXlsxXmlSheetBlocks lee filas igual con prefijo de namespace "${prefix || '(ninguno)'}"`, async () => {
    const buf = makeXlsx({ prefix, cells: CELLS });
    const blocks = await readXlsxXmlSheetBlocks(makeFile(buf));
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].sheetName, 'Hoja Real');
    assert.deepEqual(blocks[0].rows[0], ['CLAVE-1', '42']);
  });
}

test('readXlsxXmlRows tambien es independiente del prefijo de namespace', async () => {
  const noPrefix = await readXlsxXmlRows(makeFile(makeXlsx({ prefix: '', cells: CELLS })));
  const withPrefix = await readXlsxXmlRows(makeFile(makeXlsx({ prefix: 'x', cells: CELLS })));
  assert.deepEqual(noPrefix, withPrefix);
  assert.deepEqual(noPrefix[0], ['CLAVE-1', '42']);
});

test('readWorkbookSheetOrder (via readXlsxXmlSheetBlocks) resuelve el nombre real de hoja aunque los atributos de Relationship/sheet esten en otro orden', async () => {
  const buf = makeXlsx({ prefix: 'x', relAttrOrder: 'reversed', cells: CELLS });
  const blocks = await readXlsxXmlSheetBlocks(makeFile(buf));
  assert.equal(blocks[0].sheetName, 'Hoja Real');
});

test('shared strings con prefijo de namespace se resuelven igual que sin prefijo', async () => {
  const cellsShared = [{ ref: 'A1', v: 0, type: 's' }];
  const noPrefix = await readXlsxXmlSheetBlocks(makeFile(makeXlsx({ prefix: '', cells: cellsShared, sharedStrings: ['hola mundo'] })));
  const withPrefix = await readXlsxXmlSheetBlocks(makeFile(makeXlsx({ prefix: 'x', cells: cellsShared, sharedStrings: ['hola mundo'] })));
  assert.equal(noPrefix[0].rows[0][0], 'hola mundo');
  assert.equal(withPrefix[0].rows[0][0], 'hola mundo');
});

test('cuando read-excel-file falla con el contenido real (indice de shared string no numerico), readSpreadsheetSheetBlocks recae en el parser XML y sigue recuperando filas', async () => {
  // t="s" con un <v> no numerico hace que read-excel-file/browser lance
  // ("Invalid \"shared\" string index: ...") de forma determinista -- es
  // el mismo tipo de fallo real que llevo al fallback con el archivo real
  // del usuario. readSpreadsheetSheetBlocks debe atrapar ese error y usar
  // igualmente el parser XML de respaldo (ya namespace-aware) en vez de
  // devolver un catalogo vacio.
  const cells = [
    { ref: 'A1', v: 'notanumber', type: 's' },
    { ref: 'B1', v: 42 },
  ];
  const buf = makeXlsx({ prefix: 'x', cells });
  const blocks = await readSpreadsheetSheetBlocks(makeFile(buf));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].rows[0][1], '42');
});

test('readSpreadsheetRows tambien recae correctamente en el fallback XML con prefijo de namespace', async () => {
  const cells = [
    { ref: 'A1', v: 'notanumber', type: 's' },
    { ref: 'B1', v: 42 },
  ];
  const buf = makeXlsx({ prefix: 'x', cells });
  const rows = await readSpreadsheetRows(makeFile(buf));
  assert.ok(rows.some(row => row.includes('42')));
});
