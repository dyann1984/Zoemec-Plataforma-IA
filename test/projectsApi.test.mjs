/* api/projects.mjs contra los emuladores REALES de Firebase Auth + Firestore
   (Fase 7). Corre con `npm run test:projects`. Mismo patron que
   test/technicalMemoryApi.test.mjs / test/challengeDecisionsApi.test.mjs. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/projects.mjs';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/projectsApi.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:projects`.');
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
const uniq = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.zoemec`;

describe('POST /api/projects action=create', () => {
  it('crea un proyecto con identidad real del token, nunca del body', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('create') });
    const res = await call(post(idToken, { action: 'create', id: 'PRO-1', name: 'Obra QA', ownerUid: 'uid-falso-inyectado' }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.project.ownerUid, uid);
    assert.equal(res.body.project.name, 'Obra QA');
  });

  it('es idempotente: repetir create con el mismo id no duplica ni falla', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('idempotent') });
    const first = await call(post(idToken, { action: 'create', id: 'PRO-2', name: 'Obra QA 2' }));
    const second = await call(post(idToken, { action: 'create', id: 'PRO-2', name: 'Obra QA 2 (otro nombre)' }));
    assert.equal(second.statusCode, 201);
    assert.equal(second.body.project.name, 'Obra QA 2'); // conserva la version original, no la reescribe
    const list = await call(get(idToken, {}));
    assert.equal(list.body.projects.filter(p => p.id === 'PRO-2').length, 1);
  });

  it('create con id ya usado por OTRO usuario devuelve 409', async () => {
    const owner = await createUserAndGetIdToken({ email: uniq('owner') });
    await call(post(owner.idToken, { action: 'create', id: 'PRO-SHARED', name: 'De owner' }));
    const stranger = await createUserAndGetIdToken({ email: uniq('stranger') });
    const res = await call(post(stranger.idToken, { action: 'create', id: 'PRO-SHARED', name: 'De stranger' }));
    assert.equal(res.statusCode, 409);
  });

  it('sin token, 401, no se crea nada', async () => {
    const res = await call(post(null, { action: 'create', id: 'PRO-X', name: 'X' }));
    assert.equal(res.statusCode, 401);
  });
});

describe('GET /api/projects', () => {
  it('lista solo los proyectos del usuario autenticado', async () => {
    const a = await createUserAndGetIdToken({ email: uniq('lista-a') });
    const b = await createUserAndGetIdToken({ email: uniq('lista-b') });
    await call(post(a.idToken, { action: 'create', id: 'PRO-A1', name: 'A1' }));
    await call(post(b.idToken, { action: 'create', id: 'PRO-B1', name: 'B1' }));
    const listA = await call(get(a.idToken, {}));
    assert.ok(listA.body.projects.every(p => p.ownerUid === a.uid));
    assert.ok(listA.body.projects.some(p => p.id === 'PRO-A1'));
    assert.ok(!listA.body.projects.some(p => p.id === 'PRO-B1'));
  });
});

describe('POST /api/projects action=update', () => {
  it('el dueno real puede actualizar sus propios campos', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('update') });
    await call(post(idToken, { action: 'create', id: 'PRO-U1', name: 'Original' }));
    const res = await call(post(idToken, { action: 'update', id: 'PRO-U1', name: 'Actualizado', progress: 40 }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.project.name, 'Actualizado');
    assert.equal(res.body.project.progress, 40);
  });

  it('un usuario distinto no puede actualizar un proyecto ajeno (403)', async () => {
    const owner = await createUserAndGetIdToken({ email: uniq('owner-u') });
    await call(post(owner.idToken, { action: 'create', id: 'PRO-U2', name: 'Original' }));
    const stranger = await createUserAndGetIdToken({ email: uniq('stranger-u') });
    const res = await call(post(stranger.idToken, { action: 'update', id: 'PRO-U2', name: 'Hackeado' }));
    assert.equal(res.statusCode, 403);
  });

  it('update no puede sobreescribir ownerUid ni createdAt via body', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('immutable-fields') });
    const created = await call(post(idToken, { action: 'create', id: 'PRO-U3', name: 'Original' }));
    const res = await call(post(idToken, { action: 'update', id: 'PRO-U3', ownerUid: 'otro-uid', createdAt: '2000-01-01' }));
    assert.equal(res.body.project.ownerUid, uid);
    assert.equal(res.body.project.createdAt, created.body.project.createdAt);
  });
});

describe('POST /api/projects action=archive', () => {
  it('archiva el proyecto y registra auditoria', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('archive') });
    await call(post(idToken, { action: 'create', id: 'PRO-ARCH', name: 'A archivar' }));
    const res = await call(post(idToken, { action: 'archive', id: 'PRO-ARCH' }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.project.status, 'Archivado');
    assert.ok(res.body.project.archivedAt);
    const auditSnap = await getAdminDb().collection('projectAudit').where('entryId', '==', 'PRO-ARCH').where('action', '==', 'PROJECT_ARCHIVED').get();
    assert.equal(auditSnap.size, 1);
  });

  it('un proyecto archivado desaparece de la lista por defecto (equivalente a "eliminar" sin perder el dato)', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('archive-hides') });
    await call(post(idToken, { action: 'create', id: 'PRO-ARCH2', name: 'A ocultar' }));
    await call(post(idToken, { action: 'archive', id: 'PRO-ARCH2' }));
    const list = await call(get(idToken, {}));
    assert.ok(!list.body.projects.some(p => p.id === 'PRO-ARCH2'));
  });
});
