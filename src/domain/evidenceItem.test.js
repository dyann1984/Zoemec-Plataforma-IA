import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVIDENCE_KIND, EVIDENCE_STATUS, makeEvidenceItem, normalizeEvidenceItem, buildGalleryFromEvidenceItems
} from './evidenceItem.js';

test('makeEvidenceItem: forma completa, uploadedBy siempre igual a ownerUid', () => {
  const item = makeEvidenceItem({
    id: 'MED-1', surveyId: 'LEV-1', projectId: 'PRO-1', organizationId: 'ORG-1', ownerUid: 'uid-1',
    kind: EVIDENCE_KIND.PHOTO, storagePath: 'levantamiento-media/uid-1/LEV-1/photo/MED-1/foto.jpg',
    mimeType: 'image/jpeg', sizeBytes: 12345
  });
  assert.equal(item.id, 'MED-1');
  assert.equal(item.uploadedBy, 'uid-1');
  assert.equal(item.status, EVIDENCE_STATUS.UPLOADING);
  assert.equal(item.durationSeconds, null);
});

test('makeEvidenceItem: video con duracion valida la conserva; foto siempre queda con durationSeconds null', () => {
  const video = makeEvidenceItem({ id: 'M1', surveyId: 'S1', ownerUid: 'u1', kind: EVIDENCE_KIND.VIDEO, storagePath: 'x', durationSeconds: 42.5 });
  assert.equal(video.durationSeconds, 42.5);
  const photo = makeEvidenceItem({ id: 'M2', surveyId: 'S1', ownerUid: 'u1', kind: EVIDENCE_KIND.PHOTO, storagePath: 'x', durationSeconds: 42.5 });
  assert.equal(photo.durationSeconds, null);
});

test('makeEvidenceItem: status invalido cae a UPLOADING (default seguro), nunca a UPLOADED sin confirmar', () => {
  const item = makeEvidenceItem({ id: 'M1', surveyId: 'S1', ownerUid: 'u1', kind: EVIDENCE_KIND.PHOTO, storagePath: 'x', status: 'algo-invalido' });
  assert.equal(item.status, EVIDENCE_STATUS.UPLOADING);
});

test('normalizeEvidenceItem: null si falta id o storagePath -- nunca reconstruye un item sin esos dos datos', () => {
  assert.equal(normalizeEvidenceItem(null), null);
  assert.equal(normalizeEvidenceItem({ id: 'M1' }), null);
  assert.equal(normalizeEvidenceItem({ storagePath: 'x' }), null);
});

test('normalizeEvidenceItem: campos ausentes caen a su default seguro, nunca a un valor inventado distinto de 0/null', () => {
  const item = normalizeEvidenceItem({ id: 'M1', storagePath: 'x' });
  assert.equal(item.sizeBytes, 0);
  assert.equal(item.durationSeconds, null);
  assert.equal(item.organizationId, null);
  assert.equal(item.status, EVIDENCE_STATUS.UPLOADED);
});

test('buildGalleryFromEvidenceItems: ordena por createdAt ascendente (orden real de captura)', () => {
  const gallery = buildGalleryFromEvidenceItems([
    { id: 'M2', storagePath: 'x', createdAt: 200 },
    { id: 'M1', storagePath: 'x', createdAt: 100 },
    { id: 'M3', storagePath: 'x', createdAt: 300 }
  ]);
  assert.deepEqual(gallery.map(i => i.id), ['M1', 'M2', 'M3']);
});

test('buildGalleryFromEvidenceItems: descarta documentos corruptos sin reventar el resto de la galeria', () => {
  const gallery = buildGalleryFromEvidenceItems([
    { id: 'M1', storagePath: 'x', createdAt: 100 },
    { corrupto: true },
    null,
    { id: 'M2', storagePath: 'y', createdAt: 200 }
  ]);
  assert.equal(gallery.length, 2);
  assert.deepEqual(gallery.map(i => i.id), ['M1', 'M2']);
});
