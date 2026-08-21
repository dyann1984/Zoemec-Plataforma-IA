import { requireAuth } from '../server/api-lib/_authGuard.mjs';

const PLAN_PRICES = {
  Inicial: 399,
  Profesional: 899,
  Empresa: 1899
};

const ORIGIN = process.env.PUBLIC_APP_URL || process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}` || 'http://localhost:5173';

export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.status(405).json({ error:'Metodo no permitido.' });
    return;
  }
  try{
    /* La identidad SIEMPRE viene del ID token verificado, nunca del body: antes
       este endpoint confiaba en el uid/email/name que mandaba el cliente, asi
       que cualquiera podia generar un link de pago que activara el plan sobre
       la cuenta de OTRA persona (el uid del body llegaba intacto hasta
       payment-webhook.mjs y terminaba en db.collection('users').doc(uid)). */
    const authz = await requireAuth(req);
    const { plan='Profesional', method='Mercado Pago' } = req.body || {};
    const uid = authz.uid;
    const email = authz.email;
    const name = authz.name;
    if(!email) throw new Error('Tu cuenta no tiene un correo asociado.');
    if(!PLAN_PRICES[plan]) throw new Error('Plan no valido.');

    if(method !== 'Mercado Pago'){
      throw new Error('Por ahora el endpoint real esta preparado para Mercado Pago.');
    }
    if(!process.env.MP_ACCESS_TOKEN){
      throw new Error('Falta MP_ACCESS_TOKEN en variables de Vercel.');
    }

    const body = {
      items:[{
        title:`ZOEMEC ${plan}`,
        description:`Plan ${plan} de ZOEMEC Plataforma IA`,
        quantity:1,
        unit_price:PLAN_PRICES[plan],
        currency_id:'MXN'
      }],
      payer:{ email, name:name || email },
      metadata:{ uid, email, plan },
      external_reference:`${uid}:${plan}:${Date.now()}`,
      back_urls:{
        success:`${ORIGIN}/?payment=success&plan=${encodeURIComponent(plan)}`,
        failure:`${ORIGIN}/?payment=failure`,
        pending:`${ORIGIN}/?payment=pending`
      },
      notification_url:process.env.MP_WEBHOOK_URL || `${ORIGIN}/api/payment-webhook`,
      auto_return:'approved'
    };

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method:'POST',
      headers:{
        Authorization:`Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'Content-Type':'application/json'
      },
      body:JSON.stringify(body)
    });
    const data = await mpRes.json();
    if(!mpRes.ok) throw new Error(data.message || data.error || 'Mercado Pago rechazo el checkout.');

    res.status(200).json({ id:data.id, url:data.init_point || data.sandbox_init_point });
  }catch(err){
    res.status(err.status || 400).json({ error:err.message || 'No se pudo crear checkout.' });
  }
}
