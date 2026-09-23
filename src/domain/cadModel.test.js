import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyCadModel, addWall, updateWall, moveWallEndpoint, addOpening, updateOpening, addSpace,
  addDimension, deleteElement, setElementReview, setElementAssignment, rescaleModel, findElement,
  computeWallMetrics, computeSpaceMetrics, computeOpeningMetrics, resolveDimension, validateCadModel,
  elementDisplayStatus, wallPlanPieces, wallEndExtensions, CAD_ISSUE, REVIEW_STATUS, OPENING_TYPE, SCALE_STATUS
} from './cadModel.js';
import { buildFixtureCadModel } from './cadFixture.js';
import { findSnap, SNAP_KIND, orthoConstrain } from './cadSnap.js';
import { createHistory, commitHistory, replacePresent, undoHistory, redoHistory, canUndo, canRedo } from './cadHistory.js';
import { deriveCad3D } from './cad3d.js';
import { buildElementTakeoff, summarizeCadModel, isAssignmentStale, conceptQuantityFromModel, markConceptSynced } from './cadTakeoff.js';
import { hitTestCad, dimensionLayout } from './cadHitTest.js';
import { buildCadModelFromRecognition, mergeParallelWallPairs, healCorners, proposeScale, METERS_PER_PDF_POINT } from './cadRecognition.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

/* ---------- Fixture obligatorio (punto 19) ---------- */

test('fixture 8x8: cuatro muros, puerta, ventana, espacio y cotas con IDs persistentes', () => {
  const m = buildFixtureCadModel();
  assert.deepEqual(m.walls.map(w => w.id), ['M-01', 'M-02', 'M-03', 'M-04']);
  assert.deepEqual(m.openings.map(o => o.id), ['P-01', 'V-01']);
  assert.deepEqual(m.spaces.map(s => s.id), ['ESP-01']);
  assert.deepEqual(m.dimensions.map(d => d.id), ['C-01', 'C-02']);
  m.walls.forEach(w => { close(w.height, 3); close(w.thickness, 0.15); });
});

test('fixture: metricas reales de muros (bruta, huecos, neta) desde el mismo objeto', () => {
  const m = buildFixtureCadModel();
  const m1 = computeWallMetrics(m, 'M-01');
  close(m1.length, 8); close(m1.grossArea, 24); close(m1.openingsArea, 1.89); close(m1.netArea, 22.11);
  const m3 = computeWallMetrics(m, 'M-03');
  close(m3.openingsArea, 2.4); close(m3.netArea, 21.6);
  const m2 = computeWallMetrics(m, 'M-02');
  close(m2.netArea, 24);
  const s = computeSpaceMetrics(m, 'ESP-01');
  close(s.area, 64); close(s.perimeter, 32); close(s.volume, 192);
  const v = computeOpeningMetrics(m, 'V-01');
  close(v.area, 2.4); close(v.sill, 0.9);
  assert.deepEqual(validateCadModel(m).filter(i => i.severity === 'error'), []);
});

test('fixture: cotas ligadas a muros toman la longitud vigente', () => {
  const m = buildFixtureCadModel();
  close(resolveDimension(m, m.dimensions[0]).value, 8);
  const edited = updateWall(m, 'M-01', { length: 7.5 });
  close(resolveDimension(edited, edited.dimensions[0]).value, 7.5);
});

test('fixture 3D: muros, piso, puerta y ventana comparten el id de planta', () => {
  const m = buildFixtureCadModel();
  const r = deriveCad3D(m);
  assert.equal(r.ok, true);
  const ids = new Set(r.elements.map(e => e.objectId));
  for(const id of ['M-01', 'M-02', 'M-03', 'M-04', 'P-01', 'V-01', 'ESP-01']) assert.ok(ids.has(id), `falta ${id} en 3D`);
  // M-01 tiene puerta -> tramo izq, tramo der y dintel (sin pretil: antepecho 0)
  const m1 = r.elements.filter(e => e.objectId === 'M-01');
  assert.equal(m1.length, 3);
  // M-03 tiene ventana -> izq, der, dintel y pretil
  assert.equal(r.elements.filter(e => e.objectId === 'M-03').length, 4);
  const door = r.elements.find(e => e.objectId === 'P-01');
  close(door.dimensions.width, 0.9); close(door.dimensions.height, 2.1); close(door.position.y, 1.05);
  const win = r.elements.find(e => e.objectId === 'V-01');
  close(win.dimensions.width, 2); close(win.position.y, 0.9 + 0.6);
  // Escala visual correcta: bounds 8 x 8 x 3
  close(r.bounds.maxX - r.bounds.minX, 8); close(r.bounds.maxZ - r.bounds.minZ, 8); close(r.bounds.height, 3);
  // El area de muro en 3D (suma de tramos, sin extensiones de esquina) = area neta
  const ext = wallEndExtensions(m, m.walls[0]);
  const area3d = m1.reduce((s, e) => s + e.dimensions.width * e.dimensions.height, 0) - (ext.start + ext.end) * 3;
  close(area3d, 22.11, 1e-6);
});

/* ---------- Edicion y recalculo (punto 4) ---------- */

test('editar longitud/espesor/altura recalcula todas las cantidades', () => {
  let m = buildFixtureCadModel();
  m = updateWall(m, 'M-02', { height: 2.7, thickness: 0.2 });
  const w = computeWallMetrics(m, 'M-02');
  close(w.grossArea, 21.6); close(w.thickness, 0.2); close(w.netVolume, 21.6 * 0.2);
  assert.throws(() => updateWall(m, 'M-02', { height: 0 }), /mayor que cero/);
  assert.throws(() => updateWall(m, 'M-02', { length: 0.01 }), /al menos/);
});

test('mover un extremo arrastra la esquina conectada y el espacio (sin resultados viejos)', () => {
  let m = buildFixtureCadModel();
  m = moveWallEndpoint(m, 'M-01', 'end', { x: 9, y: 0 });
  const m1 = m.walls.find(w => w.id === 'M-01'), m2 = m.walls.find(w => w.id === 'M-02');
  assert.deepEqual([m1.x2, m1.y2], [9, 0]);
  assert.deepEqual([m2.x1, m2.y1], [9, 0]);
  close(computeSpaceMetrics(m, 'ESP-01').area, (8 + 9) / 2 * 8);
  // sin conexion: solo el muro
  const n = moveWallEndpoint(buildFixtureCadModel(), 'M-01', 'end', { x: 9, y: 0 }, { connected: false });
  assert.deepEqual([n.walls[1].x1, n.walls[1].y1], [8, 0]);
});

test('puerta/ventana: cambiar posicion, ancho, alto y antepecho; validacion de errores', () => {
  let m = buildFixtureCadModel();
  m = updateOpening(m, 'V-01', { width: 1.5, height: 1.0, sill: 1.1 });
  close(computeWallMetrics(m, 'M-03').openingsArea, 1.5);
  m = updateOpening(m, 'V-01', { at: { x: 1, y: 8 } });
  // centrada en x=1 sobre M-03 (que va de x=8 a x=0): borde cercano en distancia 6.25 desde el inicio
  close(m.openings.find(o => o.id === 'V-01').offset, 6.25);
  const bad = updateOpening(m, 'V-01', { offset: 7.5 });
  const issues = validateCadModel(bad);
  assert.ok(issues.some(i => i.id === 'V-01' && i.code === CAD_ISSUE.OPENING_EXCEEDS_WALL));
  assert.equal(elementDisplayStatus(issues, 'V-01'), 'error');
  const tall = updateOpening(m, 'P-01', { height: 3.5 });
  assert.ok(validateCadModel(tall).some(i => i.code === CAD_ISSUE.OPENING_TOO_TALL));
  close(computeWallMetrics(tall, 'M-01').openingsArea, 0.9 * 3); // descuento recortado a la altura del muro
});

test('aberturas traslapadas se reportan', () => {
  let m = buildFixtureCadModel();
  ({ model: m } = addOpening(m, { type: OPENING_TYPE.WINDOW, wallId: 'M-01', offset: 1.5, width: 1 }));
  assert.ok(validateCadModel(m).some(i => i.code === CAD_ISSUE.OPENINGS_OVERLAP));
});

test('eliminar un muro elimina sus huecos y cotas; los IDs nunca se reutilizan', () => {
  let m = buildFixtureCadModel();
  m = deleteElement(m, 'M-01');
  assert.equal(findElement(m, 'P-01'), null);
  assert.equal(findElement(m, 'C-01'), null);
  let id;
  ({ model: m, id } = addWall(m, { x1: 0, y1: 0, x2: 8, y2: 0 }));
  assert.equal(id, 'M-05');
  ({ model: m, id } = addOpening(m, { type: OPENING_TYPE.DOOR, wallId: 'M-05' }));
  assert.equal(id, 'P-02');
});

test('addWall/addSpace rechazan geometria degenerada', () => {
  const m = createEmptyCadModel();
  assert.throws(() => addWall(m, { x1: 0, y1: 0, x2: 0.01, y2: 0 }));
  assert.throws(() => addSpace(m, { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }));
  assert.throws(() => addOpening(m, { type: 'door', wallId: 'M-99' }), /muro existente/);
});

test('piezas de muro en planta: el hueco de la puerta corta el solido', () => {
  const m = buildFixtureCadModel();
  const pieces = wallPlanPieces(m, m.walls[0]);
  assert.equal(pieces.length, 2);
  // primera pieza: desde -0.075 (esquina) hasta 1.0 (inicio de puerta)
  close(pieces[0][0].x, -0.075); close(pieces[0][1].x, 1.0);
  close(pieces[1][0].x, 1.9); close(pieces[1][1].x, 8.075);
});

/* ---------- Snap (punto 5) ---------- */

test('snap: endpoint > interseccion > midpoint > nearest', () => {
  const m = buildFixtureCadModel();
  assert.equal(findSnap(m, { x: 8.1, y: 0.05 }, { tolerance: 0.2 }).kind, SNAP_KIND.ENDPOINT);
  const mid = findSnap(m, { x: 4.05, y: 0.1 }, { tolerance: 0.2 });
  assert.equal(mid.kind, SNAP_KIND.MIDPOINT); close(mid.x, 4);
  const near = findSnap(m, { x: 2.5, y: 0.1 }, { tolerance: 0.2 });
  assert.equal(near.kind, SNAP_KIND.NEAREST); close(near.y, 0); close(near.x, 2.5);
  assert.equal(findSnap(m, { x: 4, y: 4 }, { tolerance: 0.2 }), null);
  let cross;
  ({ model: cross } = addWall(m, { x1: 4, y1: -1, x2: 4, y2: 1 }));
  const inter = findSnap(cross, { x: 4.05, y: 0.02 }, { tolerance: 0.1, settings: { endpoint: true, intersection: true, midpoint: false, nearest: true } });
  assert.equal(inter.kind, SNAP_KIND.INTERSECTION);
  assert.deepEqual(orthoConstrain({ x: 0, y: 0 }, { x: 5, y: 0.3 }), { x: 5, y: 0 });
});

/* ---------- Deshacer / rehacer (punto 18) ---------- */

test('historial: crear, mover, cambiar dimension y eliminar se deshacen y rehacen', () => {
  let h = createHistory(buildFixtureCadModel());
  h = commitHistory(h, updateWall(h.present, 'M-02', { height: 2.5 }), 'altura');
  h = commitHistory(h, deleteElement(h.present, 'V-01'), 'eliminar');
  // arrastre: estados intermedios sin historial, un solo commit
  const before = h.present;
  h = replacePresent(h, moveWallEndpoint(before, 'M-01', 'end', { x: 8.5, y: 0 }));
  h = replacePresent(h, moveWallEndpoint(before, 'M-01', 'end', { x: 9, y: 0 }));
  h = { ...h, present: before };
  h = commitHistory(h, moveWallEndpoint(before, 'M-01', 'end', { x: 9, y: 0 }), 'mover');
  assert.equal(h.past.length, 3);
  h = undoHistory(h);
  assert.equal(h.present.walls[0].x2, 8);
  h = undoHistory(h);
  assert.ok(findElement(h.present, 'V-01'));
  h = redoHistory(h);
  assert.equal(findElement(h.present, 'V-01'), null);
  assert.ok(canUndo(h) && canRedo(h));
  h = commitHistory(h, updateWall(h.present, 'M-03', { height: 2 }), 'x');
  assert.equal(canRedo(h), false);
});

/* ---------- Cuantificacion y conexion concepto/APU (puntos 15-16) ---------- */

test('cuantificar muro: propuesta desde el mismo objeto y deteccion de asignacion desactualizada', () => {
  let m = buildFixtureCadModel();
  const t = buildElementTakeoff(m, 'M-01');
  assert.equal(t.primary.field, 'netArea'); close(t.primary.value, 22.11); assert.equal(t.primary.unit, 'm²');
  m = setElementAssignment(m, 'M-01', { conceptId: 'CAT-1', concept: 'Muro de block', unit: 'm²', quantityField: 'netArea', syncedQty: 22.11, apuId: 'A7C3YJ' });
  assert.equal(isAssignmentStale(m, m.walls[0]), false);
  m = updateWall(m, 'M-01', { height: 2.7 });
  assert.equal(isAssignmentStale(m, m.walls[0]), true);
  // la asignacion sobrevive a la edicion (misma pared, mismo id)
  assert.equal(m.walls[0].assignment.apuId, 'A7C3YJ');
  assert.throws(() => setElementAssignment(m, 'C-01', {}));
});

test('concepto compartido: la cantidad es la suma vigente de los objetos ligados', () => {
  let m = buildFixtureCadModel();
  for(const id of ['M-01', 'M-02']) m = setElementAssignment(m, id, { conceptId: 'CAT-9', concept: 'Muro de block', unit: 'm²', quantityField: 'netArea' });
  m = setElementAssignment(m, 'P-01', { conceptId: 'CAT-9', concept: 'Muro de block', unit: 'm²', quantityField: 'pieces' });
  const q = conceptQuantityFromModel(m, 'CAT-9', 'm²');
  close(q.qty, 22.11 + 24); assert.deepEqual(q.elementIds, ['M-01', 'M-02']); assert.deepEqual(q.mismatched, ['P-01']);
  m = markConceptSynced(m, 'CAT-9', { apuId: 'A7C3YJ' });
  close(m.walls[0].assignment.syncedQty, 22.11);
  assert.equal(m.walls[1].assignment.apuId, 'A7C3YJ');
  assert.equal(isAssignmentStale(m, m.walls[0]), false);
  m = updateOpening(m, 'P-01', { width: 1.2 });
  assert.equal(isAssignmentStale(m, m.walls[0]), true);
});

test('cuantificar espacio y puerta', () => {
  const m = buildFixtureCadModel();
  const s = buildElementTakeoff(m, 'ESP-01');
  close(s.primary.value, 64); assert.ok(s.lines.some(l => l.key === 'ceilingArea'));
  const p = buildElementTakeoff(m, 'P-01');
  assert.equal(p.primary.unit, 'pza');
});

test('resumen del modelo: conteos, pendientes y estado de validacion', () => {
  let m = buildFixtureCadModel();
  let s = summarizeCadModel(m);
  assert.deepEqual(s.counts, { walls: 4, doors: 1, windows: 1, spaces: 1, dimensions: 2 });
  assert.equal(s.isValidated, true);
  m = setElementReview(m, 'M-02', REVIEW_STATUS.PENDIENTE);
  s = summarizeCadModel(m);
  assert.deepEqual(s.pending, ['M-02']);
  assert.equal(s.isValidated, false);
});

/* ---------- Persistencia (punto 17) ---------- */

test('el modelo es JSON plano sin arreglos anidados (compatible con Firestore) y sobrevive ida y vuelta', () => {
  let m = buildFixtureCadModel();
  m = setElementAssignment(m, 'M-01', { conceptId: 'CAT-1', concept: 'Muro', unit: 'm²', quantityField: 'netArea', syncedQty: 22.11 });
  const hasNestedArray = (v) => Array.isArray(v) ? v.some(x => Array.isArray(x) || hasNestedArray(x)) : (v && typeof v === 'object' ? Object.values(v).some(hasNestedArray) : false);
  assert.equal(hasNestedArray(m), false);
  const restored = JSON.parse(JSON.stringify(m));
  assert.deepEqual(restored, m);
  close(computeWallMetrics(restored, 'M-01').netArea, 22.11);
});

/* ---------- Escala / calibracion ---------- */

test('rescale: calibrar escala todo lo dibujado pero no alturas ni medidas de usuario', () => {
  let m = createEmptyCadModel({ underlay: { kind: 'pdf', widthUnits: 100, heightUnits: 100, metersPerUnit: 0.01 } });
  ({ model: m } = addWall(m, { x1: 0, y1: 0, x2: 4, y2: 0, thicknessSource: 'DIBUJO', thickness: 0.1, height: 2.5 }));
  ({ model: m } = addOpening(m, { type: 'door', wallId: 'M-01', offset: 1, width: 0.9, source: 'IA' }));
  const r = rescaleModel(m, 2);
  close(computeWallMetrics(r, 'M-01').length, 8);
  close(r.walls[0].thickness, 0.2); close(r.walls[0].height, 2.5);
  close(r.openings[0].offset, 2); close(r.openings[0].width, 1.8);
  close(r.underlay.metersPerUnit, 0.02);
});

/* ---------- Reconocimiento asistido (punto 7) ---------- */

test('escala propuesta: detectada queda PENDIENTE/MEDIA; sin escala 1:100 provisional BAJA', () => {
  const det = proposeScale({ fuente: 'cotas_texto', realUnitsPerPdfPoint: 50 * METERS_PER_PDF_POINT });
  assert.equal(det.status, SCALE_STATUS.PENDIENTE); assert.equal(det.confidenceLevel, 'MEDIA'); close(det.ratio, 50);
  const none = proposeScale({ fuente: 'no_determinada', realUnitsPerPdfPoint: null });
  assert.equal(none.status, SCALE_STATUS.NO_DETERMINADA); assert.equal(none.confidenceLevel, 'BAJA'); close(none.ratio, 100);
  const user = proposeScale({ fuente: 'referencia_usuario', realUnitsPerPdfPoint: 0.01 });
  assert.equal(user.status, SCALE_STATUS.CONFIRMADA);
});

test('muros de doble linea se fusionan en un eje con espesor medido; esquinas se cierran', () => {
  const axes = [
    { x1: 0, y1: 0, x2: 8, y2: 0, sourceElementIds: ['a'] },
    { x1: 0, y1: 0.15, x2: 8, y2: 0.15, sourceElementIds: ['b'] }
  ];
  const merged = mergeParallelWallPairs(axes);
  assert.equal(merged.length, 1);
  close(merged[0].y1, 0.075); close(merged[0].thickness, 0.15);
  const healed = healCorners([{ x1: 0, y1: 0, x2: 7.8, y2: 0 }, { x1: 8, y1: 0.2, x2: 8, y2: 8 }]);
  assert.deepEqual([healed[0].x2, healed[0].y2], [8, 0]);
  assert.deepEqual([healed[1].x1, healed[1].y1], [8, 0]);
});

test('reconocimiento: vector -> muros PENDIENTE con confianza; IA sin ubicacion -> lista de no ubicados', () => {
  // Cuadrado de 8m a escala 1:100 en puntos PDF (1 pt = 0.0254/72 m -> 8 m = 226.77 pt a 1:100)
  const s = 8 / (100 * METERS_PER_PDF_POINT);
  const seg = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });
  const vec = (id, segs) => ({ id, tipo: 'muro', pagina: 1, estado: 'DETECTADO_VECTORIAL', confianzaIA: 95, origin: 'VECTOR_DETECTED', geometry: { kind: 'segments', segments: segs } });
  const elementos = [
    vec('v1', [seg(0, 0, s, 0)]), vec('v2', [seg(s, 0, s, s)]), vec('v3', [seg(s, s, 0, s)]), vec('v4', [seg(0, s, 0, 0)]),
    { id: 'ai1', tipo: 'puerta', pagina: 1, estado: 'PROPUESTO_POR_IA', confianzaIA: 74, geometry: null },
    { id: 'ai2', tipo: 'muro', pagina: 1, estado: 'RECHAZADO', confianzaIA: 50, geometry: { kind: 'segments', segments: [seg(0, 0, s, s)] } }
  ];
  const { model, report } = buildCadModelFromRecognition({
    elementos,
    resolvedScale: { fuente: 'escala_grafica', realUnitsPerPdfPoint: 100 * METERS_PER_PDF_POINT },
    underlay: { kind: 'pdf', page: 1, widthUnits: 612, heightUnits: 792 },
    toViewport: (x, y) => ({ x, y: 792 - y })
  });
  assert.equal(report.walls, 4);
  assert.equal(model.walls.length, 4);
  model.walls.forEach(w => { assert.equal(w.review.status, REVIEW_STATUS.PENDIENTE); assert.equal(w.review.confidence, 95); assert.equal(w.review.level, 'ALTA'); });
  model.walls.forEach(w => close(computeWallMetrics(model, w).length, 8, 1e-6));
  assert.equal(report.unplaced.length, 1);
  assert.equal(report.unplaced[0].id, 'ai1');
  assert.equal(model.scale.status, SCALE_STATUS.PENDIENTE);
  const summary = summarizeCadModel(model);
  assert.equal(summary.pending.length, 4);
  // aceptar una propuesta
  const accepted = setElementReview(model, 'M-01', REVIEW_STATUS.CONFIRMADO);
  assert.equal(summarizeCadModel(accepted).pending.length, 3);
});

test('reconocimiento: puerta de IA con bbox se aloja en el muro mas cercano como PENDIENTE', () => {
  const s = 8 / (100 * METERS_PER_PDF_POINT);
  const elementos = [
    { id: 'v1', tipo: 'muro', pagina: 1, estado: 'DETECTADO_VECTORIAL', confianzaIA: 95, geometry: { kind: 'segments', segments: [{ x1: 0, y1: 792, x2: s, y2: 792 }] } },
    // bbox en fracciones de pagina (612x792 pt) cerca de y=0 del mundo, x ~ 2..3 m
    { id: 'ai-door', tipo: 'puerta', pagina: 1, estado: 'PROPUESTO_POR_IA', confianzaIA: 74, geometry: { kind: 'bbox', bbox: { x0: (2 / 8) * s / 612, y0: 0, x1: (2.9 / 8) * s / 612, y1: 0.005 } } }
  ];
  const { model, report } = buildCadModelFromRecognition({
    elementos,
    resolvedScale: { fuente: 'escala_grafica', realUnitsPerPdfPoint: 100 * METERS_PER_PDF_POINT },
    underlay: { kind: 'pdf', page: 1, widthUnits: 612, heightUnits: 792 },
    toViewport: (x, y) => ({ x, y: 792 - y })
  });
  assert.equal(report.doors, 1);
  const door = model.openings[0];
  assert.equal(door.wallId, 'M-01');
  assert.equal(door.review.status, REVIEW_STATUS.PENDIENTE);
  assert.equal(door.review.level, 'MEDIA');
  close(door.width, 0.9, 1e-6);
});

test('seleccion por clic: ventana gana al muro, cota, muro y espacio; capas bloqueadas se excluyen', () => {
  const m = buildFixtureCadModel();
  assert.equal(hitTestCad(m, { x: 4, y: 8.02 }, 0.1), 'V-01');
  assert.equal(hitTestCad(m, { x: 6, y: 8.02 }, 0.1), 'M-03');
  assert.equal(hitTestCad(m, { x: 4, y: -0.7 }, 0.1), 'C-01');
  assert.equal(hitTestCad(m, { x: 4, y: 4 }, 0.1), 'ESP-01');
  assert.equal(hitTestCad(m, { x: 20, y: 20 }, 0.1), null);
  assert.equal(hitTestCad(m, { x: 6, y: 7.97 }, 0.1), 'M-03');
  assert.equal(hitTestCad(m, { x: 6, y: 7.97 }, 0.1, { isSelectable: kind => kind !== 'wall' }), 'ESP-01');
  const lay = dimensionLayout(m, m.dimensions[0]);
  close(lay.p1.y, -0.7); close(lay.value, 8); close(lay.angle, 0);
});

test('cota libre: pendiente de validacion y cotas huerfanas se reportan', () => {
  let m = buildFixtureCadModel();
  ({ model: m } = addDimension(m, { a: { x: 0, y: 0 }, b: { x: 3, y: 4 }, status: 'PENDIENTE_VALIDACION' }));
  close(resolveDimension(m, m.dimensions[2]).value, 5);
  assert.ok(validateCadModel(m).some(i => i.code === CAD_ISSUE.DIMENSION_PENDING && i.id === 'C-03'));
  const ok = setElementReview(m, 'C-03', REVIEW_STATUS.CONFIRMADO);
  assert.equal(ok.dimensions[2].status, 'OK');
});
