import { calcAPUv2, findApuNumericIssuesV2, calcMaterialRow, calcLaborRow, calcEquipmentRow, calcConsumableRow, calcSeguridadRow } from '../lib/apuCalc.js';
import { validateApuSchemaV2, APU_DATA_STATE } from './apuSchema.js';
import { runTechnicalQualityRules } from './technicalQualityRules.js';

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

const ROW_COST_FN = { materials: calcMaterialRow, labor: calcLaborRow, equipment: calcEquipmentRow, consumables: calcConsumableRow, seguridad: calcSeguridadRow };

function sourceRows(apu){
  const ctx = { cantidadContractual: num(apu.cantidadObra) };
  return ['materials','labor','equipment','consumables','seguridad'].flatMap(kind =>
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
  const materialsRows = Array.isArray(apu.materials) ? apu.materials : [];
  // Cobertura de rendimiento (motor universal): cuando un renglon declara
  // yieldConfidence (ver crewModel.js -- la ruta determinista y la de IA ya
  // lo hacen), se pesa por esa confianza real en vez de un binario "existe
  // rendimiento = 100%". Un rendimiento de relleno (fallback generico,
  // yieldConfidence muy bajo) YA NO cuenta como si fuera tan confiable como
  // uno calibrado contra la Biblioteca ZOEMEC. Renglones sin yieldConfidence
  // (APUs anteriores a este cambio, o capturados a mano) conservan el
  // comportamiento binario de siempre -- nunca se penaliza retroactivamente
  // un dato que nunca declaro su procedencia.
  const yieldCoverage = labor.length
    ? labor.reduce((s, r) => s + (r.yieldConfidence != null ? clamp(r.yieldConfidence) : (num(r.rendimiento) > 0 || num(r.cantidad) > 0 ? 100 : 0)), 0) / labor.length / 100
    : 0;
  const compositionChecks = [apu.materials?.length, apu.labor?.length, apu.procedimientoConstructivo?.length, apu.controlCalidad?.length, apu.criterioMedicion?.unidadMedicion].filter(Boolean).length;
  const pendingValidation = rows.filter(({source}) => source.estado === APU_DATA_STATE.REQUIERE_VALIDACION).length;
  // Motor universal de APUs: confianza de 8 dimensiones (comprension del
  // concepto, clasificacion, materiales, mano de obra, rendimiento, precio,
  // evidencia de mercado, especificaciones) en vez de un numero fijo por
  // tipo (ver constructionSystems.js -- antes TPL_META traia confidence:45
  // fijo para "generico" sin relacion con la calidad real del recurso).
  // "Precio" y "Rendimiento" ya existian como dimensions.precios/rendimientos
  // (se reusan, no se duplican); las 6 restantes son nuevas.
  const qaIssues = runTechnicalQualityRules(apu);
  const hasCriticalQaFailure = qaIssues.some(i => i.severity === 'error');
  const comprensionConceptoPct = apu.classificationMatch === 'exact' ? 95
    : apu.classificationMatch === 'score' ? 55
    : apu.classificationMatch === 'generico' ? 20
    : text(apu.concept).length > 10 ? 75 : 30; // sin clasificacion conocida (ej. IA): neutral, ni penaliza ni premia
  const clasificacionPct = apu.classificationMatch === 'exact' ? 100
    : apu.classificationMatch === 'score' ? 50
    : apu.classificationMatch === 'generico' ? 0
    : 70;
  const materialesPct = materialsRows.length
    ? clamp(materialsRows.filter(r => text(r.fuente?.proveedor || r.fuente?.sourceName) || (Array.isArray(r.priceRecord?.references) && r.priceRecord.references.length)).length / materialsRows.length * 100)
    : (apu.primaryActivity ? 60 : 0); // disciplina sin materiales propios (ej. acarreo manual): neutral, no es un defecto
  const manoDeObraPct = labor.length
    ? clamp(labor.filter(r => text(r.descripcion) && (num(r.cuadrilla) > 0 || num(r.cantidad) > 0)).length / labor.length * 100)
    : 0;
  const especificacionesFields = ['distance','volume','pieceCount','dimensions','thickness','depth','height','diameter','weight','strength','materialGrade','dosage'];
  const especificacionesCount = especificacionesFields.filter(f => {
    const v = apu.variables?.[f];
    return Array.isArray(v) ? v.length > 0 : v != null;
  }).length;
  const especificacionesPct = clamp(especificacionesCount / especificacionesFields.length * 100);
  // Bono por rendimiento validado por un humano (ver src/domain/apuReview.js
  // #applyRendimientoDecision): NUNCA resta -- un renglon sin rendimientoFuente
  // (todo el historial previo a esta fase) se comporta exactamente igual que
  // antes. Solo sube la dimension "rendimientos" cuando TODOS los renglones de
  // mano de obra ya fueron confirmados por un humano (RENDIMIENTO_FUENTE.VALIDADO).
  const rendimientoValidadoBonus = labor.length && labor.every(r => r.rendimientoFuente === 'VALIDADO') ? 5 : 0;
  // Cobertura de fuentes (Fase 8 requisito 8): que fraccion del COSTO tiene
  // *algun* rastro de procedencia (proveedor/sourceName identificado, o al
  // menos un intento de busqueda de precio de mercado registrado) -- mide
  // trazabilidad, no calidad tecnica de esa evidencia (eso ya lo pesa
  // "precios" arriba). Puramente presentacional, no entra en `score`.
  const totalCostForCoverage = rows.reduce((s, r) => s + r.costoRenglon, 0);
  const coberturaFuentesPct = totalCostForCoverage > 0
    ? clamp(rows.reduce((s, r) => s + (r.costoRenglon / totalCostForCoverage) * (text(r.source.proveedor || r.source.sourceName) || (Array.isArray(r.row.priceRecord?.references) && r.row.priceRecord.references.length) ? 100 : 0), 0))
    : clamp(rows.length ? rows.filter(r => text(r.source.proveedor || r.source.sourceName)).length / count * 100 : 0);
  const dimensions = {
    precios: Math.round(pricesDimension(rows, now)),
    rendimientos: Math.round(clamp(yieldCoverage * 100 + rendimientoValidadoBonus)),
    cantidades: Math.round(clamp(rows.length ? rows.filter(({row}) => num(row.consumo ?? row.cantidad ?? row.cuadrilla) > 0).length / count * 100 : 0)),
    composicion: Math.round(compositionChecks / 5 * 100),
    // 8 dimensiones (motor universal): las 4 de arriba ya alimentan `score`
    // (sin cambios, para no alterar APUs ya calculados); las 6 siguientes
    // son informativas, se muestran pero no entran a la formula de `score`.
    comprensionConcepto: Math.round(comprensionConceptoPct),
    clasificacion: Math.round(clasificacionPct),
    materiales: Math.round(materialesPct),
    manoDeObra: Math.round(manoDeObraPct),
    evidenciaMercado: Math.round(coberturaFuentesPct),
    especificaciones: Math.round(especificacionesPct)
  };
  let score = Math.round(dimensions.precios * .40 + dimensions.rendimientos * .20 + dimensions.cantidades * .20 + dimensions.composicion * .20);
  // Una falla critica de QA tecnico (ej. "acero sin acero") limita el techo
  // de la confianza global: nunca se promedia con el resto de dimensiones
  // como si el problema no existiera (spec: "Una falla crítica debe limitar
  // la confianza global").
  if(hasCriticalQaFailure) score = Math.min(score, 40);
  return { score, level: score >= 85 ? 'ALTA' : score >= 65 ? 'MEDIA' : 'BAJA', dimensions,
    risks: score >= 85 ? 'BAJOS' : score >= 65 ? 'MEDIOS' : 'ALTOS', pendingValidation,
    // Presentacion re-etiquetada (Fase 8 requisito 8): el mismo puntaje se
    // reencuadra como "confianza de DATOS" (trazabilidad/evidencia), nunca
    // como "exactitud del precio final" -- ver Regla 10, la cercania al P.U.
    // original del catalogo NUNCA participa en ningun puntaje de este modulo.
    presentation: {
      etiqueta: 'Confianza de datos (trazabilidad y evidencia) -- no es una medida de exactitud del precio final.',
      confianzaTecnica: dimensions.composicion,
      confianzaPrecios: dimensions.precios,
      confianzaRendimientos: dimensions.rendimientos,
      coberturaFuentes: Math.round(coberturaFuentesPct)
    } };
}

export function validateAPU(apu = {}, options = {}){
  const totals = options.totals || calcAPUv2(apu);
  // runTechnicalQualityRules (motor universal, ver technicalQualityRules.js):
  // reglas semanticas por disciplina ("acero sin acero" y equivalentes),
  // derivadas del registro extensible de sistemas constructivos -- se omite
  // en silencio (arreglo vacio) para un APU sin primaryActivity conocido.
  const issues = [...validateApuSchemaV2(apu), ...findApuNumericIssuesV2(apu, totals), ...runTechnicalQualityRules(apu)];
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
  // Cantidad de obra en cero (punto 23 del spec del usuario: "cantidades
  // cero" debe detectarse explicitamente). validateApuSchemaV2 solo rechaza
  // negativos; un 0 es numericamente valido pero significa que nadie
  // capturo la cantidad real todavia -- un presupuesto no puede construirse
  // sobre un total de $0 por cantidad, aunque el precio unitario si exista.
  if(!(Number(apu.cantidadObra) > 0)) issues.push({ code:'zero_cantidad_obra', severity:'warning', message:'La cantidad de obra es cero o no se ha capturado: el importe total de esta partida sera $0 hasta que se indique.' });
  const unique = new Set();
  sourceRows(apu).forEach(({kind,row}, index) => {
    const key = `${kind}:${text(row.clave || row.descripcion).toLowerCase()}`;
    if(unique.has(key)) issues.push({ code:'duplicate_resource', kind, index, severity:'warning', message:`Recurso duplicado: ${row.clave || row.descripcion}.` });
    unique.add(key);
  });
  const hasErrors = issues.some(issue => issue.severity === 'error' || !issue.severity);
  return { status: hasErrors ? 'REQUIERE REVISION' : issues.length ? 'CON OBSERVACIONES' : 'VALIDADO', issues, totals, confidence: calculateAPUConfidence(apu, { now }) };
}

/* Guard de exportacion (RC8 -- causa raiz real: "Descargar Excel" del editor
   de UN SOLO APU exporta professionalApu tal cual esta en pantalla; si el
   usuario nunca genero/cargo un concepto en ESE panel durante la sesion
   (ej. volvio al proyecto solo a revisar la Bandeja, que lee directo de
   `apus` sin tocar apuV2), professionalApu sigue siendo el APU vacio por
   defecto -- concept="", 0 materiales/mano de obra/equipo, PU=$0. Eso nunca
   fue una corrupcion del pipeline de generacion/persistencia: es el mismo
   patron ya conocido de "boton de un solo APU" (ver
   describeAmbiguousSingleExport, src/domain/apuWorkspace.js), pero aqui NO
   hay ninguna ambiguedad de catalogo que advertir -- el APU sencillamente
   nunca se lleno. Diferencia explicita con "REQUIERE REVISION" (ver
   validateAPU arriba): un APU con datos reales pero precios sin fuente,
   fechas viejas o renglones duplicados SIGUE siendo exportable (requiere
   revision humana, no esta vacio). Solo bloquea lo que es literalmente
   imposible de convertir en un documento util. */
export function isStructurallyEmptyApu(apu = {}){
  const concept = text(apu?.concept);
  if(!concept) return true;
  const rowCount = (apu?.materials?.length || 0) + (apu?.labor?.length || 0) + (apu?.equipment?.length || 0) + (apu?.consumables?.length || 0) + (apu?.seguridad?.length || 0);
  return rowCount === 0;
}

export function finalizeProfessionalAPU(apu = {}, options = {}){
  const normalized=structuredClone(apu);
  const stateType={VERIFICADO:PRICE_SOURCE_TYPE.VERIFIED,IMPORTADO:PRICE_SOURCE_TYPE.CATALOG,ESTIMADO_IA:PRICE_SOURCE_TYPE.AI_ESTIMATED,ASUMIDO:PRICE_SOURCE_TYPE.ESTIMATED,'USER PROVIDED':PRICE_SOURCE_TYPE.USER_PROVIDED};
  for(const kind of ['materials','labor','equipment','consumables']) for(const row of normalized[kind]||[]){
    if(row.priceRecord) continue;
    const price=Number(row.precioUnitario??row.salarioBase??row.tarifa??0);
    row.priceRecord=makePriceRecord({description:row.descripcion,price,unit:row.unidad,currency:normalized.moneda||'MXN',supplier:row.fuente?.proveedor||'',sourceName:row.fuente?.sourceName||'',sourceUrl:row.fuente?.sourceUrl||'',sourceType:stateType[row.fuente?.estado]||PRICE_SOURCE_TYPE.ESTIMATED,priceDate:row.fuente?.fecha||'',confidence:row.fuente?.confidence||0,verified:row.fuente?.estado===APU_DATA_STATE.VERIFICADO});
  }
  const validation = validateAPU(normalized, options);
  return { ...normalized, calculated: validation.totals, confidence: validation.confidence,
    warnings: validation.issues, validationStatus: validation.status, validatedAt: new Date().toISOString() };
}
