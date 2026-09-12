/* server/api-lib/_route-construction-proposal.mjs contra el emulador REAL
   de Firebase Auth + Firestore. Corre con `npm run test:constructionproposal`.

   Solo cubre action=apuConcepts (pura, sin llamar a OpenAI) -- action=generate
   llama a un modelo real con vision y no se prueba aqui, mismo criterio que
   generateAPU/generateAPUv2 en test/openaiApuCore.test.mjs (esas tampoco se
   prueban con una llamada real). La logica de normalizacion/derivacion de
   conceptos SI esta cubierta a fondo en src/domain/constructionProposal.test.js
   -- este archivo solo verifica el cableado del endpoint (auth, gate de
   plan, codigos de error). */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import constructionProposalHandler from '../server/api-lib/_route-construction-proposal.mjs';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/constructionProposalApi.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:constructionproposal`.');
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

// requireFeature(req,'ai') exige un plan con IA activa (Gratis:false) --
// mismo cableado que generate-apu.mjs. Un usuario Gratis real nunca llega a
// action=apuConcepts en produccion (action=generate ya lo hubiera
// rechazado antes), asi que estas pruebas simulan directamente el estado
// de un usuario que YA paso ese primer gate.
async function bumpPlanToEmpresa(uid){
  await getAdminDb().collection('users').doc(uid).set({ plan: 'Empresa' }, { merge: true });
}

function mockRes(){
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (d) => { res.body = d; return res; };
  return res;
}
function post(token, body){ return { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body }; }
async function call(req){ const res = mockRes(); await constructionProposalHandler(req, res); return res; }
const uniq = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.zoemec`;

describe('POST /api/construction-proposal', () => {
  it('sin token, 401', async () => {
    const res = await call(post(null, { action: 'apuConcepts', proposal: {} }));
    assert.equal(res.statusCode, 401);
  });

  it('accion no reconocida, 400', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('bad-action') });
    const res = await call(post(idToken, { action: 'no-existe' }));
    assert.equal(res.statusCode, 400);
  });

  it('plan Gratis (sin IA activa) rechaza con 402, incluso para apuConcepts', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('gratis') });
    const res = await call(post(idToken, { action: 'apuConcepts', proposal: { sistemaConstructivo: { muros: ['x'] } } }));
    assert.equal(res.statusCode, 402);
  });

  it('apuConcepts sin proposal, 400', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('no-proposal') });
    await bumpPlanToEmpresa(uid);
    const res = await call(post(idToken, { action: 'apuConcepts' }));
    assert.equal(res.statusCode, 400);
  });

  it('apuConcepts con una propuesta real deriva los conceptos en el orden correcto', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('concepts') });
    await bumpPlanToEmpresa(uid);
    const proposal = {
      sistemaConstructivo: {
        preliminares: ['Trazo y nivelacion'],
        cimentacion: [], estructura: [], muros: ['Block hueco 15cm'], cubierta: [], instalaciones: [],
        acabados: ['Pintura vinilica']
      }
    };
    const res = await call(post(idToken, { action: 'apuConcepts', proposal }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.concepts, [
      { categoria: 'preliminares', concept: 'Trazo y nivelacion' },
      { categoria: 'muros', concept: 'Block hueco 15cm' },
      { categoria: 'acabados', concept: 'Pintura vinilica' }
    ]);
  });
});
