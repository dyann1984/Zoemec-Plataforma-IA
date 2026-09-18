import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUANTITY_SOURCE,
  QUANTITY_STATUS,
  makeProjectQuantityRecord,
  buildProjectQuantityList,
  calculateQuantificationSummary
} from './quantificationAdapter.js';

test('makeProjectQuantityRecord: genera un registro inmutable normalizado', () => {
  const rec = makeProjectQuantityRecord({
    id: 'qty-1',
    projectId: 'PRJ-100',
    source: QUANTITY_SOURCE.PLANO,
    concept: 'Muro tabique',
    category: 'Muros',
    quantity: 12.3456,
    unit: 'm²',
    origin: 'plano-takeoff-vector',
    status: QUANTITY_STATUS.CONFIRMADO,
    metadata: { floor: 1 }
  });

  assert.equal(rec.id, 'qty-1');
  assert.equal(rec.projectId, 'PRJ-100');
  assert.equal(rec.quantity, 12.35); // 2 decimales seguros
  assert.equal(rec.unit, 'm²');
  assert.equal(rec.status, QUANTITY_STATUS.CONFIRMADO);
  assert.equal(rec.metadata.floor, 1);
  assert.ok(Object.isFrozen(rec));
  assert.ok(Object.isFrozen(rec.metadata));
});

test('buildProjectQuantityList: respeta aislamiento estricto por projectId', () => {
  const planoTakeoffs = [
    {
      id: 'TK-1',
      projectId: 'PRJ-A',
      fileName: 'Plano-A.pdf',
      snapshot: {
        elementos: [
          { id: 'el-1', tipo: 'muro', estado: 'VALIDADO_POR_USUARIO', cantidadPropuesta: 10, unidad: 'm' }
        ]
      }
    },
    {
      id: 'TK-2',
      projectId: 'PRJ-B',
      fileName: 'Plano-B.pdf',
      snapshot: {
        elementos: [
          { id: 'el-2', tipo: 'muro', estado: 'VALIDADO_POR_USUARIO', cantidadPropuesta: 25, unidad: 'm' }
        ]
      }
    }
  ];

  const surveys = [
    {
      id: 'SRV-A',
      projectId: 'PRJ-A',
      name: 'Levantamiento A',
      spaces: [{ name: 'Sala', length: 4, width: 3, height: 2.5 }]
    },
    {
      id: 'SRV-B',
      projectId: 'PRJ-B',
      name: 'Levantamiento B',
      spaces: [{ name: 'Bodega', length: 10, width: 10, height: 3 }]
    }
  ];

  const listA = buildProjectQuantityList({ projectId: 'PRJ-A', planoTakeoffs, surveys });
  const listB = buildProjectQuantityList({ projectId: 'PRJ-B', planoTakeoffs, surveys });

  assert.ok(listA.length > 0);
  assert.ok(listB.length > 0);
  assert.ok(listA.every(r => r.projectId === 'PRJ-A'));
  assert.ok(listB.every(r => r.projectId === 'PRJ-B'));
  assert.equal(buildProjectQuantityList({ projectId: 'PRJ-INEXISTENTE', planoTakeoffs, surveys }).length, 0);
});

test('buildProjectQuantityList: procesa Takeoff 2D con isQuantifiable y dimensiones efectivas', () => {
  const planoTakeoffs = [
    {
      id: 'TK-1',
      projectId: 'PRJ-1',
      fileName: 'Arquitectura-P01.pdf',
      snapshot: {
        elementos: [
          {
            id: 'el-val',
            tipo: 'muro',
            descripcion: 'Muro perimetral',
            estado: 'VALIDADO_POR_USUARIO',
            cantidadPropuesta: 14.5,
            unidad: 'm'
          },
          {
            id: 'el-corr',
            tipo: 'piso',
            descripcion: 'Piso cerámico',
            estado: 'CORREGIDO_POR_USUARIO',
            cantidadPropuesta: 20,
            cantidadCorregida: 24.8,
            unidad: 'm²'
          },
          {
            id: 'el-prop',
            tipo: 'puerta',
            descripcion: 'Puerta madera',
            estado: 'PROPUESTO_POR_IA',
            cantidadPropuesta: 3,
            unidad: 'pza'
          }
        ]
      }
    }
  ];

  const list = buildProjectQuantityList({ projectId: 'PRJ-1', planoTakeoffs });
  assert.equal(list.length, 3);

  const valRecord = list.find(r => r.metadata.elementId === 'el-val');
  assert.equal(valRecord.status, QUANTITY_STATUS.CONFIRMADO);
  assert.equal(valRecord.quantity, 14.5);
  assert.equal(valRecord.unit, 'm');
  assert.equal(valRecord.category, 'Muros');

  const corrRecord = list.find(r => r.metadata.elementId === 'el-corr');
  assert.equal(corrRecord.status, QUANTITY_STATUS.CONFIRMADO);
  assert.equal(corrRecord.quantity, 24.8); // Respeta corrección
  assert.equal(corrRecord.unit, 'm²');
  assert.equal(corrRecord.category, 'Pisos');

  const propRecord = list.find(r => r.metadata.elementId === 'el-prop');
  assert.equal(propRecord.status, QUANTITY_STATUS.PROPUESTO);
  assert.equal(propRecord.quantity, 3);
  assert.equal(propRecord.unit, 'pza');
  assert.equal(propRecord.category, 'Puertas');
});

test('REGRESIÓN OBLIGATORIA 91.71 m²: Muros netos con descuento de vanos en Levantamiento IA', () => {
  // Fixture canónico aprobado:
  // Habitación de 8m x 8m x 3m
  // Perímetro = 2 * (8 + 8) = 32m
  // Área bruta de muro = 32 * 3 = 96.00 m²
  // Puerta: 0.90m x 2.10m = 1.89 m²
  // Ventana: 2.00m x 1.20m = 2.40 m²
  // Descuento total = 1.89 + 2.40 = 4.29 m²
  // Muros netos = 96.00 - 4.29 = 91.71 m²
  const surveys = [
    {
      id: 'SRV-CANONICO',
      projectId: 'PRJ-CANONICO',
      name: 'Levantamiento Recámara Principal',
      spaces: [
        {
          name: 'Habitación 8x8',
          length: 8,
          width: 8,
          height: 3,
          elements: [
            { type: 'door', name: 'Puerta Principal', width: 0.90, height: 2.10, quantity: 1 },
            { type: 'window', name: 'Ventana Balcón', width: 2.00, height: 1.20, quantity: 1 }
          ]
        }
      ]
    }
  ];

  const list = buildProjectQuantityList({ projectId: 'PRJ-CANONICO', surveys });

  // 1. Verificar muro neto exacto 91.71 m²
  const wallRecord = list.find(r => r.category === 'Muros' && r.unit === 'm²');
  assert.ok(wallRecord, 'Debe existir registro de muro neto');
  assert.equal(wallRecord.quantity, 91.71, 'Regresión obligatoria: wallNetArea debe ser 91.71 m²');
  assert.equal(wallRecord.metadata.wallGrossArea, 96);
  assert.equal(wallRecord.metadata.doorsArea, 1.89);
  assert.equal(wallRecord.metadata.windowsArea, 2.4);
  assert.equal(wallRecord.status, QUANTITY_STATUS.CONFIRMADO);

  // 2. Superficie de piso = 8 * 8 = 64 m²
  const floorRecord = list.find(r => r.category === 'Pisos' && r.unit === 'm²');
  assert.ok(floorRecord);
  assert.equal(floorRecord.quantity, 64);

  // 3. Plafón = 8 * 8 = 64 m²
  const ceilingRecord = list.find(r => r.category === 'Plafones' && r.unit === 'm²');
  assert.ok(ceilingRecord);
  assert.equal(ceilingRecord.quantity, 64);

  // 4. Perímetro = 32 m
  const perimRecord = list.find(r => r.category === 'Acabados' && r.unit === 'm');
  assert.ok(perimRecord);
  assert.equal(perimRecord.quantity, 32);

  // 5. Volumen = 8 * 8 * 3 = 192 m³
  const volRecord = list.find(r => r.category === 'Volumen' && r.unit === 'm³');
  assert.ok(volRecord);
  assert.equal(volRecord.quantity, 192);

  // 6. Elementos vanos: puerta 1 pza, ventana 1 pza
  const doorRecord = list.find(r => r.category === 'Puertas' && r.unit === 'pza');
  assert.ok(doorRecord);
  assert.equal(doorRecord.quantity, 1);

  const winRecord = list.find(r => r.category === 'Ventanas' && r.unit === 'pza');
  assert.ok(winRecord);
  assert.equal(winRecord.quantity, 1);
});

test('buildProjectQuantityList: integra modelos 3D sin inventar cubicación BIM', () => {
  const evidenceItems = [
    {
      id: 'ev-3d-1',
      projectId: 'PRJ-1',
      kind: '3d',
      name: 'Estructura-Casa.glb',
      metadata: {
        boundingBox: {
          size: { x: 10.5, y: 3.2, z: 8.0 }
        },
        meshCount: 14,
        triangleCount: 5280
      }
    }
  ];

  const list = buildProjectQuantityList({ projectId: 'PRJ-1', evidenceItems });
  assert.equal(list.length, 2);

  const vol3d = list.find(r => r.category === 'Volumen');
  assert.ok(vol3d);
  assert.equal(vol3d.source, QUANTITY_SOURCE.MODEL_3D);
  assert.equal(vol3d.status, QUANTITY_STATUS.ESTIMADO);
  assert.equal(vol3d.unit, 'm³');
  // 10.5 * 3.2 * 8.0 = 268.8 m³
  assert.equal(vol3d.quantity, 268.8);
  assert.equal(vol3d.metadata.meshCount, 14);

  const mesh3d = list.find(r => r.category === 'Estructura 3D');
  assert.ok(mesh3d);
  assert.equal(mesh3d.quantity, 14);
  assert.equal(mesh3d.unit, 'pza');
  assert.equal(mesh3d.status, QUANTITY_STATUS.ESTIMADO);
});

test('calculateQuantificationSummary: totaliza correctamente sin duplicar', () => {
  const records = [
    makeProjectQuantityRecord({ id: '1', projectId: 'P1', category: 'Muros', quantity: 91.71, unit: 'm²', planId: 'TK-1', status: QUANTITY_STATUS.CONFIRMADO, createdAt: 100 }),
    makeProjectQuantityRecord({ id: '2', projectId: 'P1', category: 'Pisos', quantity: 64, unit: 'm²', planId: 'TK-1', status: QUANTITY_STATUS.CONFIRMADO, createdAt: 200 }),
    makeProjectQuantityRecord({ id: '3', projectId: 'P1', category: 'Acabados', quantity: 32, unit: 'm', surveyId: 'S-1', status: QUANTITY_STATUS.CONFIRMADO, createdAt: 300 }),
    makeProjectQuantityRecord({ id: '4', projectId: 'P1', category: 'Volumen', quantity: 192, unit: 'm³', surveyId: 'S-1', status: QUANTITY_STATUS.CONFIRMADO, createdAt: 400 }),
    makeProjectQuantityRecord({ id: '5', projectId: 'P1', category: 'Puertas', quantity: 2, unit: 'pza', status: QUANTITY_STATUS.PROPUESTO, createdAt: 500 })
  ];

  const summary = calculateQuantificationSummary(records);

  assert.equal(summary.totalElements, 5);
  assert.equal(summary.confirmedCount, 4);
  assert.equal(summary.pendingReviewCount, 1);
  assert.equal(summary.planosCount, 1);
  assert.equal(summary.totalArea, 155.71); // 91.71 + 64
  assert.equal(summary.totalLength, 32);
  assert.equal(summary.totalVolume, 192);
  assert.equal(summary.totalPieces, 2);
  assert.equal(summary.categoriesCount, 5);
  assert.equal(summary.lastUpdated, 500);
});

test('buildProjectQuantityList: no muta takeoffs, surveys ni evidencia fuente', () => {
  const planoTakeoffs = [{ id: 'TK-1', projectId: 'P1', snapshot: { elementos: [
    { id: 'E1', tipo: 'muro', estado: 'VALIDADO_POR_USUARIO', cantidadPropuesta: 4 }
  ] } }];
  const surveys = [{ id: 'S1', projectId: 'P1', spaces: [{ name: 'Sala', length: 4, width: 3, height: 2.5 }] }];
  const evidenceItems = [{ id: 'M1', projectId: 'P1', kind: '3d', metadata: { boundingBox: { size: { x: 4, y: 3, z: 2.5 } } } }];
  const before = JSON.stringify({ planoTakeoffs, surveys, evidenceItems });
  buildProjectQuantityList({ projectId: 'P1', planoTakeoffs, surveys, evidenceItems });
  assert.equal(JSON.stringify({ planoTakeoffs, surveys, evidenceItems }), before);
});
