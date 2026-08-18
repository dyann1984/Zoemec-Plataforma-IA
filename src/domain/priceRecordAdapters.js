import {makePriceRecord,PRICE_SOURCE_TYPE} from './apuProfessional.js';
const base=(x={},type)=>makePriceRecord({description:x.description||x.descripcion||'',unit:x.unit||x.unidad||'',originalUnit:x.originalUnit||x.unidadOriginal||x.unit||x.unidad||'',price:x.price??x.precio??x.precioUnitario??0,originalPrice:x.originalPrice??x.precioOriginal??x.price??x.precio??x.precioUnitario??0,conversionFactor:x.conversionFactor||1,currency:x.currency||x.moneda||'MXN',location:x.location||x.ubicacion||{},supplier:x.supplier??x.proveedor??'',sourceName:x.sourceName??x.fuente??'',sourceUrl:x.sourceUrl??x.url??'',sourceType:type,priceDate:x.priceDate??x.fechaPrecio??x.fecha??'',consultedAt:x.consultedAt??x.fechaConsulta??'',confidence:x.confidence??x.confianza??0,verified:type===PRICE_SOURCE_TYPE.VERIFIED&&x.verified===true});
export const priceRecordFromManual=x=>base(x,PRICE_SOURCE_TYPE.USER_PROVIDED);
export const priceRecordFromMarket=x=>base(x,x.verified===true?PRICE_SOURCE_TYPE.VERIFIED:PRICE_SOURCE_TYPE.ESTIMATED);
export const priceRecordFromExcel=x=>base(x,PRICE_SOURCE_TYPE.CATALOG);
export const priceRecordFromCsv=x=>base(x,PRICE_SOURCE_TYPE.CATALOG);
export const priceRecordFromMatrix=x=>base(x,PRICE_SOURCE_TYPE.HISTORICAL);
export const priceRecordFromDocument=x=>base(x,x.userProvided?PRICE_SOURCE_TYPE.USER_PROVIDED:PRICE_SOURCE_TYPE.CATALOG);
export const priceRecordFromAI=x=>base({...x,verified:false},PRICE_SOURCE_TYPE.AI_ESTIMATED);
export const priceRecordFromLegacy=x=>base(x,x.sourceFile?PRICE_SOURCE_TYPE.CATALOG:PRICE_SOURCE_TYPE.ESTIMATED);

/* Price Intelligence real (api/_priceIntelligenceCore.mjs): x trae
   {description, unit, price(=precioRecomendado), references, stats,
   evidenceLevel}. nivelEvidencia ESTIMADO_IA (sin fuentes encontradas) nunca
   se marca VERIFIED -- se conserva como AI_ESTIMATED, igual que un precio
   propuesto por el modelo sin evidencia externa. MERCADO/REFERENCIAL (si hubo
   evidencia real) tampoco se auto-promueven a VERIFIED: ese estado sigue
   reservado para cuando un humano confirma la fuente (ver apuSchema.js). */
export const priceRecordFromMarketIntelligence=x=>{
  const record=base({...x,sourceName:x.references?.[0]?.proveedor||'',sourceUrl:x.references?.[0]?.url||'',priceDate:x.references?.[0]?.fecha||''},PRICE_SOURCE_TYPE.AI_ESTIMATED);
  record.references=Array.isArray(x.references)?x.references:[];
  record.stats=x.stats||null;
  record.evidenceLevel=x.evidenceLevel||'ESTIMADO_IA';
  record.confidence=x.evidenceLevel==='MERCADO'?70:x.evidenceLevel==='REFERENCIAL'?45:0;
  return record;
};
