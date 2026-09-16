import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProjectEvidenceList,
  makeProjectEvidenceRecord,
  EVIDENCE_SOURCE,
  EVIDENCE_TYPE,
  ANALYSIS_STATUS
} from './evidenceAdapter.js';

test('evidenceAdapter: makeProjectEvidenceRecord normaliza campos de lectura', () => {
  const record = makeProjectEvidenceRecord({
    id: 'test-1',
    source: EVIDENCE_SOURCE.EVIDENCE_ITEM,
    type: EVIDENCE_TYPE.PHOTO,
    projectId: 'PRO-1',
    name: 'Fachada Principal.jpg',
    createdAt: 1700000000000,
    sizeBytes: 1048576,
    mimeType: 'image/jpeg',
    storagePath: 'levantamiento-media/u1/PRO-1/photo/p1/foto.jpg'
  });

  assert.equal(record.id, 'test-1');
  assert.equal(record.source, 'evidence_item');
  assert.equal(record.type, 'photo');
  assert.equal(record.projectId, 'PRO-1');
  assert.equal(record.name, 'Fachada Principal.jpg');
  assert.equal(record.createdAt, 1700000000000);
  assert.equal(record.sizeBytes, 1048576);
  assert.equal(record.mimeType, 'image/jpeg');
  assert.equal(record.analysisStatus, ANALYSIS_STATUS.PENDING);
});

test('evidenceAdapter: aísla estrictamente por projectId', () => {
  const surveys = [
    { id: 's1', projectId: 'PRO-100', name: 'Levantamiento Obra 1' },
    { id: 's2', projectId: 'PRO-200', name: 'Levantamiento Obra 2' }
  ];
  const planos = [
    { id: 'p1', projectId: 'PRO-100', fileName: 'Plano-A1.pdf' },
    { id: 'p2', projectId: 'PRO-200', fileName: 'Plano-B1.pdf' }
  ];
  const items = [
    { id: 'e1', projectId: 'PRO-100', kind: 'photo', name: 'Foto 1.jpg' },
    { id: 'e2', projectId: 'PRO-200', kind: 'photo', name: 'Foto 2.jpg' }
  ];

  const list = buildProjectEvidenceList({
    projectId: 'PRO-100',
    surveys,
    planos,
    evidenceItems: items
  });

  assert.equal(list.length, 3);
  assert.ok(list.every(r => r.projectId === 'PRO-100'));
  assert.ok(list.some(r => r.id === 'survey-s1'));
  assert.ok(list.some(r => r.id === 'plano-p1'));
  assert.ok(list.some(r => r.id === 'ev-e1'));
});

test('evidenceAdapter: deduplica fotos/videos ya presentes en un survey', () => {
  const sharedStoragePath = 'levantamiento-media/u1/s1/photo/f1.jpg';
  const surveys = [
    {
      id: 's1',
      projectId: 'PRO-1',
      name: 'Levantamiento Planta Baja',
      scanMedia: [
        { id: 'med-1', kind: 'photo', storagePath: sharedStoragePath }
      ]
    }
  ];

  const evidenceItems = [
    // Este ítem tiene el mismo storagePath que el survey -> DEBE DEDUPLICARSE
    {
      id: 'med-1',
      projectId: 'PRO-1',
      kind: 'photo',
      storagePath: sharedStoragePath,
      name: 'f1.jpg'
    },
    // Este ítem es independiente -> DEBE INCLUIRSE
    {
      id: 'med-2',
      projectId: 'PRO-1',
      kind: 'video',
      storagePath: 'levantamiento-media/u1/PRO-1/video/v2.mp4',
      name: 'recorrido.mp4'
    }
  ];

  const list = buildProjectEvidenceList({
    projectId: 'PRO-1',
    surveys,
    evidenceItems,
    planos: []
  });

  // Debe haber 2 registros: el survey 's1' y el video independiente 'med-2', SIN duplicar 'med-1'
  assert.equal(list.length, 2);
  assert.ok(list.some(r => r.id === 'survey-s1'));
  assert.ok(list.some(r => r.id === 'ev-med-2'));
  assert.ok(!list.some(r => r.id === 'ev-med-1'));
});

test('evidenceAdapter: ordena evidencias de más reciente a más antigua', () => {
  const list = buildProjectEvidenceList({
    projectId: 'PRO-1',
    surveys: [{ id: 's1', projectId: 'PRO-1', createdAt: 1000 }],
    planos: [{ id: 'p1', projectId: 'PRO-1', createdAt: 3000 }],
    evidenceItems: [{ id: 'e1', projectId: 'PRO-1', createdAt: 2000 }]
  });

  assert.equal(list[0].id, 'plano-p1'); // 3000
  assert.equal(list[1].id, 'ev-e1');    // 2000
  assert.equal(list[2].id, 'survey-s1'); // 1000
});
