/* Resolucion UNICA del contexto tecnico de generacion de APU (P0 paridad
   ADMIN vs COLLABORATOR). Puro: recibe las capas ya cargadas y decide, de
   forma determinista, que precios ve el motor y de donde salio cada uno.
   La carga desde Firestore vive en server/api-lib/_apuContextResolver.mjs;
   este modulo no conoce Firebase ni roles.

   MODOS
   - organization (default para proyectos de una empresa): capas
     proyecto > empresa > global. El catalogo PERSONAL NO participa salvo
     que se pida explicitamente (includePersonal) -- asi un ADMIN no obtiene
     ventaja silenciosa por datos privados, y el resultado es reproducible
     por cualquier miembro de la empresa (regla 11/12 del encargo).
   - personal (usuario sin organizacion, o proyecto no empresarial):
     personal > global. Es el comportamiento historico intacto.

   INVARIANTE CENTRAL: la salida depende SOLO de las capas y parametros
   recibidos. No existe ningun parametro de rol. Dos miembros de la misma
   empresa que resuelven el mismo proyecto obtienen el mismo contextHash.

   PRECEDENCIA (regla 8): para cada insumo (resolutionKey = descripcion|
   unidad normalizadas) gana la primera capa, en este orden, que tenga un
   precio valido (> 0, misma moneda, region compatible, vigente):
     project -> organization -> personal (si participa) -> global
   Si ninguna capa lo tiene, el insumo simplemente no se envia y la IA lo
   estimara (priceSource 'ai_estimated' en el APU resultante). Dentro de
   una misma capa con dos registros del mismo insumo: el de fecha mas
   reciente, y a igual fecha el de sourceRecordId menor (orden estable). */
import { normalizeText, normalizeUnit, normalizeRegion, resolutionKey } from './orgLibrarySchema.js';

export const CONTEXT_MODE = Object.freeze({ ORGANIZATION: 'organization', PERSONAL: 'personal' });
export const PRICE_SOURCE = Object.freeze({
  PROJECT: 'project', ORGANIZATION: 'organization', PERSONAL: 'personal', GLOBAL: 'global', AI_ESTIMATED: 'ai_estimated'
});
const LAYER_ORDER = Object.freeze([PRICE_SOURCE.PROJECT, PRICE_SOURCE.ORGANIZATION, PRICE_SOURCE.PERSONAL, PRICE_SOURCE.GLOBAL]);
const LAYER_RANK = Object.freeze(Object.fromEntries(LAYER_ORDER.map((l, i) => [l, i])));

export const EXCLUSION_REASON = Object.freeze({
  NO_PRICE: 'NO_PRICE',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  REGION_MISMATCH: 'REGION_MISMATCH',
  EXPIRED: 'EXPIRED',
  ARCHIVED: 'ARCHIVED',
  SHADOWED: 'SHADOWED' // valido, pero una capa de mayor precedencia ya fija ese insumo
});

export const RESOLUTION_WARNING = Object.freeze({
  EMPTY_ORGANIZATION_CATALOG: 'EMPTY_ORGANIZATION_CATALOG',
  EMPTY_CONTEXT: 'EMPTY_CONTEXT',
  MISSING_PROJECT_REGION: 'MISSING_PROJECT_REGION',
  ORGANIZATION_MODE_UNAVAILABLE: 'ORGANIZATION_MODE_UNAVAILABLE'
});
const WARNING_SEVERITY = Object.freeze({
  EMPTY_ORGANIZATION_CATALOG: 'ALTA',
  EMPTY_CONTEXT: 'ALTA',
  MISSING_PROJECT_REGION: 'MEDIA',
  ORGANIZATION_MODE_UNAVAILABLE: 'MEDIA'
});

export const DEFAULT_MAX_MODEL_ROWS = 120; // mismo tope que _openaiApuCore.mjs (catalogSample.slice(0,120))

/* ---------- normalizacion de filas de cualquier capa ---------- */

/* Capas project/organization llegan como entradas de orgLibrary
   ({id, description, code, unit, price, currency, region, date, validUntil,
   status, archivedAt}); personal/global como filas de catalogo
   ({desc, unidad, precio, clave?, fecha?, traceability?}). Aqui ambas se
   llevan a UNA forma comun. */
function normalizeLayerRow(row, source, index){
  const isOrgEntry = row && (row.description !== undefined || row.price !== undefined);
  const description = String(isOrgEntry ? (row.description || row.code || '') : (row?.desc || row?.description || '')).trim();
  const unit = String(isOrgEntry ? row.unit : (row?.unidad ?? row?.unit ?? '')).trim();
  const price = Number(isOrgEntry ? row.price : (row?.precio ?? row?.price));
  const sourceRecordId = String(
    row?.id || row?.traceability?.sourceDocId && `${row.traceability.sourceDocId}#${row.traceability.rowRef ?? index}` || `${source}#${index}`
  );
  return {
    source,
    sourceRecordId,
    key: resolutionKey({ description, unit }),
    desc: description,
    unidad: unit,
    precio: Number.isFinite(price) ? price : 0,
    currency: String(row?.currency || row?.moneda || 'MXN').toUpperCase(),
    region: String(row?.region || '').trim(),
    date: String(row?.date || row?.fecha || row?.traceability?.validatedAt || ''),
    validUntil: row?.validUntil || null,
    archived: Boolean(row?.archivedAt) || row?.status === 'ARCHIVED',
    clave: row?.code || row?.clave || null
  };
}

/* La region del proyecto puede venir como string ("Estado de Mexico") o
   estructurada ({country, state, city}). Se compara contra TODAS sus
   partes normalizadas: un precio marcado "Estado de Mexico" es compatible
   con un proyecto en Toluca, Estado de Mexico. */
export function projectRegionTokens(region){
  if(!region) return [];
  if(typeof region === 'string') return [normalizeRegion(region)].filter(Boolean);
  return [region.city, region.state, region.country, region.label]
    .map(normalizeRegion).filter(Boolean);
}

function exclusionFor(row, { currency, regionTokens, asOf }){
  if(row.archived) return EXCLUSION_REASON.ARCHIVED;
  if(!(row.precio > 0)) return EXCLUSION_REASON.NO_PRICE;
  if(row.currency !== currency) return EXCLUSION_REASON.CURRENCY_MISMATCH;
  if(row.validUntil && String(row.validUntil).slice(0, 10) < String(asOf).slice(0, 10)) return EXCLUSION_REASON.EXPIRED;
  // Region vacia = aplica en cualquier region. Region declarada: debe
  // coincidir con alguna parte de la region del proyecto. Si el proyecto no
  // tiene region, no se puede verificar -> se admite y se avisa aparte
  // (MISSING_PROJECT_REGION), nunca se descarta en silencio.
  if(row.region && regionTokens.length && !regionTokens.includes(normalizeRegion(row.region))) return EXCLUSION_REASON.REGION_MISMATCH;
  return null;
}

function pickWithinLayer(a, b){
  if(a.date !== b.date) return a.date > b.date ? a : b;
  return a.sourceRecordId <= b.sourceRecordId ? a : b;
}

/* Relevancia deterministica frente al concepto: tokens compartidos (>= 3
   letras). Solo decide QUE filas caben en el tope de 120 que ve el modelo;
   nunca cambia el precio ni la precedencia. */
function tokens(text){
  return new Set(normalizeText(text).split(/[^a-z0-9]+/).filter(t => t.length >= 3));
}
function relevance(conceptTokens, desc){
  if(!conceptTokens.size) return 0;
  let n = 0;
  tokens(desc).forEach(t => { if(conceptTokens.has(t)) n++; });
  return n;
}

/* Hash FNV-1a estable (mismo algoritmo que apuGeneration.stableHash) sobre
   las filas resueltas ordenadas -- permite comparar dos contextos (ADMIN vs
   COLLABORATOR) con un solo valor. */
function fnv1a(text){
  let hash = 2166136261;
  for(let i = 0; i < text.length; i++){
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(7, '0');
}

/* ---------- API principal ---------- */

export function resolveApuGenerationContext({
  contextMode = CONTEXT_MODE.ORGANIZATION,
  requestedMode = null,
  includePersonal = false,
  organizationId = null,
  organizationName = null,
  projectId = null,
  region = null,
  currency = 'MXN',
  asOf = null,
  concept = '',
  layers = {},
  organizationLibraryCount = null,
  historicalOrgApuCount = 0,
  historicalOrgApuValidatedCount = 0,
  maxModelRows = DEFAULT_MAX_MODEL_ROWS,
  extraWarnings = []
} = {}){
  const mode = contextMode === CONTEXT_MODE.PERSONAL ? CONTEXT_MODE.PERSONAL : CONTEXT_MODE.ORGANIZATION;
  const personalParticipates = mode === CONTEXT_MODE.PERSONAL || includePersonal === true;
  const asOfDate = asOf || new Date().toISOString().slice(0, 10);
  const regionTokens = projectRegionTokens(region);
  const cur = String(currency || 'MXN').toUpperCase();

  const raw = {
    [PRICE_SOURCE.PROJECT]: mode === CONTEXT_MODE.ORGANIZATION ? (layers.project || []) : [],
    [PRICE_SOURCE.ORGANIZATION]: mode === CONTEXT_MODE.ORGANIZATION ? (layers.organization || []) : [],
    [PRICE_SOURCE.PERSONAL]: personalParticipates ? (layers.personal || []) : [],
    [PRICE_SOURCE.GLOBAL]: layers.global || []
  };

  const excluded = [];
  const validByLayer = {};
  const layerSizes = {};
  for(const source of LAYER_ORDER){
    const rows = (raw[source] || []).map((r, i) => normalizeLayerRow(r, source, i)).filter(r => r.desc && r.unidad);
    layerSizes[source] = rows.length;
    const byKey = new Map();
    rows.forEach(r => {
      const reason = exclusionFor(r, { currency: cur, regionTokens, asOf: asOfDate });
      if(reason){ excluded.push({ key: r.key, source, sourceRecordId: r.sourceRecordId, reason }); return; }
      const prior = byKey.get(r.key);
      byKey.set(r.key, prior ? pickWithinLayer(prior, r) : r);
    });
    validByLayer[source] = byKey;
  }

  // Precedencia entre capas
  const resolvedByKey = new Map();
  const conflicts = [];
  for(const source of LAYER_ORDER){
    validByLayer[source].forEach((row, key) => {
      const winner = resolvedByKey.get(key);
      if(!winner){ resolvedByKey.set(key, row); return; }
      excluded.push({ key, source, sourceRecordId: row.sourceRecordId, reason: EXCLUSION_REASON.SHADOWED, shadowedBy: winner.source });
      if(Math.abs(winner.precio - row.precio) >= 0.005){
        conflicts.push({ key, desc: winner.desc, unidad: winner.unidad, chosen: { source: winner.source, precio: winner.precio, sourceRecordId: winner.sourceRecordId }, other: { source, precio: row.precio, sourceRecordId: row.sourceRecordId } });
      }
    });
  }

  const conceptTokens = tokens(concept);
  const resolved = [...resolvedByKey.values()]
    .map(r => ({ ...r, relevance: relevance(conceptTokens, r.desc) }))
    .sort((a, b) => (b.relevance - a.relevance) || (LAYER_RANK[a.source] - LAYER_RANK[b.source]) || a.key.localeCompare(b.key));

  const catalogForModel = resolved.slice(0, Math.max(0, maxModelRows)).map(r => ({
    desc: r.desc, unidad: r.unidad, precio: r.precio,
    priceSource: r.source, sourceRecordId: r.sourceRecordId, region: r.region || null, date: r.date || null
  }));

  const sourceCounts = Object.fromEntries(LAYER_ORDER.map(s => [s, 0]));
  resolved.forEach(r => { sourceCounts[r.source] += 1; });
  const modelSourceCounts = Object.fromEntries(LAYER_ORDER.map(s => [s, 0]));
  catalogForModel.forEach(r => { modelSourceCounts[r.priceSource] += 1; });

  const excludedCounts = {};
  excluded.forEach(e => { excludedCounts[e.reason] = (excludedCounts[e.reason] || 0) + 1; });

  const warnings = [...(Array.isArray(extraWarnings) ? extraWarnings : [])];
  const warn = (code, message, detail = {}) => warnings.push({ code, severity: WARNING_SEVERITY[code] || 'MEDIA', message, ...detail });
  if(requestedMode === CONTEXT_MODE.ORGANIZATION && mode === CONTEXT_MODE.PERSONAL){
    warn(RESOLUTION_WARNING.ORGANIZATION_MODE_UNAVAILABLE, 'Se pidio contexto de empresa, pero el proyecto no pertenece a una organizacion activa del usuario: se uso contexto personal.');
  }
  if(mode === CONTEXT_MODE.ORGANIZATION && validByLayer[PRICE_SOURCE.ORGANIZATION].size === 0){
    warn(RESOLUTION_WARNING.EMPTY_ORGANIZATION_CATALOG, 'La biblioteca de la empresa no tiene precios validos para esta region/moneda: la IA estimara los insumos que no esten en proyecto o biblioteca global.', { organizationCatalogSize: 0 });
  }
  if(resolved.length === 0){
    warn(RESOLUTION_WARNING.EMPTY_CONTEXT, 'No hay ningun precio de referencia disponible: todos los precios del APU seran estimados por IA y quedaran pendientes de validacion.');
  }
  if(regionTokens.length === 0 && resolved.some(r => r.region)){
    warn(RESOLUTION_WARNING.MISSING_PROJECT_REGION, 'El proyecto no tiene region: no se pudo verificar la region de los precios regionales usados.');
  }

  const contextHash = fnv1a(resolved
    .map(r => `${r.key}|${r.precio.toFixed(4)}|${r.source}|${r.sourceRecordId}`)
    .sort()
    .join('\n'));

  return {
    contextMode: mode,
    requestedMode: requestedMode || null,
    personalIncluded: personalParticipates,
    organizationId: mode === CONTEXT_MODE.ORGANIZATION ? (organizationId || null) : null,
    organizationName: mode === CONTEXT_MODE.ORGANIZATION ? (organizationName || null) : null,
    projectId: projectId || null,
    region: region || null,
    currency: cur,
    asOf: asOfDate,
    // Tamanos por capa (ya normalizados, antes de filtros de validez)
    organizationCatalogSize: layerSizes[PRICE_SOURCE.ORGANIZATION],
    organizationValidCount: validByLayer[PRICE_SOURCE.ORGANIZATION].size,
    projectPriceCount: layerSizes[PRICE_SOURCE.PROJECT],
    personalCatalogSize: layerSizes[PRICE_SOURCE.PERSONAL],
    globalCatalogSize: layerSizes[PRICE_SOURCE.GLOBAL],
    organizationLibraryCount: organizationLibraryCount ?? layerSizes[PRICE_SOURCE.ORGANIZATION] + layerSizes[PRICE_SOURCE.PROJECT],
    historicalOrgApuCount,
    historicalOrgApuValidatedCount,
    resolvedCount: resolved.length,
    sentToModelCount: catalogForModel.length,
    sourceCounts,
    modelSourceCounts,
    excludedCounts,
    excluded,
    conflicts,
    warnings,
    confidencePenalty: warnings.filter(w => w.severity === 'ALTA' || w.severity === 'CRITICA').length * 5,
    contextHash,
    catalogForModel
  };
}

/* Vista compacta y JSON-safe para estampar en el APU (apu.contextDiagnostics)
   y devolver al cliente: sin catalogForModel completo ni la lista entera de
   excluidos (pueden ser cientos), solo conteos + los primeros 20 conflictos. */
export function toContextDiagnostics(ctx, { enrichmentFailed = false, enrichmentError = null } = {}){
  if(!ctx) return null;
  const warnings = [...(ctx.warnings || [])];
  if(enrichmentFailed){
    warnings.push({ code: 'ENRICHMENT_FAILED', severity: 'ALTA', message: `Price Intelligence fallo durante el enriquecimiento. ${enrichmentError ? `Motivo: ${enrichmentError}` : ''}`.trim(), enrichmentError });
  }
  return {
    contextMode: ctx.contextMode,
    requestedMode: ctx.requestedMode,
    personalIncluded: ctx.personalIncluded,
    organizationId: ctx.organizationId,
    organizationName: ctx.organizationName,
    projectId: ctx.projectId,
    region: ctx.region,
    currency: ctx.currency,
    asOf: ctx.asOf,
    organizationCatalogSize: ctx.organizationCatalogSize,
    organizationValidCount: ctx.organizationValidCount,
    projectPriceCount: ctx.projectPriceCount,
    personalCatalogSize: ctx.personalCatalogSize,
    globalCatalogSize: ctx.globalCatalogSize,
    organizationLibraryCount: ctx.organizationLibraryCount,
    historicalOrgApuCount: ctx.historicalOrgApuCount,
    historicalOrgApuValidatedCount: ctx.historicalOrgApuValidatedCount,
    resolvedCount: ctx.resolvedCount,
    sentToModelCount: ctx.sentToModelCount,
    sourceCounts: ctx.sourceCounts,
    modelSourceCounts: ctx.modelSourceCounts,
    excludedCounts: ctx.excludedCounts,
    conflicts: (ctx.conflicts || []).slice(0, 20),
    conflictCount: (ctx.conflicts || []).length,
    warnings,
    confidencePenalty: warnings.filter(w => w.severity === 'ALTA' || w.severity === 'CRITICA').length * 5,
    contextHash: ctx.contextHash,
    enrichmentFailed: Boolean(enrichmentFailed),
    enrichmentError: enrichmentError || null
  };
}

/* El servidor devuelve el diagnostico ya compacto; el cliente solo le suma
   lo que ocurre DESPUES en el navegador (el enriquecimiento de Price
   Intelligence). Nunca recalcula el contexto. */
export function mergeClientDiagnostics(serverDiagnostics, { enrichmentFailed = false, enrichmentError = null } = {}){
  if(!serverDiagnostics) return null;
  const warnings = [...(serverDiagnostics.warnings || []).filter(w => w.code !== 'ENRICHMENT_FAILED')];
  if(enrichmentFailed){
    warnings.push({ code: 'ENRICHMENT_FAILED', severity: 'ALTA', message: `Price Intelligence fallo durante el enriquecimiento. ${enrichmentError ? `Motivo: ${enrichmentError}` : ''}`.trim(), enrichmentError });
  }
  return {
    ...serverDiagnostics,
    warnings,
    enrichmentFailed: Boolean(enrichmentFailed),
    enrichmentError: enrichmentError || null,
    confidencePenalty: warnings.filter(w => w.severity === 'ALTA' || w.severity === 'CRITICA').length * 5
  };
}

/* Aplica la penalizacion de contexto a la confianza YA calculada por el
   Confidence Engine (finalizeProfessionalAPU la recalcula, por eso debe ir
   despues). Explicita y trazable: conserva el puntaje original. Mismo
   contexto -> misma penalizacion, sin importar quien genero. */
export function applyContextConfidencePenalty(confidence, penalty){
  const p = Math.max(0, Number(penalty) || 0);
  if(!p) return confidence;
  if(typeof confidence === 'number') return Math.max(0, confidence - p);
  if(confidence && typeof confidence === 'object' && Number.isFinite(Number(confidence.score))){
    const score = Math.max(0, Number(confidence.score) - p);
    return {
      ...confidence,
      scoreBeforeContextPenalty: Number(confidence.score),
      contextPenalty: p,
      score,
      level: score >= 85 ? 'ALTA' : score >= 65 ? 'MEDIA' : 'BAJA'
    };
  }
  return confidence;
}

/* Campos del contexto que DEBEN coincidir entre dos miembros de la misma
   empresa que resuelven el mismo proyecto. Excluye a proposito lo que es
   legitimamente individual (personalCatalogSize cuando el personal no
   participa, userScope). */
export const PARITY_FIELDS = Object.freeze([
  'contextMode', 'organizationId', 'projectId', 'currency',
  'organizationCatalogSize', 'organizationValidCount', 'projectPriceCount', 'globalCatalogSize',
  'organizationLibraryCount', 'historicalOrgApuCount', 'historicalOrgApuValidatedCount',
  'resolvedCount', 'sentToModelCount', 'contextHash'
]);

export function compareContextParity(a, b){
  const diffs = PARITY_FIELDS
    .filter(f => JSON.stringify(a?.[f] ?? null) !== JSON.stringify(b?.[f] ?? null))
    .map(f => ({ field: f, a: a?.[f] ?? null, b: b?.[f] ?? null }));
  const codes = x => (x?.warnings || []).map(w => w.code).sort().join(',');
  if(codes(a) !== codes(b)) diffs.push({ field: 'warnings', a: codes(a), b: codes(b) });
  return { equivalent: diffs.length === 0, diffs };
}

/* Marca en el APU devuelto por la IA de donde salio el precio de cada
   renglon (regla 8: priceSource + sourceRecordId). Un renglon cuyo
   (descripcion, unidad) coincide con una fila del catalogo enviado Y cuyo
   precio es igual -> esa fuente. Si coincide la identidad pero el precio
   difiere, o no coincide -> 'ai_estimated' (nunca se atribuye a la empresa
   un precio que la IA cambio). Soporta renglones v1 (arreglos) y v2
   (objetos). Devuelve un APU nuevo; nunca muta. */
const ROW_FIELDS_V2 = Object.freeze({ desc: ['descripcion', 'desc', 'nombre'], unit: ['unidad', 'unit'], price: ['precioUnitario', 'precio', 'salarioBase', 'tarifa', 'costo'] });
function readField(row, names){
  for(const n of names){ if(row?.[n] !== undefined && row?.[n] !== null && row?.[n] !== '') return row[n]; }
  return undefined;
}
function sourceFor(desc, unit, price, index){
  const hit = index.get(resolutionKey({ description: desc, unit }));
  if(hit && Math.abs(Number(price) - hit.precio) < 0.005){
    return { priceSource: hit.priceSource, sourceRecordId: hit.sourceRecordId };
  }
  return { priceSource: PRICE_SOURCE.AI_ESTIMATED, sourceRecordId: null };
}
/* Etiqueta de evidencia por capa. Un renglon cuyo precio salio de una
   biblioteca queda con estado BIBLIOTECA (el mismo que ya usa
   apuGeneration.js para un match real de catalogo sin validacion humana):
   nunca VERIFICADO -- ese estado sigue exigiendo la validacion humana
   existente. Asi el Confidence Engine (apuProfessional.js) pondera la
   evidencia real igual para cualquier miembro de la empresa. */
const SOURCE_LABEL = Object.freeze({
  project: 'Precio de proyecto', organization: 'Biblioteca empresarial',
  personal: 'Catalogo personal', global: 'Biblioteca global ZOEMEC'
});
function withLibraryEvidence(row, src){
  if(src.priceSource === PRICE_SOURCE.AI_ESTIMATED) return { ...row, priceSource: src.priceSource, sourceRecordId: null };
  const fuente = row.fuente && typeof row.fuente === 'object' ? row.fuente : {};
  return {
    ...row,
    priceSource: src.priceSource,
    sourceRecordId: src.sourceRecordId,
    fuente: {
      ...fuente,
      estado: fuente.estado === 'VERIFICADO' ? 'VERIFICADO' : 'BIBLIOTECA',
      sourceName: fuente.sourceName || `${SOURCE_LABEL[src.priceSource]} (${src.sourceRecordId})`,
      priceSource: src.priceSource,
      sourceRecordId: src.sourceRecordId
    }
  };
}
export function annotateApuPriceSources(apu, catalogForModel = []){
  if(!apu || typeof apu !== 'object') return apu;
  const index = new Map((catalogForModel || []).map(r => [resolutionKey({ description: r.desc, unit: r.unidad }), r]));
  const next = { ...apu };
  const summary = Object.fromEntries([...LAYER_ORDER, PRICE_SOURCE.AI_ESTIMATED].map(s => [s, 0]));
  for(const kind of ['materials', 'labor', 'equipment', 'consumables', 'seguridad']){
    const rows = Array.isArray(apu[kind]) ? apu[kind] : null;
    if(!rows) continue;
    next[kind] = rows.map(row => {
      let desc, unit, price;
      if(Array.isArray(row)){ desc = row[0]; unit = row[2]; price = row[3]; }
      else { desc = readField(row, ROW_FIELDS_V2.desc); unit = readField(row, ROW_FIELDS_V2.unit); price = readField(row, ROW_FIELDS_V2.price); }
      const src = sourceFor(desc, unit, price, index);
      summary[src.priceSource] += 1;
      return Array.isArray(row) ? row : withLibraryEvidence(row, src);
    });
    if(rows.some(Array.isArray)){
      // Renglones v1 (arreglos posicionales): la fuente va en un arreglo
      // paralelo para no romper el contrato [desc, cant, unidad, precio, ...].
      next.priceSourceByRow = next.priceSourceByRow || {};
      next.priceSourceByRow[kind] = rows.map(row => Array.isArray(row) ? sourceFor(row[0], row[2], row[3], index) : null);
    }
  }
  next.priceSourceSummary = summary;
  return next;
}
