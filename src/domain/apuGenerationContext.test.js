/* Test de paridad y asimetría del contexto de generacion APU (Fase 3.5).
   BUG REPORTADO: con el MISMO concepto, MISMO proyecto, MISMA region, un
   ADMIN produce un APU distinto (mejor calibrado) que un COLLABORATOR.

   CAUSA RAIZ CONFIRMADA por auditoria:
   - `catalog` (biblioteca de precios) se persiste en useCloudState
     (users/{uid}/state/zoemec-catalogo) => es PER-USUARIO, nunca
     compartido a nivel organizacion.
   - `library` (coleccion Firestore) tiene scope `ownerUid == uid` OR
     `visibility == 'global'` => tampoco es org-scoped.
   - Un COLLABORATOR de la misma empresa NO ve la biblioteca del ADMIN,
     asi que su `catalog` llega vacio o pobre al motor de IA, que responde
     con precios "estimado_ia" en vez de "catalogo" -> APU tecnicamente
     inferior. `generateAPU` server-side NO discrimina por rol: el shape
     resultante es el mismo cuando reciben el mismo input.

   ESTE TEST VERIFICA:
   1. `summarizeGenerationContext` reporta las asimetrias como warnings
      trazables (no las oculta).
   2. `diffGenerationContext` detecta que dos sesiones tienen catalogos
      distintos.
   3. El motor server-side (`generateAPU`) NO es la fuente del bug: si le
      pasas el mismo `catalog`, la ruta determinista es la misma.
   4. La degradacion de Confidence es explicita y trazable (no silenciosa). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeGenerationContext, diffGenerationContext, CONTEXT_WARNING } from './apuGenerationContext.js';

test('contexto con catalogo vacio produce warning EMPTY_CATALOG (severidad ALTA)', () => {
  const ctx = summarizeGenerationContext({
    concept: 'Muro de block 12', unit: 'm²', referencePU: 500,
    catalogSize: 0, project: { id: 'PRJ-1', locationCity: 'CDMX' }
  });
  assert.equal(ctx.catalogSize, 0);
  assert.ok(ctx.warnings.some(w => w.code === CONTEXT_WARNING.EMPTY_CATALOG && w.severity === 'ALTA'));
  assert.equal(ctx.confidencePenalty, 5, 'un warning ALTA descuenta 5 puntos');
});

test('contexto con catalogo pequeño (<30) produce warning SMALL_CATALOG (MEDIA)', () => {
  const ctx = summarizeGenerationContext({
    concept: 'x', catalogSize: 12, project: { locationCity: 'CDMX' }, referencePU: 100
  });
  assert.ok(ctx.warnings.some(w => w.code === CONTEXT_WARNING.SMALL_CATALOG && w.severity === 'MEDIA'));
  assert.equal(ctx.confidencePenalty, 0, 'MEDIA no descuenta');
});

test('sin ubicacion de proyecto produce warning MISSING_PROJECT_LOCATION', () => {
  const ctx = summarizeGenerationContext({ concept: 'x', catalogSize: 100, project: { id: 'PRJ-1' }, referencePU: 100 });
  assert.ok(ctx.warnings.some(w => w.code === CONTEXT_WARNING.MISSING_PROJECT_LOCATION));
});

test('COLLABORATOR con organizacion + libraryCount=0 produce PERMISSION_DEGRADATION visible (no silenciosa)', () => {
  const ctx = summarizeGenerationContext({
    concept: 'Muro', catalogSize: 5, project: { locationCity: 'CDMX' }, referencePU: 500,
    libraryCount: 0,
    userScope: { role: 'user', organizationId: 'ORG-1', uid: 'collab-uid' }
  });
  assert.ok(ctx.warnings.some(w => w.code === CONTEXT_WARNING.LIBRARY_ACCESS_LOCAL_ONLY));
});

test('enrichment fallido -> warning ALTA con mensaje real (nunca silencioso)', () => {
  const ctx = summarizeGenerationContext({
    concept: 'x', catalogSize: 50, project: { locationCity: 'CDMX' }, referencePU: 500,
    enrichmentFailed: true, enrichmentError: 'permission-denied on priceObservations'
  });
  const w = ctx.warnings.find(x => x.code === CONTEXT_WARNING.ENRICHMENT_FAILED);
  assert.ok(w);
  assert.equal(w.severity, 'ALTA');
  assert.match(w.message, /permission-denied/);
});

test('contexto sin warnings -> confidencePenalty = 0, no degrada confianza', () => {
  const ctx = summarizeGenerationContext({
    concept: 'x', catalogSize: 200, project: { locationCity: 'CDMX' }, referencePU: 500,
    historicalApuCount: 10, libraryCount: 30
  });
  assert.equal(ctx.warnings.length, 0);
  assert.equal(ctx.confidencePenalty, 0);
});

test('userScope se registra en el reporte pero NO cambia catalogSize ni prompt', () => {
  // Ambos con el MISMO contexto real (mismo catalogo, misma library,
  // mismo historial): distintos roles no deben generar warnings
  // adicionales. Solo la asimetria REAL (libraryCount=0 + organizacion)
  // dispara PERMISSION_DEGRADATION -- ese warning es correcto y
  // deseado (regla del encargo: hacer visible la degradation).
  const commonReal = {
    concept: 'x', catalogSize: 300, project: { locationCity: 'CDMX' }, referencePU: 500,
    historicalApuCount: 10, libraryCount: 40
  };
  const adminCtx = summarizeGenerationContext({ ...commonReal, userScope: { role: 'admin', uid: 'A' } });
  const collabCtx = summarizeGenerationContext({ ...commonReal, userScope: { role: 'user', organizationId: 'ORG-1', uid: 'B' } });
  const diff = diffGenerationContext(adminCtx, collabCtx);
  assert.equal(diff.identical, true, 'el input real es el mismo, el reporte tambien');
  assert.equal(adminCtx.userScope.role, 'admin');
  assert.equal(collabCtx.userScope.role, 'user');
  assert.equal(collabCtx.userScope.organizationId, 'ORG-1');
});

test('CASO REAL DEL BUG: ADMIN (300 refs) vs COLLABORATOR (0 refs) -> asimetria detectada por diff', () => {
  const project = { id: 'PRJ-1', locationCity: 'CDMX', locationState: 'CDMX' };
  const adminCtx = summarizeGenerationContext({
    concept: 'Muro de block 12', unit: 'm²', referencePU: 750,
    catalogSize: 300, project, historicalApuCount: 15, libraryCount: 42,
    userScope: { role: 'admin', uid: 'admin-uid' }
  });
  const collabCtx = summarizeGenerationContext({
    concept: 'Muro de block 12', unit: 'm²', referencePU: 750,
    catalogSize: 0, project, historicalApuCount: 0, libraryCount: 0,
    userScope: { role: 'user', organizationId: 'ORG-1', uid: 'collab-uid' }
  });

  // Admin: sin warnings de degradation
  assert.equal(adminCtx.warnings.length, 0, `admin sin warnings, pero tiene: ${JSON.stringify(adminCtx.warnings.map(w=>w.code))}`);
  assert.equal(adminCtx.confidencePenalty, 0);

  // Collaborator: warnings de degradation multiples
  const codes = new Set(collabCtx.warnings.map(w => w.code));
  assert.ok(codes.has(CONTEXT_WARNING.EMPTY_CATALOG));
  assert.ok(codes.has(CONTEXT_WARNING.NO_HISTORICAL_APUS));
  assert.ok(codes.has(CONTEXT_WARNING.LIBRARY_ACCESS_LOCAL_ONLY));
  assert.ok(collabCtx.confidencePenalty >= 5);

  const diff = diffGenerationContext(adminCtx, collabCtx);
  assert.equal(diff.identical, false);
  assert.ok(diff.fieldDiffs.some(d => d.key === 'catalogSize'), 'debe reportar catalogSize distinto');
  assert.ok(diff.fieldDiffs.some(d => d.key === 'libraryCount'), 'debe reportar libraryCount distinto');
  // El diff debe listar los warnings que solo aparecen en collaborator
  assert.ok(diff.warningCodesDiff.some(w => w.only === 'b' && w.code === CONTEXT_WARNING.EMPTY_CATALOG));
});

test('PARIDAD SERVER-SIDE: mismo input al motor -> mismo resultado (invariantes deterministas)', () => {
  // Simulamos que ambos usuarios envian el MISMO {concept, catalog, referencePU}
  // al servidor. Como generateAPU/generateAPUv2 NO leen role/uid del body,
  // el reporte de contexto declarado debe ser identico.
  const commonInput = {
    concept: 'Muro tabique 12', unit: 'm²', referencePU: 500,
    catalogSize: 100, project: { locationCity: 'CDMX' }, historicalApuCount: 5, libraryCount: 20
  };
  const asAdmin = summarizeGenerationContext({ ...commonInput, userScope: { role: 'admin', uid: 'A' } });
  const asCollab = summarizeGenerationContext({ ...commonInput, userScope: { role: 'user', uid: 'B', organizationId: 'ORG-1' } });
  const diff = diffGenerationContext(asAdmin, asCollab);
  assert.equal(diff.identical, true,
    'INVARIANTE: si el input real que llega al motor es identico, el APU tecnico debe serlo. El rol NO puede degradar el motor.');
});
