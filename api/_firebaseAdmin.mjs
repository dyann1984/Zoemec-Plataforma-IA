import admin from 'firebase-admin';

function parseServiceAccount(){
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if(raw){
    const json = JSON.parse(raw);
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

export function getAdminDb(){
  if(!admin.apps.length){
    const serviceAccount = parseServiceAccount();
    if(serviceAccount){
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }else{
      admin.initializeApp();
    }
  }
  return admin.firestore();
}

export const FieldValue = admin.firestore.FieldValue;
