/* Pruebas unitarias puras (sin emulador, sin red) de las funciones de
   seguridad agregadas/corregidas en la Fase 1 de remediacion. Corren dentro
   de `npm test`. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyMercadoPagoSignature } from '../api/payment-webhook.mjs';
import { isValidDriveId } from '../server/api-lib/_googleDrive.mjs';
import { assertAllowedFile, sanitizeFileName } from '../server/api-lib/_libraryClassify.mjs';

function sign(manifest, secret){
  return crypto.createHmac('sha256', secret).update(manifest).digest('hex');
}

describe('verifyMercadoPagoSignature (webhook de Mercado Pago)', () => {
  const secret = 'test-secret';
  const paymentId = '123456789';
  const requestId = 'req-abc';
  const ts = '1700000000';

  it('acepta una firma valida generada con el mismo secreto', () => {
    const manifest = `id:${paymentId};request-id:${requestId};ts:${ts};`;
    const v1 = sign(manifest, secret);
    assert.equal(verifyMercadoPagoSignature({ signatureHeader: `ts=${ts},v1=${v1}`, requestId, paymentId, secret }), true);
  });

  it('rechaza una firma con el hash alterado', () => {
    assert.equal(verifyMercadoPagoSignature({
      signatureHeader: `ts=${ts},v1=${'0'.repeat(64)}`,
      requestId, paymentId, secret
    }), false);
  });

  it('rechaza si el paymentId no coincide con el firmado (no se puede reutilizar la firma de otro pago)', () => {
    const manifest = `id:111;request-id:${requestId};ts:${ts};`;
    const v1 = sign(manifest, secret);
    assert.equal(verifyMercadoPagoSignature({ signatureHeader: `ts=${ts},v1=${v1}`, requestId, paymentId: '222', secret }), false);
  });

  it('rechaza si falta el secreto (endpoint sin MP_WEBHOOK_SECRET configurado)', () => {
    assert.equal(verifyMercadoPagoSignature({ signatureHeader: `ts=${ts},v1=abc`, requestId, paymentId, secret: '' }), false);
  });

  it('rechaza si falta el header x-signature', () => {
    assert.equal(verifyMercadoPagoSignature({ signatureHeader: '', requestId, paymentId, secret }), false);
  });

  it('rechaza si falta x-request-id', () => {
    const manifest = `id:${paymentId};request-id:;ts:${ts};`;
    const v1 = sign(manifest, secret);
    assert.equal(verifyMercadoPagoSignature({ signatureHeader: `ts=${ts},v1=${v1}`, requestId: '', paymentId, secret }), false);
  });
});

describe('isValidDriveId (evita inyeccion de query en Google Drive)', () => {
  it('acepta un id real de Drive', () => {
    assert.equal(isValidDriveId('1A2b3C4d5E6f7G8h9I0j'), true);
  });
  it('rechaza un id con comilla simple (intento de inyeccion de query)', () => {
    assert.equal(isValidDriveId("x' or trashed=false or '"), false);
  });
  it('rechaza un id con espacios', () => {
    assert.equal(isValidDriveId('carpeta con espacios'), false);
  });
  it('rechaza vacio/no-string', () => {
    assert.equal(isValidDriveId(''), false);
    assert.equal(isValidDriveId(undefined), false);
    assert.equal(isValidDriveId(123), false);
  });
});

describe('assertAllowedFile / sanitizeFileName (import de OneDrive/Drive/subida manual)', () => {
  it('acepta un archivo con extension permitida y tamano dentro del limite', () => {
    assert.doesNotThrow(() => assertAllowedFile({ name: 'catalogo.xlsx', size: 1024 }));
  });
  it('rechaza una extension no permitida (.exe)', () => {
    assert.throws(() => assertAllowedFile({ name: 'instalador.exe', size: 1024 }), /Extension no permitida/);
  });
  it('rechaza un archivo .html que podria alojar contenido activo', () => {
    assert.throws(() => assertAllowedFile({ name: 'informe.html', size: 1024 }), /Extension no permitida/);
  });
  it('rechaza un archivo que excede el tamano maximo', () => {
    assert.throws(() => assertAllowedFile({ name: 'grande.pdf', size: 20 * 1024 * 1024 }), /maximo/);
  });
  it('sanitiza caracteres peligrosos del nombre de archivo (path traversal)', () => {
    const clean = sanitizeFileName('../../etc/passwd');
    assert.equal(clean.includes('/'), false);
    assert.equal(clean.includes('..'), true); // los puntos no son peligrosos por si solos, solo el separador de ruta
  });
});
