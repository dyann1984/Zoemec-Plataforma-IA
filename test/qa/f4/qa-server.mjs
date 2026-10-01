/* F4-QA -- servidor QA LOCAL para validar F4 en navegador SIN tocar produccion.
   - Frontend: la app real servida por Vite (mismo codigo de src/), con los
     paquetes firebase/* sustituidos por shims (test/qa/f4/shims): sesion QA
     fija y Firestore cliente sobre el mismo almacen en memoria.
   - Backend: los handlers REALES de api/*.mjs y api/gateway.mjs
     (server/api-lib/_route-*.mjs) con Firebase Admin sustituido por el
     Firestore en memoria del arnes F1-F4 (test/helpers/roleParityHarness).
   - OpenAI: respuestas deterministas del arnes (nunca red real).
   Nada se escribe en Firebase/Vercel reales. Uso:
     node test/qa/f4/qa-server.mjs   (puerto QA_PORT, 5199 por defecto)  */
import { register } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

register('../../helpers/roleParityHarness/hooks.mjs', import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const PORT = Number(process.env.QA_PORT || 5199);
// F5-QA: carpeta (fuera del repo) con los reportes generados para inspeccion visual.
const QA_OUT = process.env.QA_OUT || path.join((await import('node:os')).tmpdir(), 'zoemec-qa-out');

const W = await import('../../helpers/roleParityHarness/world.mjs');
const { FieldValue } = await import('../../helpers/roleParityHarness/memdb.mjs');
const { gzipSync, strToU8 } = await import('fflate');
const { makeEmptySurvey, makeEmptySpace } = await import('../../../src/domain/levantamientoSchema.js');
const { surveyToCadModel } = await import('../../../src/domain/surveyToCadModel.js');
const CAD = await import('../../../src/domain/cadModel.js');
const { makeEmptyAPUv2, APU_DATA_STATE } = await import('../../../src/domain/apuSchema.js');

/* ---------- Mundo QA ---------- */
W.seedWorld();
const db = W.H.db;
const now = new Date().toISOString();
for(const uid of ['MGR-1', 'COL-1']){
  const u = db._get(`users/${uid}`);
  await db.collection('users').doc(uid).set({ ...u, plan: 'Empresa', name: uid === 'MGR-1' ? 'QA Manager' : 'QA Colaborador', createdAt: now });
}
await db.collection('projects').doc('P-2').set({ ...W.PROJECT, id: 'P-2', name: 'Casa QA Legacy (migracion)' });
// Concepto + APU (F2) para ver Presupuesto/Explosion: se liga al CAD desde la UI.
W.asRole('MANAGER');
{
  const created = await W.apiPost('/api/catalogo-conceptos', { action: 'create', projectId: 'P-1', conceptos: [{ clave: 'PISO-01', capitulo: 'ACABADOS', concept: 'Piso de loseta ceramica 33x33', unit: 'm²', qty: 1 }] });
  const a = makeEmptyAPUv2();
  const fuente = { estado: APU_DATA_STATE.VERIFICADO, proveedor: 'QA', fecha: '2026-09-01' };
  Object.assign(a, { id: 'APU-PISO', clave: 'APU-PISO', concept: 'Piso de loseta ceramica 33x33', unit: 'm²', cantidadObra: 1 });
  a.materials = [{ clave: 'LOS-33', descripcion: 'Loseta ceramica 33x33', unidad: 'm²', consumo: 1.05, desperdicioPct: 0, precioUnitario: 180, fuente }];
  a.labor = [{ clave: 'MO-AZ', descripcion: 'Oficial azulejero', unidad: 'jor', cuadrilla: 1, rendimiento: 10, jornada: 8, salarioBase: 700, fsr: 1.5, fuente }];
  await W.apiPost('/api/apus', { action: 'create', id: 'APU-PISO', projectId: 'P-1', apu: a });
  await W.apiPost('/api/catalogo-conceptos', { action: 'associate-apu', id: created.conceptos[0].id, apuId: 'APU-PISO' });
}
// Fixture LEGACY (anterior a F4) en el bloque por usuario, proyecto P-2.
{
  const s = makeEmptySurvey({ id: 'LEV-LEGACY-QA', projectId: 'P-2', name: 'Levantamiento legado QA' });
  const sala = { ...makeEmptySpace({ name: 'Sala', length: 5, width: 4, height: 2.6 }), id: 'SPC-SALA' };
  const cocina = { ...makeEmptySpace({ name: 'Cocina', length: 3, width: 2.5, height: 2.6 }), id: 'SPC-COC' };
  const salaCad = CAD.resizeRectangularSpace(surveyToCadModel(sala).model, 'ESP-01', { length: 5.5 });
  const legacy = [{ ...s, spaces: [sala, cocina], cadPlanos: { [sala.id]: salaCad } }];
  const z = Buffer.from(gzipSync(strToU8(JSON.stringify(legacy)))).toString('base64');
  await db.collection('users').doc('MGR-1').collection('state').doc('zoemec-levantamientos').set({ z, updatedAt: Date.now(), v: 1 });
}
W.H.log = [];

/* ---------- /api (handlers reales) ---------- */
const gateway = (await import(pathToFileURL(path.join(REPO, 'api/gateway.mjs')).href)).default;
const direct = {};
for(const f of fs.readdirSync(path.join(REPO, 'api'))){
  if(!f.endsWith('.mjs') || f === 'gateway.mjs') continue;
  direct[`/api/${f.replace(/\.mjs$/, '')}`] = f;
}
async function readBody(req){
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if(!raw) return {};
  try{ return JSON.parse(raw); }catch{ return raw; }
}
export const apiLog = [];
async function handleApi(req, res){
  const [p, qs] = req.url.split('?');
  const body = req.method === 'GET' ? {} : await readBody(req);
  const areq = { method: req.method, url: req.url, headers: req.headers, body, query: Object.fromEntries(new URLSearchParams(qs || '')) };
  let status = 200, sent = false;
  const ares = {
    statusCode: 200,
    status(c){ status = c; this.statusCode = c; return this; },
    setHeader(k, v){ if(!sent) res.setHeader(k, v); return this; },
    json(b){ if(sent) return this; sent = true; res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); return this; },
    send(b){ if(sent) return this; sent = true; res.writeHead(status); res.end(typeof b === 'string' || Buffer.isBuffer(b) ? b : JSON.stringify(b)); return this; },
    end(b){ if(sent) return this; sent = true; res.writeHead(status); res.end(b); return this; }
  };
  const uid = W.H.tokens[(req.headers.authorization || '').replace(/^Bearer\s+/i, '')]?.uid || null;
  try{
    const handler = direct[p] ? (await import(pathToFileURL(path.join(REPO, 'api', direct[p])).href)).default : gateway;
    await handler(areq, ares);
  }catch(err){
    console.error('[qa api]', p, err);
    if(!sent){ status = 500; ares.json({ error: err.message }); }
  }
  apiLog.push({ at: new Date().toISOString(), uid, method: req.method, path: p, action: body?.action || null, status });
  if(!sent){ res.writeHead(status); res.end(); }
}

/* ---------- /__qa (Firestore cliente + inspeccion) ---------- */
const SENT = '__qaSentinel';
function fromWire(v){
  if(Array.isArray(v)) return v.map(fromWire);
  if(v && typeof v === 'object'){
    if(v[SENT] === 'ts') return FieldValue.serverTimestamp();
    if(v[SENT] === 'del') return FieldValue.delete();
    if(v[SENT] === 'inc') return FieldValue.increment(v.n);
    if(v[SENT] === 'union') return FieldValue.arrayUnion(...v.items);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromWire(x)]));
  }
  return v;
}
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function runQuery(colPath, constraints){
  const prefix = colPath + '/';
  let docs = db._dump(prefix).map(d => d.path).filter(p => !p.slice(prefix.length).includes('/')).map(p => ({ path: p, data: db._get(p) }));
  for(const c of constraints.filter(x => x.kind === 'where')){
    const val = d => (c.field === '__name__' ? d.path.split('/').pop() : getPath(d.data, c.field));
    const target = c.field === '__name__' ? (Array.isArray(c.value) ? c.value.map(x => String(x).split('/').pop()) : String(c.value).split('/').pop()) : c.value;
    docs = docs.filter(d => {
      const v = val(d);
      switch(c.op){
        case '==': return JSON.stringify(v) === JSON.stringify(target);
        case '!=': return JSON.stringify(v) !== JSON.stringify(target);
        case '<': return v < target; case '<=': return v <= target; case '>': return v > target; case '>=': return v >= target;
        case 'in': return target.some(t => JSON.stringify(t) === JSON.stringify(v));
        case 'not-in': return !target.some(t => JSON.stringify(t) === JSON.stringify(v));
        case 'array-contains': return Array.isArray(v) && v.includes(target);
        case 'array-contains-any': return Array.isArray(v) && v.some(x => target.includes(x));
        default: throw new Error(`Operador no soportado en QA: ${c.op}`);
      }
    });
  }
  for(const o of constraints.filter(x => x.kind === 'orderBy').reverse()){
    docs.sort((a, b) => { const x = getPath(a.data, o.field), y = getPath(b.data, o.field); const r = x < y ? -1 : x > y ? 1 : 0; return o.dir === 'desc' ? -r : r; });
  }
  const lim = constraints.find(x => x.kind === 'limit');
  return lim ? docs.slice(0, lim.n) : docs;
}
async function fsOp(op){
  const ref = op.path ? db.doc(op.path) : null;
  switch(op.op){
    case 'get': return { data: db._get(op.path) ?? null };
    case 'query': return { docs: runQuery(op.path, op.constraints || []) };
    case 'set': await ref.set(fromWire(op.data), { merge: op.merge }); return { ok: true };
    case 'update': await ref.update(fromWire(op.data)); return { ok: true };
    case 'delete': await ref.delete(); return { ok: true };
    case 'batch': for(const o of op.ops) await fsOp(o); return { ok: true };
    default: throw new Error(`op QA desconocida: ${op.op}`);
  }
}
async function handleQa(req, res){
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const [p, qs] = req.url.split('?');
  try{
    if(p === '/__qa/fs') return send(200, await fsOp(await readBody(req)));
    if(p === '/__qa/state'){
      const q = new URLSearchParams(qs || '');
      const prefix = q.get('prefix');
      if(prefix) return send(200, db._dump(prefix));
      return send(200, {
        levantamientos: db._dump('levantamientos/').map(d => ({ id: d.id, projectId: d.projectId, revision: d.revision, geometryMode: d.geometryMode, migratedFrom: d.migratedFrom, hasLegacyBackup: Boolean(d.legacyBackup), cadLinks: d.survey?.cadLinks || {}, updatedBy: d.updatedBy })),
        planos: db._dump('planoTakeoffs/').map(d => ({ id: d.id, revision: d.revision, currentVersion: d.currentVersion, dirtySinceVersion: d.dirtySinceVersion, sourceKind: d.sourceKind, fileName: d.fileName, updatedBy: d.updatedBy, underlayPage: d.snapshot?.cadModel?.underlay?.page ?? null, scale: d.snapshot?.cadModel?.scale?.status ?? null })),
        versions: db._dump('planoTakeoffVersions/').map(v => ({ planoTakeoffId: v.planoTakeoffId, version: v.version })),
        conceptos: db._dump('catalogConceptos/').map(c => ({ id: c.id, clave: c.clave, qty: c.qty, quantitySource: c.quantitySource, generatorsStale: c.generatorsStale || false, staleness: c.generatorStaleness || {}, generadores: (c.generadores || []).map(g => `${g.elementId} ${g.operation?.expression} = ${g.netQuantity}`), apuId: c.apuId || null })),
        apiErrors: apiLog.filter(l => l.status >= 400),
        apiCalls: apiLog.length
      });
    }
    if(p === '/__qa/log') return send(200, apiLog.slice(-Number(new URLSearchParams(qs || '').get('n') || 200)));
    if(p === '/__qa/png' && req.method === 'POST'){
      // F5-QA: el visor pdf.js guarda cada pagina renderizada como PNG.
      const name = path.basename(new URLSearchParams(qs || '').get('name') || 'page.png').replace(/[^\w.-]/g, '_');
      const body = await readBody(req);
      fs.mkdirSync(QA_OUT, { recursive: true });
      fs.writeFileSync(path.join(QA_OUT, name), Buffer.from(String(body.dataUrl || '').split(',')[1] || '', 'base64'));
      return send(200, { ok: true, file: path.join(QA_OUT, name) });
    }
    if(p.startsWith('/__qa/out/')){
      // F5-QA: reportes generados por las pruebas/scripts (solo lectura).
      const f = path.join(QA_OUT, path.basename(decodeURIComponent(p)));
      if(!fs.existsSync(f)) return send(404, { error: 'archivo no encontrado' });
      const type = f.endsWith('.pdf') ? 'application/pdf' : f.endsWith('.png') ? 'image/png' : f.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/octet-stream';
      res.writeHead(200, { 'content-type': type });
      return res.end(fs.readFileSync(f));
    }
    if(p.startsWith('/__qa/fixture/')){
      const f = path.join(HERE, 'fixtures', path.basename(p));
      if(!fs.existsSync(f)) return send(404, { error: 'fixture no encontrado' });
      res.writeHead(200, { 'content-type': f.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream' });
      return res.end(fs.readFileSync(f));
    }
    return send(404, { error: 'ruta QA desconocida' });
  }catch(err){
    return send(500, { error: err.message });
  }
}

/* ---------- Vite (frontend real con shims firebase/*) ---------- */
const server = http.createServer((req, res) => {
  if(req.url.startsWith('/api/')) return handleApi(req, res);
  if(req.url.startsWith('/__qa/')) return handleQa(req, res);
  return vite.middlewares(req, res);
});
const { createServer } = await import('vite');
const react = (await import('@vitejs/plugin-react')).default;
const SHIMS = path.join(HERE, 'shims').replace(/\\/g, '/');
const vite = await createServer({
  root: REPO,
  configFile: false,
  appType: 'spa',
  plugins: [react()],
  resolve: { alias: [{ find: /^firebase\/(app|auth|firestore|storage)$/, replacement: `${SHIMS}/firebase-$1.js` }] },
  optimizeDeps: { exclude: ['firebase'] },
  server: { middlewareMode: true, hmr: { server }, fs: { allow: [REPO] } }
});
server.listen(PORT, '127.0.0.1', () => console.log(`[F4-QA] http://127.0.0.1:${PORT}  (Firestore en memoria, sin produccion)`));
