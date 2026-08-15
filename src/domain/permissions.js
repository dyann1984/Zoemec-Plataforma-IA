/* Reglas de negocio de planes y permisos: sin React, sin Firebase, sin DOM.
   Recibe datos ya cargados (perfil de usuario, plan, uso) y decide que puede
   hacer ese usuario. Testeable con objetos planos. */

export function hasValidSession(user){
  return Boolean(user?.email && user?.plan && (user?.deviceId || user?.uid));
}

export const PLAN_LIMITS = {
  Gratis:{ apus:1, library:false, ai:false, exports:false, label:'Gratis - 1 APU' },
  Inicial:{ apus:10, library:'limitada', ai:false, exports:true, label:'Inicial' },
  Profesional:{ apus:999, library:true, ai:true, exports:true, label:'Profesional' },
  Empresa:{ apus:9999, library:true, ai:true, exports:true, label:'Empresa' }
};

/* Fuente unica de verdad para saber si alguien es administrador. Antes cada
   pantalla comparaba user.role==='admin' de forma literal: si el rol venia
   guardado en Firestore como "Administrador", "ADMIN" o con espacios, el Panel
   Admin simplemente no aparecia (sin ningun error visible). Ahora se normaliza
   el texto y ademas se acepta custom claim de Firebase o correo en
   VITE_ADMIN_EMAILS, para no depender de un solo campo fragil.
   VITE_ADMIN_EMAILS nunca se configuro en Vercel/local (confirmado: no aparece
   en ninguno de los dos entornos), asi que la lista quedaba vacia y el unico
   admin real de la plataforma dependia 100% de que Firestore tuviera guardado
   role:"admin" exacto. Se agrega un correo de respaldo fijo (el mismo patron
   que ya usa src/firebase.js con sus valores por defecto) para que el acceso
   de administrador nunca dependa de una variable de entorno olvidada. */
export const ADMIN_ROLE_VALUES = new Set(['admin', 'administrator', 'administrador', 'superadmin']);
export const ADMIN_EMAILS = String(import.meta.env.VITE_ADMIN_EMAILS || 'dianalopez161184@gmail.com')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

export function normalizeRoleValue(v){ return String(v ?? '').trim().toLowerCase(); }

export function isAdminUser(user, profile){
  const role = normalizeRoleValue(profile?.role ?? user?.role);
  if(ADMIN_ROLE_VALUES.has(role)) return true;
  if(user?.claims?.admin === true) return true;
  const email = normalizeRoleValue(profile?.email ?? user?.email);
  if(email && ADMIN_EMAILS.includes(email)) return true;
  return false;
}

export function canUse(user, feature, used=0){
  if(user?.isAdmin) return true;
  const plan = PLAN_LIMITS[user?.plan || 'Gratis'] || PLAN_LIMITS.Gratis;
  if(feature === 'apu') return used < plan.apus;
  return Boolean(plan[feature]);
}

export function userInitials(name='', email=''){
  const base = (name || email?.split('@')?.[0] || 'Usuario ZOEMEC').trim();
  return base.split(' ').map(x=>x[0]).filter(Boolean).slice(0,2).join('').toUpperCase() || 'UZ';
}
