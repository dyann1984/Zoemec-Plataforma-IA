/* Reglas de negocio de planes y permisos: sin React, sin Firebase, sin DOM.
   Recibe datos ya cargados (perfil de usuario, plan, uso) y decide que puede
   hacer ese usuario. Testeable con objetos planos. */
import { isActiveTrialStatus } from './organization.js';

export function hasValidSession(user){
  return Boolean(user?.email && user?.plan && (user?.deviceId || user?.uid));
}

export const PLAN_LIMITS = {
  Gratis:{ apus:1, library:false, ai:false, exports:false, label:'Gratis - 1 APU' },
  Inicial:{ apus:10, library:'limitada', ai:false, exports:true, label:'Inicial' },
  Profesional:{ apus:999, library:true, ai:true, exports:true, label:'Profesional' },
  Empresa:{ apus:9999, library:true, ai:true, exports:true, label:'Empresa' }
};

/* Fuente unica de verdad para saber si alguien es SUPER ADMIN (administrador
   GLOBAL de ZOEMEC -- no confundir con company_manager, el responsable de
   UNA sola empresa, ver src/domain/organization.js#ORG_ROLE). Endurecimiento
   de seguridad (auditoria de roles): antes este calculo tambien aceptaba
   cualquier users/{uid}.role guardado en Firestore como "admin"/"administrator"/
   "administrador"/"superadmin" -- eso permitia que un super admin existente
   ascendiera a CUALQUIER otro usuario a super admin con una simple escritura
   de Firestore (ver el <select> de rol que existia en AdminPanel.jsx), exactamente
   lo que se pidio eliminar ("ningun usuario puede asignarse este rol, ninguna
   empresa puede crear otro super_admin"). Ningun documento de Firestore puede
   otorgar este rol nunca mas.

   MECANISMO FINAL (el pensado para quedarse): el custom claim real de
   Firebase `super_admin===true`. NINGUN endpoint de este repo lo establece
   jamas -- la UNICA forma de otorgarlo es scripts/grant-super-admin.mjs,
   corrido a mano en una terminal con las credenciales reales de Firebase
   Admin (fuera de la app, nunca desde el Team Panel, el Admin Panel, ni
   ninguna llamada de red). Un token sin ese claim simplemente no lo trae --
   nunca se puede fabricar desde el cliente.

   MECANISMO DE TRANSICION (temporal, NO el mecanismo final): el correo en
   SUPERADMIN_EMAILS/respaldo fijo. Existe unicamente para que el acceso de
   super admin no se pierda mientras el claim real todavia no se ha corrido
   contra un entorno (desarrollo, o produccion recien desplegada) -- ver el
   mismo respaldo en server/api-lib/_authGuard.mjs#SUPERADMIN_EMAILS y
   firestore.rules#isSuperAdmin, los tres deben mantenerse en sincronia. Una
   vez que scripts/grant-super-admin.mjs ya se corrio para la cuenta real en
   un entorno, este respaldo de correo puede retirarse ahi sin perder acceso
   -- queda documentado aqui explicitamente para que nadie lo trate como la
   proteccion definitiva. */
// `typeof import.meta !== 'undefined' ? import.meta.env?.X : undefined`
// (mismo guard ya usado en src/domain/intelligence2Runtime.js): import.meta.env
// solo existe bajo el bundler de Vite (navegador); sin el guard, este archivo
// no se puede importar desde un script/test de Node puro -- se descubrio
// exactamente asi (dev-qa/roles-qa.mjs, endurecimiento de roles), y hasta
// ahora nadie lo habia intentado (permissions.js no tenia pruebas propias).
const VITE_SUPERADMIN_EMAILS = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SUPERADMIN_EMAILS : undefined;
export const SUPERADMIN_EMAILS = String(VITE_SUPERADMIN_EMAILS || 'dianalopez161184@gmail.com')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

export function normalizeRoleValue(v){ return String(v ?? '').trim().toLowerCase(); }

export function isAdminUser(user, profile){
  if(user?.claims?.super_admin === true) return true;
  const email = normalizeRoleValue(profile?.email ?? user?.email);
  if(email && SUPERADMIN_EMAILS.includes(email)) return true;
  return false;
}

/* orgStatus (opcional): estado RESUELTO de la organizacion del usuario (ver
   src/domain/organization.js#resolveOrgStatus), si pertenece a una. Durante
   ACTIVE_TRIAL, la UI habilita las mismas acciones que a un admin (punto 5
   del trial empresarial: "sin limites artificiales de uso") -- esto es solo
   para pintar botones habilitados/deshabilitados, la autoridad real siempre
   es el servidor (server/api-lib/_authGuard.mjs#requireFeature). */
export function canUse(user, feature, used=0, orgStatus=null){
  if(user?.isAdmin) return true;
  if(isActiveTrialStatus(orgStatus)) return true;
  const plan = PLAN_LIMITS[user?.plan || 'Gratis'] || PLAN_LIMITS.Gratis;
  if(feature === 'apu') return used < plan.apus;
  return Boolean(plan[feature]);
}

export function userInitials(name='', email=''){
  const base = (name || email?.split('@')?.[0] || 'Usuario ZOEMEC').trim();
  return base.split(' ').map(x=>x[0]).filter(Boolean).slice(0,2).join('').toUpperCase() || 'UZ';
}
