/* Prueba de integracion REAL (no mock) del entregable Excel del APU:
   Motor APU (calcAPU) -> exportAPUExcel (write-excel-file real).

   exportAPUExcel es exactamente la funcion que usa el boton "Exportar
   Excel" de la pantalla "APU Inteligente" (src/main.jsx la importa de
   src/lib/apuExport.js sin envolverla): construye una hoja con FORMULAS de
   Excel reales (=D16*E16*(1+F16/100), =SUM(H16:H17), etc.), no numeros ya
   calculados. Eso es justo lo auditable, pero tambien lo dificil de
   verificar: un lector de xlsx normal (incluida la libreria read-excel-file
   que ya usa este proyecto) no evalua formulas, solo devuelve el texto de
   la formula o nada si no hay un valor en cache.

   Por eso esta prueba:
   1) Genera el .xlsx REAL invocando exportAPUExcel sin modificar su logica,
      solo inyectandole el escritor oficial de write-excel-file para Node
      (write-excel-file/node) en vez del de navegador -- ambos comparten el
      mismo generador de celdas/formulas (generateXlsxFileContents), asi que
      el contenido escrito es identico al que produce el boton real.
   2) Desempaca el .xlsx real (es un .zip OOXML) y lee sus celdas/formulas
      crudas con el lector de test/helpers/xlsxRead.mjs.
   3) Evalua esas formulas con test/helpers/xlsxFormula.mjs -- un evaluador
      minimo que solo entiende +,-,*,/,parentesis y SUM(rango), que es
      exactamente la gramatica que usa apuExport.js. No hardcodea ningun
      resultado: ejecuta la formula que quedo escrita en el archivo real,
      resolviendo cada celda de entrada (D22, E22, F22...) que tambien viene
      del archivo real.
   4) Compara ese resultado contra calcAPU (el motor), no al reves. Si
      alguien cambiara buildCompleteAPUSheet para escribir una formula
      distinta a la de calcAPU, o si escribiera un numero fijo en vez de una
      formula, esta prueba lo detecta. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import writeXlsxFileNode from 'write-excel-file/node';
import { calcAPU } from '../src/lib/apuCalc.js';
import { exportAPUExcel } from '../src/lib/apuExport.js';
import { readXlsxCells, findRowByLabel } from './helpers/xlsxRead.mjs';
import { createSheetEvaluator } from './helpers/xlsxFormula.mjs';

function sampleApu(overrides = {}){
  return {
    clave: 'APU-TEST-XLS',
    concept: 'Muro de block 15 cm de prueba tecnica auditable',
    unit: 'm²',
    date: '01/01/2026',
    family: 'Albañileria',
    sat: '72100000',
    confidence: 92,
    materials: [
      ['Block hueco 15x20x40', 12.5, 'pza', 16.5, 3],
      ['Mortero de junteo', 0.45, 'saco', 145, 5]
    ],
    labor: [
      ['Albañil oficial', 0.35, 'jor', 380, 1.85],
      ['Ayudante de albañil', 0.35, 'jor', 258, 1.82]
    ],
    equipment: [['Andamio / equipo básico', 0.05, 'día', 280]],
    herramienta: 3,
    indCampo: 8,
    indOficina: 7,
    finance: 2,
    utility: 10,
    cargos: 0.5,
    iva: 16,
    ...overrides
  };
}

async function generateRealXlsxCells(apu, totals){
  const company = { name: 'ZOEMEC Test' };
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-xlsx-'));
  const cwdBefore = process.cwd();
  process.chdir(scratchDir);
  try {
    // Mismo exportAPUExcel de produccion; unico cambio: el escritor final
    // (write-excel-file/node en vez de /browser) porque Node no tiene DOM
    // para disparar una descarga. La generacion de celdas/formulas es la
    // misma (write-excel-file comparte ese codigo entre ambos builds).
    await exportAPUExcel(apu, totals, company, writeXlsxFileNode);
    const filePath = path.join(scratchDir, `${apu.clave}-APU-AUDITABLE-ZOEMEC.xlsx`);
    assert.equal(fs.existsSync(filePath), true, 'exportAPUExcel no escribio el .xlsx real');
    const buffer = fs.readFileSync(filePath);
    assert.ok(buffer.length > 1000, 'el .xlsx real parece vacio o corrupto');
    return readXlsxCells(buffer);
  } finally {
    process.chdir(cwdBefore);
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

test('el Excel real de exportAPUExcel: las formulas escritas evaluan exactamente a los totales de calcAPU', async () => {
  const apu = sampleApu();
  const totals = calcAPU(apu);
  assert.ok(totals.direct > 0);

  const cells = await generateRealXlsxCells(apu, totals);
  const evaluator = createSheetEvaluator(cells);

  const casos = [
    ['SUBTOTAL MATERIALES', 'mat'],
    ['SUBTOTAL MANO DE OBRA', 'mo'],
    ['SUBTOTAL EQUIPO', 'equipo'],
    ['Herramienta menor', 'herramienta'],
    ['COSTO DIRECTO', 'direct'],
    ['Indirectos', 'indirect'],
    ['Financiamiento', 'finance'],
    ['Utilidad', 'utility'],
    ['Cargos adicionales', 'cargos'],
    ['PRECIO UNITARIO SIN IVA', 'pu'],
    ['IVA informativo', 'iva']
  ];

  for (const [label, totalsKey] of casos) {
    const cellRef = findRowByLabel(cells, label, 'H');
    assert.ok(cellRef, `no se encontro en el xlsx real la fila etiquetada "${label}"`);
    const cell = cells[cellRef];
    assert.ok(
      cell.formula !== undefined,
      `la celda ${cellRef} ("${label}") deberia contener una FORMULA de Excel, no un numero fijo`
    );
    const evaluated = evaluator.getCellValue(cellRef);
    const expected = totals[totalsKey];
    assert.ok(
      Math.abs(evaluated - expected) < 1e-6,
      `"${label}" (${cellRef}): la formula real del xlsx "${cell.formula}" evaluo a ${evaluated}, ` +
      `pero calcAPU calculo totals.${totalsKey} = ${expected}`
    );
  }
});

test('el Excel real usa formulas que dependen de las cantidades/precios reales, no valores fijos', async () => {
  const apuA = sampleApu({ clave: 'APU-XLS-A' });
  const apuB = sampleApu({
    clave: 'APU-XLS-B',
    materials: [['Block distinto', 30, 'pza', 20, 0]], // cantidades/precio muy distintos
    utility: 22
  });
  const totalsA = calcAPU(apuA);
  const totalsB = calcAPU(apuB);
  assert.notEqual(totalsA.pu, totalsB.pu);

  const cellsA = await generateRealXlsxCells(apuA, totalsA);
  const cellsB = await generateRealXlsxCells(apuB, totalsB);
  const evalA = createSheetEvaluator(cellsA);
  const evalB = createSheetEvaluator(cellsB);

  const refA = findRowByLabel(cellsA, 'PRECIO UNITARIO SIN IVA', 'H');
  const refB = findRowByLabel(cellsB, 'PRECIO UNITARIO SIN IVA', 'H');
  const valueA = evalA.getCellValue(refA);
  const valueB = evalB.getCellValue(refB);

  assert.ok(Math.abs(valueA - totalsA.pu) < 1e-6);
  assert.ok(Math.abs(valueB - totalsB.pu) < 1e-6);
  assert.notEqual(Math.round(valueA * 100), Math.round(valueB * 100));
});
