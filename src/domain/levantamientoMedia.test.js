import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCAN_MEDIA_KIND, MAX_SCAN_VIDEO_BYTES, MAX_SCAN_PHOTO_BYTES, MAX_SCAN_DURATION_SECONDS,
  MAX_SCAN_ITEMS, validateScanMediaFile, buildScanMediaItem, pickPreferredVideoMimeType
} from './levantamientoMedia.js';

test('validateScanMediaFile acepta un video valido', () => {
  const result = validateScanMediaFile({ kind: SCAN_MEDIA_KIND.VIDEO, sizeBytes: 50 * 1024 * 1024, durationSeconds: 90 });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('validateScanMediaFile acepta una foto valida', () => {
  const result = validateScanMediaFile({ kind: SCAN_MEDIA_KIND.PHOTO, sizeBytes: 2 * 1024 * 1024 });
  assert.equal(result.valid, true);
});

test('validateScanMediaFile rechaza un video que excede MAX_SCAN_VIDEO_BYTES', () => {
  const result = validateScanMediaFile({ kind: SCAN_MEDIA_KIND.VIDEO, sizeBytes: MAX_SCAN_VIDEO_BYTES + 1, durationSeconds: 30 });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('excede_tamano_maximo'));
});

test('validateScanMediaFile acepta exactamente MAX_SCAN_VIDEO_BYTES (limite inclusivo)', () => {
  const result = validateScanMediaFile({ kind: SCAN_MEDIA_KIND.VIDEO, sizeBytes: MAX_SCAN_VIDEO_BYTES, durationSeconds: 30 });
  assert.equal(result.valid, true);
});

test('validateScanMediaFile rechaza una foto que excede MAX_SCAN_PHOTO_BYTES', () => {
  const result = validateScanMediaFile({ kind: SCAN_MEDIA_KIND.PHOTO, sizeBytes: MAX_SCAN_PHOTO_BYTES + 1 });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('excede_tamano_maximo'));
});

test('validateScanMediaFile rechaza un video que excede MAX_SCAN_DURATION_SECONDS', () => {
  const result = validateScanMediaFile({ kind: SCAN_MEDIA_KIND.VIDEO, sizeBytes: 1024, durationSeconds: MAX_SCAN_DURATION_SECONDS + 1 });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('excede_duracion_maxima'));
});

test('validateScanMediaFile ignora duracion en fotos (nunca aplica el limite de duracion ahi)', () => {
  const result = validateScanMediaFile({ kind: SCAN_MEDIA_KIND.PHOTO, sizeBytes: 1024, durationSeconds: 99999 });
  assert.equal(result.valid, true);
});

test('validateScanMediaFile rechaza cuando currentCount ya alcanzo MAX_SCAN_ITEMS', () => {
  const result = validateScanMediaFile({ kind: SCAN_MEDIA_KIND.PHOTO, sizeBytes: 1024, currentCount: MAX_SCAN_ITEMS });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('excede_maximo_items'));
});

test('validateScanMediaFile acepta cuando currentCount esta justo debajo de MAX_SCAN_ITEMS', () => {
  const result = validateScanMediaFile({ kind: SCAN_MEDIA_KIND.PHOTO, sizeBytes: 1024, currentCount: MAX_SCAN_ITEMS - 1 });
  assert.equal(result.valid, true);
});

test('validateScanMediaFile rechaza un tamano invalido (cero, negativo, no numerico)', () => {
  assert.equal(validateScanMediaFile({ kind: SCAN_MEDIA_KIND.PHOTO, sizeBytes: 0 }).valid, false);
  assert.equal(validateScanMediaFile({ kind: SCAN_MEDIA_KIND.PHOTO, sizeBytes: -5 }).valid, false);
  assert.equal(validateScanMediaFile({ kind: SCAN_MEDIA_KIND.PHOTO, sizeBytes: NaN }).valid, false);
});

test('validateScanMediaFile rechaza un kind desconocido', () => {
  const result = validateScanMediaFile({ kind: 'audio', sizeBytes: 1024 });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('tipo_invalido'));
});

test('buildScanMediaItem produce un objeto plano y JSON-safe con id prefijo MED-', () => {
  const item = buildScanMediaItem({
    kind: SCAN_MEDIA_KIND.VIDEO, storagePath: 'levantamiento-media/u1/LEV-ABC/video/f1/clip.mp4',
    mimeType: 'video/mp4', sizeBytes: 12345, durationSeconds: 42, capturedAt: 1700000000000
  });
  assert.ok(item.id.startsWith('MED-'));
  assert.equal(item.kind, 'video');
  assert.equal(item.storagePath, 'levantamiento-media/u1/LEV-ABC/video/f1/clip.mp4');
  assert.equal(item.mimeType, 'video/mp4');
  assert.equal(item.sizeBytes, 12345);
  assert.equal(item.durationSeconds, 42);
  assert.equal(item.hasAudio, false);
  assert.equal(item.capturedAt, 1700000000000);
  assert.doesNotThrow(() => JSON.stringify(item));
});

test('buildScanMediaItem deja durationSeconds en null para fotos (nunca inventa una duracion)', () => {
  const item = buildScanMediaItem({ kind: SCAN_MEDIA_KIND.PHOTO, storagePath: 'x', mimeType: 'image/jpeg', sizeBytes: 500 });
  assert.equal(item.kind, 'photo');
  assert.equal(item.durationSeconds, null);
});

test('buildScanMediaItem sanea valores faltantes/invalidos a defaults seguros', () => {
  const item = buildScanMediaItem({});
  assert.equal(item.kind, 'video');
  assert.equal(item.storagePath, '');
  assert.equal(item.mimeType, '');
  assert.equal(item.sizeBytes, 0);
  assert.equal(item.hasAudio, false);
  assert.ok(Number.isFinite(item.capturedAt));
  assert.doesNotThrow(() => JSON.stringify(item));
});

test('pickPreferredVideoMimeType prefiere video/mp4 cuando esta soportado', () => {
  assert.equal(pickPreferredVideoMimeType(['video/webm', 'video/mp4']), 'video/mp4');
});

test('pickPreferredVideoMimeType cae a webm con el mejor codec disponible si mp4 no esta soportado', () => {
  assert.equal(pickPreferredVideoMimeType(['video/webm', 'video/webm;codecs=vp8', 'video/webm;codecs=vp9']), 'video/webm;codecs=vp9');
});

test('pickPreferredVideoMimeType regresa el primer candidato si ninguno esta en la lista de preferencia', () => {
  assert.equal(pickPreferredVideoMimeType(['video/x-custom']), 'video/x-custom');
});

test('pickPreferredVideoMimeType regresa null si no hay ningun candidato soportado', () => {
  assert.equal(pickPreferredVideoMimeType([]), null);
  assert.equal(pickPreferredVideoMimeType(undefined), null);
});
