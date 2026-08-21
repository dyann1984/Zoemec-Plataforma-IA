import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreLibraryDoc, searchLibrary, findSimilarMatrices } from './_librarySearch.mjs';

function doc(overrides = {}){
  return {
    id: 'LIB-1', name: 'FASAR OPUS.xlsx', cat: 'Costos', family: 'Bases tecnicas (OPUS/NEODATA)',
    tags: ['opus'], contentText: '', contentInsumos: [], source: 'google-drive', status: 'Subido e indexado', indexed: true,
    ...overrides
  };
}

test('scoreLibraryDoc: sin query regresa score 0 sin coincidencias', () => {
  const r = scoreLibraryDoc(doc(), []);
  assert.equal(r.score, 0);
  assert.deepEqual(r.matchedTerms, []);
});

test('scoreLibraryDoc: coincidencia por nombre suma boost y es explicable', () => {
  const r = scoreLibraryDoc(doc({ name: 'Salarios minimos 2025.xlsx' }), ['salarios']);
  assert.ok(r.score > 0);
  assert.deepEqual(r.matchedTerms, ['salarios']);
});

test('scoreLibraryDoc: coincidencia por contentInsumos.desc queda como evidencia explicita', () => {
  const d = doc({ contentInsumos: [{ desc: 'Block hueco 15x20x40 concreto', unidad: 'pza', precio: 15.5 }] });
  const r = scoreLibraryDoc(d, ['block', 'hueco']);
  assert.ok(r.matchedInsumos.length === 1);
  assert.equal(r.matchedInsumos[0].desc, 'Block hueco 15x20x40 concreto');
});

test('searchLibrary: ordena por score descendente y excluye score 0', () => {
  const docs = [
    doc({ id: 'A', name: 'Catalogo de pinturas.xlsx' }),
    doc({ id: 'B', name: 'Salarios minimos 2025.xlsx' }),
    doc({ id: 'C', name: 'Salarios minimos 2025 con anexos y region SCT.xlsx', contentInsumos: [{ desc: 'Tabulador de salarios minimos por region', unidad: 'jor', precio: 315.04 }] })
  ];
  const results = searchLibrary(docs, 'salarios minimos');
  assert.equal(results.length, 2); // A ("pinturas") no coincide, queda fuera
  assert.equal(results[0].id, 'C'); // ademas del nombre, coincide en un insumo extraido: mas evidencia
  assert.ok(results[0].score > results[1].score);
  assert.ok(results.every(r => r.score > 0));
  assert.ok(results.every(r => Array.isArray(r.matchedTerms)));
});

test('searchLibrary: query vacia no regresa resultados (no hay que devolver todo por defecto)', () => {
  const docs = [doc()];
  assert.deepEqual(searchLibrary(docs, ''), []);
});

test('searchLibrary: cada resultado expone documento fuente, estado y ruta de origen (Fase 3)', () => {
  const docs = [doc({ driveParentPath: ['06 - FASAR OPUS'] })];
  const [r] = searchLibrary(docs, 'fasar opus');
  assert.equal(r.name, 'FASAR OPUS.xlsx');
  assert.equal(r.status, 'Subido e indexado');
  assert.deepEqual(r.driveParentPath, ['06 - FASAR OPUS']);
});

test('findSimilarMatrices: solo considera categorias de matriz/costo y excluye el propio documento', () => {
  const target = doc({ id: 'SELF', name: 'Muro de block hueco 15cm.xlsx', cat: 'Matrices APU' });
  const docs = [
    target,
    doc({ id: 'M1', name: 'Muro de block hueco 20cm.xlsx', cat: 'Matrices APU' }),
    doc({ id: 'ACAD', name: 'Curso de AutoCAD block.xlsx', cat: 'Academia' })
  ];
  const results = findSimilarMatrices(docs, target);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'M1');
});

test('findSimilarMatrices: la evidencia nunca es un score opaco (siempre incluye terminos/insumos coincidentes)', () => {
  const target = { name: 'Muro de block hueco 15cm', concept: 'Muro de block hueco', contentInsumos: [] };
  const docs = [doc({ id: 'M1', name: 'Muro de block hueco 20cm.xlsx', cat: 'Matrices APU' })];
  const [r] = findSimilarMatrices(docs, target);
  assert.ok(r.matchedTerms.length > 0);
  assert.ok('score' in r && 'matchedInsumos' in r && 'cat' in r);
});

test('findSimilarMatrices: acepta un concepto de texto plano (no solo un documento) como objetivo', () => {
  const docs = [doc({ id: 'M1', name: 'Rendimiento de cuadrilla albañil.xlsx', cat: 'Costos' })];
  const results = findSimilarMatrices(docs, 'rendimiento cuadrilla albañil');
  assert.equal(results.length, 1);
});
