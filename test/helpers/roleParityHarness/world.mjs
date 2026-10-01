/* F1/P0 -- Mundo controlado para paridad por rol (ADMIN/MANAGER/COLLABORATOR).
   Requiere que hooks.mjs este registrado ANTES de importar este modulo
   (ver test/f1RoleParity.e2e.test.mjs): sustituye SOLO la infraestructura
   (Firebase Admin/Client -> memoria). Todo lo demas es codigo real del repo:
   api/generate-apu.mjs, api/price-intelligence.mjs, api/gateway.mjs,
   _authGuard.mjs (plan + rate limit), _apuContextResolver.mjs,
   _priceIntelligenceCache.mjs, apiClient.js, generateApuForConcepto.js,
   materialPriceIntelligence2.js, finalizeProfessionalAPU, calcAPUv2.
   OpenAI se sustituye por respuestas deterministas: nunca hay red real. */
import { createMemDb } from './memdb.mjs';

process.env.OPENAI_API_KEY = 'sk-harness-fake-never-sent';
delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

export const H = globalThis.__HARNESS = globalThis.__HARNESS || { db: null, tokens: {}, currentToken: null, role: null, log: [], openai: { chat: 0, responses: 0 } };

/* ---------- Reloj controlable (ventanas de rate limit) ---------- */
const realNow = Date.now.bind(Date);
let clockOffsetMs = 0;
Date.now = () => realNow() + clockOffsetMs;
export function advanceClock(ms){ clockOffsetMs += ms; }
export function resetClock(){ clockOffsetMs = 0; }

/* ---------- OpenAI determinista ---------- */
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export const TARGET = 'Muro de block hueco de 12 cm asentado con mortero cemento-arena 1:5, acabado comun';
const RECIPE_TARGET = {
  materials: [['Block hueco de concreto 12x20x40', 12.5, 'pza', 16, 3], ['Cemento gris CPC 30R saco 50 kg', 0.18, 'saco', 260, 3], ['Arena de rio', 0.03, 'm³', 480, 5], ['Agua potable', 0.01, 'm³', 40, 0], ['Varilla corrugada 3/8 pulgada', 0.8, 'kg', 28, 3]],
  labor: [['Oficial albañil', 0.08, 'jor', 700, 1.7], ['Ayudante general', 0.08, 'jor', 450, 1.7]],
  equipment: [['Revolvedora 1 saco', 0.02, 'dia', 650]],
  seguridad: [['Casco de seguridad', 2, 'pza', 180]]
};
function fillerRecipe(concept){
  const k = norm(concept).replace(/[^a-z0-9]/g, '').slice(-10);
  return {
    materials: Array.from({ length: 6 }, (_, i) => [`Material ${k} ${i}`, 1, 'pza', 50 + i, 3]),
    labor: [[`Oficio ${k}`, 0.1, 'jor', 600, 1.7]],
    equipment: [[`Equipo ${k}`, 0.02, 'dia', 500]],
    seguridad: [[`EPP ${k}`, 1, 'pza', 100]]
  };
}
function stubChat(body){
  const text = (body.messages || []).map(m => m.content).join('\n');
  const concept = (text.match(/CONCEPTO ORIGINAL, NO LO CAMBIES DE TEMA:\n([^\n]+)/) || [])[1]?.trim() || '';
  const catalog = JSON.parse((text.match(/CATALOGO DISPONIBLE[^\n]*\n(\[[^\n]*\])/) || [])[1] || '[]');
  const idx = new Map(catalog.map(c => [`${norm(c.desc)}|${norm(c.unidad)}`, Number(c.precio)]));
  const recipe = norm(concept) === norm(TARGET) ? RECIPE_TARGET : fillerRecipe(concept);
  const price = (d, u, est) => idx.get(`${norm(d)}|${norm(u)}`) ?? est;
  const mat = recipe.materials.map(([d, q, u, p, m]) => [d, q, u, price(d, u, p), m]);
  const lab = recipe.labor.map(([d, q, u, p, f]) => [d, q, u, price(d, u, p), f]);
  const eq = recipe.equipment.map(([d, q, u, p]) => [d, q, u, price(d, u, p)]);
  const seg = recipe.seguridad.map(([d, q, u, p]) => [d, q, u, p]);
  const apu = {
    concept, unit: 'm2', family: 'Albañileria', confidence: 80, sat: '72141100',
    materials: mat, materialSources: mat.map(() => ({ proveedor: null, region: null, integracion: 'POR_UNIDAD_OBRA' })),
    labor: lab, laborDetails: lab.map(() => ({ cuadrilla: 1, rendimiento: 12.5, jornada: 8 })),
    equipment: eq, equipmentDetails: eq.map(() => ({ integracion: 'POR_JORNADA', rendimientoDiario: 12.5, vidaUtilDias: null, factorUso: null, modalidad: 'renta_jornada' })),
    seguridad: seg, seguridadDetails: seg.map(() => ({ integracion: 'AMORTIZABLE', rendimientoDiario: 12.5, vidaUtilDias: 180, factorReposicion: 1 })),
    consumables: [], consumableSources: [],
    procedimientoConstructivo: ['Trazo', 'Asentado', 'Limpieza'],
    controlCalidad: [{ especificacion: 'Plomo', criterio: '±3 mm' }],
    criterioMedicion: { criterio: 'Se mide el area neta ejecutada', formaPago: 'Por m2 terminado', incluye: ['materiales'], excluye: ['acabados'] },
    technicalJustifications: { materials: 'x', labor: 'x', equipment: 'x', smallTools: 'x', consumables: 'NO APLICA -- no se identificaron consumibles independientes para este procedimiento.', safety: 'x' },
    herramienta: 3, indCampo: 8, indOficina: 7, finance: 2, utility: 10, cargos: 0.5, iva: 16,
    confidenceBreakdown: { precios: 70, rendimientos: 70, cantidades: 70, composicion: 70 }, notes: ['arnes']
  };
  return { choices: [{ message: { content: JSON.stringify(apu) } }] };
}
// Precio de mercado deliberadamente DISTINTO del precio usado: si el
// enriquecimiento reemplazara precios, T5 lo detectaria.
const MARKET = { 'block hueco de concreto 12x20x40': 15.2, 'cemento gris cpc 30r saco 50 kg': 245, 'arena de rio': 455, 'agua potable': 38, 'varilla corrugada 3/8 pulgada': 26.5, 'oficial albanil': 680, 'ayudante general': 440, 'revolvedora 1 saco': 620, 'casco de seguridad': 175 };
function stubResponses(body){
  const input = String(body.input || '');
  const desc = (input.match(/descripcion:\n"([^"]*)"/) || [])[1] || '';
  const unit = (input.match(/unidad requerida para el calculo: ([^)]+)\)/) || [])[1] || '';
  const p = MARKET[norm(desc)] ?? 100;
  const kw = desc.split(/\s+/)[0];
  const refs = [0.97, 1, 1.03].map((f, i) => ({ proveedor: `Proveedor QA ${i}`, url: `https://qa.example/${i}`, precioOriginal: +(p * f).toFixed(2), presentacionOriginal: unit, unidadOriginal: unit, factorConversion: 1, precioNormalizado: +(p * f).toFixed(2), fecha: '2026-09-01', tipoProducto: desc, dimension: null, material: null, contextoUso: null, presentacionComparable: true, nivelCobertura: 'estado', tipoFuenteSalarial: 'tabulador_construccion' }));
  return { output_text: JSON.stringify({ fichaTecnica: { familia: 'QA', uso: '', material: null, dimensiones: null, capacidad: null, keywordsObligatorias: [kw], keywordsExcluyentes: [] }, referencias: refs }) };
}

/* ---------- Router HTTP -> handlers reales ---------- */
const REPO = new URL('../../../', import.meta.url).href;
const handlers = {
  '/api/generate-apu': (await import(REPO + 'api/generate-apu.mjs')).default,
  '/api/price-intelligence': (await import(REPO + 'api/price-intelligence.mjs')).default
};
const gateway = (await import(REPO + 'api/gateway.mjs')).default;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const jsonRes = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  if(u.startsWith('https://api.openai.com/v1/chat/completions')){ H.openai.chat++; return jsonRes(stubChat(JSON.parse(init.body))); }
  if(u.startsWith('https://api.openai.com/v1/responses')){ H.openai.responses++; return jsonRes(stubResponses(JSON.parse(init.body))); }
  if(!u.startsWith('/api/')) throw new Error(`HARNESS: red externa bloqueada (${u})`);
  const [path, qs] = u.split('?');
  const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const body = init.body ? JSON.parse(init.body) : {};
  const req = { method: init.method || 'GET', url: u, headers, body, query: Object.fromEntries(new URLSearchParams(qs || '')) };
  const res = { statusCode: 200, body: null, status(c){ this.statusCode = c; return this; }, json(b){ this.body = b; return this; }, setHeader(){}, end(){ return this; } };
  await (handlers[path] || gateway)(req, res);
  H.log.push({ role: H.role, path, action: body.action || null, desc: body.description || body.concept || null, status: res.statusCode, error: res.statusCode >= 400 ? res.body?.error : null, retryAfterSeconds: res.body?.retryAfterSeconds ?? null });
  return jsonRes(res.body ?? {}, res.statusCode);
};

export const { generateApuForConcepto } = await import(REPO + 'src/features/catalogo/generateApuForConcepto.js');
export const { resetSharedPriceCache } = await import(REPO + 'src/domain/intelligence2Runtime.js');
export const { calcAPUv2 } = await import(REPO + 'src/lib/apuCalc.js');
export const { requireFeature, requireSuperAdmin } = await import(REPO + 'server/api-lib/_authGuard.mjs');
export const { apiPost } = await import(REPO + 'src/services/apiClient.js');

/* ---------- Mundo ---------- */
export const ROLES = {
  SUPERADMIN: { uid: 'SA-1', email: 'sa@harness.test', super_admin: true, member: 'company_manager' },
  MANAGER: { uid: 'MGR-1', email: 'mgr@harness.test', member: 'company_manager' },
  COLLABORATOR: { uid: 'COL-1', email: 'col@harness.test', member: 'collaborator' }
};
export const PROJECT = { id: 'P-1', ownerUid: 'MGR-1', organizationId: 'ORG-1', name: 'Casa QA', locationCountry: 'MX', locationState: 'Estado de México', locationCity: 'Toluca', moneda: 'MXN' };

export function seedWorld(){
  const seed = {
    'organizations/ORG-1': { id: 'ORG-1', name: 'Constructora QA', status: 'CONVERTED' },
    'projects/P-1': PROJECT,
    'library/GLOBAL-1': { id: 'GLOBAL-1', visibility: 'global', name: 'Tabulador global', contentInsumos: [{ desc: 'Agua potable', unidad: 'm³', precio: 38 }], insumosReview: [{ index: 0, state: 'VALIDADO', validatedBy: 'qa', validatedAt: '2026-05-01' }] }
  };
  for(const r of Object.values(ROLES)){
    seed[`organizations/ORG-1/members/${r.uid}`] = { uid: r.uid, role: r.member, status: 'active' };
    seed[`users/${r.uid}`] = { uid: r.uid, email: r.email, organizationId: 'ORG-1', plan: 'Gratis', role: 'user', active: true };
    H.tokens[`tok-${r.uid}`] = { uid: r.uid, email: r.email, email_verified: true, ...(r.super_admin ? { super_admin: true } : {}) };
  }
  [['Cemento gris CPC 30R saco 50 kg', 'saco', 239], ['Arena de rio', 'm³', 450], ['Block hueco de concreto 12x20x40', 'pza', 14.5], ['Oficial albañil', 'jor', 650], ['Ayudante general', 'jor', 430], ['Revolvedora 1 saco', 'dia', 600]]
    .forEach(([d, u, p], i) => { seed[`orgLibrary/OLIB-${i}`] = { id: `OLIB-${i}`, organizationId: 'ORG-1', projectId: null, type: 'material', code: '', description: d, unit: u, price: p, currency: 'MXN', region: '', source: 'Cotizacion QA', date: '2026-09-01', validUntil: null, status: 'ACTIVE', archivedAt: null }; });
  H.db = createMemDb(seed);
  H.log = [];
  resetClock();
  return H.db;
}

/* Un "navegador" nuevo por rol: token del rol + cache de sesion vacio. */
export function asRole(role, { newBrowser = true } = {}){
  H.role = role; H.currentToken = `tok-${ROLES[role].uid}`;
  if(newBrowser) resetSharedPriceCache();
}
export const concepto = (concept, i = 0, qty = 50) => ({ id: `CON-${i}`, concept, unit: 'm2', qty, referencePU: 0, projectId: 'P-1' });

const PRICE_FIELDS = { materials: 'precioUnitario', labor: 'salarioBase', equipment: 'tarifa', seguridad: 'precioUnitario', consumables: 'precioUnitario' };
export const ECONOMIC_FIELDS = ['precioUnitario', 'salarioBase', 'tarifa', 'consumo', 'cantidad', 'desperdicioPct', 'cuadrilla', 'rendimiento', 'rendimientoDiario', 'fsr', 'vidaUtilDias'];

export function summarize(out, logSlice){
  const apu = out.apu;
  const c = calcAPUv2(apu);
  const rows = [];
  for(const [kind, f] of Object.entries(PRICE_FIELDS)) (apu[kind] || []).forEach(r => rows.push({
    kind, desc: r.descripcion, precio: r[f], estado: r.fuente?.estado || null, priceStatus: r.priceStatus || null,
    priceSearchStatus: r.priceSearchStatus || null, priceSearchError: r.priceSearchError || null,
    economic: Object.fromEntries(ECONOMIC_FIELDS.map(k => [k, r[k] ?? null]))
  }));
  const pi = logSlice.filter(l => l.path === '/api/price-intelligence');
  const count = arr => arr.reduce((a, l) => { a[l.status] = (a[l.status] || 0) + 1; return a; }, {});
  return {
    apuId: out.apuId, contextHash: out.contextDiagnostics?.contextHash,
    warnings: (out.contextDiagnostics?.warnings || []).map(w => w.code).sort(),
    enrichmentPartial: out.contextDiagnostics?.enrichmentPartial || null,
    piCalls: pi.length, piStatus: count(pi),
    pu: +c.pu.toFixed(6), direct: +c.direct.toFixed(6), importe: +(c.pu * Number(apu.cantidadObra || 0)).toFixed(4),
    confidence: typeof apu.confidence === 'object' ? apu.confidence?.score : apu.confidence,
    rows
  };
}

export async function runOne(role, concept, i, { newBrowser = true } = {}){
  asRole(role, { newBrowser });
  const start = H.log.length;
  const out = await generateApuForConcepto({ concepto: concepto(concept, i), catalog: [], project: PROJECT });
  return summarize(out, H.log.slice(start));
}

export const rateDoc = (role, feature) => H.db._get(`rateLimits/${ROLES[role].uid}_${feature}`) || null;
export const fakeReq = (role) => ({ method: 'POST', headers: { authorization: `Bearer tok-${ROLES[role].uid}` }, body: {} });
