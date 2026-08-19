import { calcAPUv2, findApuNumericIssuesV2, calcMaterialRow, calcLaborRow, calcEquipmentRow, calcSeguridadRow } from '../lib/apuCalc.js';
import { validateApuSchemaV2, APU_DATA_STATE } from './apuSchema.js';

export const PRICE_SOURCE_TYPE = Object.freeze({
  VERIFIED: 'VERIFIED', HISTORICAL: 'HISTORICAL', USER_PROVIDED: 'USER PROVIDED',
  CATALOG: 'CATALOG', ESTIMATED: 'ESTIMATED', AI_ESTIMATED: 'AI ESTIMATED'
});

const num = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const clamp = value => Math.max(0, Math.min(100, num(value)));
const text = value => String(value ?? '').trim();

export function makePriceRecord(input = {}){
  const originalPrice = Math.max(0, num(input.originalPrice ?? input.price));
  const conversionFactor = Math.max(0, num(input.conversionFactor, 1)) || 1;
  const sourceType = Object.values(PRICE_SOURCE_TYPE).includes(input.sourceType)
    ? input.sourceType : PRICE_SOURCE_TYPE.ESTIMATED;
  return {
    id: text(input.id) || `PR-${Date.now().toString(36).toUpperCase()}`,
    resourceId: text(input.resourceId), description: text(input.description),
    normalizedDescription: text(input.normalizedDescription || input.description).toLowerCase(),
    brand: text(input.brand), model: text(input.model), unit: text(input.unit),
    originalUnit: text(input.originalUnit || input.unit), price: originalPrice / conversionFactor,
    originalPrice, currency: text(input.currency || 'MXN'), location: input.location || {},
    supplier: text(input.supplier), sourceName: text(input.sourceName), sourceUrl: text(input.sourceUrl),
    sourceType, priceDate: text(input.priceDate), consultedAt: text(input.consultedAt),
    confidence: clamp(input.confidence), verified: sourceType === PRICE_SOURCE_TYPE.VERIFIED && Boolean(input.verified),
    // Price Intelligence (busqueda real de mercado, ver api/_priceIntelligenceCore.mjs):
    // referencias individuales encontradas (cada una con su propia presentacion/
    // unidad/factor de conversion/url) y estadisticas (min/mediana/promedio/max/
    // nFuentes) calculadas en codigo, nunca por el modelo. evidenceLevel es la
    // clasificacion determinista (VALIDADO/MERCADO/REFERENCIAL/ESTIMADO_IA) segun
    // src/domain/apuSchema.js#PRICE_EVIDENCE_LEVEL. Vacios/null por defecto: no
    // rompe ningun llamador existente que no busque precios de mercado.
    references: Array.isArray(input.references) ? input.references : [],
    stats: input.stats || null,
    evidenceLevel: text(input.evidenceLevel) || null,
    // Ficha tecnica del recurso (RECURSO -> FICHA TECNICA -> BUSQUEDA ->
    // NORMALIZACION -> VALIDACION DE EQUIVALENCIA -> ESTADISTICA), ver
    // src/lib/technicalMatch.js. null si el precio no vino de Price
    // Intelligence (no rompe ningun llamador existente).
    technicalSpec: input.fichaTecnica || null,
    createdAt: text(input.createdAt) || new Date().toISOString()
  };
}

const ROW_COST_FN = { materials: calcMaterialRow, labor: calcLaborRow, equipment: calcEquipmentRow, seguridad: calcSeguridadRow };

function sourceRows(apu){
  const ctx = { cantidadContractual: num(apu.cantidadObra) };
  return ['materials','labor','equipment','seguridad'].flatMap(kind =>
    (Array.isArray(apu?.[kind]) ? apu[kind] : []).map(row => ({
      kind, row, source: row.fuente || {},
      costoRenglon: Math.max(0, num(ROW_COST_FN[kind]?.(row, ctx)))
    }))
  );
}

function ageMonths(dateValue, now){
  const date = new Date(dateValue);
  if(Number.isNaN(date.getTime())) return null;
  return Math.max(0, (now.getFullYear() - date.getFullYear()) * 12 + now.getMonth() - date.getMonth());
}
function freshnessScore(months){
  if(months === null) return 0;
  return months <= 6 ? 100 : months <= 12 ? 75 : months <= 24 ? 45 : 15;
}

/* Dimension "precios" de la confianza: pondera por COSTO (no por conteo de
   renglones) que fraccion del APU esta respaldada por referencias de mercado
   tecnicamente equivalentes (verdict ALTO, ver src/lib/technicalMatch.js),
   que tan fuerte es esa evidencia en promedio (technicalMatchScore) y que
   tan reciente es. Un renglon en REQUIERE_VALIDACION con 3 referencias ALTO
   pesa mas que uno VERIFICADO sin fecha ni fuente identificable -- la
   cercania al P.U. original del catalogo NUNCA participa aqui (ver Regla 10:
   el catalogo es referencia, no objetivo a alcanzar). */
/* Calidad de evidencia de UN renglon (0-100), independiente de su costo:
   - Catalogo real confirmado (VERIFICADO/IMPORTADO): 100 -- es el precio
     real, no necesita "match" tecnico.
   - Price Intelligence con evidencia ALTO (ver technicalMatch.js): el
     promedio de technicalMatchScore de esas referencias, con bonificacion
     por tener >=3 fuentes (MERCADO) vs 1-2 (REFERENCIAL, se escala 85%).
   - Solo referencias MEDIO/BAJO (ninguna ALTO): 20 -- se intento, no hay
     nada tecnicamente utilizable.
   - Sin evidencia de ningun tipo: 0.
   Despues se ajusta por antiguedad de la fuente (freshness), nunca por
   cercania al P.U. original del catalogo. */
function rowEvidenceQuality(row, source, now){
  if(source.estado === APU_DATA_STATE.VERIFICADO || source.estado === APU_DATA_STATE.IMPORTADO){
    const m = ageMonths(source.fecha || source.priceDate, now);
    return { quality: 100, freshness: m === null ? 60 : freshnessScore(m) };
  }
  const pr = row.priceRecord;
  const referencias = Array.isArray(pr?.references) ? pr.references : [];
  const aceptadas = referencias.filter(r => r.match?.verdict === 'ALTO');
  if(aceptadas.length){
    const avgScore = aceptadas.reduce((s, r) => s + r.match.score, 0) / aceptadas.length;
    const quality = pr.evidenceLevel === 'MERCADO' ? avgScore : avgScore * 0.85;
    const m = ageMonths(aceptadas[0]?.fecha, now);
    return { quality, freshness: m === null ? 50 : freshnessScore(m) };
  }
  if(referencias.length) return { quality: 20, freshness: 30 }; // solo MEDIO/BAJO: se intento, sin evidencia utilizable
  return { quality: 0, freshness: 0 };
}

function pricesDimension(rows, now){
  const totalCost = rows.reduce((s, r) => s + r.costoRenglon, 0);
  if(!(totalCost > 0)){
    // Sin costo (renglon vacio/cero, ej. datos de captura incompletos): cae
    // a un criterio simple basado en conteo, para no dividir entre cero.
    const count = rows.length || 1;
    const identified = rows.filter(({source}) => text(source.proveedor || source.sourceName)).length;
    return clamp((identified / count) * 60);
  }
  let weightedQuality = 0;
  rows.forEach(({row, source, costoRenglon}) => {
    const { quality, freshness } = rowEvidenceQuality(row, source, now);
    const rowScore = quality * 0.8 + freshness * 0.2; // la frescura modula, no domina, la calidad de la fuente
    weightedQuality += (costoRenglon / totalCost) * rowScore;
  });
  return clamp(weightedQuality);
}

export function calculateAPUConfidence(apu = {}, options = {}){
  const now = options.now ? new Date(options.now) : new Date();
  const rows = sourceRows(apu);
  const count = rows.length || 1;
  const labor = Array.isArray(apu.labor) ? apu.labor : [];
  const yieldCoverage = labor.length ? labor.filter(r => num(r.rendimiento) > 0 || num(r.cantidad) > 0).length / labor.length : 0;
  const compositionChecks = [apu.materials?.length, apu.labor?.length, apu.procedimientoConstructivo?.length, apu.controlCalidad?.length, apu.criterioMedicion?.unidadMedicion].filter(Boolean).length;
  const pendingValidation = rows.filter(({source}) => source.estado === APU_DATA_STATE.REQUIERE_VALIDACION).length;
  const dimensions = {
    precios: Math.round(pricesDimension(rows, now)),
    rendimientos: Math.round(clamp(yieldCoverage * 100)),
    cantidades: Math.round(clamp(rows.length ? rows.filter(({row}) => num(row.consumo ?? row.cantidad ?? row.cuadrilla) > 0).length / count * 100 : 0)),
    composicion: Math.round(compositionChecks / 5 * 100)
  };
  const score = Math.round(dimensions.precios * .40 + dimensions.rendimientos * .20 + dimensions.cantidades * .20 + dimensions.composicion * .20);
  return { score, level: score >= 85 ? 'ALTA' : score >= 65 ? 'MEDIA' : 'BAJA', dimensions,
    risks: score >= 85 ? 'BAJOS' : score >= 65 ? 'MEDIOS' : 'ALTOS', pendingValidation };
}

export function validateAPU(apu = {}, options = {}){
  const totals = options.totals || calcAPUv2(apu);
  const issues = [...validateApuSchemaV2(apu), ...findApuNumericIssuesV2(apu, totals)];
  const now = options.now ? new Date(options.now) : new Date();
  sourceRows(apu).forEach(({kind,row,source}, index) => {
    if(!text(source.proveedor || source.sourceName)) issues.push({ code:'price_without_source', kind, index, severity:'warning', message:`${row.clave || kind} no tiene fuente identificable.` });
    const months = ageMonths(source.fecha || source.priceDate, now);
    if(months === null) issues.push({ code:'price_without_date', kind, index, severity:'warning', message:`${row.clave || kind} no tiene fecha de precio.` });
    else if(months > 12) issues.push({ code:'stale_price', kind, index, severity:'warning', message:`${row.clave || kind} tiene un precio de ${months} meses de antiguedad.` });
  });
  if(!(apu.materials || []).length) issues.push({ code:'missing_materials', severity:'warning', message:'El APU no contiene materiales.' });
  if(!(apu.labor || []).length) issues.push({ code:'missing_labor', severity:'error', message:'El APU no contiene mano de obra.' });
  if(!text(apu.unit)) issues.push({ code:'missing_unit', severity:'error', message:'Falta la unidad del concepto.' });
  if(!text(apu.concept)) issues.push({ code:'missing_concept', severity:'error', message:'Falta la descripcion del concepto.' });
  const unique = new Set();
  sourceRows(apu).forEach(({kind,row}, index) => {
    const key = `${kind}:${text(row.clave || row.descripcion).toLowerCase()}`;
    if(unique.has(key)) issues.push({ code:'duplicate_resource', kind, index, severity:'warning', message:`Recurso duplicado: ${row.clave || row.descripcion}.` });
    unique.add(key);
  });
  const hasErrors = issues.some(issue => issue.severity === 'error' || !issue.severity);
  return { status: hasErrors ? 'REQUIERE REVISION' : issues.length ? 'CON OBSERVACIONES' : 'VALIDADO', issues, totals, confidence: calculateAPUConfidence(apu, { now }) };
}

export function finalizeProfessionalAPU(apu = {}, options = {}){
  const normalized=structuredClone(apu);
  const stateType={VERIFICADO:PRICE_SOURCE_TYPE.VERIFIED,IMPORTADO:PRICE_SOURCE_TYPE.CATALOG,ESTIMADO_IA:PRICE_SOURCE_TYPE.AI_ESTIMATED,ASUMIDO:PRICE_SOURCE_TYPE.ESTIMATED,'USER PROVIDED':PRICE_SOURCE_TYPE.USER_PROVIDED};
  for(const kind of ['materials','labor','equipment']) for(const row of normalized[kind]||[]){
    if(row.priceRecord) continue;
    const price=Number(row.precioUnitario??row.salarioBase??row.tarifa??0);
    row.priceRecord=makePriceRecord({description:row.descripcion,price,unit:row.unidad,currency:normalized.moneda||'MXN',supplier:row.fuente?.proveedor||'',sourceName:row.fuente?.sourceName||'',sourceUrl:row.fuente?.sourceUrl||'',sourceType:stateType[row.fuente?.estado]||PRICE_SOURCE_TYPE.ESTIMATED,priceDate:row.fuente?.fecha||'',confidence:row.fuente?.confidence||0,verified:row.fuente?.estado===APU_DATA_STATE.VERIFICADO});
  }
  const validation = validateAPU(normalized, options);
  return { ...normalized, calculated: validation.totals, confidence: validation.confidence,
    warnings: validation.issues, validationStatus: validation.status, validatedAt: new Date().toISOString() };
}
