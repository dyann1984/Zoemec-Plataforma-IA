/* Integracion de Costos de Campo / Presupuestado vs Real / Normativa /
   Riesgos (Parte C/D/E/F) en los 4 entregables reales: Excel individual,
   PDF individual, Dossier PDF, Dossier Excel (Parte G/H/I del
   requerimiento de produccion 2026-09-03). Tambien cubre compatibilidad
   con APUs antiguos (Parte K) y persistencia/serializacion (Parte J). */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeEmptyAPUv2, APU_DATA_STATE, migrateLegacyApuToV2 } from '../src/domain/apuSchema.js';
import { finalizeProfessionalAPU } from '../src/domain/apuProfessional.js';
import { exportAPUExcelV2, exportAPUPdfV2 } from '../src/lib/apuExportV2.js';
import { exportApuAuditDossierPdf } from '../src/lib/apuDossierPdf.js';
import { exportApuAuditDossierExcel } from '../src/lib/apuDossierXlsx.js';
import { COSTO_CAMPO_CATEGORIA } from '../src/domain/apuCostosCampo.js';
import { analyzeApuRisks } from '../src/domain/apuRiskDetector.js';

function goldenApu(overrides = {}){
  const a = makeEmptyAPUv2();
  const fuente = { estado: APU_DATA_STATE.VERIFICADO, proveedor: 'Proveedor real', fecha: '2026-01-01' };
  Object.assign(a, { id: 'APU-CC-TEST', clave: 'APU-CC-TEST', concept: 'Muro de block hueco 15x20x40 cm asentado con mortero', unit: 'm²', cantidadObra: 20, version: 'V1' });
  a.materials = [{ clave: 'MAT-001', descripcion: 'Block hueco 15x20x40', unidad: 'pza', consumo: 12.5, desperdicioPct: 3, precioUnitario: 16.5, fuente }];
  a.labor = [{ clave: 'MO-001', descripcion: 'Albañil oficial', unidad: 'jor', cuadrilla: 1, rendimiento: 2.86, jornada: 8, salarioBase: 380, fsr: 1.85, fuente }];
  return { ...a, ...overrides };
}

function withCostosCampo(apu){
  return {
    ...apu,
    costosCampo: [
      { id: 'CC-1', concepto: 'Viaticos cuadrilla', categoria: COSTO_CAMPO_CATEGORIA.INDIRECTO_OBRA, descripcion: 'Alimentos y traslados 3 dias', cantidad: 3, unidad: 'dia', costoUnitario: 350, fecha: '2026-02-01', proveedor: 'Caja chica obra', comprobante: 'CC-045', observacion: '', justificacion: 'Cuadrilla foranea' },
      { id: 'CC-2', concepto: 'Maniobra no prevista', categoria: COSTO_CAMPO_CATEGORIA.EXTRAORDINARIO, descripcion: 'Renta de grua 1 dia', cantidad: 1, unidad: 'dia', costoUnitario: 4500, fecha: '2026-02-02', proveedor: 'Rentas ABC', comprobante: 'FAC-9', observacion: 'Acceso restringido', justificacion: 'No estaba en el alcance original' }
    ]
  };
}

function withNormativa(apu){
  return {
    ...apu,
    normativa: [
      { id: 'NRM-1', nombre: 'NOM-031-STPS', clave: 'NOM-031', organismoEmisor: 'STPS', jurisdiccion: 'Federal', version: '2011', fechaPublicacion: '2011-06-30', vigencia: 'Vigente', fuente: 'DOF', articulo: 'Cap. 5', requisito: 'EPP basico obligatorio en obra', impactoTecnico: 'Requiere casco/botas/lentes', impactoEconomico: 'Bajo', requiereMaterial: false, requiereEPP: true, requiereProcedimiento: false, requierePrueba: false, requiereDocumentacion: false, estadoRevision: 'PENDIENTE', observaciones: '' },
      { id: 'NRM-2', nombre: 'Reglamento de construccion local', clave: 'RCL-2020', organismoEmisor: 'Municipio', jurisdiccion: 'Local', version: '2020', fechaPublicacion: '2020-01-01', vigencia: 'Por verificar', fuente: 'Gaceta municipal', articulo: 'Art. 12', requisito: 'Aviso de obra menor', impactoTecnico: 'Ninguno', impactoEconomico: 'Costo de tramite', requiereMaterial: false, requiereEPP: false, requiereProcedimiento: false, requierePrueba: false, requiereDocumentacion: true, estadoRevision: 'EN_REVISION', observaciones: 'Verificar con residente' }
    ]
  };
}

const rawText = doc => Buffer.from(doc.output('arraybuffer')).toString('latin1');

// ---- PDF individual ----

test('PDF individual: con Costos de Campo y Normativa, el contenido real aparece en el PDF (categoria, importes, disclaimer de normativa)', () => {
  const apu = withNormativa(withCostosCampo(goldenApu()));
  const { doc } = exportAPUPdfV2(apu, { save: false });
  const raw = rawText(doc);
  assert.match(raw, /Viaticos cuadrilla/);
  assert.match(raw, /NOM-031-STPS/);
  assert.match(raw, /potencialmente aplicable/i);
});

test('PDF individual: sin Costos de Campo, muestra el aviso "Sin costos de campo registrados" y nunca una tabla vacia', () => {
  const { doc } = exportAPUPdfV2(goldenApu(), { save: false });
  const raw = rawText(doc);
  assert.match(raw, /Sin costos de campo registrados/);
});

test('PDF individual: normativa vacia muestra el texto exacto pedido "Normativa pendiente de revisión"', () => {
  const { doc } = exportAPUPdfV2(goldenApu(), { save: false });
  const raw = rawText(doc);
  assert.match(raw, /Normativa pendiente de revisi/);
});

test('PDF individual: con riesgos analizados, el hallazgo real aparece en el PDF', () => {
  const apu = goldenApu({ seguridad: [] });
  const finalized = finalizeProfessionalAPU(apu);
  const riesgos = analyzeApuRisks(finalized);
  const apuConRiesgos = { ...apu, riesgosNoContemplados: riesgos };
  const { doc } = exportAPUPdfV2(apuConRiesgos, { save: false });
  const raw = rawText(doc);
  assert.ok(riesgos.hallazgos.length > 0, 'precondicion: debe haber al menos un hallazgo (sin EPP con mano de obra presente)');
  assert.match(raw, /EPP/);
});

test('PDF individual: APU sin riesgosNoContemplados (nunca analizado) nunca imprime la seccion de riesgos', () => {
  const { doc } = exportAPUPdfV2(goldenApu(), { save: false });
  const raw = rawText(doc);
  assert.ok(!raw.includes('RIESGOS Y COSTOS NO CONTEMPLADOS'), 'la seccion no debe aparecer si el analisis nunca se corrio (bajo demanda)');
});

// ---- Excel individual ----

test('Excel individual: exportAPUExcelV2 sigue generando las hojas reales, con el contenido de Costos de Campo/Normativa presente en la hoja del concepto', async () => {
  const apu = withNormativa(withCostosCampo(goldenApu()));
  const sheets = await exportAPUExcelV2(apu, { writeXlsxFileImpl: async () => {} });
  const FIXED_SHEETS = new Set(['PORTADA', 'RESUMEN', 'CONTROL_REVISION', 'PARAMETROS', 'FUENTES_PRECIOS']);
  const conceptSheet = sheets.find(s => !FIXED_SHEETS.has(s.sheet));
  assert.ok(conceptSheet, 'debe existir la hoja del concepto');
  const flatText = JSON.stringify(conceptSheet.rows);
  assert.match(flatText, /Viaticos cuadrilla/);
  assert.match(flatText, /NOM-031-STPS/);
});

// ---- Compatibilidad con APUs antiguos (Parte K) ----

test('Compatibilidad: un APU v1 (legacy) migrado a v2 nunca trae costosCampo/normativa undefined -- defaults seguros []', () => {
  const legacy = { id: 'APU-LEGACY-1', clave: 'APU-LEGACY-1', concept: 'Concepto legacy', unit: 'm²', materials: [], labor: [], equipment: [] };
  const migrated = migrateLegacyApuToV2(legacy);
  assert.deepEqual(migrated.costosCampo, []);
  assert.deepEqual(migrated.normativa, []);
  assert.equal(migrated.riesgosNoContemplados, null);
});

test('Compatibilidad: exportAPUPdfV2/exportAPUExcelV2 de un APU legacy migrado (sin los campos nuevos) nunca truenan', async () => {
  const legacy = { id: 'APU-LEGACY-2', clave: 'APU-LEGACY-2', concept: 'Concepto legacy con recursos', unit: 'm²',
    materials: [['Cemento', 10, 'kg', 5, 0]], labor: [['Albañil', 1, 'jor', 400, 1]], equipment: [] };
  const migrated = migrateLegacyApuToV2(legacy);
  assert.doesNotThrow(() => exportAPUPdfV2(migrated, { save: false }));
  await assert.doesNotReject(() => exportAPUExcelV2(migrated, { writeXlsxFileImpl: async () => {} }));
});

test('Compatibilidad: un APU nuevo (makeEmptyAPUv2) trae costosCampo/normativa=[] y riesgosNoContemplados=null desde el inicio', () => {
  const apu = makeEmptyAPUv2();
  assert.deepEqual(apu.costosCampo, []);
  assert.deepEqual(apu.normativa, []);
  assert.equal(apu.riesgosNoContemplados, null);
});

// ---- Persistencia / serializacion (Parte J) ----

test('Persistencia: costosCampo/normativa/riesgosNoContemplados sobreviven un ciclo real de serializacion JSON (localStorage/Firestore)', () => {
  const apu = withNormativa(withCostosCampo(goldenApu({ riesgosNoContemplados: analyzeApuRisks(goldenApu()) })));
  const roundTripped = JSON.parse(JSON.stringify(apu));
  assert.deepEqual(roundTripped.costosCampo, apu.costosCampo);
  assert.deepEqual(roundTripped.normativa, apu.normativa);
  assert.deepEqual(roundTripped.riesgosNoContemplados, apu.riesgosNoContemplados);
});

test('Persistencia: finalizeProfessionalAPU (usado por guardar version/recalcular) nunca descarta costosCampo/normativa/riesgosNoContemplados', () => {
  const apu = withNormativa(withCostosCampo(goldenApu()));
  const finalized = finalizeProfessionalAPU(apu);
  assert.deepEqual(finalized.costosCampo, apu.costosCampo);
  assert.deepEqual(finalized.normativa, apu.normativa);
});

// ---- Dossier PDF / Excel (Parte G: no debe romperse; debe incluir lo nuevo) ----

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

test('Dossier PDF: sigue exportando BORRADOR NO RESPALDADO igual que antes (no se rompe) y ademas incluye Costos de Campo/Normativa reales', async () => {
  const apu = withNormativa(withCostosCampo(goldenApu()));
  const { doc, data } = await exportApuAuditDossierPdf({ apu, apuId: apu.id, save: false });
  assert.equal(data.source, 'LOCAL_DRAFT');
  assert.equal(data.verificationLabel, 'BORRADOR NO RESPALDADO');
  const raw = rawText(doc);
  assert.match(raw, /Viaticos cuadrilla/);
  assert.match(raw, /NOM-031-STPS/);
});

test('Dossier Excel: sigue exportando correctamente y agrega hojas COSTOS_CAMPO/COSTO_REAL/NORMATIVA cuando hay datos', async () => {
  const apu = withNormativa(withCostosCampo(goldenApu()));
  const { sheets, data } = await exportApuAuditDossierExcel({ apu, apuId: apu.id, fileName: 'x.xlsx', writeXlsxFileImpl: async () => {} });
  assert.equal(data.verificationLabel, 'BORRADOR NO RESPALDADO');
  const names = sheets.map(s => s.sheet);
  assert.ok(names.includes('COSTOS_CAMPO'));
  assert.ok(names.includes('COSTO_REAL'));
  assert.ok(names.includes('NORMATIVA'));
});

test('Dossier Excel: sin Costos de Campo/Riesgos, nunca crea esas hojas (regla "no crear hoja vacia"), pero NORMATIVA si aparece con el texto de pendiente', async () => {
  const apu = goldenApu();
  const { sheets } = await exportApuAuditDossierExcel({ apu, apuId: apu.id, fileName: 'x.xlsx', writeXlsxFileImpl: async () => {} });
  const names = sheets.map(s => s.sheet);
  assert.ok(!names.includes('COSTOS_CAMPO'));
  assert.ok(!names.includes('COSTO_REAL'));
  assert.ok(!names.includes('RIESGOS'));
  assert.ok(names.includes('NORMATIVA'));
  const normativaSheet = sheets.find(s => s.sheet === 'NORMATIVA');
  const flatText = JSON.stringify(normativaSheet.rows);
  assert.match(flatText, /pendiente de revisi/i);
});

test('Dossier Excel: multiples normas (2) aparecen todas, ninguna se pierde', async () => {
  const apu = withNormativa(goldenApu());
  const { sheets } = await exportApuAuditDossierExcel({ apu, apuId: apu.id, fileName: 'x.xlsx', writeXlsxFileImpl: async () => {} });
  const normativaSheet = sheets.find(s => s.sheet === 'NORMATIVA');
  const flatText = JSON.stringify(normativaSheet.rows);
  assert.match(flatText, /NOM-031-STPS/);
  assert.match(flatText, /Reglamento de construccion local/);
});

test('Dossier Excel/PDF: export sin Price Intelligence activo (API auxiliar caida) sigue completando ambos entregables con los datos nuevos', async () => {
  global.fetch = async () => { throw new Error('/api/apus no disponible (simulado)'); };
  const apu = withCostosCampo(goldenApu());
  const pdfResult = await exportApuAuditDossierPdf({ apu, apuId: apu.id, save: false });
  const xlsxResult = await exportApuAuditDossierExcel({ apu, apuId: apu.id, fileName: 'x.xlsx', writeXlsxFileImpl: async () => {} });
  assert.equal(pdfResult.data.source, 'LOCAL_DRAFT');
  assert.equal(xlsxResult.data.source, 'LOCAL_DRAFT');
  assert.ok(xlsxResult.sheets.map(s => s.sheet).includes('COSTOS_CAMPO'));
});
