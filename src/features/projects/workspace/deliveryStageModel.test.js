import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeDeliveryStageModel,
  sameVersionSet
} from './deliveryStageModel.js';

const apu = (id, version = 'V1', projectId = 'project-a', extra = {}) => ({
  id,
  projectId,
  currentVersion: version,
  ...extra
});

const projectEvent = ({
  projectId = 'project-a',
  versions = [],
  format = 'PDF',
  timestamp = '2026-09-16T20:00:00.000Z',
  scope = 'PROJECT'
} = {}) => ({
  scope,
  projectId,
  apuVersionIds: versions,
  format,
  mode: 'TECNICO',
  timestamp
});

test('sin APUs entregables devuelve PENDIENTE', () => {
  const model = computeDeliveryStageModel({
    projectId: 'project-a',
    apuDocs: [],
    exportEvents: []
  });

  assert.equal(model.status, 'pendiente');
  assert.equal(model.reason, 'NO_DELIVERABLE_APUS');
  assert.equal(model.apuCount, 0);
});

test('con APUs pero sin exportaciones devuelve ATENCION', () => {
  const model = computeDeliveryStageModel({
    projectId: 'project-a',
    apuDocs: [apu('apu-1')],
    exportEvents: []
  });

  assert.equal(model.status, 'atencion');
  assert.equal(model.reason, 'NOT_EXPORTED');
  assert.equal(model.neverExported, true);
  assert.equal(model.isStale, false);
});

test('una exportacion PROJECT con las versiones actuales completa Entrega', () => {
  const model = computeDeliveryStageModel({
    projectId: 'project-a',
    apuDocs: [
      apu('apu-1', 'V1'),
      apu('apu-2', 'V3')
    ],
    exportEvents: [
      projectEvent({
        versions: ['apu-1@V1', 'apu-2@V3']
      })
    ]
  });

  assert.equal(model.status, 'completado');
  assert.equal(model.reason, 'CURRENT_DELIVERY_EXISTS');
  assert.deepEqual(model.currentFormats, ['PDF']);
});

test('el orden de apuVersionIds no altera la comparacion', () => {
  assert.equal(
    sameVersionSet(
      ['apu-2@V3', 'apu-1@V1'],
      ['apu-1@V1', 'apu-2@V3']
    ),
    true
  );
});

test('si cambia una version del APU la entrega queda desactualizada', () => {
  const model = computeDeliveryStageModel({
    projectId: 'project-a',
    apuDocs: [
      apu('apu-1', 'V2'),
      apu('apu-2', 'V1')
    ],
    exportEvents: [
      projectEvent({
        versions: ['apu-1@V1', 'apu-2@V1']
      })
    ]
  });

  assert.equal(model.status, 'atencion');
  assert.equal(model.reason, 'DELIVERY_OUTDATED');
  assert.equal(model.isStale, true);
  assert.equal(model.currentExports.length, 0);
});

test('ignora exportaciones de otro proyecto y scopes que no son PROJECT', () => {
  const model = computeDeliveryStageModel({
    projectId: 'project-a',
    apuDocs: [apu('apu-1', 'V1')],
    exportEvents: [
      projectEvent({
        projectId: 'project-b',
        versions: ['apu-1@V1']
      }),
      projectEvent({
        projectId: 'project-a',
        versions: ['apu-1@V1'],
        scope: 'APU'
      })
    ]
  });

  assert.equal(model.status, 'atencion');
  assert.equal(model.projectExports.length, 0);
});

test('reconoce PDF y XLSX actuales sin exigir ambos formatos', () => {
  const model = computeDeliveryStageModel({
    projectId: 'project-a',
    apuDocs: [apu('apu-1', 'V4')],
    exportEvents: [
      projectEvent({
        versions: ['apu-1@V4'],
        format: 'PDF',
        timestamp: '2026-09-16T19:00:00.000Z'
      }),
      projectEvent({
        versions: ['apu-1@V4'],
        format: 'XLSX',
        timestamp: '2026-09-16T20:00:00.000Z'
      })
    ]
  });

  assert.equal(model.status, 'completado');
  assert.deepEqual(
    new Set(model.currentFormats),
    new Set(['PDF', 'XLSX'])
  );
  assert.equal(model.lastCurrentExport.format, 'XLSX');
});

test('ignora APUs archivados al definir la entrega actual', () => {
  const model = computeDeliveryStageModel({
    projectId: 'project-a',
    apuDocs: [
      apu('apu-1', 'V2'),
      apu('apu-archived', 'V7', 'project-a', {
        archivedAt: '2026-09-16T18:00:00.000Z'
      })
    ],
    exportEvents: [
      projectEvent({
        versions: ['apu-1@V2']
      })
    ]
  });

  assert.equal(model.apuCount, 1);
  assert.deepEqual(model.currentVersionIds, ['apu-1@V2']);
  assert.equal(model.status, 'completado');
});