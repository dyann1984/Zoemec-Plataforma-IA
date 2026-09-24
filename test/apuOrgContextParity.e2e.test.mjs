/* P0 -- PARIDAD REAL DE GENERACION DE APU entre ADMIN (responsable) y
   COLLABORATOR de la misma empresa. Este test debe quedarse permanentemente
   en CI (regla 22 del encargo).

   Escenario (regla 25):
     Organization ORG-1 "BIUMEC QA" (CONVERTED)
     Manager ADMIN-1 (company_manager)   Collaborator USER-1 (collaborator)
     Biblioteca empresarial: 100 recursos (incluye cemento, arena, block,
       oficial, ayudante, revolvedora)
     Catalogo personal ADMIN-1: 50 recursos (algunos mas baratos)
     Catalogo personal USER-1: 0
     Proyecto P-1 pertenece a ORG-1 (Toluca, Estado de Mexico)
     Empresa B (ORG-2) con su propia biblioteca -- nunca debe filtrarse.

   Usa el nucleo REAL del servidor (_apuGenerateCore.mjs ->
   _apuContextResolver.mjs -> apuContextResolution.js) sobre un Firestore en
   memoria. La IA se sustituye por un generador determinista que arma el APU
   SOLO con el catalogo que recibe: asi cualquier diferencia de resultado
   solo puede venir del contexto, que es justo lo que se prueba. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryFirestore } from './helpers/memoryFirestore.mjs';
import { runApuGeneration } from '../server/api-lib/_apuGenerateCore.mjs';
import { loadApuGenerationContext } from '../server/api-lib/_apuContextResolver.mjs';
import { compareContextParity, toContextDiagnostics } from '../src/domain/apuContextResolution.js';
import { calcAPU, APU_DEFAULT_FACTORS } from '../src/lib/apuCalc.js';

const CONCEPT = 'Muro de block hueco de 12 cm asentado con mortero cemento-arena 1:5, acabado comun';

function orgEntry(orgId, i, description, unit, price, extra = {}){
  return [`orgLibrary/OLIB-${orgId}-${String(i).padStart(3, '0')}`, {
    id: `OLIB-${orgId}-${String(i).padStart(3, '0')}`, organizationId: orgId, projectId: null, type: 'material',
    code: '', description, unit, price, currency: 'MXN', region: '', source: 'Cotizacion QA', date: '2026-09-01',
    validUntil: null, status: 'ACTIVE', archivedAt: null, ...extra
  }];
}

function seedWorld(){
  const seed = {
    'organizations/ORG-1': { id: 'ORG-1', name: 'BIUMEC QA', status: 'CONVERTED' },
    'organizations/ORG-1/members/ADMIN-1': { uid: 'ADMIN-1', role: 'company_manager', status: 'active' },
    'organizations/ORG-1/members/USER-1': { uid: 'USER-1', role: 'collaborator', status: 'active' },
    'organizations/ORG-1/members/GONE-1': { uid: 'GONE-1', role: 'collaborator', status: 'disabled' },
    'organizations/ORG-2': { id: 'ORG-2', name: 'Empresa B', status: 'CONVERTED' },
    'organizations/ORG-2/members/OUT-1': { uid: 'OUT-1', role: 'company_manager', status: 'active' },
    'users/ADMIN-1': { uid: 'ADMIN-1', organizationId: 'ORG-1' },
    'users/USER-1': { uid: 'USER-1', organizationId: 'ORG-1' },
    'users/GONE-1': { uid: 'GONE-1', organizationId: 'ORG-1' },
    'users/OUT-1': { uid: 'OUT-1', organizationId: 'ORG-2' },
    'users/SOLO-1': { uid: 'SOLO-1' },
    'projects/P-1': { id: 'P-1', ownerUid: 'ADMIN-1', organizationId: 'ORG-1', name: 'Casa QA', locationCountry: 'México', locationState: 'Estado de México', locationCity: 'Toluca' },
    'library/GLOBAL-1': { id: 'GLOBAL-1', visibility: 'global', name: 'Tabulador global', contentInsumos: [{ desc: 'Agua potable', unidad: 'm³', precio: 38 }], insumosReview: [{ index: 0, state: 'VALIDADO', validatedBy: 'qa', validatedAt: '2026-05-01' }] },
    'apus/APU-A': { organizationId: 'ORG-1', ownerUid: 'ADMIN-1', snapshot: { revisionStatus: 'VALIDADO_POR_USUARIO' } },
    'apus/APU-B': { organizationId: 'ORG-1', ownerUid: 'USER-1', snapshot: { revisionStatus: 'REVISADO' } },
    'apus/APU-C': { organizationId: 'ORG-1', ownerUid: 'USER-1', snapshot: { revisionStatus: 'GENERADO' } },
    'apus/APU-X': { organizationId: 'ORG-2', ownerUid: 'OUT-1', snapshot: { revisionStatus: 'VALIDADO_POR_USUARIO' } }
  };
  const core = [
    ['Cemento gris CPC 30R saco 50 kg', 'saco', 239],
    ['Arena de rio', 'm³', 450],
    ['Block hueco de concreto 12x20x40', 'pza', 14.5],
    ['Oficial albañil', 'jor', 650],
    ['Ayudante general', 'jor', 430],
    ['Revolvedora 1 saco', 'dia', 600]
  ];
  core.forEach(([d, u, p], i) => { const [k, v] = orgEntry('ORG-1', i, d, u, p); seed[k] = v; });
  for(let i = core.length; i < 100; i++){ const [k, v] = orgEntry('ORG-1', i, `Insumo empresa ${i}`, 'pza', 10 + i); seed[k] = v; }
  // Empresa B: tiene precios distintos para lo mismo -- jamas deben aparecer en ORG-1.
  [['Cemento gris CPC 30R saco 50 kg', 'saco', 999], ['Arena de rio', 'm³', 999], ['Block hueco de concreto 12x20x40', 'pza', 99], ['Oficial albañil', 'jor', 999], ['Revolvedora 1 saco', 'dia', 999]]
    .forEach(([d, u, p], i) => { const [k, v] = orgEntry('ORG-2', i, d, u, p); seed[k] = v; });
  return createMemoryFirestore(seed);
}

// Replica exacta de la forma que devuelve _orgGuard.mjs#loadOrgContext.
async function orgContextFor(db, uid){
  const user = (await db.collection('users').doc(uid).get()).data() || {};
  if(!user.organizationId) return null;
  const orgRef = db.collection('organizations').doc(user.organizationId);
  const [orgSnap, memberSnap] = await Promise.all([orgRef.get(), orgRef.collection('members').doc(uid).get()]);
  if(!orgSnap.exists || !memberSnap.exists) return null;
  const org = { id: orgSnap.id, ...orgSnap.data() };
  return { organizationId: user.organizationId, org, member: { uid, ...memberSnap.data() }, status: org.status };
}

const ADMIN_PERSONAL_50 = [
  { desc: 'Block hueco de concreto 12x20x40', unidad: 'pza', precio: 11 },   // mas barato que la empresa
  { desc: 'Cemento gris CPC 30R saco 50 kg', unidad: 'saco', precio: 225 },
  ...Array.from({ length: 48 }, (_, i) => ({ desc: `Insumo privado admin ${i}`, unidad: 'pza', precio: 5 + i }))
];

/* Generador determinista: arma el APU del muro SOLO con lo que trae el
   catalogo recibido; si falta un insumo usa un "estimado IA" fijo. */
const RECIPE = [
  { kind: 'materials', word: 'block', qty: 12.5, unit: 'pza', estimate: 17, extra: 3 },
  { kind: 'materials', word: 'cemento', qty: 0.18, unit: 'saco', estimate: 260, extra: 3 },
  { kind: 'materials', word: 'arena', qty: 0.03, unit: 'm³', estimate: 520, extra: 5 },
  { kind: 'labor', word: 'oficial', qty: 0.1, unit: 'jor', estimate: 700, extra: 1.7 },
  { kind: 'labor', word: 'ayudante', qty: 0.1, unit: 'jor', estimate: 480, extra: 1.7 },
  { kind: 'equipment', word: 'revolvedora', qty: 0.02, unit: 'dia', estimate: 650 }
];
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const receivedCatalogs = [];
async function fakeGenerate(payload){
  receivedCatalogs.push(payload.catalog);
  const apu = { concept: payload.concept, unit: 'm²', family: 'Albañileria', confidence: 90, materials: [], labor: [], equipment: [], ...APU_DEFAULT_FACTORS };
  RECIPE.forEach(r => {
    const hit = (payload.catalog || []).find(row => norm(row.desc).includes(r.word));
    const desc = hit ? hit.desc : `${r.word} (estimado IA)`;
    const unit = hit ? hit.unidad : r.unit;
    const price = hit ? hit.precio : r.estimate;
    if(r.kind === 'materials') apu.materials.push([desc, r.qty, unit, price, r.extra]);
    if(r.kind === 'labor') apu.labor.push([desc, r.qty, unit, price, r.extra]);
    if(r.kind === 'equipment') apu.equipment.push([desc, r.qty, unit, price]);
  });
  return apu;
}

async function generateAs(db, uid, body){
  const orgContext = await orgContextFor(db, uid);
  return runApuGeneration({ body, authz: { uid, email: `${uid}@qa.test`, role: 'user' }, orgContext, db, generate: fakeGenerate });
}

const invariants = apu => ({
  materials: apu.materials, labor: apu.labor, equipment: apu.equipment,
  factors: [apu.herramienta, apu.indCampo, apu.indOficina, apu.finance, apu.utility, apu.cargos],
  pu: Math.round(calcAPU(apu).pu * 100) / 100,
  priceSources: apu.priceSourceByRow,
  confidence: apu.confidence
});

/* ---------- 1. Contexto empresarial equivalente ---------- */

test('P0 §25: ADMIN y COLLABORATOR resuelven el MISMO contexto empresarial (100 recursos cada uno)', async () => {
  const db = seedWorld();
  const [adminCtx, collabCtx] = await Promise.all([
    orgContextFor(db, 'ADMIN-1').then(orgContext => loadApuGenerationContext({ db, authz: { uid: 'ADMIN-1' }, orgContext, projectId: 'P-1', requestedMode: 'organization', clientPersonalCatalog: ADMIN_PERSONAL_50, concept: CONCEPT })),
    orgContextFor(db, 'USER-1').then(orgContext => loadApuGenerationContext({ db, authz: { uid: 'USER-1' }, orgContext, projectId: 'P-1', requestedMode: 'organization', clientPersonalCatalog: [], concept: CONCEPT }))
  ]);
  assert.equal(adminCtx.contextMode, 'organization');
  assert.equal(collabCtx.contextMode, 'organization');
  assert.equal(adminCtx.organizationCatalogSize, 100);
  assert.equal(collabCtx.organizationCatalogSize, 100);
  assert.equal(adminCtx.organizationLibraryCount, 100);
  assert.equal(adminCtx.historicalOrgApuCount, 3);
  assert.equal(adminCtx.historicalOrgApuValidatedCount, 2);
  assert.equal(adminCtx.contextHash, collabCtx.contextHash, 'mismo hash de contexto');
  assert.deepEqual(adminCtx.catalogForModel, collabCtx.catalogForModel, 'la IA recibe exactamente el mismo catalogo');
  const parity = compareContextParity(toContextDiagnostics(adminCtx), toContextDiagnostics(collabCtx));
  assert.equal(parity.equivalent, true, JSON.stringify(parity.diffs));
  assert.deepEqual(adminCtx.warnings, [], 'sin warnings: no se degrada Confidence por ser colaborador');
  assert.equal(adminCtx.personalIncluded, false, 'el catalogo personal del admin NO participa en modo empresa');
});

/* ---------- 2. Regresion del bug real: ANTES vs DESPUES ---------- */

test('P0 §22 REGRESION -- ANTES (cliente antiguo, catalogo personal en el body): el colaborador recibia un contexto inferior', async () => {
  const db = seedWorld();
  receivedCatalogs.length = 0;
  const adminCatalog300 = Array.from({ length: 300 }, (_, i) => ({ desc: i === 0 ? 'Block hueco de concreto 12x20x40' : `Insumo admin ${i}`, unidad: 'pza', precio: i === 0 ? 14.5 : 10 }));
  const admin = await generateAs(db, 'ADMIN-1', { concept: CONCEPT, catalog: adminCatalog300, schema: 'v1' });
  const collab = await generateAs(db, 'USER-1', { concept: CONCEPT, catalog: [], schema: 'v1' });
  // Comportamiento historico conservado para clientes que no mandan contexto:
  assert.equal(admin.modelCatalog.length, 300);
  assert.equal(collab.modelCatalog.length, 0);
  assert.notDeepEqual(invariants(admin.apu).materials, invariants(collab.apu).materials, 'documenta la asimetria original');
  assert.equal(admin.context, null);
});

test('P0 §22 REGRESION -- DESPUES (contexto empresarial server-side): ambos usan ~el mismo catalogo como fuente principal', async () => {
  const db = seedWorld();
  const body = { concept: CONCEPT, projectId: 'P-1', contextMode: 'organization', schema: 'v1' };
  const admin = await generateAs(db, 'ADMIN-1', { ...body, catalog: ADMIN_PERSONAL_50 });   // aunque el admin mande su catalogo personal...
  const collab = await generateAs(db, 'USER-1', { ...body, catalog: [] });               // ...y el colaborador no tenga ninguno
  assert.equal(admin.context.organizationCatalogSize, 100);
  assert.equal(collab.context.organizationCatalogSize, 100);
  assert.deepEqual(admin.modelCatalog, collab.modelCatalog);
  assert.equal(admin.context.contextHash, collab.context.contextHash);
  assert.ok(admin.context.modelSourceCounts.organization > 0);
  assert.equal(admin.context.modelSourceCounts.personal, 0, 'el personal del admin no entra en modo empresa');
});

/* ---------- 3. Paridad del APU resultante ---------- */

test('P0 §9: mismo concepto -> mismos recursos, fuentes, precios, formulas, indirectos, P.U. y Confidence', async () => {
  const db = seedWorld();
  const body = { concept: CONCEPT, projectId: 'P-1', contextMode: 'organization', schema: 'v1' };
  const admin = await generateAs(db, 'ADMIN-1', { ...body, catalog: ADMIN_PERSONAL_50 });
  const collab = await generateAs(db, 'USER-1', { ...body, catalog: [] });
  assert.deepEqual(invariants(admin.apu), invariants(collab.apu));
  // Todos los insumos del muro salieron de la biblioteca de la EMPRESA ORG-1
  const sources = admin.apu.priceSourceByRow;
  [...sources.materials, ...sources.labor, ...sources.equipment].forEach(s => {
    assert.equal(s.priceSource, 'organization');
    assert.match(s.sourceRecordId, /^OLIB-ORG-1-/, 'nunca un registro de la empresa B');
  });
  assert.equal(admin.apu.materials[0][3], 14.5, 'block al precio de la empresa (no el 11.00 privado del admin)');
  assert.equal(admin.apu.contextDiagnostics.contextHash, collab.apu.contextDiagnostics.contextHash);
});

/* ---------- 4. Colaborador nuevo sin catalogo personal (el test mas importante) ---------- */

test('P0 §10: colaborador NUEVO con personalCatalogSize=0 genera con organizationCatalogSize>0 y sin estimados IA', async () => {
  const db = seedWorld();
  const collab = await generateAs(db, 'USER-1', { concept: CONCEPT, projectId: 'P-1', contextMode: 'organization', catalog: [], schema: 'v1' });
  assert.equal(collab.context.personalCatalogSize, 0);
  assert.equal(collab.context.organizationCatalogSize, 100);
  assert.equal(collab.apu.priceSourceSummary.ai_estimated, 0);
  assert.equal(collab.apu.priceSourceSummary.organization, 6);
  assert.equal(collab.context.confidencePenalty, 0);
});

/* ---------- 5. El admin no obtiene ventaja silenciosa por datos privados ---------- */

test('P0 §11: incluir el catalogo personal solo ocurre si se pide explicitamente, y queda registrado', async () => {
  const db = seedWorld();
  const base = { concept: CONCEPT, projectId: 'P-1', contextMode: 'organization', schema: 'v1', catalog: ADMIN_PERSONAL_50 };
  const orgOnly = await generateAs(db, 'ADMIN-1', base);
  const withPersonal = await generateAs(db, 'ADMIN-1', { ...base, includePersonal: true });
  assert.equal(orgOnly.context.personalIncluded, false);
  assert.equal(withPersonal.context.personalIncluded, true);
  assert.notEqual(withPersonal.context.contextHash, orgOnly.context.contextHash, 'el contexto aumentado es distinto y trazable');
  // Aun incluyendo el personal, en las identidades compartidas gana la empresa
  const block = withPersonal.modelCatalog.find(r => /block/i.test(r.desc));
  assert.equal(block.priceSource, 'organization');
  assert.equal(block.precio, 14.5);
});

/* ---------- 6. Aislamiento multi-tenant ---------- */

test('P0 §21: usuario de la empresa B no puede generar sobre un proyecto de la empresa A', async () => {
  const db = seedWorld();
  await assert.rejects(
    generateAs(db, 'OUT-1', { concept: CONCEPT, projectId: 'P-1', contextMode: 'organization', schema: 'v1' }),
    err => err.status === 403
  );
});

test('P0 §21: sin proyecto, la empresa B solo ve SU biblioteca (nunca la de A)', async () => {
  const db = seedWorld();
  const out = await generateAs(db, 'OUT-1', { concept: CONCEPT, contextMode: 'organization', schema: 'v1' });
  assert.equal(out.context.organizationId, 'ORG-2');
  assert.equal(out.context.organizationCatalogSize, 5);
  out.modelCatalog.filter(r => r.priceSource === 'organization').forEach(r => assert.match(r.sourceRecordId, /^OLIB-ORG-2-/));
  assert.equal(out.context.historicalOrgApuCount, 1);
});

test('P0 §21: usuario sin empresa no accede a biblioteca empresarial y conserva su comportamiento personal', async () => {
  const db = seedWorld();
  await assert.rejects(generateAs(db, 'SOLO-1', { concept: CONCEPT, projectId: 'P-1', contextMode: 'organization', schema: 'v1' }), err => err.status === 403);
  const solo = await generateAs(db, 'SOLO-1', { concept: CONCEPT, contextMode: 'organization', catalog: [{ desc: 'Block hueco de concreto 12x20x40', unidad: 'pza', precio: 13 }], schema: 'v1' });
  assert.equal(solo.context.contextMode, 'personal');
  assert.equal(solo.context.organizationId, null);
  assert.equal(solo.context.organizationCatalogSize, 0);
  assert.equal(solo.modelCatalog.find(r => /block/i.test(r.desc)).priceSource, 'personal');
  assert.ok(solo.context.warnings.some(w => w.code === 'ORGANIZATION_MODE_UNAVAILABLE'));
});

test('P0: miembro DESHABILITADO pierde el contexto empresarial y el acceso al proyecto', async () => {
  const db = seedWorld();
  await assert.rejects(generateAs(db, 'GONE-1', { concept: CONCEPT, projectId: 'P-1', contextMode: 'organization', schema: 'v1' }), err => err.status === 403);
  const gone = await generateAs(db, 'GONE-1', { concept: CONCEPT, contextMode: 'organization', schema: 'v1' });
  assert.equal(gone.context.contextMode, 'personal');
  assert.equal(gone.context.organizationCatalogSize, 0);
});

/* ---------- 7. Fallback equivalente cuando la empresa NO tiene biblioteca ---------- */

test('P0 §16: empresa sin biblioteca -> ambos degradan IGUAL (mismos warnings, misma penalty, mismos estimados)', async () => {
  const db = seedWorld();
  db._dump('orgLibrary/').filter(d => d.organizationId === 'ORG-1').forEach(d => db._set(d.path, { ...d, archivedAt: '2026-09-20', status: 'ARCHIVED' }));
  const body = { concept: CONCEPT, projectId: 'P-1', contextMode: 'organization', schema: 'v1' };
  const admin = await generateAs(db, 'ADMIN-1', { ...body, catalog: ADMIN_PERSONAL_50 });
  const collab = await generateAs(db, 'USER-1', { ...body, catalog: [] });
  assert.equal(admin.context.organizationCatalogSize, 0);
  assert.deepEqual(admin.context.warnings.map(w => w.code), collab.context.warnings.map(w => w.code));
  assert.ok(admin.context.warnings.some(w => w.code === 'EMPTY_ORGANIZATION_CATALOG'));
  assert.equal(admin.context.confidencePenalty, collab.context.confidencePenalty);
  assert.deepEqual(invariants(admin.apu), invariants(collab.apu));
  assert.equal(admin.apu.priceSourceSummary.ai_estimated, 6, 'todo estimado por IA, y marcado como tal');
});

test('P0: projectId inexistente (id viejo del navegador) no bloquea: contexto de empresa + advertencia, igual para ambos', async () => {
  const db = seedWorld();
  const body = { concept: CONCEPT, projectId: 'P-BORRADO', contextMode: 'organization', schema: 'v1' };
  const admin = await generateAs(db, 'ADMIN-1', { ...body, catalog: ADMIN_PERSONAL_50 });
  const collab = await generateAs(db, 'USER-1', { ...body, catalog: [] });
  assert.equal(admin.context.contextMode, 'organization');
  assert.equal(admin.context.projectId, null);
  assert.ok(admin.context.warnings.some(w => w.code === 'PROJECT_NOT_FOUND'));
  assert.equal(admin.context.contextHash, collab.context.contextHash);
});

/* ---------- 8. Invariante estructural ---------- */

test('P0: el contexto no depende del campo role del token', async () => {
  const db = seedWorld();
  const orgContext = await orgContextFor(db, 'USER-1');
  const asUser = await runApuGeneration({ body: { concept: CONCEPT, projectId: 'P-1', contextMode: 'organization', schema: 'v1' }, authz: { uid: 'USER-1', role: 'user' }, orgContext, db, generate: fakeGenerate });
  const asAdminRole = await runApuGeneration({ body: { concept: CONCEPT, projectId: 'P-1', contextMode: 'organization', schema: 'v1' }, authz: { uid: 'USER-1', role: 'admin' }, orgContext, db, generate: fakeGenerate });
  assert.equal(asUser.context.contextHash, asAdminRole.context.contextHash);
  assert.deepEqual(asUser.modelCatalog, asAdminRole.modelCatalog);
});
