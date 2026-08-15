/* Prueba de integracion REAL (no mock) del entregable PDF del APU:
   Motor APU (calcAPU) -> exportAPUPDFPro (jsPDF real).

   exportAPUPDFPro es exactamente la funcion que usa la pantalla "APU
   Inteligente" para el boton "Exportar PDF" (src/main.jsx la importa de
   src/lib/apuExport.js sin envolverla). Aqui se invoca tal cual, con jsPDF
   real (jsPDF trae un build oficial para Node, sin necesitar DOM/canvas) y
   sin comprimir el content stream por defecto, asi que el texto queda
   legible como bytes crudos dentro del PDF. Eso permite verificar, leyendo
   el archivo real generado, que cada importe que aparece en el PDF es
   textualmente el mismo que calculo calcAPU — no un numero hardcodeado ni
   una formula recalculada por separado en la capa de exportacion. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { calcAPU } from '../src/lib/apuCalc.js';
import { exportAPUPDFPro, money } from '../src/lib/apuExport.js';

const mxn = (v) => money(v).replace('MX$', '$');

function sampleApu(overrides = {}){
  return {
    clave: 'APU-TEST-PDF',
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

test('el PDF real de exportAPUPDFPro contiene, como texto crudo, los importes calculados por calcAPU', () => {
  const apu = sampleApu();
  const totals = calcAPU(apu);
  const company = { name: 'ZOEMEC Test', address: 'CDMX', email: 'test@zoemec.mx' };

  // calcAPU no es un stub: confirma que los insumos de la prueba realmente
  // producen importes distintos de cero antes de buscarlos en el PDF.
  assert.ok(totals.direct > 0);
  assert.ok(totals.pu > totals.direct);

  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-pdf-'));
  const cwdBefore = process.cwd();
  process.chdir(scratchDir);
  let doc;
  try {
    doc = exportAPUPDFPro(apu, totals, company);
  } finally {
    process.chdir(cwdBefore);
  }

  try {
    // doc.save() (dentro de exportAPUPDFPro) escribe un archivo real en Node
    // via fs — se confirma que existe, igual que en produccion.
    const savedPath = path.join(scratchDir, `${apu.clave}-APU-ZOEMEC.pdf`);
    assert.equal(fs.existsSync(savedPath), true);
    assert.ok(fs.statSync(savedPath).size > 1000);

    // Se lee el contenido real (el mismo objeto jsPDF que se guardo) como
    // bytes crudos: jsPDF no aplica FlateDecode por defecto, asi que el
    // texto de cada "Tj" es legible directamente.
    const bytes = Buffer.from(doc.output('arraybuffer'));
    const text = bytes.toString('latin1');

    const renglonesEsperados = [
      ['Herramienta menor', totals.herramienta],
      ['Costo directo', totals.direct],
      ['Indirectos', totals.indirect],
      ['Financiamiento', totals.finance],
      ['Utilidad', totals.utility],
      ['Cargos adicionales', totals.cargos],
      ['Precio unitario (sin IVA)', totals.pu],
      ['IVA informativo', totals.iva]
    ];
    for (const [label, value] of renglonesEsperados) {
      const expected = mxn(value);
      assert.ok(
        text.includes(`(${expected})`),
        `no se encontro el importe "${expected}" (${label}) como texto en el PDF real generado`
      );
    }

    // El concepto y la clave tambien deben estar, textualmente, en el PDF.
    assert.ok(text.includes('(APU-TEST-PDF)'));
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
});

test('el PDF real cambia si cambia el APU: dos APUs distintos producen precios de texto distintos', () => {
  const apuA = sampleApu({ clave: 'APU-TEST-A' });
  const apuB = sampleApu({ clave: 'APU-TEST-B', utility: 25 }); // utilidad muy distinta
  const totalsA = calcAPU(apuA);
  const totalsB = calcAPU(apuB);
  assert.notEqual(totalsA.pu, totalsB.pu);

  const company = { name: 'ZOEMEC Test', address: 'CDMX', email: 'test@zoemec.mx' };
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-pdf-'));
  const cwdBefore = process.cwd();
  process.chdir(scratchDir);
  let docA, docB;
  try {
    docA = exportAPUPDFPro(apuA, totalsA, company);
    docB = exportAPUPDFPro(apuB, totalsB, company);
  } finally {
    process.chdir(cwdBefore);
  }
  try {
    const textA = Buffer.from(docA.output('arraybuffer')).toString('latin1');
    const textB = Buffer.from(docB.output('arraybuffer')).toString('latin1');
    assert.ok(textA.includes(`(${mxn(totalsA.pu)})`));
    assert.ok(textB.includes(`(${mxn(totalsB.pu)})`));
    // El precio unitario de A no debe aparecer como precio unitario "fuerte" del PDF de B
    assert.notEqual(mxn(totalsA.pu), mxn(totalsB.pu));
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
});
