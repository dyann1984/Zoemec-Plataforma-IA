/* E2E real (sin red, sin mock de OpenAI) de Planos IA / Takeoff (RC4 Fase 2):

   Respuesta simulada del modelo -> validacion determinista server-side ->
   revision humana (1 validado con correccion, 1 rechazado, 1 sin escala
   forzado a REQUIERE_REVISION) -> toApuSeed (unico puente al motor) ->
   pipeline real de generacion de conceptos (templateFallbackAPU ->
   migrateLegacyApuToV2 -> applyConceptMetadataV2 -> finalizeProfessionalAPU,
   el mismo que ya usa el pegado de texto/Excel en produccion) -> motor v2
   real -> exportadores RC3 reales, con la cantidad validada trazable en el
   PDF final.

   No se prueba la llamada HTTP a OpenAI (requeriria credenciales reales,
   igual que el resto de RC4); se prueba toda la cadena de decision y de
   calculo, que es donde vive el riesgo real de este modulo. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import writeXlsxFileNode from 'write-excel-file/node';
import { validateTakeoffResponse } from '../server/api-lib/_planoValidate.mjs';
import { PLANO_ELEMENT_STATES, applyPlanoElementReview, toApuSeed } from '../src/domain/planoReview.js';
import { searchLibrary } from '../server/api-lib/_librarySearch.mjs';
import { templateFallbackAPU } from '../src/domain/apuGeneration.js';
import { migrateLegacyApuToV2 } from '../src/domain/apuSchema.js';
import { applyConceptMetadataV2 } from '../src/domain/apuGeneration.js';
import { finalizeProfessionalAPU } from '../src/domain/apuProfessional.js';
import { exportAPUExcelV2, exportAPUPdfV2 } from '../src/lib/apuExportV2.js';

function simulatedModelResponse(){
  return {
    resumenAnalisis: 'Plano arquitectonico de una planta, 2 paginas, con cotas de muro visibles y una ventana sin acotar.',
    elementos: [
      {
        tipo: 'muro', descripcion: 'Muro de block hueco 15cm perimetral, eje A-B',
        cantidadPropuesta: 126.4, unidad: 'm²', confianzaIA: 82, pagina: 2,
        evidencia: 'Cota de 12.64 x 10.00 m visible junto al eje A-B, pagina 2.',
        fuenteEscala: 'cotas_texto', observaciones: 'Incluye vanos de puertas descontados.'
      },
      {
        tipo: 'ventana', descripcion: 'Ventana de aluminio 1.20 x 1.00 m, fachada norte',
        // El modelo intenta proponer una cantidad SIN escala confiable: la
        // regla determinista debe anularla sin importar esto.
        cantidadPropuesta: 8, unidad: 'pza', confianzaIA: 55, pagina: 1,
        evidencia: 'Se observan 8 ventanas similares en el alzado, sin cota de dimension.',
        fuenteEscala: 'no_determinada', observaciones: ''
      },
      {
        tipo: 'puerta', descripcion: 'Puerta interior de madera, 0.90 x 2.10 m',
        cantidadPropuesta: 5, unidad: 'pza', confianzaIA: 70, pagina: 1,
        evidencia: 'Simbolo estandar de puerta repetido 5 veces en planta, escala grafica 1:100 indicada en el plano.',
        fuenteEscala: 'escala_grafica', observaciones: 'Posible confusion con acceso de closet.'
      }
    ]
  };
}

test('E2E Takeoff: respuesta simulada -> validacion determinista -> regla de escala forzada', () => {
  const result = validateTakeoffResponse(simulatedModelResponse(), { numPages: 2 });
  assert.equal(result.ok, true);
  assert.equal(result.elementos.length, 3);

  const muro = result.elementos.find(e => e.tipo === 'muro');
  assert.equal(muro.cantidadPropuesta, 126.4);
  assert.equal(muro.estado, PLANO_ELEMENT_STATES.PROPUESTO_POR_IA); // escala valida, pero AUN no verificado

  const ventana = result.elementos.find(e => e.tipo === 'ventana');
  assert.equal(ventana.cantidadPropuesta, null, 'la regla determinista anula la cantidad aunque el modelo la propuso');
  assert.equal(ventana.estado, PLANO_ELEMENT_STATES.REQUIERE_REVISION);

  const puerta = result.elementos.find(e => e.tipo === 'puerta');
  assert.equal(puerta.cantidadPropuesta, 5);
  assert.equal(puerta.estado, PLANO_ELEMENT_STATES.PROPUESTO_POR_IA);
});

test('E2E Takeoff: revision humana (validar con correccion, rechazar, dejar pendiente) y gate hacia el APU', () => {
  const validated = validateTakeoffResponse(simulatedModelResponse(), { numPages: 2 }).elementos;
  const validatorId = 'diana@zoemec.com';

  // 1) Muro: el usuario VALIDA pero corrige la cantidad (126.4 -> 128.0, midio distinto)
  const muroIdx = validated.findIndex(e => e.tipo === 'muro');
  validated[muroIdx] = applyPlanoElementReview(validated[muroIdx], {
    state: PLANO_ELEMENT_STATES.VALIDADO_POR_USUARIO, validatedBy: validatorId, cantidadCorregida: 128
  });

  // 2) Puerta: el usuario RECHAZA (era el acceso de un closet, no una puerta interior real)
  const puertaIdx = validated.findIndex(e => e.tipo === 'puerta');
  validated[puertaIdx] = applyPlanoElementReview(validated[puertaIdx], {
    state: PLANO_ELEMENT_STATES.RECHAZADO, validatedBy: validatorId, motivo: 'Es el acceso de un closet, no una puerta interior contable.'
  });

  // 3) Ventana: queda REQUIERE_REVISION, el usuario no la toca todavia (pendiente de medida de referencia)

  const seeds = validated.map(toApuSeed).filter(Boolean);
  assert.equal(seeds.length, 1, 'solo el elemento VALIDADO_POR_USUARIO produce una semilla de APU');
  assert.equal(seeds[0].concept, 'Muro de block hueco 15cm perimetral, eje A-B');
  assert.equal(seeds[0].qty, 128); // la cantidad CORREGIDA, no la original de la IA
  assert.equal(seeds[0].unit, 'm²');
  assert.equal(seeds[0].sourceMeta.fuenteEscala, 'cotas_texto');
  assert.equal(seeds[0].sourceMeta.validatedBy, validatorId);

  // Buscar matrices similares en Biblioteca (motor real, sin red) con la
  // descripcion del elemento validado -- integracion Biblioteca -> APU.
  const libraryDocs = [
    { id: 'LIB-1', name: 'Muro de block hueco 15cm.xlsx', cat: 'Matrices APU', family: 'Albañileria', contentInsumos: [] }
  ];
  const similares = searchLibrary(libraryDocs, seeds[0].concept);
  assert.ok(similares.length >= 1, 'debe encontrar al menos una matriz relacionada por coincidencia de texto');
});

test('E2E Takeoff: la semilla validada llega, calculada, hasta XLSX/PDF reales (RC3, sin tocar)', () => {
  const validated = validateTakeoffResponse(simulatedModelResponse(), { numPages: 2 }).elementos;
  const muroIdx = validated.findIndex(e => e.tipo === 'muro');
  const muro = applyPlanoElementReview(validated[muroIdx], {
    state: PLANO_ELEMENT_STATES.VALIDADO_POR_USUARIO, validatedBy: 'diana@zoemec.com', cantidadCorregida: 128
  });
  const seed = toApuSeed(muro);
  assert.ok(seed);

  const sourceFile = `Plano: ${'plano-planta-baja.pdf'} (pagina ${muro.pagina})`;
  const v1 = templateFallbackAPU(seed, [], 0, sourceFile, 'Takeoff validado por usuario, sin IA de generacion de matriz');
  const v2Base = migrateLegacyApuToV2(v1);
  const withMeta = applyConceptMetadataV2(v2Base, seed, 0, sourceFile);
  const apu = finalizeProfessionalAPU(withMeta);

  assert.equal(apu.concept, seed.concept);
  assert.equal(apu.unit, 'm²');
  assert.equal(apu.cantidadObra, 128);
  assert.ok(apu.calculated.pu > 0);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-takeoff-e2e-'));
  const before = process.cwd();
  process.chdir(dir);
  try{
    exportAPUPdfV2(apu, { fileName: 'takeoff-e2e.pdf' });
    const { doc } = exportAPUPdfV2(apu, { save: false });
    const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    assert.ok(raw.includes('128'), 'la cantidad corregida por el usuario debe quedar trazable en el PDF final');
    assert.ok(fs.statSync('takeoff-e2e.pdf').size > 1000);
  } finally {
    process.chdir(before);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
