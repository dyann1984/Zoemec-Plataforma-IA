import admin from 'firebase-admin';

const DEFAULT_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'zoemec-plataforma-ia';

function parseServiceAccount(){
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if(raw){
    const clean = raw.trim();
    const decoded = clean.startsWith('{')
      ? clean
      : Buffer.from(clean, 'base64').toString('utf8');
    const json = JSON.parse(decoded);
    if(json.private_key) json.private_key = json.private_key.replace(/\\n/g, '\n');
    return json;
  }
  if(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY){
    return {
      project_id: process.env.FIREBASE_PROJECT_ID,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    };
  }
  return null;
}

export function hasAdminCredentials(){
  return Boolean(parseServiceAccount() || process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

function initAdminApp(){
  if(!admin.apps.length){
    const serviceAccount = parseServiceAccount();
    if(serviceAccount){
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id || DEFAULT_PROJECT_ID
      });
    }else{
      admin.initializeApp({ projectId: DEFAULT_PROJECT_ID });
    }
  }
}

export function getAdminDb(){
  initAdminApp();
  if(!hasAdminCredentials()){
    throw new Error('Falta FIREBASE_SERVICE_ACCOUNT_JSON en Vercel para leer planes, permisos y pagos. Puedes pegar el JSON completo o su version base64.');
  }
  return admin.firestore();
}

export function getAdminAuth(){
  initAdminApp();
  return admin.auth();
}

export const FieldValue = admin.firestore.FieldValue;
