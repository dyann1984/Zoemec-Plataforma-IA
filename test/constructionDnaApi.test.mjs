/* server/api-lib/_route-construction-dna.mjs contra los emuladores REALES
   de Firebase Auth + Firestore. Cubre generacion (derivada de datos reales
   del proyecto), versionado (V1, V2... nunca sobreescribe), diff contra la
   version anterior, y aislamiento multi-tenant. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import dnaHandler from '../server/api-lib/_route-construction-dna.mjs';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/constructionDnaApi.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:constructiondna`.');
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
async function call(req){ const res = mockRes(); await dnaHandler(req, res); return res; }
const uniq = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.zoemec`;

async function seedOrgMember(db, uid, organizationId){
  await db.doc(`organizations/${organizationId}`).set({ id: organizationId, name: `Empresa ${organizationId}`, status: 'ACTIVE_TRIAL' });
  await db.doc(`organizations/${organizationId}/members/${uid}`).set({ uid, role: 'company_manager', status: 'active' });
  await db.doc(`users/${uid}`).set({ uid, organizationId, role: 'user', plan: 'Gratis', active: true }, { merge: true });
}
async function seedProject(db, { id, ownerUid, organizationId = null }){
  await db.collection('projects').doc(id).set({ id, ownerUid, organizationId, name: 'Obra QA DNA', locationCountry: 'MX', locationState: 'Nuevo León', locationCity: 'Monterrey' });
}
async function seedConcepto(db, { id, ownerUid, organizationId = null, projectId, capitulo, concept, unit = 'm²', qty = 40, apuId = null }){
  await db.collection('catalogConceptos').doc(id).set({ id, ownerUid, organizationId, projectId, clave: id, capitulo, concept, unit, qty, apuId, status: apuId ? 'ASOCIADO' : 'PENDIENTE' });
}
async function seedApu(db, { id, ownerUid, organizationId = null, projectId = null, pu }){
  await db.collection('apus').doc(id).set({
    id, ownerUid, organizationId, projectId, currentVersion: 'V1',
    snapshot: {
      schemaVersion: 2, id, calculated: { pu, direct: pu * 0.7, iva: pu * 0.16 },
      materials: [{ descripcion: 'Block hueco', consumo: 12, desperdicioPct: 5, precioUnitario: 20, unidad: 'pza', integracion: 'POR_UNIDAD_OBRA' }],
      labor: [{ descripcion: 'Albañil', cuadrilla: 1, rendimiento: 8, salarioBase: 380, fsr: 1.65 }],
      equipment: [], consumables: [], seguridad: [],
      factores: { indCampo: 8, indOficina: 7, finance: 2, utility: 10, cargos: 0.5, iva: 16 }
    }
  });
}

describe('POST /api/construction-dna action=generate', () => {
  it('deriva el DNA de datos reales (sistema constructivo, recursos, costos) y arranca en V1', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('dna-gen') });
    const db = getAdminDb();
    const projectId = 'PRO-DNA-1';
    await seedProject(db, { id: projectId, ownerUid: uid });
    await seedApu(db, { id: 'APU-DNA-1', ownerUid: uid, projectId, pu: 500 });
    await seedConcepto(db, { id: 'C-DNA-1', ownerUid: uid, projectId, capitulo: 'ALBANILERIA', concept: 'Muro de block hueco 15cm', apuId: 'APU-DNA-1' });

    const res = await call(post(idToken, { action: 'generate', projectId }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.constructionDna.currentVersion, 'V1');
    assert.equal(res.body.version.version, 'V1');
    const dna = res.body.version.snapshot;
    assert.equal(dna.sistemaConstructivo.muros.origin, 'DETECTED');
    assert.equal(dna.geometria.muros.value[0].qty, 40);
    assert.equal(dna.costos.familiasPrincipales.value[0].capitulo, 'ALBANILERIA');
    assert.ok(res.body.version.hash && res.body.version.hash.length === 64);
    assert.deepEqual(res.body.version.changes, []);
  });

  it('generar una segunda vez crea V2, con diff contra V1, nunca sobreescribe V1', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('dna-v2') });
    const db = getAdminDb();
    const projectId = 'PRO-DNA-2';
    await seedProject(db, { id: projectId, ownerUid: uid });
    await seedApu(db, { id: 'APU-DNA-2', ownerUid: uid, projectId, pu: 500 });
    await seedConcepto(db, { id: 'C-DNA-2', ownerUid: uid, projectId, capitulo: 'ALBANILERIA', concept: 'Muro de block', apuId: 'APU-DNA-2' });
    const first = await call(post(idToken, { action: 'generate', projectId }));
    assert.equal(first.body.version.version, 'V1');

    // Agrega un concepto nuevo de otro capitulo -- el DNA debe reflejarlo en V2.
    await seedConcepto(db, { id: 'C-DNA-3', ownerUid: uid, projectId, capitulo: 'CIMENTACION', concept: 'Zapata aislada', unit: 'pza', qty: 4 });
    const second = await call(post(idToken, { action: 'generate', projectId }));
    assert.equal(second.statusCode, 201);
    assert.equal(second.body.version.version, 'V2');
    assert.ok(second.body.version.changes.length > 0, 'debe registrar al menos un cambio contra V1 (aparece CIMENTACION detectado)');

    const get1 = await call(get(idToken, { projectId }));
    assert.equal(get1.body.versions.length, 2);
    assert.equal(get1.body.versions[0].version, 'V1');
    assert.equal(get1.body.versions[1].version, 'V2');
    assert.equal(get1.body.constructionDna.currentVersion, 'V2');
  });

  it('sin ningun dato en el proyecto, genera un DNA vacio (Sin informacion), nunca lanza', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('dna-empty') });
    const db = getAdminDb();
    const projectId = 'PRO-DNA-EMPTY';
    await seedProject(db, { id: projectId, ownerUid: uid });
    const res = await call(post(idToken, { action: 'generate', projectId }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.version.snapshot.geometria.superficieConstruida.value, null);
    assert.equal(res.body.version.snapshot.recursos.materialesPrincipales.value, null);
  });

  it('sin token, 401', async () => {
    const res = await call(post(null, { action: 'generate', projectId: 'PRO-X' }));
    assert.equal(res.statusCode, 401);
  });

  it('proyecto inexistente, 404', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('dna-noproj') });
    const res = await call(post(idToken, { action: 'generate', projectId: 'PRO-NO-EXISTE' }));
    assert.equal(res.statusCode, 404);
  });
});

describe('aislamiento multi-tenant', () => {
  it('un miembro de otra organizacion no puede generar ni leer el DNA de un proyecto ajeno por projectId', async () => {
    const db = getAdminDb();
    const a = await createUserAndGetIdToken({ email: uniq('dna-org-a') });
    const orgA = `org-dna-a-${Date.now()}`;
    await seedOrgMember(db, a.uid, orgA);
    const b = await createUserAndGetIdToken({ email: uniq('dna-org-b') });
    const orgB = `org-dna-b-${Date.now()}`;
    await seedOrgMember(db, b.uid, orgB);

    const projectId = 'PRO-DNA-ORG-A';
    await db.collection('projects').doc(projectId).set({ id: projectId, ownerUid: a.uid, organizationId: orgA, name: 'Obra A' });
    const generated = await call(post(a.idToken, { action: 'generate', projectId }));
    assert.equal(generated.statusCode, 201);

    assert.equal((await call(post(b.idToken, { action: 'generate', projectId }))).statusCode, 403);
    assert.equal((await call(get(b.idToken, { projectId }))).statusCode, 403);
  });
});
