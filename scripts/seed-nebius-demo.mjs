// Emulator only: this script cannot seed a real tenant or overwrite an existing project.
import { createNebiusDemo } from '../src/domain/nebiusDemo.js';
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) {
  throw new Error('La demo requiere emuladores locales Firestore y Auth. No escribe en producción.');
}
process.env.FIREBASE_PROJECT_ID = 'demo-zoemec-nebius';
const { getAdminDb, getAdminAuth } = await import('../server/api-lib/_firebaseAdmin.mjs');
const db = getAdminDb(); const auth = getAdminAuth();
const { project, apus, conceptos } = createNebiusDemo();
const uid = project.ownerUid;
try { await auth.getUser(uid); } catch (err) {
  if (err.code !== 'auth/user-not-found') throw err;
  await auth.createUser({ uid, email: 'ingeniero@nebius-demo.test', password: 'DemoLocal-2026!', emailVerified: true });
}
const entries = [
  [`users/${uid}`, { uid, email: 'ingeniero@nebius-demo.test', active: true, organizationId: project.organizationId, plan: 'Empresa', role: 'user' }],
  [`organizations/${project.organizationId}`, { id: project.organizationId, name: 'ZOEMEC DEMO aislado', status: 'CONVERTED' }],
  [`organizations/${project.organizationId}/members/${uid}`, { uid, status: 'active', role: 'company_manager' }],
  [`projects/${project.id}`, project], ...apus.map(a => [`apus/${a.id}`, a]), ...conceptos.map(c => [`catalogConceptos/${c.id}`, c])
];
for (const [path, data] of entries) {
  const ref = db.doc(path);
  if (!(await ref.get()).exists) await ref.create(data);
}
console.log('Demo local preparada: Residencial Las Palmas - Edificio A. Usuario ingeniero@nebius-demo.test; contraseña local DemoLocal-2026!');
