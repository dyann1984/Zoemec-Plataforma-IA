/* Nucleo server-side de la biblioteca EMPRESARIAL (P0) sobre Firestore en
   memoria: RBAC real (responsable escribe, colaborador lee), aislamiento
   entre empresas y migracion NO destructiva del catalogo personal. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryFirestore } from './helpers/memoryFirestore.mjs';
import {
  listOrgLibrary, createOrgLibraryEntries, updateOrgLibraryEntry, archiveOrgLibraryEntry,
  previewPersonalImport, commitPersonalImport, previewApuContext
} from '../server/api-lib/_orgLibraryCore.mjs';

const ctx = (organizationId, uid, role, status = 'active', orgStatus = 'CONVERTED') =>
  ({ organizationId, org: { id: organizationId, name: organizationId, status: orgStatus }, member: { uid, role, status }, status: orgStatus });
const MANAGER = ctx('ORG-1', 'ADMIN-1', 'company_manager');
const COLLAB = ctx('ORG-1', 'USER-1', 'collaborator');
const DISABLED = ctx('ORG-1', 'GONE-1', 'collaborator', 'disabled');
const OUTSIDER = ctx('ORG-2', 'OUT-1', 'company_manager');
const EXPIRED_MANAGER = ctx('ORG-1', 'ADMIN-1', 'company_manager', 'active', 'TRIAL_EXPIRED');

function world(){
  return createMemoryFirestore({
    'projects/P-1': { organizationId: 'ORG-1', ownerUid: 'ADMIN-1' },
    'projects/P-B': { organizationId: 'ORG-2', ownerUid: 'OUT-1' },
    'users/ADMIN-1/state/zoemec-catalogo': { z: 'BLOB-PERSONAL-INTACTO', updatedAt: 1 }
  });
}
const entries = [
  { description: 'Cemento gris CPC 30R', unit: 'saco', price: 239, region: 'Estado de México', source: 'Cotizacion Cemex 2026-09' },
  { description: 'Arena de rio', unit: 'm³', price: 450, source: 'Cotizacion local' }
];
const is403 = err => err.status === 403;

test('responsable crea recursos; organizationId SIEMPRE del orgContext (nunca del body) y queda auditoria', async () => {
  const db = world();
  const { created, rejected } = await createOrgLibraryEntries(db, { orgContext: MANAGER, actor: 'admin@qa', entries: [...entries, { ...entries[0], organizationId: 'ORG-2' }] });
  assert.equal(created.length, 2);
  assert.equal(rejected.length, 1, 'el tercero es duplicado del primero (misma identidad)');
  assert.equal(rejected[0].reason, 'DUPLICADO');
  created.forEach(e => assert.equal(e.organizationId, 'ORG-1'));
  assert.equal(db._dump('orgLibraryAudit/').length, 1);
});

test('colaborador LEE la misma biblioteca que el responsable', async () => {
  const db = world();
  await createOrgLibraryEntries(db, { orgContext: MANAGER, actor: 'admin@qa', entries });
  const asManager = await listOrgLibrary(db, { orgContext: MANAGER });
  const asCollab = await listOrgLibrary(db, { orgContext: COLLAB });
  assert.equal(asCollab.length, 2);
  assert.deepEqual(asCollab.map(e => e.id), asManager.map(e => e.id));
});

test('colaborador NO crea, NO edita, NO archiva, NO importa', async () => {
  const db = world();
  const { created } = await createOrgLibraryEntries(db, { orgContext: MANAGER, actor: 'a', entries });
  await assert.rejects(createOrgLibraryEntries(db, { orgContext: COLLAB, actor: 'c', entries }), is403);
  await assert.rejects(updateOrgLibraryEntry(db, { orgContext: COLLAB, actor: 'c', id: created[0].id, patch: { price: 1 } }), is403);
  await assert.rejects(archiveOrgLibraryEntry(db, { orgContext: COLLAB, actor: 'c', id: created[0].id }), is403);
  await assert.rejects(previewPersonalImport(db, { orgContext: COLLAB, authz: { uid: 'USER-1' }, rows: [] }), is403);
  await assert.rejects(commitPersonalImport(db, { orgContext: COLLAB, authz: { uid: 'USER-1' }, actor: 'c', rows: [] }), is403);
});

test('empresa B: no lee la biblioteca de A y su responsable no puede administrar recursos de A', async () => {
  const db = world();
  const { created } = await createOrgLibraryEntries(db, { orgContext: MANAGER, actor: 'a', entries });
  assert.equal((await listOrgLibrary(db, { orgContext: OUTSIDER })).length, 0);
  await assert.rejects(updateOrgLibraryEntry(db, { orgContext: OUTSIDER, actor: 'o', id: created[0].id, patch: { price: 1 } }), is403);
  await assert.rejects(archiveOrgLibraryEntry(db, { orgContext: OUTSIDER, actor: 'o', id: created[0].id }), is403);
  const [stillThere] = await listOrgLibrary(db, { orgContext: MANAGER });
  assert.notEqual(stillThere.price, 1);
});

test('usuario sin empresa y miembro deshabilitado: sin acceso a la biblioteca empresarial', async () => {
  const db = world();
  await assert.rejects(listOrgLibrary(db, { orgContext: null }), is403);
  await assert.rejects(listOrgLibrary(db, { orgContext: DISABLED }), is403);
});

test('empresa con trial vencido: el responsable ya no puede modificar (lectura sigue)', async () => {
  const db = world();
  await createOrgLibraryEntries(db, { orgContext: MANAGER, actor: 'a', entries });
  await assert.rejects(createOrgLibraryEntries(db, { orgContext: EXPIRED_MANAGER, actor: 'a', entries: [{ description: 'Grava', unit: 'm³', price: 520 }] }), is403);
  assert.equal((await listOrgLibrary(db, { orgContext: ctx('ORG-1', 'USER-1', 'collaborator', 'active', 'TRIAL_EXPIRED') })).length, 2);
});

test('precios de PROYECTO: solo para proyectos de la propia empresa', async () => {
  const db = world();
  const ok = await createOrgLibraryEntries(db, { orgContext: MANAGER, actor: 'a', projectId: 'P-1', entries: [{ description: 'Cemento gris CPC 30R', unit: 'saco', price: 245 }] });
  assert.equal(ok.created[0].projectId, 'P-1');
  await assert.rejects(createOrgLibraryEntries(db, { orgContext: MANAGER, actor: 'a', projectId: 'P-B', entries: [{ description: 'x', unit: 'pza', price: 1 }] }), is403);
});

test('editar conserva el id y registra antes/despues en la auditoria; archivar lo saca de la lista', async () => {
  const db = world();
  const { created } = await createOrgLibraryEntries(db, { orgContext: MANAGER, actor: 'a', entries });
  const updated = await updateOrgLibraryEntry(db, { orgContext: MANAGER, actor: 'a', id: created[0].id, patch: { price: 247, organizationId: 'ORG-2' } });
  assert.equal(updated.id, created[0].id);
  assert.equal(updated.price, 247);
  assert.equal(updated.organizationId, 'ORG-1', 'organizationId no es editable');
  const audit = db._dump('orgLibraryAudit/').find(a => a.action === 'ORG_LIBRARY_UPDATED');
  assert.deepEqual([audit.previous.price, audit.next.price], [239, 247]);
  await archiveOrgLibraryEntry(db, { orgContext: MANAGER, actor: 'a', id: created[1].id });
  assert.equal((await listOrgLibrary(db, { orgContext: COLLAB })).length, 1);
});

/* ---------- Migracion NO destructiva (reglas 4, 17, 18) ---------- */

const PERSONAL = [
  { desc: 'Cemento gris CPC 30R', unidad: 'saco', precio: 245, fecha: '2026-09-15', region: 'Estado de México' }, // update (mas reciente)
  { desc: 'Arena de rio', unidad: 'm3', precio: 450, fecha: '2026-09-15' },                                 // sin cambio (alias m3)
  { desc: 'Block hueco 12x20x40', unidad: 'pza', precio: 14.5, fecha: '2026-09-15' },                        // nuevo
  { desc: 'Block hueco 12x20x40', unidad: 'pza', precio: 15, fecha: '2026-09-20' },                          // duplicado en lote
  { desc: 'Clavo 2.5"', unidad: 'kg', precio: 0 }                                                           // invalido
];

test('vista previa de importacion: NO escribe nada y reporta registros/duplicados/conflictos/regiones/fechas/fuentes', async () => {
  const db = world();
  await createOrgLibraryEntries(db, { orgContext: MANAGER, actor: 'a', entries: entries.map(e => ({ ...e, date: '2026-09-01' })) });
  const before = db._dump('orgLibrary/').length;
  const { summary, toUpdate } = await previewPersonalImport(db, { orgContext: MANAGER, authz: { uid: 'ADMIN-1' }, rows: PERSONAL });
  assert.equal(db._dump('orgLibrary/').length, before, 'la vista previa no escribe');
  assert.deepEqual(
    { c: summary.toCreate, u: summary.toUpdate, n: summary.unchanged, i: summary.invalid, d: summary.duplicatesInBatch },
    { c: 1, u: 1, n: 1, i: 1, d: 1 }
  );
  assert.equal(toUpdate[0].from, 239);
  assert.equal(toUpdate[0].to, 245);
  assert.ok(summary.regions.length >= 1 && summary.sources.length >= 1 && summary.dateRange);
});

test('importar sin aplicar actualizaciones: solo crea lo nuevo, no pisa precios de la empresa, no toca el catalogo personal', async () => {
  const db = world();
  await createOrgLibraryEntries(db, { orgContext: MANAGER, actor: 'a', entries: entries.map(e => ({ ...e, date: '2026-09-01' })) });
  const result = await commitPersonalImport(db, { orgContext: MANAGER, authz: { uid: 'ADMIN-1' }, actor: 'a', rows: PERSONAL });
  assert.deepEqual([result.created, result.updated, result.skippedUpdates], [1, 0, 1]);
  const list = await listOrgLibrary(db, { orgContext: COLLAB });
  assert.equal(list.length, 3);
  assert.equal(list.find(e => /cemento/i.test(e.description)).price, 239, 'precio empresarial intacto');
  const block = list.find(e => /block/i.test(e.description));
  assert.equal(block.price, 15, 'del duplicado en lote gana el mas reciente');
  assert.equal(block.origin.kind, 'personal-import');
  assert.equal(block.origin.fromUid, 'ADMIN-1');
  assert.deepEqual(db._dump('users/ADMIN-1/state/')[0], { path: 'users/ADMIN-1/state/zoemec-catalogo', z: 'BLOB-PERSONAL-INTACTO', updatedAt: 1 });
});

test('importar aplicando actualizaciones: actualiza el MISMO registro (no crea copias); reimportar no duplica', async () => {
  const db = world();
  const { created } = await createOrgLibraryEntries(db, { orgContext: MANAGER, actor: 'a', entries: entries.map(e => ({ ...e, date: '2026-09-01' })) });
  await commitPersonalImport(db, { orgContext: MANAGER, authz: { uid: 'ADMIN-1' }, actor: 'a', rows: PERSONAL, applyUpdates: true });
  const cemento = (await listOrgLibrary(db, { orgContext: MANAGER })).find(e => /cemento/i.test(e.description));
  assert.equal(cemento.id, created[0].id);
  assert.equal(cemento.price, 245);
  const second = await commitPersonalImport(db, { orgContext: MANAGER, authz: { uid: 'ADMIN-1' }, actor: 'a', rows: PERSONAL, applyUpdates: true });
  assert.equal(second.created, 0, 'reimportar el mismo catalogo no crea 20 copias del mismo insumo');
  assert.equal((await listOrgLibrary(db, { orgContext: MANAGER })).length, 3);
});

test('vista previa de contexto: responsable y colaborador ven el mismo contexto empresarial', async () => {
  const db = world();
  await createOrgLibraryEntries(db, { orgContext: MANAGER, actor: 'a', entries });
  const m = await previewApuContext(db, { authz: { uid: 'ADMIN-1' }, orgContext: MANAGER, projectId: 'P-1', concept: 'mortero cemento arena' });
  const c = await previewApuContext(db, { authz: { uid: 'USER-1' }, orgContext: COLLAB, projectId: 'P-1', concept: 'mortero cemento arena' });
  assert.equal(m.organizationCatalogSize, 2);
  assert.equal(m.contextHash, c.contextHash);
  assert.equal(m.organizationName, 'ORG-1');
});
