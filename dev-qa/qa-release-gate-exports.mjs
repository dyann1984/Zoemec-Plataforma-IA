/* ARNES DE QA (release gate 2026-09-17) -- NO es parte del producto ni del
   build de produccion. Genera los 4 entregables reales (PDF/Excel del APU +
   Dossier PDF/Excel) para el escenario canonico de verificacion regional --
   Tecamac, Estado de Mexico, Zona Metropolitana, MXN, fecha base septiembre
   2026, con referencia de precios NACIONAL (el nivel real que el sistema
   reportaria: no hay referencia de ciudad ni de estado para este insumo,
   confirmado en vivo durante el release gate). Corre 100% en Node, sin
   navegador ni servidor -- usa exactamente los mismos exportadores de
   produccion (apuExportV2.js, apuDossierPdf.js, apuDossierXlsx.js) que
   consume la UI, en modo BORRADOR LOCAL (sin apuId), el path que toman
   cuando no hay backend disponible. Reusar este arnes (o su patron) para
   verificar el CONTENIDO real de un export tras un cambio al modelo
   geografico, en vez de solo confirmar que el codigo corre sin lanzar.

   Uso:
     node dev-qa/qa-release-gate-exports.mjs
     node dev-qa/qa-release-gate-inspect.mjs

   Los archivos quedan en dev-qa/.out/ (ignorado por git) para inspeccion
   manual real. */
import fs from 'node:fs';
import path from 'node:path';
import writeXlsxFileNode from 'write-excel-file/node';
import { makeEmptyAPUv2, APU_DATA_STATE } from '../src/domain/apuSchema.js';
import { finalizeProfessionalAPU } from '../src/domain/apuProfessional.js';
import { exportAPUExcelV2, exportAPUPdfV2 } from '../src/lib/apuExportV2.js';
import { exportApuAuditDossierPdf } from '../src/lib/apuDossierPdf.js';
import { exportApuAuditDossierExcel } from '../src/lib/apuDossierXlsx.js';
import { formatLocationDisplay } from '../src/domain/geography.js';

const ubicacionEstructurada = { country: 'MX', state: 'MEX', region: 'Zona Metropolitana', city: 'Tecámac' };
const ubicacion = formatLocationDisplay(ubicacionEstructurada);

function buildTecamacApu(){
  const a = makeEmptyAPUv2();
  Object.assign(a, {
    clave: 'PISO-ESTAMPADO-001',
    concept: 'Suministro y colocacion de piso de concreto estampado en patio exterior, incluye base compactada, malla electrosoldada y acabado impermeabilizante',
    unit: 'm²', cantidadObra: 1,
    proyecto: 'Obra Tecamac', cliente: 'Cliente QA',
    version: 'V1',
    moneda: 'MXN',
    fechaBase: '2026-09-17',
    ubicacionEstructurada,
    ubicacion
  });
  // Nivel de referencia real reportado en la corrida en vivo de la ronda
  // anterior para este escenario: sin referencia de ciudad ni de estado
  // para Tecamac -- el sistema cae honestamente a referencia NACIONAL
  // (nunca se inventa un nivel mas especifico).
  const fuente = { estado: APU_DATA_STATE.ESTIMADO_IA, region: null };
  const regional = { regionalConfidence: 'BAJA', regionalFallbackLevel: 'nacional', priceStatus: 'ESTIMATED_NATIONAL' };
  a.materials = [
    { clave: 'MAT-001', descripcion: 'Concreto premezclado f\'c=200 kg/cm²', unidad: 'm³', consumo: 0.1, desperdicioPct: 3, precioUnitario: 2450, fuente, ...regional },
    { clave: 'MAT-002', descripcion: 'Malla electrosoldada 6x6-10/10', unidad: 'm²', consumo: 1.05, desperdicioPct: 5, precioUnitario: 68, fuente, ...regional }
  ];
  a.labor = [
    { clave: 'MO-001', descripcion: 'Oficial albañil', unidad: 'jor', cuadrilla: 1, rendimiento: 20, jornada: 8, salarioBase: 450, fsr: 1.65, fuente, ...regional },
    { clave: 'MO-002', descripcion: 'Ayudante albañil', unidad: 'jor', cuadrilla: 1, rendimiento: 20, jornada: 8, salarioBase: 320, fsr: 1.65, fuente, ...regional }
  ];
  a.equipment = [
    { clave: 'EQ-001', descripcion: 'Vibrador de concreto', unidad: 'dia', cantidad: 0.05, tarifa: 350, rendimiento: 20, fuente }
  ];
  a.herramientaMenor = { modo: 'porcentaje', porcentaje: 3, detalle: [] };
  a.seguridad = [
    { clave: 'SEG-001', descripcion: 'Casco de seguridad', unidad: 'pza', cantidad: 0.02, precioUnitario: 220, integracion: 'AMORTIZABLE', vidaUtilDias: 180, rendimientoDiario: 20, factorReposicion: 1, fuente }
  ];
  a.procedimientoConstructivo = ['Compactar base', 'Colocar malla electrosoldada', 'Colar concreto', 'Estampar y sellar', 'Curar', 'Impermeabilizar'];
  a.criterioMedicion = { unidadMedicion: 'm²', incluye: ['base compactada', 'malla', 'concreto', 'acabado estampado', 'impermeabilizante'], excluye: ['juntas de dilatacion adicionales'] };
  return a;
}

async function main(){
  const outDir = path.join(process.cwd(), 'dev-qa', '.out');
  fs.mkdirSync(outDir, { recursive: true });
  const before = process.cwd();
  process.chdir(outDir);
  try{
    const apu = finalizeProfessionalAPU(buildTecamacApu());
    console.log('--- APU construido ---');
    console.log('ubicacionEstructurada:', JSON.stringify(apu.ubicacionEstructurada));
    console.log('ubicacion (texto):', apu.ubicacion);
    console.log('moneda:', apu.moneda, '| fechaBase:', apu.fechaBase);

    // 1) PDF del APU
    const { doc: apuDoc } = exportAPUPdfV2(apu, { save: false, fileName: 'APU-Tecamac.pdf' });
    fs.writeFileSync('APU-Tecamac.pdf', Buffer.from(apuDoc.output('arraybuffer')));

    // 2) Excel del APU
    await exportAPUExcelV2(apu, { writeXlsxFileImpl: writeXlsxFileNode, fileName: 'APU-Tecamac.xlsx' });

    // 3) Dossier PDF (modo TECNICO, borrador local -- sin apuId, sin red)
    const { doc: dossierDoc, data: dossierData } = await exportApuAuditDossierPdf({ apu, mode: 'TECNICO', save: false, fileName: 'APU-Tecamac-DOSSIER.pdf' });
    fs.writeFileSync('APU-Tecamac-DOSSIER.pdf', Buffer.from(dossierDoc.output('arraybuffer')));
    console.log('--- Dossier data ---');
    console.log('source:', dossierData.source, '| verificationLabel:', dossierData.verificationLabel);
    console.log('regionalReferenceLabel:', dossierData.regionalReferenceLabel);

    // 4) Dossier Excel
    await exportApuAuditDossierExcel({ apu, mode: 'TECNICO', writeXlsxFileImpl: writeXlsxFileNode, fileName: 'APU-Tecamac-DOSSIER.xlsx' });

    console.log('--- Archivos generados ---');
    for(const f of ['APU-Tecamac.pdf', 'APU-Tecamac.xlsx', 'APU-Tecamac-DOSSIER.pdf', 'APU-Tecamac-DOSSIER.xlsx']){
      console.log(f, fs.statSync(f).size, 'bytes');
    }
  } finally {
    process.chdir(before);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
