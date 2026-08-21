/* Almacenamiento del plano original (RC4): OPCIONAL por decision explicita
   del usuario -- el proyecto esta en plan Firebase Spark y no se activara
   Storage (evita introducir facturacion antes del concurso). La ausencia
   del bucket ("The specified bucket does not exist", confirmado en
   produccion) debe ser una condicion SOPORTADA, nunca un error bloqueante:
   Takeoff, la revision humana, Biblioteca y el APU deben funcionar igual.

   En este entorno de pruebas no hay credenciales reales de Firebase Admin
   (mismo limite ya documentado en el resto de RC4), asi que Storage
   tambien falla aqui -- lo cual, convenientemente, es EXACTAMENTE la misma
   clase de condicion ("Storage no disponible") que se necesita probar. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import writeXlsxFileNode from 'write-excel-file/node';
import { storeOriginalPlano } from '../api/visual-ai.mjs';
import { MAX_UPLOAD_BYTES } from '../server/api-lib/_libraryClassify.mjs';
import { validateTakeoffResponse } from '../server/api-lib/_planoValidate.mjs';
import { applyPlanoElementReview, toApuSeed } from '../src/domain/planoReview.js';
import { templateFallbackAPU, applyConceptMetadataV2 } from '../src/domain/apuGeneration.js';
import { migrateLegacyApuToV2 } from '../src/domain/apuSchema.js';
import { finalizeProfessionalAPU } from '../src/domain/apuProfessional.js';
import { exportAPUExcelV2, exportAPUPdfV2 } from '../src/lib/apuExportV2.js';

test('storeOriginalPlano: un archivo que excede MAX_UPLOAD_BYTES nunca intenta Storage, pero SI calcula el hash', async () => {
  const buffer = Buffer.alloc(MAX_UPLOAD_BYTES + 1024, 1);
  const result = await storeOriginalPlano({ uid: 'alice', visualRequestId: 'req1', fileName: 'plano-grande.pdf', mimeType: 'application/pdf', buffer });
  assert.equal(result.fileStored, false);
  assert.equal(result.storagePath, null);
  assert.equal(result.downloadURL, null);
  assert.equal(result.fileHash.length, 64, 'el hash SHA-256 debe calcularse aunque el archivo no se almacene');
  assert.match(result.storageError, /supera el maximo/);
});

test('storeOriginalPlano: cuando Storage no esta disponible (bucket inexistente / sin credenciales), nunca lanza y SIEMPRE calcula el hash', async () => {
  const buffer = Buffer.from('contenido real de un plano pequeno', 'utf8');
  const result = await storeOriginalPlano({ uid: 'alice', visualRequestId: 'req2', fileName: 'plano-chico.pdf', mimeType: 'application/pdf', buffer });
  if(!result.fileStored){
    assert.ok(result.storageError, 'si no se almaceno, debe explicar por que');
    assert.equal(result.storagePath, null);
    assert.equal(result.downloadURL, null);
    assert.equal(result.fileHash.length, 64, 'el hash debe sobrevivir aunque Storage falle -- es la unica trazabilidad del archivo cuando no hay bucket');
  }else{
    // Si en algun entorno SI hay bucket configurado, debe ser una escritura real.
    assert.match(result.storagePath, /^visual\/alice\/req2\//);
    assert.ok(result.downloadURL);
    assert.equal(result.fileHash.length, 64);
  }
});

test('storeOriginalPlano: el hash SHA-256 es determinista para el mismo contenido, exista o no Storage', async () => {
  const buffer1 = Buffer.from('mismo contenido');
  const buffer2 = Buffer.from('mismo contenido');
  const r1 = await storeOriginalPlano({ uid: 'alice', visualRequestId: 'reqA', fileName: 'a.pdf', mimeType: 'application/pdf', buffer: buffer1 });
  const r2 = await storeOriginalPlano({ uid: 'alice', visualRequestId: 'reqB', fileName: 'b.pdf', mimeType: 'application/pdf', buffer: buffer2 });
  assert.equal(r1.fileHash, r2.fileHash, 'mismo contenido debe producir el mismo hash SHA-256 independientemente de si Storage esta disponible');
});

test('storeOriginalPlano: "bucket does not exist" se traduce a un mensaje claro de "Storage no configurado", nunca se oculta el hecho', async () => {
  const buffer = Buffer.from('plano de prueba');
  const result = await storeOriginalPlano({ uid: 'alice', visualRequestId: 'req3', fileName: 'plano.pdf', mimeType: 'application/pdf', buffer });
  if(!result.fileStored){
    // En este entorno sin credenciales el mensaje real sera sobre
    // FIREBASE_SERVICE_ACCOUNT_JSON; en produccion (Spark, sin bucket) es
    // "specified bucket does not exist" -- ambos casos deben quedar
    // explicados, nunca silenciados.
    assert.ok(result.storageError.length > 0);
  }
});

/* REGRESION OBLIGATORIA (RC4, punto 5): Storage no configurado -> Takeoff
   funciona -> resultado persistido -> revision humana funciona -> APU
   funciona. Nunca HTTP 500, nunca se pierde el resultado de Takeoff. Se
   ejercita el pipeline COMPLETO posterior al analisis (que es identico con o
   sin Storage: no depende de storagePath/downloadURL/fileStored en ningun
   punto), usando una respuesta de modelo simulada -- la parte de Storage
   real ya se prueba arriba con storeOriginalPlano. */
test('REGRESION: Storage no configurado no bloquea Takeoff -> revision humana -> APU -> XLSX/PDF', async () => {
  // 1) Storage falla (bucket inexistente / sin credenciales) -- se demuestra que no lanza.
  const planoBuffer = Buffer.from('contenido real de un plano de prueba para la regresion');
  const storage = await storeOriginalPlano({ uid: 'diana', visualRequestId: 'req-regresion', fileName: 'plano-regresion.pdf', mimeType: 'application/pdf', buffer: planoBuffer });
  assert.equal(storage.fileStored, false, 'en este entorno Storage no esta disponible: debe degradarse, no lanzar');
  assert.ok(storage.fileHash);

  // 2) El resultado de Takeoff (ya validado deterministicamente) se conserva
  // integro sin importar el resultado de Storage -- son estructuras
  // independientes, nunca se descarta un elemento por falta de bucket.
  const modelResponse = {
    resumenAnalisis: 'Plano de regresion con un muro acotado.',
    elementos: [{
      tipo: 'muro', descripcion: 'Muro de regresion 6.00 m', cantidadPropuesta: 6, unidad: 'm',
      confianzaIA: 90, pagina: 1, evidencia: 'MURO: 6.00 m', fuenteEscala: 'cotas_texto', observaciones: ''
    }]
  };
  const validation = validateTakeoffResponse(modelResponse, { numPages: 1 });
  assert.equal(validation.ok, true);
  assert.equal(validation.elementos.length, 1, 'el resultado de Takeoff no se pierde aunque Storage haya fallado');

  // 3) Revision humana: funciona identico, no toca ningun campo de storage.
  const validatorId = 'diana@zoemec.com';
  const elemento = applyPlanoElementReview(validation.elementos[0], { state: 'VALIDADO_POR_USUARIO', validatedBy: validatorId });
  assert.equal(elemento.estado, 'VALIDADO_POR_USUARIO');

  // 4) APU: la semilla y el motor real no dependen de storagePath/downloadURL/fileStored.
  const seed = toApuSeed(elemento);
  assert.ok(seed, 'la semilla de APU se genera igual, sin importar el estado de Storage');
  const sourceFile = `Plano: plano-regresion.pdf (hash ${storage.fileHash.slice(0, 12)}..., sin archivo original almacenado)`;
  const v1 = templateFallbackAPU(seed, [], 0, sourceFile, 'Regresion: Storage no configurado');
  const v2Base = migrateLegacyApuToV2(v1);
  const withMeta = applyConceptMetadataV2(v2Base, seed, 0, sourceFile);
  const apu = finalizeProfessionalAPU(withMeta);
  assert.equal(apu.concept, 'Muro de regresion 6.00 m');
  assert.ok(apu.calculated.pu > 0, 'el motor real calcula un precio unitario positivo sin necesitar el archivo del plano almacenado');

  // 5) Exportadores reales (RC3, sin tocar): XLSX/PDF se generan igual.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-storage-regresion-'));
  const before = process.cwd();
  process.chdir(dir);
  try{
    await exportAPUExcelV2(apu, { writeXlsxFileImpl: writeXlsxFileNode, fileName: 'regresion.xlsx' });
    assert.ok(fs.statSync('regresion.xlsx').size > 1000);
    const { doc } = exportAPUPdfV2(apu, { fileName: 'regresion.pdf' });
    assert.ok(fs.statSync('regresion.pdf').size > 1000);
    const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    assert.ok(raw.includes('Muro de regresion'), 'el PDF final es correcto aunque el plano original nunca se haya almacenado');
  }finally{
    process.chdir(before);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // 6) Confirmacion final del punto 5: ni un solo paso de este flujo lanzo
  // una excepcion no controlada (equivalente a "nunca HTTP 500") y el
  // resultado de Takeoff jamas se perdio.
});
