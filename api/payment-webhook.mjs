import crypto from 'node:crypto';
import { FieldValue, getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';

async function getPayment(paymentId){
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers:{ Authorization:`Bearer ${process.env.MP_ACCESS_TOKEN}` }
  });
  const data = await res.json();
  if(!res.ok) throw new Error(data.message || 'No pude verificar el pago.');
  return data;
}

/* Valida el header x-signature que Mercado Pago firma con HMAC-SHA256 sobre
   "id:{paymentId};request-id:{x-request-id};ts:{ts};" usando el secreto
   configurado en el panel de Mercado Pago (Webhooks > Firma secreta). Antes
   este endpoint aceptaba cualquier POST con un paymentId y volvia a consultar
   Mercado Pago (lo cual evitaba falsificar un pago "aprobado"), pero
   cualquiera podia igual forzar al servidor a golpear la API de MP en bucle
   con ids arbitrarios. Exportada para poder probarla con datos deterministas. */
export function verifyMercadoPagoSignature({ signatureHeader, requestId, paymentId, secret }){
  if(!secret || !signatureHeader || !requestId || !paymentId) return false;
  const parts = {};
  String(signatureHeader).split(',').forEach(chunk => {
    const [key, value] = chunk.split('=');
    if(key && value !== undefined) parts[key.trim()] = value.trim();
  });
  const { ts, v1 } = parts;
  if(!ts || !v1) return false;
  const manifest = `id:${String(paymentId).toLowerCase()};request-id:${requestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  try{
    const expectedBuf = Buffer.from(expected, 'hex');
    const actualBuf = Buffer.from(v1, 'hex');
    return expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);
  }catch{
    return false;
  }
}

export default async function handler(req, res){
  try{
    if(req.method !== 'POST' && req.method !== 'GET'){
      res.status(405).json({ error:'Metodo no permitido.' });
      return;
    }
    if(!process.env.MP_ACCESS_TOKEN) throw new Error('Falta MP_ACCESS_TOKEN.');
    if(!process.env.MP_WEBHOOK_SECRET){
      const error = new Error('Falta MP_WEBHOOK_SECRET en Vercel: sin este secreto no se puede validar que el webhook venga realmente de Mercado Pago.');
      error.status = 501;
      throw error;
    }

    const paymentId = req.query?.['data.id'] || req.query?.id || req.body?.data?.id || req.body?.id;
    if(!paymentId){
      res.status(200).json({ ok:true, ignored:true });
      return;
    }

    const signatureHeader = req.headers?.['x-signature'];
    const requestId = req.headers?.['x-request-id'];
    const validSignature = verifyMercadoPagoSignature({
      signatureHeader,
      requestId,
      paymentId,
      secret: process.env.MP_WEBHOOK_SECRET
    });
    if(!validSignature){
      const error = new Error('Firma de webhook invalida: esta solicitud no viene verificablemente de Mercado Pago.');
      error.status = 401;
      throw error;
    }

    const payment = await getPayment(paymentId);
    if(payment.status !== 'approved'){
      res.status(200).json({ ok:true, status:payment.status });
      return;
    }

    const metadata = payment.metadata || {};
    const uid = metadata.uid || String(payment.external_reference || '').split(':')[0];
    const plan = metadata.plan || String(payment.external_reference || '').split(':')[1] || 'Profesional';
    if(!uid) throw new Error('El pago no trae uid para activar el plan.');

    /* Defensa en profundidad: confirma que el uid corresponda a una cuenta
       real de Firebase Auth antes de escribir en Firestore. create-checkout
       ya solo genera este uid a partir de un ID token verificado (nunca del
       body del cliente), pero esta comprobacion cierra ademas cualquier ruta
       de path-injection si "uid" llegara con "/" u otro caracter fuera de lo
       que Firebase Auth permite como identificador real. */
    const db = getAdminDb();
    try{
      await getAdminAuth().getUser(uid);
    }catch{
      throw new Error('El pago referencia un uid que no existe en Firebase Auth; se descarta la activacion.');
    }
    await db.collection('users').doc(uid).set({
      plan,
      active:true,
      paidProvider:'Mercado Pago',
      paidAt:FieldValue.serverTimestamp(),
      lastPaymentId:String(paymentId),
      updatedAt:FieldValue.serverTimestamp()
    }, { merge:true });

    await db.collection('payments').doc(String(paymentId)).set({
      uid,
      plan,
      provider:'Mercado Pago',
      status:payment.status,
      amount:payment.transaction_amount || 0,
      currency:payment.currency_id || 'MXN',
      rawStatus:payment.status_detail || '',
      createdAt:FieldValue.serverTimestamp()
    }, { merge:true });

    res.status(200).json({ ok:true, uid, plan });
  }catch(err){
    res.status(err.status || 400).json({ error:err.message || 'No se pudo procesar webhook.' });
  }
}
