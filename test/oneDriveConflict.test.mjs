import test from 'node:test';
import assert from 'node:assert/strict';
import { isConflictStatus, buildUploadHeaders, uploadFileName } from '../server/api-lib/_oneDriveConflict.mjs';

// --- isConflictStatus: que codigos HTTP de Microsoft Graph cuentan como
// conflicto real (nunca se sobrescribe en esos casos) ---
test('isConflictStatus: 409 y 412 son conflicto real', () => {
  assert.equal(isConflictStatus(409), true);
  assert.equal(isConflictStatus(412), true);
});

test('isConflictStatus: 200/201/404/500 NUNCA se tratan como conflicto', () => {
  assert.equal(isConflictStatus(200), false);
  assert.equal(isConflictStatus(201), false);
  assert.equal(isConflictStatus(404), false);
  assert.equal(isConflictStatus(500), false);
});

// --- buildUploadHeaders: control optimista de concurrencia (If-Match) ---
test('buildUploadHeaders: sin remoteEtag conocido, NO se envia If-Match (primera subida, nada que proteger)', () => {
  const headers = buildUploadHeaders({ accessToken: 'tok', remoteEtag: null, resolution: undefined });
  assert.equal(headers['If-Match'], undefined);
  assert.equal(headers.Authorization, 'Bearer tok');
});

test('buildUploadHeaders: con remoteEtag conocido y sin resolucion explicita, SI se envia If-Match con ese eTag exacto', () => {
  const headers = buildUploadHeaders({ accessToken: 'tok', remoteEtag: '"abc123"', resolution: undefined });
  assert.equal(headers['If-Match'], '"abc123"');
});

test('buildUploadHeaders: resolucion explicita "local" (el humano ya eligio) fuerza la escritura -- nunca envia If-Match aunque haya remoteEtag', () => {
  const headers = buildUploadHeaders({ accessToken: 'tok', remoteEtag: '"abc123"', resolution: 'local' });
  assert.equal(headers['If-Match'], undefined);
});

test('buildUploadHeaders: resolucion explicita "version" (guardar ambos) tampoco envia If-Match -- sube como archivo nuevo, no compite con el remoto', () => {
  const headers = buildUploadHeaders({ accessToken: 'tok', remoteEtag: '"abc123"', resolution: 'version' });
  assert.equal(headers['If-Match'], undefined);
});

// --- uploadFileName: "guardar ambos/versionar" nunca pisa el archivo remoto ---
test('uploadFileName: sin resolucion "version", el nombre no cambia', () => {
  assert.equal(uploadFileName('catalogo.xlsx', undefined), 'catalogo.xlsx');
  assert.equal(uploadFileName('catalogo.xlsx', 'local'), 'catalogo.xlsx');
  assert.equal(uploadFileName('catalogo.xlsx', 'remote'), 'catalogo.xlsx');
});

test('uploadFileName: resolucion "version" produce un nombre NUEVO y distinto, preservando la extension', () => {
  const now = new Date('2026-08-28T15:30:00.000Z');
  const versioned = uploadFileName('catalogo.xlsx', 'version', now);
  assert.notEqual(versioned, 'catalogo.xlsx');
  assert.match(versioned, /^catalogo \(conflicto .*\)\.xlsx$/);
});

test('uploadFileName: resolucion "version" con un archivo sin extension tambien produce un nombre distinto', () => {
  const now = new Date('2026-08-28T15:30:00.000Z');
  const versioned = uploadFileName('README', 'version', now);
  assert.notEqual(versioned, 'README');
  assert.match(versioned, /^README \(conflicto .*\)$/);
});
