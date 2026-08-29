/* Fase 8.1 -- test dedicado pendiente del reporte de Fase 8 Parte 2 (punto
   15): reproduce el ciclo real de migracion transparente legado -> server
   (Fase 7) que useAuthoritativeProjects.js/useAuthoritativeApus.js ejecutan
   en su bootstrap: "for(const item of legacy){ try{ create }catch{} }",
   SIN llevar registro de que items ya migraron -- por diseño, un reintento
   vuelve a recorrer TODOS los items legados otra vez. La unica garantia
   real contra duplicados es la idempotencia de action=create por id (ya
   probada de forma aislada en projectsApi.test.mjs/apusApi.test.mjs); este
   test reproduce el escenario COMPLETO: intento 1 interrumpido a la mitad
   (simulado deteniendo el bucle antes de terminar, como haria un error de
   red real) + intento 2 (retry) que vuelve a recorrer TODO -- y ademas
   confirma que el blob legado (users/{uid}/state/{key}, ver src/cloud.js)
   nunca se toca por la migracion, en ningun intento. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import projectsHandler from '../api/projects.mjs';
import apusHandler from '../api/apus.mjs';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/legacyMigrationRetry.e2e.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:projects`.');
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
async function callProjects(req){ const res = mockRes(); await projectsHandler(req, res); return res; }
async function callApus(req){ const res = mockRes(); await apusHandler(req, res); return res; }
const uniq = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.zoemec`;

function apuFixture(concept){
  return {
    concept, unit: 'm2', cantidadObra: 10,
    materials: [], labor: [{ descripcion: 'Oficial albañil', cuadrilla: 1, rendimiento: 5, salarioBase: 380, fsr: 1.65 }],
    equipment: [], consumables: [], seguridad: [], factores: {}
  };
}

// Reproduce EXACTAMENTE el bucle real de useAuthoritativeProjects.js/
// useAuthoritativeApus.js: recorre todos los items legados, nunca detiene
// el resto si uno falla, nunca lleva registro de cuales ya migraron.
async function runProjectMigrationPass(idToken, legacyProjects, { stopAfter = Infinity } = {}){
  let processed = 0;
  for(const project of legacyProjects){
    if(processed >= stopAfter) break; // simula la interrupcion real (ej. se cerro la pestaña / cayo la red)
    try{ await callProjects(post(idToken, { action: 'create', ...project, migratedFrom: 'legacy-blob' })); }catch{ /* se reintenta la proxima vez */ }
    processed++;
  }
}
async function runApuMigrationPass(idToken, legacyApus, { stopAfter = Infinity } = {}){
  let processed = 0;
  for(const apu of legacyApus){
    if(processed >= stopAfter) break;
    try{ await callApus(post(idToken, { action: 'create', id: apu.id, projectId: apu.projectId || null, apu: apu.apu, reason: 'Migracion automatica desde almacenamiento anterior' })); }catch{ /* se reintenta la proxima vez */ }
    processed++;
  }
}

describe('Retry de migracion legado -> server no duplica proyectos, APUs ni versiones', () => {
  it('intento interrumpido a la mitad + retry completo -> exactamente 1 copia de cada proyecto/APU/version, blob legado intacto', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('legacy-retry') });
    const db = getAdminDb();

    // Blobs legados reales (users/{uid}/state/{key}, ver src/cloud.js) --
    // sembrados directo por admin SDK para poder comprobar que la migracion
    // JAMAS los toca, en ningun intento.
    const legacyProjectsBlob = { z: 'contenido-gzip-simulado-projects-v1', updatedAt: 12345, v: 1 };
    const legacyApusBlob = { z: 'contenido-gzip-simulado-apus-v1', updatedAt: 12345, v: 1 };
    await db.collection('users').doc(uid).collection('state').doc('zoemec-projects').set(legacyProjectsBlob);
    await db.collection('users').doc(uid).collection('state').doc('zoemec-apus').set(legacyApusBlob);

    const legacyProjects = [
      { id: 'PRO-LEGACY-A', name: 'Proyecto legado A' },
      { id: 'PRO-LEGACY-B', name: 'Proyecto legado B' },
      { id: 'PRO-LEGACY-C', name: 'Proyecto legado C' }
    ];
    const legacyApus = [
      { id: 'APU-LEGACY-A', projectId: 'PRO-LEGACY-A', apu: apuFixture('Concepto legado A') },
      { id: 'APU-LEGACY-B', projectId: 'PRO-LEGACY-B', apu: apuFixture('Concepto legado B') },
      { id: 'APU-LEGACY-C', projectId: 'PRO-LEGACY-C', apu: apuFixture('Concepto legado C') }
    ];

    // Intento 1: interrumpido despues de procesar solo 2 de 3 items (simula
    // una caida de red/cierre de pestaña a la mitad del bucle real).
    await runProjectMigrationPass(idToken, legacyProjects, { stopAfter: 2 });
    await runApuMigrationPass(idToken, legacyApus, { stopAfter: 2 });

    const afterAttempt1 = await callProjects(get(idToken, {}));
    assert.equal(afterAttempt1.body.projects.length, 2, 'el intento interrumpido debio dejar solo 2 proyectos');

    // Intento 2 (retry): el codigo real NUNCA sabe cuales ya migraron --
    // vuelve a recorrer los 3 items legados completos, tal cual arranca la
    // sesion de nuevo.
    await runProjectMigrationPass(idToken, legacyProjects);
    await runApuMigrationPass(idToken, legacyApus);

    // -- Proyectos: exactamente 3, sin duplicados, migratedFrom correcto --
    const finalProjects = await callProjects(get(idToken, {}));
    assert.equal(finalProjects.body.projects.length, 3, 'el retry debio completar la migracion sin duplicar');
    for(const id of ['PRO-LEGACY-A', 'PRO-LEGACY-B', 'PRO-LEGACY-C']){
      const matches = finalProjects.body.projects.filter(p => p.id === id);
      assert.equal(matches.length, 1, `proyecto ${id} duplicado o perdido tras el retry`);
      assert.equal(matches[0].migratedFrom, 'legacy-blob', `proyecto ${id} no quedo marcado migratedFrom=legacy-blob`);
    }

    // -- APUs: exactamente 3, sin duplicados, cada uno con UNA sola V1 --
    const finalApus = await callApus(get(idToken, {}));
    assert.equal(finalApus.body.apus.length, 3, 'el retry debio completar la migracion de APUs sin duplicar');
    for(const id of ['APU-LEGACY-A', 'APU-LEGACY-B', 'APU-LEGACY-C']){
      const matches = finalApus.body.apus.filter(a => a.id === id);
      assert.equal(matches.length, 1, `APU ${id} duplicado o perdido tras el retry`);
      assert.equal(matches[0].currentVersion, 'V1', `APU ${id} deberia seguir en V1 unica, no duplicada`);
      const detail = await callApus(get(idToken, { id }));
      assert.equal(detail.body.versions.length, 1, `APU ${id} tiene mas de una V1 (version duplicada por el retry)`);
      assert.equal(detail.body.versions[0].version, 'V1');
    }

    // -- El blob legado NUNCA se toca, ni en el intento interrumpido ni en
    // el retry -- migracion == solo lectura sobre el blob original. --
    const projectsBlobAfter = await db.collection('users').doc(uid).collection('state').doc('zoemec-projects').get();
    const apusBlobAfter = await db.collection('users').doc(uid).collection('state').doc('zoemec-apus').get();
    assert.deepEqual(projectsBlobAfter.data(), legacyProjectsBlob, 'el blob legado de proyectos fue modificado por la migracion');
    assert.deepEqual(apusBlobAfter.data(), legacyApusBlob, 'el blob legado de APUs fue modificado por la migracion');
  });
});
