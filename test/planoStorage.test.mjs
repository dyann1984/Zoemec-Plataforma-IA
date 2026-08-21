/* Almacenamiento minimo del plano original (RC4). Sin credenciales reales de
   Firebase Admin en este entorno de pruebas (mismo limite ya documentado
   para el resto de RC4), no se puede probar una escritura EXITOSA real a
   Storage aqui -- eso ya se demostro por separado con Biblioteca usando el
   mismo mecanismo (getAdminStorage + signed URL). Lo que SI se prueba aqui,
   determinista y sin red: (1) el limite de tamano nunca intenta Storage, y
   (2) si Storage falla (por ejemplo sin credenciales), nunca se finge
   almacenado -- se reporta el error explicito, tal como exige el resto de
   RC4 ("nunca declarar exito sin evidencia real"). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { storeOriginalPlano } from '../api/visual-ai.mjs';
import { MAX_UPLOAD_BYTES } from '../server/api-lib/_libraryClassify.mjs';

test('storeOriginalPlano: un archivo que excede MAX_UPLOAD_BYTES nunca intenta Storage, se documenta la razon', async () => {
  const buffer = Buffer.alloc(MAX_UPLOAD_BYTES + 1024, 1);
  const result = await storeOriginalPlano({ uid: 'alice', visualRequestId: 'req1', fileName: 'plano-grande.pdf', mimeType: 'application/pdf', buffer });
  assert.equal(result.fileStored, false);
  assert.equal(result.storagePath, null);
  assert.equal(result.downloadURL, null);
  assert.equal(result.fileHash, null);
  assert.match(result.storageError, /supera el maximo/);
});

test('storeOriginalPlano: un archivo dentro del limite intenta Storage real; si falla (sin credenciales en este entorno), nunca finge exito', async () => {
  const buffer = Buffer.from('contenido de prueba de un plano pequeno', 'utf8');
  const result = await storeOriginalPlano({ uid: 'alice', visualRequestId: 'req2', fileName: 'plano-chico.pdf', mimeType: 'application/pdf', buffer });
  // En este entorno de pruebas no hay FIREBASE_SERVICE_ACCOUNT_JSON: se
  // espera que falle honestamente, nunca que reporte fileStored:true sin
  // haber escrito nada real.
  if(!result.fileStored){
    assert.ok(result.storageError, 'si no se almaceno, debe explicar por que');
    assert.equal(result.storagePath, null);
    assert.equal(result.downloadURL, null);
  }else{
    // Si este entorno SI tuviera credenciales configuradas, debe haber
    // escrito de verdad: ruta, URL y hash reales, no simulados.
    assert.match(result.storagePath, /^visual\/alice\/req2\//);
    assert.ok(result.downloadURL);
    assert.equal(result.fileHash.length, 64); // sha256 hex
  }
});

test('storeOriginalPlano: el hash SHA-256 es determinista para el mismo contenido (cuando se calcula)', async () => {
  const buffer1 = Buffer.from('mismo contenido');
  const buffer2 = Buffer.from('mismo contenido');
  const r1 = await storeOriginalPlano({ uid: 'alice', visualRequestId: 'reqA', fileName: 'a.pdf', mimeType: 'application/pdf', buffer: buffer1 });
  const r2 = await storeOriginalPlano({ uid: 'alice', visualRequestId: 'reqB', fileName: 'b.pdf', mimeType: 'application/pdf', buffer: buffer2 });
  if(r1.fileStored && r2.fileStored){
    assert.equal(r1.fileHash, r2.fileHash, 'mismo contenido debe producir el mismo hash SHA-256');
  }
});
