/* ARNES DE QA (release gate, cierre 2026-09-17) -- NO es parte del producto
   ni del build de produccion. Genera el DOSSIER DE PROYECTO real (PDF +
   Excel, multi-APU) para un proyecto QA con 2 APUs reales, invocando
   directamente exportProjectDossierPdf/exportProjectDossierExcel -- los
   mismos exportadores de produccion que usa la etapa Entrega del Workspace.

   buildProjectDossierData (apuProjectDossierData.js) SIEMPRE lee
   /api/projects, /api/apus, /api/challenge-decisions y /api/technical-
   memory via HTTP (nunca acepta un arreglo de APUs como fuente
   autoritativa) -- por eso, igual que test/apuProjectDossier.pdf.
   integration.test.mjs / .xlsx.integration.test.mjs (ya en el repo), se
   mockea global.fetch con las MISMAS formas de respuesta reales que esos
   endpoints devuelven, en vez de levantar un servidor HTTP real.

   Uso: node dev-qa/qa-release-gate-project-dossier.mjs
   Salida: dev-qa/.out/PROYECTO-Tecamac-DOSSIER.pdf / .xlsx */
import fs from 'node:fs';
import path from 'node:path';
import writeXlsxFileNode from 'write-excel-file/node';
import { makeEmptyAPUv2, APU_DATA_STATE } from '../src/domain/apuSchema.js';
import { finalizeProfessionalAPU } from '../src/domain/apuProfessional.js';
import { formatLocationDisplay } from '../src/domain/geography.js';
import { exportProjectDossierPdf } from '../src/lib/apuProjectDossierPdf.js';
import { exportProjectDossierExcel } from '../src/lib/apuProjectDossierXlsx.js';

const PROJECT_ID = 'PRO-TECAMAC-QA';
const ubicacionEstructurada = { country: 'MX', state: 'MEX', region: 'Zona Metropolitana', city: 'Tecámac' };
const ubicacion = formatLocationDisplay(ubicacionEstructurada);

function baseApu(id, clave, concept, cantidadObra){
  const a = makeEmptyAPUv2();
  Object.assign(a, {
    id, clave, concept, unit: 'm²', cantidadObra, version: 'V1',
    proyecto: 'Obra Tecamac QA', cliente: 'Cliente QA',
    moneda: 'MXN', fechaBase: '2026-09-17',
    ubicacionEstructurada, ubicacion
  });
  return a;
}

// APU 1: referencia NACIONAL (sin cobertura local/estatal para este insumo,
// mismo escenario ya verificado en el release gate de exportacion individual).
function apuPisoEstampado(){
  const a = baseApu('APU-TEC-1', 'PISO-ESTAMPADO-001', 'Suministro y colocacion de piso de concreto estampado en patio exterior', 40);
  const fuente = { estado: APU_DATA_STATE.ESTIMADO_IA, region: null };
  const regional = { regionalConfidence: 'BAJA', regionalFallbackLevel: 'nacional', priceStatus: 'ESTIMATED_NATIONAL' };
  a.materials = [
    { clave: 'MAT-001', descripcion: 'Concreto premezclado f\'c=200 kg/cm²', unidad: 'm³', consumo: 0.1, desperdicioPct: 3, precioUnitario: 2450, fuente, ...regional },
    { clave: 'MAT-002', descripcion: 'Malla electrosoldada 6x6-10/10', unidad: 'm²', consumo: 1.05, desperdicioPct: 5, precioUnitario: 68, fuente, ...regional }
  ];
  a.labor = [
    { clave: 'MO-001', descripcion: 'Oficial albañil', unidad: 'jor', cuadrilla: 1, rendimiento: 20, jornada: 8, salarioBase: 450, fsr: 1.65, fuente, ...regional }
  ];
  a.herramientaMenor = { modo: 'porcentaje', porcentaje: 3, detalle: [] };
  return finalizeProfessionalAPU(a);
}

// APU 2: concepto DISTINTO (nunca duplica el 1), con referencia de ESTADO
// (para probar que el dossier muestra niveles de referencia distintos por
// APU, nunca uno solo copiado a todos).
function apuBanqueta(){
  const a = baseApu('APU-TEC-2', 'BANQUETA-CONC-001', 'Suministro y colocacion de banqueta de concreto simple, incluye cimbra y acabado escobillado', 60);
  const fuente = { estado: APU_DATA_STATE.VERIFICADO, proveedor: 'Proveedor regional', fecha: '2026-09-01' };
  const regional = { regionalConfidence: 'MEDIA', regionalFallbackLevel: 'estado', priceStatus: 'VERIFIED_MARKET' };
  a.materials = [
    { clave: 'MAT-003', descripcion: 'Concreto premezclado f\'c=150 kg/cm²', unidad: 'm³', consumo: 0.08, desperdicioPct: 3, precioUnitario: 2200, fuente, ...regional }
  ];
  a.labor = [
    { clave: 'MO-002', descripcion: 'Oficial albañil', unidad: 'jor', cuadrilla: 1, rendimiento: 25, jornada: 8, salarioBase: 450, fsr: 1.65, fuente, ...regional },
    { clave: 'MO-003', descripcion: 'Ayudante albañil', unidad: 'jor', cuadrilla: 1, rendimiento: 25, jornada: 8, salarioBase: 320, fsr: 1.65, fuente, ...regional }
  ];
  a.herramientaMenor = { modo: 'porcentaje', porcentaje: 3, detalle: [] };
  return finalizeProfessionalAPU(a);
}

function apuDoc(id, snapshot){
  return { id, ownerUid: 'uid-qa-release-gate', projectId: PROJECT_ID, currentVersion: 'V1', snapshot, createdAt: '2026-09-17T00:00:00.000Z', updatedAt: '2026-09-17T00:00:00.000Z' };
}

const originalFetch = global.fetch;
function installMockFetch(){
  const responses = {
    [`/api/projects?id=${PROJECT_ID}`]: {
      project: {
        id: PROJECT_ID, name: 'Obra Tecamac QA', client: 'Cliente QA', moneda: 'MXN',
        locationCountry: ubicacionEstructurada.country, locationState: ubicacionEstructurada.state,
        locationCity: ubicacionEstructurada.city, locationRegion: ubicacionEstructurada.region
      }
    },
    [`/api/apus?projectId=${PROJECT_ID}`]: { apus: [apuDoc('APU-TEC-1', apuPisoEstampado()), apuDoc('APU-TEC-2', apuBanqueta())] },
    '/api/challenge-decisions': { decisions: [] },
    '/api/technical-memory': { entries: [] },
    '/api/export-events': { event: {} }
  };
  global.fetch = async (url) => {
    const u = new URL(String(url), 'http://localhost');
    const key = u.pathname + (u.search || '');
    const found = Object.entries(responses).find(([pattern]) => key.startsWith(pattern));
    const body = found ? found[1] : { error: 'not mocked: ' + key };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
}
function restoreFetch(){ global.fetch = originalFetch; }

async function main(){
  const outDir = path.join(process.cwd(), 'dev-qa', '.out');
  fs.mkdirSync(outDir, { recursive: true });
  const before = process.cwd();
  installMockFetch();
  try{
    process.chdir(outDir);
    const { doc, data } = await exportProjectDossierPdf({ projectId: PROJECT_ID, mode: 'TECNICO', save: false, fileName: 'PROYECTO-Tecamac-DOSSIER.pdf' });
    fs.writeFileSync('PROYECTO-Tecamac-DOSSIER.pdf', Buffer.from(doc.output('arraybuffer')));

    console.log('--- Dossier de proyecto ---');
    console.log('projectId:', data.projectId, '| APUs incluidos:', data.apuEntries.length);
    console.log('apuEntries:', data.apuEntries.map(e => `${e.apuId} (${e.concept}) importeTotal=${e.importeTotal}`));
    console.log('importeProyectoTotal:', data.importeProyectoTotal);

    await exportProjectDossierExcel({ projectId: PROJECT_ID, mode: 'TECNICO', writeXlsxFileImpl: writeXlsxFileNode, fileName: 'PROYECTO-Tecamac-DOSSIER.xlsx' });

    console.log('--- Archivos generados ---');
    for(const f of ['PROYECTO-Tecamac-DOSSIER.pdf', 'PROYECTO-Tecamac-DOSSIER.xlsx']){
      console.log(f, fs.statSync(f).size, 'bytes');
    }
  } finally {
    process.chdir(before);
    restoreFetch();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
