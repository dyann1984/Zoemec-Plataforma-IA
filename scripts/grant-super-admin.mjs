#!/usr/bin/env node
/* PROCEDIMIENTO ADMINISTRATIVO FUERA DE LA APLICACION (Endurecimiento de
   roles): esta es la UNICA forma legitima de otorgar el custom claim real
   `super_admin` de Firebase a una cuenta. Deliberadamente NO es un endpoint
   HTTP, NO vive bajo api/ ni server/api-lib/ (nunca se despliega, nunca es
   alcanzable por ninguna peticion de red), y NO se invoca desde ningun botón
   de la UI (Team Panel, Admin Panel) ni desde ningun otro codigo de la app --
   solo se ejecuta a mano, en una terminal, por quien ya tiene las
   credenciales reales de Firebase Admin (el mismo FIREBASE_SERVICE_ACCOUNT_JSON
   que usa el resto del servidor). Esto es intencional: super_admin (admin
   GLOBAL de ZOEMEC) no debe depender de nada que la aplicacion misma pueda
   escribir -- ni un documento de Firestore, ni una llamada API, ni una
   accion de UI -- exactamente lo que se pidio.

   USO:
     node scripts/grant-super-admin.mjs <correo> [--revoke]

   Ejemplos:
     node scripts/grant-super-admin.mjs dianalopez161184@gmail.com
     node scripts/grant-super-admin.mjs dianalopez161184@gmail.com --revoke

   Requiere las MISMAS credenciales que ya usa el resto del servidor
   (una de las tres, ver server/api-lib/_firebaseAdmin.mjs):
     - FIREBASE_SERVICE_ACCOUNT_JSON (produccion, la variable real de Vercel)
     - GOOGLE_APPLICATION_CREDENTIALS
     - FIRESTORE_EMULATOR_HOST + FIREBASE_AUTH_EMULATOR_HOST (emulador local,
       solo para probar el flujo sin tocar produccion)

   Tras correr esto contra produccion, la cuenta debe cerrar sesion y volver a
   iniciarla (o forzar un refresh de su ID token) para que el claim nuevo
   llegue a su sesion -- los custom claims de Firebase NUNCA se aplican
   retroactivamente a un token ya emitido.

   Nota sobre el respaldo temporal por correo (ver src/domain/permissions.js,
   server/api-lib/_authGuard.mjs, firestore.rules#isSuperAdmin): ese chequeo
   de correo exacto es una TRANSICION de desarrollo, documentada como tal en
   los tres archivos -- nunca el mecanismo final. Una vez que se corra este
   script contra produccion para la cuenta real, esa cuenta queda cubierta
   por el custom claim real (la via pensada como definitiva) ademas del
   respaldo de correo; el respaldo puede retirarse mas adelante sin que la
   cuenta pierda acceso, siempre que este script ya se haya corrido. */
import { getAdminAuth } from '../server/api-lib/_firebaseAdmin.mjs';

const [, , emailArg, flag] = process.argv;
const revoke = flag === '--revoke';

if(!emailArg || !emailArg.includes('@')){
  console.error('Uso: node scripts/grant-super-admin.mjs <correo> [--revoke]');
  process.exit(1);
}
const email = emailArg.trim().toLowerCase();

const auth = getAdminAuth();
const user = await auth.getUserByEmail(email).catch(() => null);
if(!user){
  console.error(`No existe ninguna cuenta de Firebase Auth con el correo "${email}" en este proyecto/entorno.`);
  process.exit(1);
}

// setCustomUserClaims REEMPLAZA todos los claims del usuario -- se leen los
// existentes primero y solo se toca la llave super_admin, para no borrar por
// accidente algun otro claim que esa cuenta ya tuviera.
const existingClaims = user.customClaims || {};
const nextClaims = { ...existingClaims };
if(revoke) delete nextClaims.super_admin;
else nextClaims.super_admin = true;

await auth.setCustomUserClaims(user.uid, nextClaims);

console.log(`${revoke ? 'REVOCADO' : 'OTORGADO'} el custom claim super_admin para ${email} (uid: ${user.uid}).`);
console.log('Esa cuenta debe cerrar sesion y volver a iniciarla (o refrescar su ID token) para que el cambio tome efecto -- los custom claims nunca se aplican a un token ya emitido.');
