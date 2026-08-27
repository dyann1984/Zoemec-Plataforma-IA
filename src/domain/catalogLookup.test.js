import test from 'node:test';
import assert from 'node:assert/strict';
import { findCatalogMatches } from './catalogLookup.js';
import { NullSemanticProvider } from '../lib/semanticProvider.js';

test('findCatalogMatches: sin catalogo regresa null', () => {
  assert.equal(findCatalogMatches([], { desc: 'Cemento gris 50kg' }), null);
  assert.equal(findCatalogMatches(null, { desc: 'Cemento gris 50kg' }), null);
});

test('findCatalogMatches: 1) clave_exacta gana sobre cualquier otro criterio', () => {
  const catalog = [
    { desc: 'Cemento gris relleno generico', unidad: 'saco', precio: 999, clave: 'OTRO' },
    { desc: 'Cemento portland gris 50kg CPC-30R', unidad: 'saco', precio: 182, clave: 'MAT-CEM-01' }
  ];
  const found = findCatalogMatches(catalog, { desc: 'no importa el texto', clave: 'MAT-CEM-01' });
  assert.equal(found.matchMethod, 'clave_exacta');
  assert.equal(found.confidence, 1);
  assert.equal(found.match.precio, 182);
});

test('findCatalogMatches: 2) alias_sinonimo exacto', () => {
  const catalog = [
    { desc: 'Cemento portland gris 50kg CPC-30R', unidad: 'saco', precio: 182, sinonimos: ['Cemento gris saco 50 kg'] }
  ];
  const found = findCatalogMatches(catalog, { desc: 'Cemento gris saco 50 kg' });
  assert.equal(found.matchMethod, 'alias_sinonimo');
  assert.equal(found.confidence, 0.95);
  assert.equal(found.match.precio, 182);
});

test('findCatalogMatches: 3) descripcion_normalizada -- mismo texto salvo acentos/mayusculas/puntuacion, SIN sinonimo registrado', () => {
  const catalog = [
    { desc: 'Cemento Gris CPC-30R', unidad: 'saco', precio: 182 }
  ];
  const found = findCatalogMatches(catalog, { desc: 'cemento gris cpc 30r' }); // sin acentos/guion/mayusculas
  assert.equal(found.matchMethod, 'descripcion_normalizada');
  assert.equal(found.confidence, 0.97);
  assert.equal(found.match.precio, 182);
});

test('findCatalogMatches: 4) categoria_unidad -- overlap de texto bajo pero real, misma categoria y unidad exactas', () => {
  const catalog = [
    { desc: 'Adhesivo cementicio para piso', unidad: 'bulto', categoria: 'Pegazulejos', precio: 145 },
    { desc: 'Sellador acrilico para muro', unidad: 'lote', categoria: 'Pinturas', precio: 90 }
  ];
  // "Mortero adherente especial" no comparte suficientes tokens con
  // "Adhesivo cementicio para piso" para el umbral fuzzy_token (0.34), pero
  // SI comparte categoria+unidad exactas -- debe resolver aqui, no en fuzzy.
  const found = findCatalogMatches(catalog, { desc: 'Mortero adherente para piso especial', unidad: 'bulto', categoria: 'Pegazulejos' });
  assert.equal(found.matchMethod, 'categoria_unidad');
  assert.equal(found.match.precio, 145);
  assert.ok(found.confidence >= 0.4 && found.confidence <= 0.65);
});

test('findCatalogMatches: categoria_unidad NUNCA decide solo por categoria/unidad sin ningun overlap real de texto', () => {
  const catalog = [
    { desc: 'Producto totalmente distinto sin relacion alguna', unidad: 'bulto', categoria: 'Pegazulejos', precio: 500 }
  ];
  const found = findCatalogMatches(catalog, { desc: 'Adhesivo para piso ceramico', unidad: 'bulto', categoria: 'Pegazulejos' });
  assert.equal(found, null);
});

test('findCatalogMatches: 5) fuzzy_token (Jaccard por tokens, NUNCA presentado como semantica) con bonus de categoria/unidad', () => {
  const catalog = [
    { desc: 'Cemento portland gris comun 50kg', unidad: 'saco', categoria: 'Cementantes', precio: 182 },
    { desc: 'Cemento blanco especial 25kg', unidad: 'saco', categoria: 'Cementantes', precio: 340 }
  ];
  const found = findCatalogMatches(catalog, { desc: 'Cemento gris comun de 50 kg', unidad: 'saco', categoria: 'Cementantes' });
  assert.equal(found.matchMethod, 'fuzzy_token');
  assert.equal(found.match.precio, 182);
  assert.ok(found.confidence > 0 && found.confidence < 1);
});

test('findCatalogMatches: bajo el umbral de fuzzy_token regresa null (nunca inventa una coincidencia)', () => {
  const catalog = [{ desc: 'Loseta ceramica 60x60', unidad: 'm2', precio: 280 }];
  const found = findCatalogMatches(catalog, { desc: 'Varilla de acero corrugado 3/8' });
  assert.equal(found, null);
});

test('findCatalogMatches: 6) semantic_provider es OPCIONAL -- sin proveedor, nunca se activa (comportamiento identico a hoy)', () => {
  const catalog = [{ desc: 'Xyz totalmente distinto', unidad: 'pza', precio: 10 }];
  const found = findCatalogMatches(catalog, { desc: 'Nada que se le parezca' }, { semanticProvider: NullSemanticProvider });
  assert.equal(found, null);
});

test('findCatalogMatches: 6) semantic_provider SI se usa cuando esta disponible y ninguna etapa anterior encontro nada', () => {
  const catalog = [{ desc: 'Xyz totalmente distinto', unidad: 'pza', precio: 10 }];
  const fakeProvider = { available: true, match: (items) => ({ match: items[0], confidence: 0.7 }) };
  const found = findCatalogMatches(catalog, { desc: 'Nada que se le parezca' }, { semanticProvider: fakeProvider });
  assert.equal(found.matchMethod, 'semantic_provider');
  assert.equal(found.confidence, 0.7);
});

test('findCatalogMatches: match de VERIFICADO se distingue en el shape devuelto', () => {
  const catalog = [{ desc: 'Cemento gris 50kg', unidad: 'saco', precio: 182, clave: 'MAT-01', estado: 'VERIFICADO' }];
  const found = findCatalogMatches(catalog, { desc: 'x', clave: 'MAT-01' });
  assert.equal(found.match.estado, 'VERIFICADO');
});

test('findCatalogMatches: con `tipo`, nunca cruza categorias (hueco real encontrado en auditoria: mano de obra podia empatar contra un material por pura coincidencia de texto)', () => {
  const catalog = [
    { desc: 'Cuadrilla de colocador de piso cerámico', unidad: 'jor', precio: 850, tipo: 'labor' },
    { desc: 'Piso cerámico nacional 30x30', unidad: 'm²', precio: 210, tipo: 'material' }
  ];
  const laborMatch = findCatalogMatches(catalog, { desc: 'Colocador de piso ceramico oficial', tipo: 'labor' });
  assert.equal(laborMatch.match.tipo, 'labor');
  assert.equal(laborMatch.match.precio, 850);
  const materialMatch = findCatalogMatches(catalog, { desc: 'Piso ceramico nacional', tipo: 'material' });
  assert.equal(materialMatch.match.tipo, 'material');
  assert.equal(materialMatch.match.precio, 210);
});

test('findCatalogMatches: sin `tipo` en la fila del catalogo (legacy), sigue siendo candidata sin importar el `tipo` de la consulta (compatibilidad hacia atras)', () => {
  const catalog = [{ desc: 'Cemento portland gris 50kg', unidad: 'saco', precio: 182 }]; // sin tipo, catalogo "viejo"
  const found = findCatalogMatches(catalog, { desc: 'Cemento gris comun 50 kg', tipo: 'material' });
  assert.ok(found);
  assert.equal(found.match.precio, 182);
});

test('findCatalogMatches: rendimiento/cuadrilla de un registro de mano de obra encontrado por CLAVE exacta (fase de correccion "Rendimientos reales", punto 1 del spec)', () => {
  const catalog = [
    { desc: 'Cuadrilla de colocador de piso con ayudante, zona centro', unidad: 'jor', precio: 890, clave: 'MO-COLOC-PISO', tipo: 'labor', rendimiento: 22, rendimientoUnidad: 'm²/jornada', cuadrilla: 2 }
  ];
  const found = findCatalogMatches(catalog, { desc: 'cualquier texto', clave: 'MO-COLOC-PISO', tipo: 'labor' });
  assert.equal(found.matchMethod, 'clave_exacta');
  assert.equal(found.match.rendimiento, 22);
  assert.equal(found.match.cuadrilla, 2);
});
