/* Normalizacion segura de perfiles legacy (users/{uid}).
   Incidente produccion: cuentas creadas por versiones anteriores de ZOEMEC
   (o manualmente) pueden tener el documento users/{uid} SIN role/plan/active,
   o con tipos incorrectos (ej. plan numerico, active como string). Antes,
   loadOrCreateProfile() devolvia ese documento tal cual -- y cualquier
   escritura posterior (ej. el sync de companyName) tronaba con
   permission-denied porque la regla de "update" de Firestore exige que
   role/plan/active permanezcan IGUALES entre el documento existente y el
   resultante; si el campo faltaba, la comparacion nunca podia ser cierta.

   normalizeUserProfile() es logica PURA (sin Firestore): decide, a partir
   del documento crudo, cuales campos faltan o tienen un tipo invalido y
   cual es el UNICO valor seguro para llenarlos. Reglas de seguridad que esta
   funcion respeta siempre, sin excepcion:

   - NUNCA sobrescribe un campo que ya tiene un valor del tipo correcto,
     sea cual sea ese valor -- un admin nunca se convierte en 'user', un
     plan de pago nunca se degrada a 'Gratis', un active:false explicito
     (cuenta desactivada a proposito) NUNCA se reactiva solo.
   - El unico valor que puede rellenar un campo AUSENTE es el de arranque
     mas restrictivo (role:'user', plan:'Gratis', active:true) -- igual que
     ya usa el codigo de registro/creacion. Nunca inventa otro valor.
   - El campo uid del resultado SIEMPRE viene de fbUser.uid, nunca del
     documento leido -- defensa adicional (Firestore Rules ya es la
     autoridad real) contra un documento con un uid distinto al dueno real. */

const SAFE_DEFAULTS = Object.freeze({ role: 'user', plan: 'Gratis', active: true });

export function normalizeUserProfile(raw, fbUser){
  if(!raw) return null;

  const patch = {};
  if(typeof raw.role !== 'string' || raw.role.trim() === ''){
    patch.role = SAFE_DEFAULTS.role;
  }
  if(typeof raw.plan !== 'string' || raw.plan.trim() === ''){
    patch.plan = SAFE_DEFAULTS.plan;
  }
  if(typeof raw.active !== 'boolean'){
    patch.active = SAFE_DEFAULTS.active;
  }
  if(typeof raw.name !== 'string' || raw.name.trim() === ''){
    patch.name = fbUser?.displayName || fbUser?.email?.split('@')[0] || raw.email?.split?.('@')?.[0] || 'Usuario ZOEMEC';
  }
  if(typeof raw.email !== 'string' || raw.email.trim() === ''){
    patch.email = fbUser?.email || raw.email || null;
  }
  if(typeof raw.apusCreated !== 'number' || !Number.isFinite(raw.apusCreated)){
    patch.apusCreated = 0;
  }

  const needsNormalization = Object.keys(patch).length > 0;
  return {
    profile: { ...raw, ...patch, uid: fbUser?.uid || raw.uid },
    needsNormalization,
    patch,
  };
}
