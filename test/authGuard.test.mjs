/* Pruebas de integracion de api/_authGuard.mjs contra los emuladores de
   Firebase Auth + Firestore (no contra el proyecto real). Corren con:
     npm run test:authguard
   (o npm run test:security, que agrupa esta suite con firestore.rules.test.mjs)

   A diferencia de firestore.rules.test.mjs (que prueba las reglas en
   aislamiento), esto ejercita el codigo real de _authGuard.mjs con tokens de
   ID reales emitidos por el emulador de Auth: demuestra que un checkout no
   puede confiar en la identidad que manda el cliente, que una cuenta sin
   correo verificado no puede llamar endpoints protegidos, y que el limite de
   rafaga por usuario/funcion realmente corta las llamadas. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { requireAuth, requireFeature } from '../server/api-lib/_authGuard.mjs';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/authGuard.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:authguard` o `npm run test:security`.');
}

async function createUserAndGetIdToken({ email, password = 'Test1234!', emailVerified = true }){
  const auth = getAdminAuth();
  const user = await auth.createUser({ email, password, emailVerified });
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const data = await res.json();
  if(!res.ok) throw new Error('No se pudo autenticar el usuario de prueba: ' + JSON.stringify(data));
  return { uid: user.uid, idToken: data.idToken };
}

function reqWithToken(token, body){
  return { headers: token ? { authorization: `Bearer ${token}` } : {}, body };
}

async function statusOf(promise){
  try{
    await promise;
    return null;
  }catch(err){
    return err.status;
  }
}

describe('_authGuard.requireFeature', () => {
  it('rechaza solicitudes sin token con 401', async () => {
    assert.equal(await statusOf(requireFeature(reqWithToken(null), 'assistant')), 401);
  });

  it('rechaza una cuenta con correo sin verificar (403), aunque el token sea real', async () => {
    const { idToken } = await createUserAndGetIdToken({
      email: `unverified-${Date.now()}@test.zoemec`,
      emailVerified: false
    });
    assert.equal(await statusOf(requireFeature(reqWithToken(idToken), 'assistant')), 403);
  });

  it('acepta una cuenta con correo verificado y feature disponible en su plan (Gratis + assistant)', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: `verified-${Date.now()}@test.zoemec` });
    const authz = await requireFeature(reqWithToken(idToken), 'assistant');
    assert.equal(authz.plan, 'Gratis');
    assert.equal(authz.role, 'user');
  });

  it('bug D5 corregido: Biblioteca bloqueada en Gratis (402) pero disponible en Profesional', async () => {
    const email = `library-${Date.now()}@test.zoemec`;
    const { uid, idToken } = await createUserAndGetIdToken({ email });
    assert.equal(await statusOf(requireFeature(reqWithToken(idToken), 'library')), 402);

    await getAdminDb().collection('users').doc(uid).set({
      uid, email, role: 'user', plan: 'Profesional', active: true
    }, { merge: true });

    const authz = await requireFeature(reqWithToken(idToken), 'library');
    assert.equal(authz.plan, 'Profesional');
  });

  it('aplica el limite de rafaga por usuario/funcion y lo rechaza con 429 al superarlo', async () => {
    const email = `rate-${Date.now()}@test.zoemec`;
    const { idToken } = await createUserAndGetIdToken({ email });
    // RATE_LIMITS.assistant.max = 40 en la ventana de 1h (ver api/_authGuard.mjs)
    for(let i = 0; i < 40; i++){
      await requireFeature(reqWithToken(idToken), 'assistant');
    }
    assert.equal(await statusOf(requireFeature(reqWithToken(idToken), 'assistant')), 429);
  });
});

describe('_authGuard.requireAuth (usado por create-checkout, sin gating de plan)', () => {
  it('rechaza solicitudes sin token con 401', async () => {
    assert.equal(await statusOf(requireAuth(reqWithToken(null))), 401);
  });

  it('rechaza una cuenta con correo sin verificar con 403', async () => {
    const { idToken } = await createUserAndGetIdToken({
      email: `checkout-unverified-${Date.now()}@test.zoemec`,
      emailVerified: false
    });
    assert.equal(await statusOf(requireAuth(reqWithToken(idToken))), 403);
  });

  it('ignora por completo cualquier uid/email suplantado en el body y usa solo el del token verificado', async () => {
    const email = `checkout-${Date.now()}@test.zoemec`;
    const { uid, idToken } = await createUserAndGetIdToken({ email });
    const req = reqWithToken(idToken, {
      plan: 'Empresa',
      method: 'Mercado Pago',
      uid: 'victima-suplantada',
      email: 'atacante@evil.zoemec',
      name: 'Atacante'
    });
    const authz = await requireAuth(req);
    assert.equal(authz.uid, uid);
    assert.equal(authz.email, email);
    assert.notEqual(authz.uid, 'victima-suplantada');
    assert.notEqual(authz.email, 'atacante@evil.zoemec');
  });
});
