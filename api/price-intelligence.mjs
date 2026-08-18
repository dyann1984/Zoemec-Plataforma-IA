import { requireFeature } from './_authGuard.mjs';
import { searchMarketReferences } from './_priceIntelligenceCore.mjs';

export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.status(405).json({ error: 'Metodo no permitido.' });
    return;
  }
  try{
    await requireFeature(req, 'ai');
    const { description = '', unit = '', kind = 'materials', location = '', dateBase = '' } = req.body || {};
    const result = await searchMarketReferences({ description, unit, kind, location, dateBase });
    res.status(200).json(result);
  }catch(err){
    res.status(err.status || 400).json({ error: err.message || 'No se pudo consultar precios de mercado.' });
  }
}
