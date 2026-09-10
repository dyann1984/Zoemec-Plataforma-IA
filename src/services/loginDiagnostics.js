/* Instrumentacion temporal de diagnostico para el incidente de produccion
   "permission-denied al iniciar sesion" (ver informe de auditoria). Objetivo
   unico: dejar rastro en consola de en que etapa exacta de login() ocurre un
   fallo, sin cambiar ningun comportamiento (nunca lanza, nunca altera el
   valor de retorno de nada que envuelva).

   No registra NUNCA: password, idToken, refreshToken, apiKey, el objeto
   `credential` completo ni el objeto de usuario de Firebase completo --
   solo strings cortos (stage, code, name, y hasta 200 caracteres del
   mensaje).

   Este modulo es deliberadamente desechable: una vez cerrado el incidente,
   se puede borrar junto con las llamadas a logLoginTrace() que lo usan. */

const PREFIX = '[ZOEMEC][login-trace]';

export function logLoginTrace(stage, extra){
  try{
    if(extra && Object.keys(extra).length){
      console.info(PREFIX, stage, extra);
    }else{
      console.info(PREFIX, stage);
    }
  }catch{ /* la instrumentacion nunca debe poder romper el login */ }
}

/* Extrae SOLO los campos seguros de un error para diagnostico: nunca el
   objeto completo (podria traer, segun el SDK, referencias a la request
   original). */
export function errInfo(error){
  return {
    code: error?.code || null,
    name: error?.name || null,
    message: String(error?.message || '').slice(0, 200),
  };
}

export function isPermissionDeniedCode(code){
  return String(code || '').includes('permission-denied');
}
