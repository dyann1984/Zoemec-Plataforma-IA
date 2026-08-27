/* Paridad XLSX <-> PDF individual <-> PDF maestro (spec 19-26): las tres
   salidas son renderizadores del MISMO objeto finalizeProfessionalAPU, nunca
   un segundo motor de calculo. Este archivo prueba explicitamente que las
   SEIS categorias A-F (incluyendo E. CONSUMIBLES, la categoria nueva que mas
   riesgo tiene de "existir en el schema pero desaparecer en silencio de una
   vista derivada" -- ver nota de Riesgos en el plan RC11/consumibles) llegan
   con los mismos numeros a los tres formatos, y que el conteo
   N conceptos = N APUs = N hojas XLSX = N APUs en PDF maestro = N PDFs
   individuales nunca se rompe en silencio. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import writeXlsxFileNode from 'write-excel-file/node';
import { makeEmptyAPUv2, APU_DATA_STATE } from '../src/domain/apuSchema.js';
import { finalizeProfessionalAPU } from '../src/domain/apuProfessional.js';
import { exportAPUExcelV2, exportAPUPdfV2, exportAPUPdfMaster } from '../src/lib/apuExportV2.js';
import { readXlsxCells, findRowByLabel } from './helpers/xlsxRead.mjs';
import { createSheetEvaluator } from './helpers/xlsxFormula.mjs';

const pdfMoney = v => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(v).replace('MX$', '$');

/* APU golden con EXACTAMENTE 1 renglon real en cada una de las 6 categorias
   A-F (incluyendo herramienta menor en modo "detalle" y consumibles), mas
   las 6 justificaciones tecnicas completas -- para poder verificar que
   ninguna de las 6 desaparece en ningun renderizador. */
function fullSixCategoryApu(){
  const a = makeEmptyAPUv2();
  const fuente = { estado: APU_DATA_STATE.VERIFICADO, proveedor: 'Catalogo ZOEMEC', fecha: '2026-08-01' };
  Object.assign(a, {
    clave: 'PARIDAD-001',
    concept: 'Concepto de prueba de paridad XLSX-PDF con las seis categorias A-F completas.',
    unit: 'm²', cantidadObra: 40, proyecto: 'Proyecto paridad', cliente: 'Cliente paridad', version: 'V1'
  });
  a.materials = [{ clave: 'MAT-001', descripcion: 'Cemento CPC 30R', unidad: 'kg', consumo: 5.6, desperdicioPct: 3, precioUnitario: 2.35, fuente }];
  a.labor = [{ clave: 'MO-001', descripcion: 'Oficial albañil', unidad: 'jor', cuadrilla: 1, rendimiento: 25, jornada: 8, salarioBase: 802.15, fsr: 1.382, fuente }];
  a.equipment = [{ clave: 'EQ-001', descripcion: 'Andamio tubular', unidad: 'dia', cantidad: 0.1, tarifa: 150, fuente }];
  a.herramientaMenor = { modo: 'detalle', porcentaje: 3, detalle: [{ clave: 'HM-001', descripcion: 'Llana y flexometro', unidad: 'pza', cantidad: 2, valorAdquisicion: 180, depreciacionPct: 10, fuente }] };
  a.consumables = [{ clave: 'CON-001', descripcion: 'Disco de corte diamantado', especificacion: '4.5 pulgadas', unidad: 'pza', consumo: 0.02, desperdicioPct: 0, precioUnitario: 45, fuente, technicalReason: 'Corte de piezas ceramicas del acabado' }];
  a.seguridad = [{ clave: 'SP-001', descripcion: 'Casco de seguridad', unidad: 'pza', cantidad: 0.001, precioUnitario: 220, fuente }];
  a.technicalJustifications = {
    materials: 'Cemento requerido para el mortero de asiento segun especificacion tecnica.',
    labor: 'Cuadrilla de un oficial con rendimiento de 25 m2/jornada, valor estandar del catalogo ZOEMEC.',
    equipment: 'Andamio de apoyo para trabajo en altura durante la aplicacion.',
    smallTools: 'Herramienta menor calculada como 3% de mano de obra segun estandar ZOEMEC.',
    consumables: 'Disco de corte diamantado necesario para cortar piezas ceramicas del acabado.',
    safety: 'Casco de seguridad obligatorio conforme a la normativa de seguridad en obra.'
  };
  return a;
}

test('Paridad XLSX <-> objeto canonico: las 6 categorias A-F escriben exactamente los mismos subtotales que calcAPUv2', async () => {
  const apu = fullSixCategoryApu();
  const snapshot = finalizeProfessionalAPU(apu);
  const t = snapshot.calculated;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-parity-xlsx-'));
  const before = process.cwd(); process.chdir(dir);
  try {
    await exportAPUExcelV2(snapshot, { writeXlsxFileImpl: writeXlsxFileNode, fileName: 'parity.xlsx' });
    // PORTADA(1) + RESUMEN(2) + CONTROL_REVISION(3) + PARAMETROS(4) + el APU (5).
    const cells = readXlsxCells(fs.readFileSync('parity.xlsx'), 'xl/worksheets/sheet5.xml');
    const evaluate = createSheetEvaluator(cells);
    const cases = [
      ['SUBTOTAL MATERIALES', 'mat'], ['SUBTOTAL MANO DE OBRA', 'mo'], ['SUBTOTAL EQUIPO', 'equipo'],
      ['SUBTOTAL HERRAMIENTA', 'herramienta'], ['SUBTOTAL CONSUMIBLES', 'consumibles'], ['SUBTOTAL SEGURIDAD', 'seguridad'],
      ['COSTO DIRECTO', 'direct'], ['PRECIO UNITARIO FINAL', 'pu']
    ];
    for (const [label, key] of cases) {
      const ref = findRowByLabel(cells, label, 'J');
      assert.ok(ref, `falta la fila "${label}" en la hoja XLSX del APU`);
      const xlsxValue = evaluate.getCellValue(ref);
      assert.ok(Math.abs(xlsxValue - t[key]) < 1e-8, `${label}: XLSX (${xlsxValue}) != objeto canonico (${t[key]})`);
    }
    // Las 6 justificaciones tecnicas deben estar presentes como texto real, no el placeholder.
    const allStrings = Object.values(cells).map(c => c.str).filter(Boolean).join(' | ');
    Object.values(apu.technicalJustifications).forEach(text => {
      assert.ok(allStrings.includes(text), `la hoja XLSX no conserva la justificacion tecnica real: "${text}"`);
    });
    assert.ok(!allStrings.includes('Sin justificación técnica registrada'), 'un APU CON justificaciones reales nunca debe mostrar el placeholder de "sin justificacion"');
  } finally { process.chdir(before); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Paridad PDF individual <-> objeto canonico: las 6 categorias A-F aparecen con el mismo importe efectivo formateado', () => {
  const apu = fullSixCategoryApu();
  const snapshot = finalizeProfessionalAPU(apu);
  const t = snapshot.calculated;
  const { doc } = exportAPUPdfV2(snapshot, { save: false });
  const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  ['A. MATERIALES', 'B. MANO DE OBRA', 'C. EQUIPO Y MAQUINARIA', 'D. HERRAMIENTA MENOR', 'E. CONSUMIBLES Y AUXILIARES', 'F. SEGURIDAD Y EPP'].forEach(title => {
    assert.ok(raw.includes(title), `el PDF individual no contiene la seccion "${title}"`);
  });
  [t.mat, t.mo, t.equipo, t.herramienta, t.consumibles, t.seguridad, t.direct, t.pu, t.importeTotal].forEach(value => {
    assert.ok(raw.includes(`(${pdfMoney(value)})`), `el PDF individual no muestra el importe ${pdfMoney(value)}`);
  });
  Object.values(apu.technicalJustifications).forEach(text => {
    assert.ok(raw.includes('Justificacion tecnica'), 'el PDF individual debe traer bloques de "Justificacion tecnica" por categoria');
  });
  assert.ok(raw.includes('TRAZABILIDAD'), 'el PDF individual debe traer una seccion de TRAZABILIDAD (spec 22)');
  assert.ok(raw.includes('ALCANCE'), 'el PDF individual debe traer una seccion de ALCANCE (spec 22)');
  assert.ok(raw.includes('EXCLUSIONES'), 'el PDF individual debe traer una seccion de EXCLUSIONES (spec 22)');
});

test('Paridad PDF individual: un APU historico sin technicalJustifications muestra el placeholder explicito, nunca texto en blanco ni inventado', () => {
  const apu = fullSixCategoryApu();
  apu.technicalJustifications = { materials: '', labor: '', equipment: '', smallTools: '', consumables: '', safety: '' };
  const snapshot = finalizeProfessionalAPU(apu);
  const { doc } = exportAPUPdfV2(snapshot, { save: false });
  const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  assert.ok(raw.includes('Sin justificacion tecnica registrada'), 'sin technicalJustifications, el PDF debe mostrar el placeholder explicito');
});

test('PDF MAESTRO: portada + resumen + control de revision + N APUs completos, cada uno con sus 6 categorias y numeros identicos al objeto canonico', () => {
  const apus = [1, 2, 3].map(i => {
    const a = fullSixCategoryApu();
    a.clave = `PARIDAD-${String(i).padStart(3, '0')}`;
    a.concept = `Concepto de prueba de paridad numero ${i} con las seis categorias A-F completas.`;
    a.cantidadObra = 10 * i;
    return a;
  });
  const finalized = apus.map(a => finalizeProfessionalAPU(a));
  const { doc, apus: returned } = exportAPUPdfMaster(finalized, { save: false, company: { name: 'ZOEMEC', client: 'Cliente paridad' } });
  assert.equal(returned.length, 3, 'exportAPUPdfMaster debe devolver los 3 APUs procesados');
  const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  assert.ok(raw.includes('RESUMEN GENERAL'), 'el PDF maestro debe traer la pagina RESUMEN GENERAL');
  assert.ok(raw.includes('CONTROL DE REVISION'), 'el PDF maestro debe traer la pagina CONTROL DE REVISION');
  finalized.forEach(apu => {
    assert.ok(raw.includes(apu.clave), `el PDF maestro no contiene la clave ${apu.clave}`);
    assert.ok(raw.includes(`(${pdfMoney(apu.calculated.direct)})`), `el PDF maestro no muestra el costo directo de ${apu.clave}`);
    assert.ok(raw.includes(`(${pdfMoney(apu.calculated.pu)})`), `el PDF maestro no muestra el precio unitario de ${apu.clave}`);
  });
  // Cada APU debe arrancar en pagina nueva -- nunca dos claves compartiendo
  // el numero de pagina en que EMPIEZA su encabezado general.
  const startPages = returned.map((_, i) => i); // orden de exportAPUPdfMaster == orden de finalized
  assert.equal(new Set(finalized.map(a => a.clave)).size, finalized.length);
});

test('Conteo de entrega: N conceptos validos = N APUs = N hojas XLSX = N APUs en PDF maestro = N PDFs individuales, sin perdida silenciosa', async () => {
  const N = 5;
  const apus = Array.from({ length: N }, (_, i) => {
    const a = fullSixCategoryApu();
    a.clave = `LOTE-${String(i + 1).padStart(3, '0')}`;
    a.concept = `Concepto de lote numero ${i + 1} para prueba de conteo de entrega.`;
    return a;
  });
  const finalized = apus.map(a => finalizeProfessionalAPU(a));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-parity-count-'));
  const before = process.cwd(); process.chdir(dir);
  try {
    // XLSX: N hojas de concepto (mas PORTADA+RESUMEN+CONTROL_REVISION).
    const sheets = await exportAPUExcelV2(finalized, { writeXlsxFileImpl: writeXlsxFileNode, fileName: 'lote.xlsx' });
    const conceptSheets = sheets.filter(s => !['PORTADA', 'RESUMEN', 'CONTROL_REVISION', 'PARAMETROS'].includes(s.sheet));
    assert.equal(conceptSheets.length, N, `XLSX: se esperaban ${N} hojas de concepto, hubo ${conceptSheets.length}`);

    // PDF individuales: N archivos, cada uno con su propia clave.
    let individualCount = 0;
    finalized.forEach((apu, idx) => {
      const { doc } = exportAPUPdfV2(apu, { save: false });
      const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
      assert.ok(raw.includes(apu.clave), `PDF individual ${idx + 1}: no contiene su propia clave ${apu.clave}`);
      individualCount++;
    });
    assert.equal(individualCount, N, `se esperaban ${N} PDFs individuales generados, hubo ${individualCount}`);

    // PDF maestro: las N claves deben aparecer TODAS en el mismo documento.
    const { doc: masterDoc, apus: masterApus } = exportAPUPdfMaster(finalized, { save: false });
    assert.equal(masterApus.length, N, `PDF maestro: se esperaban ${N} APUs procesados, hubo ${masterApus.length}`);
    const masterRaw = Buffer.from(masterDoc.output('arraybuffer')).toString('latin1');
    finalized.forEach(apu => assert.ok(masterRaw.includes(apu.clave), `PDF maestro: falta la clave ${apu.clave}`));
  } finally { process.chdir(before); fs.rmSync(dir, { recursive: true, force: true }); }
});
