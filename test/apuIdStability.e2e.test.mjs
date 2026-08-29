/* Fase 8.1 -- test dedicado pendiente del reporte de Fase 8 Parte 2 (punto
   11): confirma que apu.id permanece ESTABLE al "regenerar desarrollo"
   (simulado aqui como el cliente perdiendo su estado en memoria y volviendo
   a pedirle todo al servidor, exactamente lo que hace
   useAuthoritativeApus.js en su bootstrap -- ver GET /api/apus). No basta
   con la garantia arquitectural indirecta (id asignado por el servidor,
   nunca regenerado client-side): aqui se guarda V1, se "pierde" el estado
   local, se relee del servidor, se guarda V2 sobre ese mismo id releido, y
   se confirma que V1 y V2 conviven bajo el mismo apuId sin 404 y con
   currentVersion correcto. Mismo patron que test/apusApi.test.mjs. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../server/api-lib/_route-apus.mjs';
import { getAdminAuth } from '../server/api-lib/_firebaseAdmin.mjs';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/apuIdStability.e2e.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:projects`.');
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

function apuFixture(overrides = {}){
  return {
    concept: 'Concepto de prueba estabilidad de id', unit: 'm2', cantidadObra: 10,
    materials: [], labor: [{ descripcion: 'Oficial albañil', cuadrilla: 1, rendimiento: 5, salarioBase: 380, fsr: 1.65 }],
    equipment: [], consumables: [], seguridad: [], factores: {},
    ...overrides
  };
}

describe('apu.id permanece estable a traves de un ciclo completo de "regenerar desarrollo"', () => {
  it('V1 -> releer del servidor (simula reload/regeneracion) -> V2, mismo apuId, sin 404, V1 y V2 conviven, currentVersion correcto', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('id-stability') });
    const apuId = 'APU-ID-STABLE-1';

    // 1) Guardar V1 (equivalente a la primera creacion del APU en la UI).
    const created = await call(post(idToken, { action: 'create', id: apuId, projectId: 'PRO-ID-STABLE', apu: apuFixture() }));
    assert.equal(created.statusCode, 201);
    assert.equal(created.body.apu.id, apuId);
    assert.equal(created.body.apu.currentVersion, 'V1');

    // 2) "Regenerar desarrollo": el cliente NUNCA guarda su propio estado
    // como fuente de verdad -- vuelve a pedirle el APU completo al
    // servidor, exactamente como useAuthoritativeApus.js#useEffect en cada
    // bootstrap de sesion. Sin 404: el id sigue siendo autoritativo.
    const reread = await call(get(idToken, { id: apuId }));
    assert.equal(reread.statusCode, 200);
    assert.ok(reread.body.apu, 'el APU desaparecio tras "regenerar desarrollo" (404 encubierto como null)');
    assert.equal(reread.body.apu.id, apuId, 'el id cambio al releer del servidor');
    assert.equal(reread.body.versions.length, 1);
    assert.equal(reread.body.versions[0].version, 'V1');

    // 3) Guardar V2 usando EXACTAMENTE el id releido en el paso 2 (nunca uno
    // nuevo) -- asi es como ProfessionalApuEditor#saveVersion opera despues
    // de un reload real.
    const saved = await call(post(idToken, {
      action: 'save-version', id: reread.body.apu.id,
      apu: { ...reread.body.apu.snapshot, cantidadObra: 20 }, reason: 'Ajuste tras regenerar desarrollo',
      expectedParentVersionId: reread.body.apu.currentVersion
    }));
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.body.apu.id, apuId, 'el id cambio al guardar V2');
    assert.equal(saved.body.apu.currentVersion, 'V2');
    assert.equal(saved.body.version.version, 'V2');

    // 4) V1 sigue existiendo (nunca se sobreescribe), V2 es la version
    // actual -- ambas bajo el MISMO apuId.
    const final = await call(get(idToken, { id: apuId }));
    assert.equal(final.statusCode, 200);
    assert.equal(final.body.apu.id, apuId);
    assert.equal(final.body.apu.currentVersion, 'V2', 'currentVersion no quedo en V2 tras el segundo guardado');
    const versionNumbers = final.body.versions.map(v => v.version).sort();
    assert.deepEqual(versionNumbers, ['V1', 'V2'], 'V1 y/o V2 no conviven bajo el mismo apuId');
    assert.equal(final.body.apu.snapshot.cantidadObra, 20, 'el snapshot actual no refleja el guardado de V2');
  });
});
