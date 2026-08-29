/* Prueba de integracion del Dossier APU Auditable en XLSX (Fase 8). Mismo
   criterio de mock de fetch que test/apuDossier.pdf.integration.test.mjs
   (ver ese archivo para el detalle honesto del limite: se mockea la capa
   HTTP, no un servidor real -- eso lo cubre la QA de aplicacion completa).
   El .xlsx generado se desempaca de verdad (fflate) y se lee su XML real. */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import writeXlsxFileNode from 'write-excel-file/node';
import { unzipSync, strFromU8 } from 'fflate';
import { makeEmptyAPUv2, APU_DATA_STATE } from '../src/domain/apuSchema.js';
import { finalizeProfessionalAPU } from '../src/domain/apuProfessional.js';
import { SYSTEM_RESOURCES } from '../src/domain/constructionSystems.js';
import { exportApuAuditDossierExcel } from '../src/lib/apuDossierXlsx.js';

function goldenApu(overrides = {}){
  const a = makeEmptyAPUv2();
  const [descripcion, cantidadPorUnidad, , salarioBase, fsr] = SYSTEM_RESOURCES.tablaroca.labor[0];
  const fuente = { estado: APU_DATA_STATE.VERIFICADO, proveedor: 'Proveedor de prueba', fecha: '2026-01-01' };
  Object.assign(a, {
    id: 'APU-TEST-XLSX', clave: 'APU-TEST-XLSX', concept: 'Muro de prueba XLSX dossier',
    unit: 'm²', cantidadObra: 100, proyecto: 'Proyecto Dossier Test', cliente: 'Cliente Dossier Test',
    primaryActivity: 'tablaroca', version: 'V1'
  });
  a.materials = [{ clave: 'MAT-1', descripcion: 'Panel de yeso', unidad: 'pza', consumo: 2, desperdicioPct: 5, precioUnitario: 150, fuente }];
  a.labor = [{ clave: 'MO-1', descripcion, cuadrilla: 1, rendimiento: 1 / cantidadPorUnidad, jornada: 8, salarioBase, fsr, fuente, rendimientoFuente: 'PLANTILLA' }];
  return { ...a, ...overrides };
}

let responses;
const originalFetch = global.fetch;
before(() => {
  global.fetch = async (url) => {
    const u = new URL(String(url), 'http://localhost');
    const key = u.pathname + (u.search || '');
    const found = Object.entries(responses).find(([pattern]) => key.startsWith(pattern));
    const body = found ? found[1] : { error: 'not mocked: ' + key };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
});
after(() => { global.fetch = originalFetch; });
beforeEach(() => { responses = { '/api/apus': { apu: null, versions: [] }, '/api/challenge-decisions': { decisions: [] }, '/api/technical-memory': { entries: [] }, '/api/export-events': { event: {} } }; });

function allSheetsText(zip, sheetNames){
  const shared = strFromU8(zip['xl/sharedStrings.xml'] || new Uint8Array());
  const sheetFiles = Object.keys(zip).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
  return shared + sheetFiles.map(f => strFromU8(zip[f])).join('\n');
}

test('workbook: solo crea hojas con datos reales (no hojas vacias), incluye PORTADA/RESUMEN/AUDITORIA/CHALLENGE/CONFIDENCE', async () => {
  const apu = goldenApu();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-dossier-xlsx-'));
  const before_ = process.cwd(); process.chdir(dir);
  try{
    const { sheets } = await exportApuAuditDossierExcel({ apu, apuId: apu.id, writeXlsxFileImpl: writeXlsxFileNode, fileName: 'dossier.xlsx' });
    const names = sheets.map(s => s.sheet);
    assert.ok(names.includes('PORTADA'));
    assert.ok(names.includes('RESUMEN'));
    assert.ok(names.includes('CONFIDENCE'));
    assert.ok(fs.statSync('dossier.xlsx').size > 500);
  }finally{ process.chdir(before_); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CASO N/O/P: el xlsx real nunca contiene NaN/Infinity, y el precio unitario real aparece', async () => {
  const apu = goldenApu();
  const finalized = finalizeProfessionalAPU(apu);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-dossier-xlsx2-'));
  const before_ = process.cwd(); process.chdir(dir);
  try{
    await exportApuAuditDossierExcel({ apu, apuId: apu.id, writeXlsxFileImpl: writeXlsxFileNode, fileName: 'dossier2.xlsx' });
    const zip = unzipSync(fs.readFileSync('dossier2.xlsx'));
    const text = allSheetsText(zip, []);
    assert.ok(!/\bNaN\b/.test(text));
    assert.ok(!/\bInfinity\b/.test(text));
    assert.match(text, new RegExp(String(finalized.calculated.pu.toFixed(2)).replace('.', '\\.')));
  }finally{ process.chdir(before_); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CASO B: borrador local se rotula BORRADOR NO RESPALDADO en la hoja PORTADA', async () => {
  const apu = goldenApu();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-dossier-xlsx3-'));
  const before_ = process.cwd(); process.chdir(dir);
  try{
    await exportApuAuditDossierExcel({ apu, apuId: apu.id, writeXlsxFileImpl: writeXlsxFileNode, fileName: 'dossier3.xlsx' });
    const zip = unzipSync(fs.readFileSync('dossier3.xlsx'));
    const text = allSheetsText(zip, []);
    assert.match(text, /BORRADOR NO RESPALDADO/);
  }finally{ process.chdir(before_); fs.rmSync(dir, { recursive: true, force: true }); }
});
