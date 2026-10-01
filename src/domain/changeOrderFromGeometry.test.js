import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHANGE_ORDER_STATUS } from './changeOrderSchema.js';
import {
  composeGeometryChangeDescription, composeGeometryChangeMotivo,
  buildGeometryEvidence, computeReferenceImpact,
  buildChangeOrderPayload, findDuplicateChangeOrder
} from './changeOrderFromGeometry.js';

test('composeGeometryChangeDescription: caso obligatorio M-01 4.85 -> 5.30 -> 11.295 -> 12.510', () => {
  const d = composeGeometryChangeDescription({
    elementLabel: 'M-01', propertyChanged: 'longitud', oldValue: 4.85, newValue: 5.30,
    cantidadAnterior: 11.295, cantidadNueva: 12.510, unit: 'm²', conceptLabel: 'Muro de tabique 12'
  });
  assert.match(d, /Modificacion geometrica detectada en M-01/);
  assert.match(d, /longitud cambio de 4\.850 a 5\.300 m/);
  assert.match(d, /modificando la cantidad de 11\.295 a 12\.510 m²/);
  assert.match(d, /Concepto contractual: Muro de tabique 12/);
});

test('composeGeometryChangeDescription: sin conceptLabel funciona (frase corta)', () => {
  const d = composeGeometryChangeDescription({
    elementLabel: 'M-02', propertyChanged: 'altura', oldValue: 2.7, newValue: 3.0,
    cantidadAnterior: 5, cantidadNueva: 6, unit: 'm²'
  });
  assert.match(d, /altura cambio de 2\.700 a 3\.000 m/);
  assert.doesNotMatch(d, /Concepto contractual/);
});

test('composeGeometryChangeMotivo: siempre <= 60 chars, en misma forma', () => {
  const m = composeGeometryChangeMotivo({ elementLabel: 'M-01' });
  assert.equal(m, 'Cambio geometrico en M-01');
  assert.ok(m.length <= 60);
});

test('buildGeometryEvidence: guarda TODAS las claves de trazabilidad estructurada', () => {
  const e = buildGeometryEvidence({
    origenElementoId: 'survey:LEV-1:SPC-1:M-01',
    planoId: 'survey:LEV-1:SPC-1', surveyId: 'LEV-1', spaceId: 'SPC-1',
    cadElementId: 'M-01', cadElementKind: 'wall',
    propertyChanged: 'longitud', oldValue: 4.85, newValue: 5.30
  });
  assert.equal(e.generatedFrom, 'cad-geometry-change');
  assert.equal(e.origenElementoId, 'survey:LEV-1:SPC-1:M-01');
  assert.equal(e.surveyId, 'LEV-1');
  assert.equal(e.spaceId, 'SPC-1');
  assert.equal(e.cadElementId, 'M-01');
  assert.equal(e.propertyChanged, 'longitud');
  assert.equal(e.requiresNewApu, false);
});

test('computeReferenceImpact: reutiliza computeChangeOrderEconomicImpact -> +$909.00 con caso obligatorio', () => {
  const r = computeReferenceImpact({ cantidadAnterior: 11.295, cantidadNueva: 12.510, pu: 748.15 });
  assert.equal(Math.round(r * 100) / 100, 909.00);
});

test('computeReferenceImpact: delta negativo -> impacto negativo', () => {
  const r = computeReferenceImpact({ cantidadAnterior: 11.295, cantidadNueva: 10, pu: 748.15 });
  // 10 - 11.295 = -1.295 * 748.15 = -968.85...
  assert.ok(r < 0);
  assert.equal(Math.round(r * 100) / 100, -968.85);
});

test('computeReferenceImpact: PU null -> impacto 0 (nunca NaN)', () => {
  const r = computeReferenceImpact({ cantidadAnterior: 10, cantidadNueva: 12, pu: null });
  assert.equal(r, 0);
  assert.equal(Number.isFinite(r), true);
});

test('buildChangeOrderPayload: incluye evidencia y NO cantidadAnterior/pu (server los recalcula)', () => {
  const evidencia = buildGeometryEvidence({ origenElementoId: 'survey:LEV-1:SPC-1:M-01' });
  const p = buildChangeOrderPayload({
    projectId: 'PRJ-1', conceptoId: 'CAT-1', cantidadNueva: 12.510,
    motivo: 'Cambio geometrico', descripcion: 'M-01 4.85 -> 5.30', evidencia
  });
  assert.equal(p.action, 'create');
  assert.equal(p.projectId, 'PRJ-1');
  assert.equal(p.conceptoId, 'CAT-1');
  assert.equal(p.cantidadNueva, 12.510);
  assert.equal(p.evidencia.origenElementoId, 'survey:LEV-1:SPC-1:M-01');
  // Cantidad anterior/PU NO viajan client-side: el server los recalcula.
  assert.equal(p.cantidadAnterior, undefined);
  assert.equal(p.pu, undefined);
});

test('buildChangeOrderPayload: valida projectId/conceptoId/cantidad/motivo', () => {
  assert.throws(() => buildChangeOrderPayload({ conceptoId: 'x', cantidadNueva: 1, motivo: 'x' }), /projectId/);
  assert.throws(() => buildChangeOrderPayload({ projectId: 'x', cantidadNueva: 1, motivo: 'x' }), /conceptoId/);
  assert.throws(() => buildChangeOrderPayload({ projectId: 'x', conceptoId: 'y', cantidadNueva: 'abc', motivo: 'x' }), /cantidadNueva/);
  assert.throws(() => buildChangeOrderPayload({ projectId: 'x', conceptoId: 'y', cantidadNueva: 1, motivo: '' }), /motivo/);
});

test('findDuplicateChangeOrder: sin OCs -> ni duplicado ni stale', () => {
  const r = findDuplicateChangeOrder({ changeOrders: [], conceptoId: 'CAT-1', origenElementoId: 'X', cantidadNueva: 12.51 });
  assert.equal(r.duplicate, null);
  assert.equal(r.staleDraft, null);
});

test('findDuplicateChangeOrder: OC en BORRADOR con misma cantidadNueva -> duplicate', () => {
  const oc = { id: 'OC-1', conceptoId: 'CAT-1', status: CHANGE_ORDER_STATUS.BORRADOR, cantidadNueva: 12.510, evidencia: { origenElementoId: 'X' } };
  const r = findDuplicateChangeOrder({ changeOrders: [oc], conceptoId: 'CAT-1', origenElementoId: 'X', cantidadNueva: 12.510 });
  assert.equal(r.duplicate?.id, 'OC-1');
  assert.equal(r.staleDraft, null);
});

test('findDuplicateChangeOrder: OC en BORRADOR con DISTINTA cantidadNueva -> staleDraft', () => {
  const oc = { id: 'OC-1', conceptoId: 'CAT-1', status: CHANGE_ORDER_STATUS.BORRADOR, cantidadNueva: 12.510, evidencia: { origenElementoId: 'X' } };
  const r = findDuplicateChangeOrder({ changeOrders: [oc], conceptoId: 'CAT-1', origenElementoId: 'X', cantidadNueva: 13.20 });
  assert.equal(r.duplicate, null);
  assert.equal(r.staleDraft?.id, 'OC-1');
});

test('findDuplicateChangeOrder: OC APROBADA no bloquea nueva OC (historia terminal)', () => {
  const oc = { id: 'OC-1', conceptoId: 'CAT-1', status: CHANGE_ORDER_STATUS.APROBADA, cantidadNueva: 12.510, evidencia: { origenElementoId: 'X' } };
  const r = findDuplicateChangeOrder({ changeOrders: [oc], conceptoId: 'CAT-1', origenElementoId: 'X', cantidadNueva: 12.510 });
  assert.equal(r.duplicate, null);
  assert.equal(r.staleDraft, null);
});

test('findDuplicateChangeOrder: OC RECHAZADA no bloquea', () => {
  const oc = { id: 'OC-1', conceptoId: 'CAT-1', status: CHANGE_ORDER_STATUS.RECHAZADA, cantidadNueva: 12.510, evidencia: { origenElementoId: 'X' } };
  const r = findDuplicateChangeOrder({ changeOrders: [oc], conceptoId: 'CAT-1', origenElementoId: 'X', cantidadNueva: 12.510 });
  assert.equal(r.duplicate, null);
});

test('findDuplicateChangeOrder: distintos origenElementoId no colisionan (dos muros distintos, mismo concepto)', () => {
  const oc = { id: 'OC-A', conceptoId: 'CAT-1', status: CHANGE_ORDER_STATUS.BORRADOR, cantidadNueva: 12.510, evidencia: { origenElementoId: 'M-01' } };
  const r = findDuplicateChangeOrder({ changeOrders: [oc], conceptoId: 'CAT-1', origenElementoId: 'M-02', cantidadNueva: 12.510 });
  assert.equal(r.duplicate, null);
  assert.equal(r.staleDraft, null);
});
