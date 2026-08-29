/* Parche de compatibilidad Vercel Hobby: api/gateway.mjs consolida 6
   funciones serverless (apus, projects, challenge-decisions,
   technical-memory, export-events, health) en UNA sola, despachando por
   pathname (req.url) hacia los handlers reales reubicados en
   server/api-lib/_route-*.mjs -- ver VERCEL_HOBBY_COMPAT.md.

   Este archivo NO repite la cobertura funcional ya probada en
   apusApi.test.mjs/projectsApi.test.mjs/etc (esas siguen corriendo tal
   cual, solo import path cambiado). Prueba especificamente el
   COMPORTAMIENTO DEL ROUTER: que cada ruta publica original siga llegando
   al handler correcto a traves de req.url, que una ruta desconocida de 404,
   que un metodo no soportado de 405 (delegado al handler real), que 401 sin
   token siga siendo 401, y -- el caso mas critico -- que VERSION_CONFLICT
   (409) siga propagandose intacto (regla/codigo/currentVersion) cuando se
   llega a /api/apus a traves del router en vez de directo. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import gateway from '../api/gateway.mjs';
import { getAdminAuth } from '../server/api-lib/_firebaseAdmin.mjs';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/apiGateway.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:security`.');
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
// `url` simula exactamente lo que Vercel entrega a la funcion cuando la
// solicitud llego via un rewrite estatico de vercel.json (source sin
// wildcard) -- el pathname ORIGINAL, nunca "/api/gateway".
function post(url, token, body){ return { method: 'POST', url, headers: token ? { authorization: `Bearer ${token}` } : {}, body }; }
function get(url, token, query){ return { method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {}, query: query || {} }; }
function del(url, token){ return { method: 'DELETE', url, headers: token ? { authorization: `Bearer ${token}` } : {} }; }
async function call(req){ const res = mockRes(); await gateway(req, res); return res; }
const uniq = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.zoemec`;

function apuFixture(overrides = {}){
  return {
    concept: 'Concepto de prueba (gateway)', unit: 'm2', cantidadObra: 10,
    materials: [], labor: [{ descripcion: 'Oficial albañil', cuadrilla: 1, rendimiento: 5, salarioBase: 380, fsr: 1.65 }],
    equipment: [], consumables: [], seguridad: [], factores: {},
    ...overrides
  };
}

describe('api/gateway.mjs -- ruteo hacia los 6 handlers consolidados', () => {
  it('ruta desconocida -> 404 (nunca cae en ningun handler real)', async () => {
    const res = await call(get('/api/no-existe', null));
    assert.equal(res.statusCode, 404);
    assert.match(res.body.error, /no-existe/);
  });

  it('/api/health -> handler real de health (405 en POST, mismo comportamiento que el archivo original)', async () => {
    const res = await call(post('/api/health', null, {}));
    assert.equal(res.statusCode, 405);
  });

  it('/api/health sin token admin -> 401/403 real del handler (nunca 404 del router)', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('gw-health-nonadmin') });
    const res = await call(get('/api/health', idToken));
    assert.notEqual(res.statusCode, 404);
    assert.ok(res.statusCode === 401 || res.statusCode === 403, `esperaba 401/403 de requireAdmin, obtuve ${res.statusCode}`);
  });

  it('/api/projects sin token -> 401 real del handler (nunca 404 del router)', async () => {
    const res = await call(get('/api/projects', null));
    assert.equal(res.statusCode, 401);
  });

  it('POST /api/projects action=create llega al handler real de projects', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('gw-projects') });
    const res = await call(post('/api/projects', idToken, { action: 'create', id: `PRO-GW-${Date.now()}`, name: 'Proyecto via gateway' }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.project.ownerUid, uid);
  });

  it('GET /api/projects tras crear -> lista real via router', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('gw-projects-list') });
    const id = `PRO-GW-LIST-${Date.now()}`;
    await call(post('/api/projects', idToken, { action: 'create', id, name: 'Proyecto listado via gateway' }));
    const res = await call(get('/api/projects', idToken));
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.projects.some(p => p.id === id));
  });

  it('POST /api/apus action=create + save-version llega al handler real de apus (mismo comportamiento que directo)', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('gw-apus') });
    const apuId = `APU-GW-${Date.now()}`;
    const created = await call(post('/api/apus', idToken, { action: 'create', id: apuId, projectId: 'PRO-GW', apu: apuFixture() }));
    assert.equal(created.statusCode, 201);
    assert.equal(created.body.apu.currentVersion, 'V1');
    const saved = await call(post('/api/apus', idToken, {
      action: 'save-version', id: apuId, apu: { ...apuFixture(), cantidadObra: 20 },
      expectedParentVersionId: 'V1', reason: 'Ajuste via gateway'
    }));
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.body.apu.currentVersion, 'V2');
  });

  it('VERSION_CONFLICT (409) se propaga intacto -- code/currentVersion -- a traves del router', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('gw-conflict') });
    const apuId = `APU-GW-CONFLICT-${Date.now()}`;
    await call(post('/api/apus', idToken, { action: 'create', id: apuId, projectId: 'PRO-GW', apu: apuFixture() }));
    // Guardado real desde V1 -> V2 (avanza la version vigente en el servidor).
    await call(post('/api/apus', idToken, { action: 'save-version', id: apuId, apu: apuFixture(), expectedParentVersionId: 'V1', reason: 'Primero' }));
    // Segundo cliente sigue creyendo que la base es V1 -- debe rechazarse.
    const conflict = await call(post('/api/apus', idToken, { action: 'save-version', id: apuId, apu: apuFixture(), expectedParentVersionId: 'V1', reason: 'Conflicto' }));
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.body.code, 'VERSION_CONFLICT');
    assert.equal(conflict.body.currentVersion, 'V2');
    // El estado real en el servidor no debe haber avanzado a V3 por el intento fallido.
    const reread = await call(get('/api/apus', idToken, { id: apuId }));
    assert.equal(reread.body.apu.currentVersion, 'V2');
    assert.equal(reread.body.versions.length, 2);
  });

  it('/api/apus con metodo no soportado -> 405 real del handler (nunca 404 del router)', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('gw-apus-405') });
    const res = await call(del('/api/apus', idToken));
    assert.equal(res.statusCode, 405);
  });

  it('POST /api/technical-memory action=proposal llega al handler real de memoria tecnica', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('gw-memory') });
    const res = await call(post('/api/technical-memory', idToken, {
      action: 'proposal', scope: 'PROJECT', type: 'APPROVED_PRICE', subject: { resourceDescripcion: 'Cemento gris 50kg' }, value: 245, unit: 'saco',
      context: { projectId: 'PRO-GW-MEM' }, tags: []
    }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.entry.status, 'PROPOSED');
  });

  it('POST /api/challenge-decisions action=record llega al handler real de decisiones', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('gw-challenge') });
    const res = await call(post('/api/challenge-decisions', idToken, {
      action: 'record', apuId: 'APU-GW-CHALLENGE', challengeId: 'ch-1', decision: 'MAINTAIN', reason: 'Via gateway'
    }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.decision.decision, 'MAINTAIN');
  });

  it('POST /api/export-events action=record llega al handler real de eventos de exportacion', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('gw-export') });
    const apuId = `APU-GW-EXPORT-${Date.now()}`;
    await call(post('/api/apus', idToken, { action: 'create', id: apuId, projectId: 'PRO-GW-EXPORT', apu: apuFixture() }));
    const res = await call(post('/api/export-events', idToken, { action: 'record', scope: 'APU', apuId, format: 'PDF', mode: 'TECNICO' }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.event.apuId, apuId);
  });

  it('GET /api/export-events lista solo eventos propios via router', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('gw-export-list') });
    const res = await call(get('/api/export-events', idToken));
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.events));
  });
});
