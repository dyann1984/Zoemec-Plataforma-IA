#!/usr/bin/env node
/* PROCEDIMIENTO ADMINISTRATIVO FUERA DE LA APLICACION (Cuantificador
   Parametrico ZOEMEC, Fase B): siembra los auxiliares BASE globales
   (organizationId:null) en la coleccion `auxiliares` -- CONC-200, MORT-1-4,
   CIMBRA-COMUN, CONC-100 (ver src/domain/auxiliaries.js#buildBaseAuxiliaries,
   la UNICA fuente de verdad de su contenido: este script nunca redefine la
   composicion, solo la escribe).

   Igual que grant-super-admin.mjs: NO es un endpoint HTTP, NO se despliega,
   NO se invoca desde ningun boton de la UI -- se corre a mano, con las
   MISMAS credenciales que ya usa el resto del servidor (Admin SDK, que
   ignora firestore.rules por diseno -- por eso esto no requiere que la
   cuenta que lo corre tenga el custom claim super_admin, solo acceso al
   service account). NUNCA sobreescribe un auxiliar que la organizacion o un
   despliegue previo ya haya personalizado (usa restoreBaseAuxiliaries, que
   solo AGREGA los que falten por `clave`).

   USO:
     node scripts/seed-base-auxiliaries.mjs
     node scripts/seed-base-auxiliaries.mjs --dry-run

   Requiere una de las credenciales de server/api-lib/_firebaseAdmin.mjs
   (FIREBASE_SERVICE_ACCOUNT_JSON en produccion, o el emulador local via
   FIRESTORE_EMULATOR_HOST). Si FIREBASE_SERVICE_ACCOUNT_JSON no esta ya en
   el entorno, este script la toma de .env.local -- el flag nativo
   `node --env-file` de Node no reproduce el mismo parseo de comillas/
   caracteres escapados que espera este valor (un JSON de service account
   citado en una sola linea), asi que se lee el archivo a mano en vez de
   depender de ese flag. */
import { readFileSync, existsSync } from 'node:fs';

if(!process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIRESTORE_EMULATOR_HOST && existsSync('.env.local')){
  const line = readFileSync('.env.local', 'utf8').split('\n').find(l => l.startsWith('FIREBASE_SERVICE_ACCOUNT_JSON='));
  if(line){
    let value = line.slice('FIREBASE_SERVICE_ACCOUNT_JSON='.length).trim();
    if(value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = value;
  }
}

const { getAdminDb } = await import('../server/api-lib/_firebaseAdmin.mjs');
const { buildBaseAuxiliaries } = await import('../src/domain/auxiliaries.js');

const dryRun = process.argv.includes('--dry-run');
const db = getAdminDb();
const collection = db.collection('auxiliares');

const existingSnap = await collection.where('organizationId', '==', null).get();
const existingClaves = new Set(existingSnap.docs.map(d => d.data().clave));
const missing = buildBaseAuxiliaries().filter(a => !existingClaves.has(a.clave));

if(!missing.length){
  console.log('Los 4 auxiliares base ya existen en esta base de datos -- nada que sembrar.');
  console.log('Existentes:', [...existingClaves].join(', '));
  process.exit(0);
}

console.log(`Auxiliares base ya presentes (${existingClaves.size}):`, [...existingClaves].join(', ') || '(ninguno)');
console.log(`Auxiliares a sembrar (${missing.length}):`, missing.map(a => a.clave).join(', '));

if(dryRun){
  console.log('--dry-run: no se escribio nada.');
  process.exit(0);
}

for(const aux of missing){
  await collection.doc(aux.id).set(aux);
  console.log(`Sembrado: ${aux.clave} (${aux.nombre})`);
}
console.log(`Listo: ${missing.length} auxiliar(es) base sembrado(s).`);
