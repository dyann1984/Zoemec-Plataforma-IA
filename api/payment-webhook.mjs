import { FieldValue, getAdminDb } from './_firebaseAdmin.mjs';

async function getPayment(paymentId){
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers:{ Authorization:`Bearer ${process.env.MP_ACCESS_TOKEN}` }
  });
  const data = await res.json();
  if(!res.ok) throw new Error(data.message || 'No pude verificar el pago.');
  return data;
}

export default async function handler(req, res){
  try{
    if(req.method !== 'POST' && req.method !== 'GET'){
      res.status(405).json({ error:'Metodo no permitido.' });
      return;
    }
    if(!process.env.MP_ACCESS_TOKEN) throw new Error('Falta MP_ACCESS_TOKEN.');

    const paymentId = req.query?.['data.id'] || req.query?.id || req.body?.data?.id || req.body?.id;
    if(!paymentId){
      res.status(200).json({ ok:true, ignored:true });
      return;
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

    const db = getAdminDb();
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
    res.status(400).json({ error:err.message || 'No se pudo procesar webhook.' });
  }
}
