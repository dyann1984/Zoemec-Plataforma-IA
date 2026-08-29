import { FieldValue, getAdminAuth, getAdminDb, hasAdminCredentials } from './_firebaseAdmin.mjs';

/* "library" faltaba aqui (bug real, no de seguridad): rules['library'] daba
   undefined para CUALQUIER plan, asi que requireFeature(req,'library') le
   negaba el acceso a Biblioteca a todo usuario no-admin sin importar cuanto
   hubiera pagado. Los valores boolean reflejan la misma intencion que
   PLAN_LIMITS.library en src/main.jsx (Gratis:false, resto:true). */
const PLAN_RULES = {
  Gratis: { apuLimit: 1, ai: false, visual: false, assistant: true, library: false },
  Inicial: { apuLimit: 10, ai: false, visual: false, assistant: true, library: true },
  Profesional: { apuLimit: 999, ai: true, visual: true, assistant: true, library: true },
  Empresa: { apuLimit: 9999, ai: true, visual: true, assistant: true, library: true }
};

/* Tope de ráfaga por usuario y funcion, independiente del limite mensual de
   plan (apuLimit). Antes assistant/visual/ai/library solo verificaban un
   booleano de plan, sin ningun freno de frecuencia: una cuenta de pago (o
   admin) podia hacer scripting de llamadas ilimitadas contra OpenAI/Drive sin
   ningun control de costo. Los administradores quedan exentos, igual que ya
   pasa con el limite mensual. */
const RATE_LIMITS = {
  apu: { max: 30, windowMs: 60 * 60 * 1000 },
  assistant: { max: 40, windowMs: 60 * 60 * 1000 },
  visual: { max: 15, windowMs: 60 * 60 * 1000 },
  ai: { max: 40, windowMs: 60 * 60 * 1000 },
  library: { max: 60, windowMs: 60 * 60 * 1000 }
};

async function enforceRateLimit(db, uid, feature){
  const limit = RATE_LIMITS[feature];
  if(!limit) return;
  const ref = db.collection('rateLimits').doc(`${uid}_${feature}`);
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    const expired = !data || (now - Number(data.windowStart || 0)) > limit.windowMs;
    if(expired){
      tx.set(ref, { windowStart: now, count: 1 });
      return;
    }
    if(Number(data.count || 0) >= limit.max){
      const error = new Error('Demasiadas solicitudes en poco tiempo para esta funcion. Espera unos minutos e intenta de nuevo.');
      error.status = 429;
      throw error;
    }
    tx.update(ref, { count: FieldValue.increment(1) });
  });
}

function bearerToken(req){
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
}

function normalizePlan(plan){
  return PLAN_RULES[plan] ? plan : 'Gratis';
}

/* Misma logica que isAdminUser en el frontend (src/domain/permissions.js): no
   confiar en un solo valor exacto de "role". Acepta variantes normalizadas,
   custom claim de Firebase (decoded.admin === true) o correo en la lista de
   administradores. VITE_ADMIN_EMAILS/ADMIN_EMAILS nunca se configuraron en
   Vercel; la variable que si esta configurada ahi es SUPERADMIN_EMAILS (se
   lee tambien, ademas de las otras dos por compatibilidad). Se agrega el
   mismo correo de respaldo fijo que ya usa el cliente (permissions.js) para
   que el admin real de la plataforma no dependa de una variable de entorno
   ausente: sin este respaldo, requireAdmin/requireFeature nunca reconocian a
   ese usuario como admin en el servidor aunque el frontend si lo mostrara
   como admin (rol tomado solo de Firestore, cuota y limite de ráfaga
   aplicados como si fuera un usuario normal). */
const ADMIN_ROLE_VALUES = new Set(['admin', 'administrator', 'administrador', 'superadmin']);
const ADMIN_EMAILS = String(
  process.env.VITE_ADMIN_EMAILS || process.env.ADMIN_EMAILS || process.env.SUPERADMIN_EMAILS || 'dianalopez161184@gmail.com'
).split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
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
  const isAdmin = isAdminProfile(decoded, profile);

  /* Misma regla que el cliente (src/main.jsx: cierra la sesion si
     !fbUser.emailVerified y no es admin) pero aplicada server-side. Sin esto,
     un ID token real de una cuenta que nunca confirmo su correo podia llamar
     cualquier endpoint protegido directo (sin pasar por el login del
     frontend, que es el unico lugar donde antes se exigia). */
  if(!decoded.email_verified && !isAdmin){
    const error = new Error('Verifica tu correo antes de usar esta funcion. Revisa tu bandeja de entrada.');
    error.status = 403;
    throw error;
  }

  if(profile.active === false){
    const error = new Error('Tu cuenta esta desactivada. Contacta al administrador.');
    error.status = 403;
    throw error;
  }

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
    await enforceRateLimit(db, decoded.uid, feature);
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
  // email agregado (Fase 6 -- Memoria Tecnica): antes solo devolvia uid, que
  // no es legible para mostrar "aprobado por" en UI. Aditivo, ningun
  // llamador existente (health.mjs) desestructuraba mas que .uid.
  return { uid: decoded.uid, email: decoded.email || profile.email || '' };
}

/* Verificacion de identidad sin gating de plan/feature: para endpoints como
   create-checkout donde cualquier usuario con sesion valida (de cualquier
   plan, porque esta comprando/mejorando uno) debe poder operar, pero SIEMPRE
   sobre su propia identidad real verificada por Firebase Admin, nunca sobre
   un uid/email/name que el cliente mande en el body. */
export async function requireAuth(req){
  if(!hasAdminCredentials()){
    const error = new Error('Falta FIREBASE_SERVICE_ACCOUNT_JSON en Vercel para validar la sesion.');
    error.status = 500;
    throw error;
  }
  const token = bearerToken(req);
  if(!token){
    const error = new Error('Inicia sesion para continuar.');
    error.status = 401;
    throw error;
  }
  const decoded = await getAdminAuth().verifyIdToken(token);
  const db = getAdminDb();
  const userRef = db.collection('users').doc(decoded.uid);
  const snap = await userRef.get();
  const profile = snap.exists ? snap.data() : {};
  const isAdmin = isAdminProfile(decoded, profile);

  if(!decoded.email_verified && !isAdmin){
    const error = new Error('Verifica tu correo antes de continuar. Revisa tu bandeja de entrada.');
    error.status = 403;
    throw error;
  }
  if(profile.active === false){
    const error = new Error('Tu cuenta esta desactivada. Contacta al administrador.');
    error.status = 403;
    throw error;
  }

  return {
    uid: decoded.uid,
    email: decoded.email || profile.email || '',
    name: profile.name || decoded.name || decoded.email || 'Usuario ZOEMEC',
    role: isAdmin ? 'admin' : (profile.role || 'user'),
    userRef
  };
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
