import { FieldValue, getAdminAuth, getAdminDb, hasAdminCredentials } from './_firebaseAdmin.mjs';

const PLAN_RULES = {
  Gratis: { apuLimit: 1, ai: false, visual: false, assistant: true },
  Inicial: { apuLimit: 10, ai: false, visual: false, assistant: true },
  Profesional: { apuLimit: 999, ai: true, visual: true, assistant: true },
  Empresa: { apuLimit: 9999, ai: true, visual: true, assistant: true }
};

function bearerToken(req){
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
}

function normalizePlan(plan){
  return PLAN_RULES[plan] ? plan : 'Gratis';
}

/* Misma logica que isAdminUser en el frontend (src/main.jsx): no confiar en un
   solo valor exacto de "role". Acepta variantes normalizadas, custom claim de
   Firebase (decoded.admin === true) o correo en VITE_ADMIN_EMAILS (la misma
   variable que usa el cliente; Vercel la expone igual en runtime de funciones). */
const ADMIN_ROLE_VALUES = new Set(['admin', 'administrator', 'administrador', 'superadmin']);
const ADMIN_EMAILS = String(process.env.VITE_ADMIN_EMAILS || process.env.ADMIN_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
function normalizeRoleValue(v){ return String(v ?? '').trim().toLowerCase(); }
function isAdminProfile(decoded, profile){
  const role = normalizeRoleValue(profile?.role);
  if(ADMIN_ROLE_VALUES.has(role)) return true;
  if(decoded?.admin === true) return true;
  const email = normalizeRoleValue(profile?.email ?? decoded?.email);
  if(email && ADMIN_EMAILS.includes(email)) return true;
  return false;
}

function usageMonth(){
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function requireFeature(req, feature){
  if(!hasAdminCredentials()){
    const error = new Error('Falta FIREBASE_SERVICE_ACCOUNT_JSON en Vercel para validar usuarios y planes.');
    error.status = 500;
    throw error;
  }
  const token = bearerToken(req);
  if(!token){
    const error = new Error('Inicia sesion para usar la IA de ZOEMEC.');
    error.status = 401;
    throw error;
  }

  const auth = getAdminAuth();
  const decoded = await auth.verifyIdToken(token);
  const db = getAdminDb();
  const userRef = db.collection('users').doc(decoded.uid);
  const snap = await userRef.get();
  const profile = snap.exists ? snap.data() : {};

  if(profile.active === false){
    const error = new Error('Tu cuenta esta desactivada. Contacta al administrador.');
    error.status = 403;
    throw error;
  }

  const isAdmin = isAdminProfile(decoded, profile);
  const role = isAdmin ? 'admin' : (profile.role || 'user');
  const plan = isAdmin ? 'Empresa' : normalizePlan(profile.plan || 'Gratis');
  const rules = PLAN_RULES[plan] || PLAN_RULES.Gratis;
  const month = usageMonth();
  const currentUsage = Number(profile.usage?.[month]?.[feature] || 0);

  if(!isAdmin){
    if(feature === 'apu' && currentUsage >= rules.apuLimit){
      const error = new Error('Tu limite de APUs de este plan ya fue usado. Activa o mejora tu plan para continuar.');
      error.status = 402;
      throw error;
    }
    if(feature !== 'apu' && !rules[feature]){
      const error = new Error('Esta funcion requiere un plan con IA activa.');
      error.status = 402;
      throw error;
    }
  }

  if(!snap.exists){
    await userRef.set({
      uid: decoded.uid,
      email: decoded.email || '',
      name: decoded.name || decoded.email || 'Usuario ZOEMEC',
      plan: 'Gratis',
      role: 'user',
      active: true,
      createdAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }

  return {
    uid: decoded.uid,
    email: decoded.email || profile.email || '',
    name: profile.name || decoded.name || decoded.email || 'Usuario ZOEMEC',
    plan,
    role,
    userRef,
    usageMonth: month,
    feature
  };
}

export async function requireAdmin(req){
  if(!hasAdminCredentials()){
    const error = new Error('Falta FIREBASE_SERVICE_ACCOUNT_JSON en Vercel para validar administradores.');
    error.status = 500;
    throw error;
  }
  const token = bearerToken(req);
  if(!token){
    const error = new Error('Inicia sesion como administrador.');
    error.status = 401;
    throw error;
  }
  const decoded = await getAdminAuth().verifyIdToken(token);
  const snap = await getAdminDb().collection('users').doc(decoded.uid).get();
  const profile = snap.exists ? snap.data() : {};
  if(!isAdminProfile(decoded, profile)){
    const error = new Error('Esta seccion es solo para administradores.');
    error.status = 403;
    throw error;
  }
  return { uid: decoded.uid };
}

export async function markFeatureUsed(authz){
  if(!authz?.userRef || authz.role === 'admin') return;
  await authz.userRef.set({
    usage: {
      [authz.usageMonth]: {
        [authz.feature]: FieldValue.increment(1)
      }
    },
    lastAiUseAt: FieldValue.serverTimestamp()
  }, { merge: true });
}
