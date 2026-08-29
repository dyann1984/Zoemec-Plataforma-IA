/* api/export-events.mjs contra los emuladores REALES de Firebase Auth +
   Firestore (Fase 8). Corre con `npm run test:dossier` (o incluido en
   test:security). Mismo patron que test/projectsApi.test.mjs.

   FIX Fase 9 (hallazgo F-003, P1): el endpoint ya NO acepta
   apuId/projectId/apuVersionId(s)/snapshotHash(es)/manifestHash tal cual
   los manda el cliente -- ahora verifica dueno real y recalcula todo desde
   el snapshot ACTUAL en Firestore. Estas pruebas siembran APUs/proyectos
   REALES (vía los handlers reales de apus.mjs/projects.mjs) en vez de
   inventar ids sueltos, y verifican que el evento reflete el estado
   servidor real, nunca lo que el cliente haya declarado. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../server/api-lib/_route-export-events.mjs';
import apusHandler from '../server/api-lib/_route-apus.mjs';
import projectsHandler from '../server/api-lib/_route-projects.mjs';
import { getAdminAuth } from '../server/api-lib/_firebaseAdmin.mjs';
import { computeSnapshotHash } from '../src/domain/snapshotHash.js';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/exportEventsApi.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:dossier`.');
}

async function createUserAndGetIdToken({ email }){
  const auth = getAdminAuth();
  const user = await auth.createUser({ email, password: 'Test1234!', emailVerified: true });
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test1234!', returnSecureToken: true })
  });
  const data = await res.json();
  if(!res.ok) throw new Error('No se pudo autenticar: ' + JSON.stringify(data));
  return { uid: user.uid, email, idToken: data.idToken };
}

function mockRes(){
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (d) => { res.body = d; return res; };
  return res;
}
function post(token, body){ return { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body }; }
function get(token, query){ return { method: 'GET', headers: token ? { authorization: `Bearer ${token}` } : {}, query: query || {} }; }
async function call(req){ const res = mockRes(); await handler(req, res); return res; }
async function callApus(req){ const res = mockRes(); await apusHandler(req, res); return res; }
async function callProjects(req){ const res = mockRes(); await projectsHandler(req, res); return res; }
const uniq = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.zoemec`;
const uniqId = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function apuFixture(concept){
  return { concept, unit: 'm2', cantidadObra: 10, materials: [], labor: [{ descripcion: 'Oficial', cuadrilla: 1, rendimiento: 5, salarioBase: 380, fsr: 1.65 }], equipment: [], consumables: [], seguridad: [], factores: {} };
}

describe('POST /api/export-events action=record', () => {
  it('CASO R: registra el evento con identidad real del token, nunca del body, y recalcula version/hash del snapshot REAL', async () => {
    const { uid, email, idToken } = await createUserAndGetIdToken({ email: uniq('record') });
    const apuId = uniqId('APU-EE-1');
    const created = await callApus(post(idToken, { action: 'create', id: apuId, apu: apuFixture('Concepto export event') }));
    assert.equal(created.statusCode, 201);
    const res = await call(post(idToken, {
      action: 'record', apuId, apuVersionId: 'V999-FALSO',
      snapshotHash: 'hash-inventado-por-el-cliente', format: 'PDF', mode: 'TECNICO', actorEmail: 'atacante@evil.example'
    }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.event.actor, uid);
    assert.equal(res.body.event.actorEmail, email);
    assert.equal(res.body.event.apuVersionId, 'V1', 'debe usar la version REAL del servidor, no la declarada por el cliente');
    const expectedHash = await computeSnapshotHash(created.body.apu.snapshot);
    assert.equal(res.body.event.snapshotHash, expectedHash, 'debe recalcular el hash desde el snapshot real, nunca aceptar el declarado');
  });

  it('un APU que no existe se rechaza con error real (nunca registra un evento sobre un recurso inexistente)', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('noexist') });
    const res = await call(post(idToken, { action: 'record', apuId: 'APU-NO-EXISTE', format: 'PDF', mode: 'TECNICO' }));
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.event, undefined);
  });

  it('un APU de OTRO usuario se rechaza con 403 (nunca se puede registrar un evento sobre un recurso ajeno)', async () => {
    const owner = await createUserAndGetIdToken({ email: uniq('owner') });
    const apuId = uniqId('APU-EE-AJENO');
    await callApus(post(owner.idToken, { action: 'create', id: apuId, apu: apuFixture('Concepto ajeno') }));
    const stranger = await createUserAndGetIdToken({ email: uniq('stranger') });
    const res = await call(post(stranger.idToken, { action: 'record', apuId, format: 'PDF', mode: 'TECNICO' }));
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.event, undefined);
  });

  it('format/mode invalidos se rechazan con error real', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('badformat') });
    const apuId = uniqId('APU-EE-2');
    await callApus(post(idToken, { action: 'create', id: apuId, apu: apuFixture('Concepto badformat') }));
    const res = await call(post(idToken, { action: 'record', apuId, format: 'DOCX', mode: 'TECNICO' }));
    assert.ok(res.statusCode >= 400);
    assert.equal(res.body.event, undefined);
  });

  it('sin token, 401, no se guarda nada', async () => {
    const res = await call(post(null, { action: 'record', apuId: 'APU-X', format: 'PDF', mode: 'TECNICO' }));
    assert.equal(res.statusCode, 401);
  });
});

describe('POST /api/export-events action=record, scope=PROJECT (Fase 8 Parte 2)', () => {
  it('CASO: registra evento de proyecto con arreglos de versiones/hashes REALES del servidor, no los declarados por el cliente', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('proj-record') });
    const projectId = uniqId('PRO-EE-1');
    const apuId1 = uniqId('APU-EE-P1'), apuId2 = uniqId('APU-EE-P2');
    await callProjects(post(idToken, { action: 'create', id: projectId, name: 'Proyecto export event' }));
    const a1 = await callApus(post(idToken, { action: 'create', id: apuId1, projectId, apu: apuFixture('Concepto proyecto 1') }));
    const a2 = await callApus(post(idToken, { action: 'create', id: apuId2, projectId, apu: apuFixture('Concepto proyecto 2') }));

    const res = await call(post(idToken, {
      action: 'record', scope: 'PROJECT', projectId,
      apuVersionIds: ['APU-FALSO@V99'], snapshotHashes: ['hash-inventado'],
      selectedScenarioIds: ['SC-1'], manifestHash: 'manifest-inventado-por-el-cliente', format: 'PDF', mode: 'TECNICO'
    }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.event.scope, 'PROJECT');
    assert.equal(res.body.event.actor, uid);
    assert.equal(res.body.event.projectId, projectId);
    assert.deepEqual(new Set(res.body.event.apuVersionIds), new Set([`${apuId1}@V1`, `${apuId2}@V1`]), 'debe reflejar los APUs REALES del proyecto, no el arreglo inventado por el cliente');
    assert.equal(res.body.event.snapshotHashes.length, 2);
    const realHash1 = await computeSnapshotHash(a1.body.apu.snapshot);
    assert.ok(res.body.event.snapshotHashes.includes(realHash1), 'el hash real del APU debe estar presente');
    assert.notEqual(res.body.event.manifestHash, 'manifest-inventado-por-el-cliente', 'el manifestHash debe ser recalculado, nunca el declarado por el cliente');
    assert.deepEqual(res.body.event.selectedScenarioIds, ['SC-1']);
    assert.equal(res.body.event.apuId, undefined);
  });

  it('un proyecto que no existe se rechaza con error real', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('proj-noexist') });
    const res = await call(post(idToken, { action: 'record', scope: 'PROJECT', projectId: 'PRO-NO-EXISTE', format: 'PDF', mode: 'TECNICO' }));
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.event, undefined);
  });

  it('un proyecto de OTRO usuario se rechaza con 403', async () => {
    const owner = await createUserAndGetIdToken({ email: uniq('proj-owner') });
    const projectId = uniqId('PRO-EE-AJENO');
    await callProjects(post(owner.idToken, { action: 'create', id: projectId, name: 'Proyecto ajeno' }));
    const stranger = await createUserAndGetIdToken({ email: uniq('proj-stranger') });
    const res = await call(post(stranger.idToken, { action: 'record', scope: 'PROJECT', projectId, format: 'PDF', mode: 'TECNICO' }));
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.event, undefined);
  });

  it('scope=PROJECT sin projectId se rechaza con error real', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('proj-noid') });
    const res = await call(post(idToken, { action: 'record', scope: 'PROJECT', format: 'PDF', mode: 'TECNICO' }));
    assert.ok(res.statusCode >= 400);
    assert.equal(res.body.event, undefined);
  });

  it('scope invalido se rechaza', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('badscope') });
    const res = await call(post(idToken, { action: 'record', scope: 'ORG', projectId: 'PRO-1', format: 'PDF', mode: 'TECNICO' }));
    assert.ok(res.statusCode >= 400);
    assert.equal(res.body.event, undefined);
  });
});

describe('GET /api/export-events', () => {
  it('lista solo los eventos del usuario autenticado, opcionalmente filtrados por apuId', async () => {
    const a = await createUserAndGetIdToken({ email: uniq('list-a') });
    const b = await createUserAndGetIdToken({ email: uniq('list-b') });
    const idA = 'APU-EE-LIST-A-' + Date.now(), idB = 'APU-EE-LIST-B-' + Date.now();
    const createdA = await callApus(post(a.idToken, { action: 'create', id: idA, apu: apuFixture('Concepto A1') }));
    const createdB = await callApus(post(b.idToken, { action: 'create', id: idB, apu: apuFixture('Concepto B1') }));
    assert.equal(createdA.statusCode, 201);
    assert.equal(createdB.statusCode, 201);
    const recA = await call(post(a.idToken, { action: 'record', apuId: idA, format: 'PDF', mode: 'CLIENTE' }));
    const recB = await call(post(b.idToken, { action: 'record', apuId: idB, format: 'XLSX', mode: 'TECNICO' }));
    assert.equal(recA.statusCode, 201);
    assert.equal(recB.statusCode, 201);
    const listA = await call(get(a.idToken, {}));
    assert.ok(listA.body.events.every(e => e.ownerUid === a.uid));
    assert.ok(listA.body.events.some(e => e.apuId === idA));
    assert.ok(!listA.body.events.some(e => e.apuId === idB));
  });
});
