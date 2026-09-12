import { FieldValue, getAdminAuth, getAdminDb, hasAdminCredentials } from './_firebaseAdmin.mjs';
import { resolveOrgStatus, isActiveTrialStatus } from '../../src/domain/organization.js';

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

/* SUPER ADMIN = administrador GLOBAL de ZOEMEC (no confundir con
   company_manager, el responsable de UNA sola empresa dentro de su
   organizacion -- ver src/domain/organization.js#ORG_ROLE y
   _orgGuard.mjs#requireCompanyManager). Mismo criterio que el cliente
   (src/domain/permissions.js#isAdminUser), y debe mantenerse en sincronia
   con firestore.rules#isSuperAdmin() -- son las UNICAS tres fuentes de este
   calculo en todo el repo.

   Endurecimiento de seguridad (auditoria de roles): antes tambien se aceptaba
   cualquier users/{uid}.role guardado en Firestore como "admin"/"administrator"/
   "administrador"/"superadmin" -- eso permitia que un super admin ascendiera
   a CUALQUIER otro usuario a super admin con una simple escritura de
   Firestore (ver el <select> que existia en AdminPanel.jsx), exactamente lo
   que se pidio eliminar ("ningun usuario puede asignarse este rol, ninguna
   empresa puede crear otro super_admin", "debe validarse server-side").
   Ningun documento de Firestore puede otorgar este rol nunca mas.

   MECANISMO FINAL: el custom claim real de Firebase `super_admin===true`
   (decoded.super_admin viene del ID token YA VERIFICADO por
   verifyIdToken -- nunca del body/query del cliente). NINGUN endpoint de
   este repo lo establece jamas -- la unica forma de otorgarlo es
   scripts/grant-super-admin.mjs, corrido a mano fuera de la app con las
   credenciales reales de Firebase Admin.

   MECANISMO DE TRANSICION (temporal, NO el final): el correo en
   SUPERADMIN_EMAILS/respaldo fijo. SUPERADMIN_EMAILS es la unica variable de
   entorno que de verdad esta configurada en Vercel hoy (confirmado); el
   respaldo fijo evita que el acceso dependa de una variable ausente. Existe
   solo mientras scripts/grant-super-admin.mjs todavia no se ha corrido para
   la cuenta real en un entorno dado -- una vez corrido, este respaldo puede
   retirarse sin perder acceso. Debe mantenerse en sincronia con
   src/domain/permissions.js#SUPERADMIN_EMAILS y firestore.rules#isSuperAdmin
   -- son las UNICAS tres fuentes de este calculo en todo el repo. */
const SUPERADMIN_EMAILS = String(
  process.env.SUPERADMIN_EMAILS || 'dianalopez161184@gmail.com'
).split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
function normalizeRoleValue(v){ return String(v ?? '').trim().toLowerCase(); }
function isSuperAdminProfile(decoded, profile){
  if(decoded?.super_admin === true) return true;
  const email = normalizeRoleValue(profile?.email ?? decoded?.email);
  if(email && SUPERADMIN_EMAILS.includes(email)) return true;
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
  const isAdmin = isSuperAdminProfile(decoded, profile);

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

  /* Punto 5 del trial empresarial: "sin limites artificiales de uso durante
     el mes". Un miembro de una organizacion en ACTIVE_TRIAL no debe heredar
     el limite del plan individual (normalmente Gratis: 1 APU, sin IA) de su
     users/{uid} personal -- se le trata como acceso completo al chequeo de
     cuota/plan, igual que ya se hace con isAdmin. A diferencia de admin, SI
     sigue aplicando enforceRateLimit (rate limiting por rafaga): el punto 5
     pide "sin limites artificiales" pero mantiene proteccion razonable
     contra abuso/automatizacion masiva. Si el trial ya vencio
     (resolveOrgStatus lo resuelve aunque el documento todavia no lo refleje,
     ver _orgGuard.mjs), no hay bypass: cae al comportamiento Gratis normal,
     lo que bloquea de facto IA/exportacion (punto 7). */
  let isActiveTrialOrgMember = false;
  if(!isAdmin && profile.organizationId){
    try{
      const orgSnap = await db.collection('organizations').doc(profile.organizationId).get();
      if(orgSnap.exists){
        isActiveTrialOrgMember = isActiveTrialStatus(resolveOrgStatus({ id: orgSnap.id, ...orgSnap.data() }));
      }
    }catch{
      // Si la lectura de la organizacion falla, cae al comportamiento de plan
      // individual normal -- nunca se otorga acceso extra por una falla.
    }
  }
  const bypassPlanLimits = isAdmin || isActiveTrialOrgMember;

  if(!bypassPlanLimits){
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
  if(!isAdmin){
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

export async function requireSuperAdmin(req){
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
  if(!isSuperAdminProfile(decoded, profile)){
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
  const isAdmin = isSuperAdminProfile(decoded, profile);

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
