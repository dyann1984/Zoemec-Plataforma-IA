process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../server/api-lib/_route-catalogo-conceptos.mjs';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST) throw new Error('Este E2E requiere FIREBASE_AUTH_EMULATOR_HOST.');

async function authUser(email){
  const auth = getAdminAuth();
  const user = await auth.createUser({ email, password: 'Test1234!', emailVerified: true });
  const response = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test1234!', returnSecureToken: true })
  });
  const body = await response.json();
  return { uid: user.uid, token: body.idToken };
}

function request(token, body){
  return { method: 'POST', headers: { authorization: `Bearer ${token}` }, body };
}

async function call(token, body){
  const response = { statusCode: 200, body: null, status(code){ this.statusCode = code; return this; }, json(value){ this.body = value; return this; } };
  await handler(request(token, body), response);
  return response;
}

async function seedProject(projectId, uid){
  await getAdminDb().collection('projects').doc(projectId).set({ id: projectId, projectId, ownerUid: uid, organizationId: null });
}

const takeoffInput = (projectId, qty) => ({
  clave: 'MURO-001',
  concept: 'Muro neto',
  unit: 'm2',
  qty,
  origenElementoId: 'PLANO-QA:wall-1',
  origenPlano: { sourceType: 'takeoff', planoTakeoffId: 'PLANO-QA', elementoId: 'wall-1' },
  sourceType: 'takeoff',
  sourceRecordId: 'PLANO-QA',
  sourceElementId: 'wall-1',
  planId: 'PLANO-QA',
  origenCantidad: 'Cuantificación confirmada',
  projectId
});

describe('Contrato Cuantificación -> Costos contra Firebase Emulator', () => {
  it('Takeoff 24.5 -> 26 es idempotente, conserva APU y presupuesto calcula 260', async () => {
    const { uid, token } = await authUser(`bridge-takeoff-${Date.now()}@qa.zoemec.test`);
    const db = getAdminDb();
    const projectId = `PRO-BRIDGE-${Date.now()}`;
    await seedProject(projectId, uid);

    const first = await call(token, { action: 'create', projectId, conceptos: [takeoffInput(projectId, 24.5)] });
    assert.equal(first.statusCode, 201);
    assert.equal(first.body.created, 1);
    const conceptoId = first.body.conceptos[0].id;
    assert.equal(first.body.conceptos[0].qty, 24.5);
    assert.equal(first.body.conceptos[0].origenElementoId, 'PLANO-QA:wall-1');
    assert.equal(first.body.conceptos[0].sourceType, 'takeoff');

    const apu = {
      id: 'APU-BRIDGE-QA', ownerUid: uid, organizationId: null, projectId,
      currentVersion: 'V1', calculated: {
        pu: 10, direct: 7, indirect: 1, finance: 0.2, utility: 1, cargos: 0.1, iva: 1.6
      },
      materials: [{ name: 'Block', qty: 12, price: 5 }],
      labor: [{ name: 'Albañil', qty: 0.1, price: 20 }],
      equipment: [{ name: 'Andamio', qty: 0.01, price: 10 }],
      herramienta: 0.03
    };
    await db.collection('apus').doc(apu.id).set(apu);
    const associated = await call(token, { action: 'associate-apu', id: conceptoId, apuId: apu.id });
    assert.equal(associated.statusCode, 200);

    const repeated = await call(token, { action: 'create', projectId, conceptos: [takeoffInput(projectId, 24.5)] });
    assert.equal(repeated.body.created, 0);
    assert.equal(repeated.body.updated, 1);
    assert.equal(repeated.body.conceptos[0].id, conceptoId);
    assert.equal(repeated.body.conceptos[0].qty, 24.5);

    const updated = await call(token, { action: 'create', projectId, conceptos: [takeoffInput(projectId, 26)] });
    assert.equal(updated.body.created, 0);
    assert.equal(updated.body.updated, 1);
    assert.equal(updated.body.conceptos[0].id, conceptoId);
    assert.equal(updated.body.conceptos[0].qty, 26);
    assert.equal(updated.body.conceptos[0].apuId, apu.id);

    const persistedApu = (await db.collection('apus').doc(apu.id).get()).data();
    assert.deepEqual(persistedApu.calculated, apu.calculated);
    assert.deepEqual(persistedApu.materials, apu.materials);
    assert.deepEqual(persistedApu.labor, apu.labor);
    assert.deepEqual(persistedApu.equipment, apu.equipment);
    assert.equal(26 * persistedApu.calculated.pu, 260);
  });

  it('Survey 91.71 conserva identidad y cantidad confirmada', async () => {
    const { uid, token } = await authUser(`bridge-survey-${Date.now()}@qa.zoemec.test`);
    const projectId = `PRO-SURVEY-${Date.now()}`;
    await seedProject(projectId, uid);
    const result = await call(token, {
      action: 'create',
      projectId,
      conceptos: [{
        projectId, concept: 'Muros netos', unit: 'm2', qty: 91.71,
        sourceType: 'survey', sourceRecordId: 'SUR-QA', sourceElementId: 'wallNet',
        surveyId: 'SUR-QA', origenElementoId: 'survey:SUR-QA:wallNet',
        origenCantidad: 'Cuantificación confirmada',
        origenPlano: { sourceType: 'survey', surveyId: 'SUR-QA', elementoId: 'wallNet' }
      }]
    });
    assert.equal(result.statusCode, 201);
    assert.equal(result.body.conceptos[0].qty, 91.71);
    assert.equal(result.body.conceptos[0].sourceType, 'survey');
    assert.equal(result.body.conceptos[0].origenElementoId, 'survey:SUR-QA:wallNet');
  });
});
