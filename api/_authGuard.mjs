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

  const role = profile.role || 'user';
  const plan = role === 'admin' ? 'Empresa' : normalizePlan(profile.plan || 'Gratis');
  const rules = PLAN_RULES[plan] || PLAN_RULES.Gratis;
  const month = usageMonth();
  const currentUsage = Number(profile.usage?.[month]?.[feature] || 0);

  if(role !== 'admin'){
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
