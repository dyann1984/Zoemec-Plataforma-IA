/* Cuantificacion desde el modelo comun (puntos 15-16). Cada cifra sale de
   las funciones de metricas de cadModel.js sobre el objeto VIGENTE -- nunca
   de un numero guardado aparte. La propuesta de un elemento declara cual es
   su cantidad PRINCIPAL (la que viaja al concepto/APU): area neta para un
   muro, area para un espacio, piezas para puertas/ventanas.

   `assignment` (guardado en el objeto) solo recuerda A QUE concepto/APU se
   ligo y con que cantidad se sincronizo por ultima vez (`syncedQty`); la
   cantidad vigente se recalcula siempre, y `isAssignmentStale` avisa cuando
   la geometria cambio despues de sincronizar -- nunca se muestra un
   resultado viejo como si fuera actual. */
import {
  CAD_KIND, OPENING_TYPE, REVIEW_STATUS, findElement,
  computeWallMetrics, computeOpeningMetrics, computeSpaceMetrics, resolveDimension, validateCadModel
} from './cadModel.js';

const line = (key, label, value, unit, extra = {}) => ({ key, label, value, unit, ...extra });

export function buildElementTakeoff(model, id){
  const found = findElement(model, id);
  if(!found) return null;
  const { kind, element } = found;
  if(kind === CAD_KIND.WALL){
    const m = computeWallMetrics(model, element);
    return {
      id, kind, title: `Muro ${id}`,
      lines: [
        line('length', 'Longitud', m.length, 'm'),
        line('height', 'Altura', m.height, 'm'),
        line('thickness', 'Espesor', m.thickness, 'm'),
        line('grossArea', 'Área bruta', m.grossArea, 'm²'),
        line('openingsArea', 'Huecos', m.openingsArea, 'm²'),
        line('netArea', 'Área neta', m.netArea, 'm²', { primary: true }),
        line('netVolume', 'Volumen neto', m.netVolume, 'm³')
      ],
      primary: { field: 'netArea', value: m.netArea, unit: 'm²' },
      suggestedConcept: 'Muro',
      capitulo: 'ALBANILERIA'
    };
  }
  if(kind === CAD_KIND.OPENING){
    const m = computeOpeningMetrics(model, element);
    const isDoor = element.type === OPENING_TYPE.DOOR;
    return {
      id, kind, title: `${isDoor ? 'Puerta' : 'Ventana'} ${id}`,
      lines: [
        line('pieces', 'Piezas', 1, 'pza', { primary: true }),
        line('width', 'Ancho', m.width, 'm'),
        line('height', 'Alto', m.height, 'm'),
        ...(isDoor ? [] : [line('sill', 'Antepecho', m.sill, 'm')]),
        line('area', 'Área del vano', m.area, 'm²')
      ],
      primary: { field: 'pieces', value: 1, unit: 'pza' },
      suggestedConcept: isDoor ? `Puerta ${m.width.toFixed(2)} × ${m.height.toFixed(2)} m` : `Ventana ${m.width.toFixed(2)} × ${m.height.toFixed(2)} m`,
      capitulo: 'CANCELERIA_CARPINTERIA'
    };
  }
  if(kind === CAD_KIND.SPACE){
    const m = computeSpaceMetrics(model, element);
    return {
      id, kind, title: `${element.name} (${id})`,
      lines: [
        line('area', 'Área', m.area, 'm²', { primary: true }),
        line('floorArea', 'Piso', m.floorArea, 'm²'),
        line('ceilingArea', 'Plafón', m.ceilingArea, 'm²'),
        line('perimeter', 'Perímetro', m.perimeter, 'm'),
        line('wallFinishArea', 'Acabado en muros (perímetro × altura)', m.wallFinishArea, 'm²'),
        line('volume', 'Volumen', m.volume, 'm³')
      ],
      primary: { field: 'area', value: m.area, unit: 'm²' },
      suggestedConcept: `Piso en ${element.name}`,
      capitulo: 'ACABADOS'
    };
  }
  const r = resolveDimension(model, element);
  return {
    id, kind, title: `Cota ${id}`,
    lines: [line('distance', 'Distancia', r.value, 'm', { primary: true })],
    primary: { field: 'distance', value: r.value, unit: 'm' },
    suggestedConcept: null,
    capitulo: null
  };
}

/* Cantidades alternativas que un espacio puede cuantificar (Piso/Plafon del
   punto 14): mismo objeto, otro campo -- nunca un objeto duplicado. */
export function takeoffLineValue(model, id, field){
  const t = buildElementTakeoff(model, id);
  return t?.lines.find(l => l.key === field) || null;
}

export function isAssignmentStale(model, element){
  const a = element?.assignment;
  if(!a || a.syncedQty == null) return false;
  const current = takeoffLineValue(model, element.id, a.quantityField || buildElementTakeoff(model, element.id)?.primary.field);
  if(!current || current.value == null) return false;
  return Math.abs(Number(current.value) - Number(a.syncedQty)) > 0.005;
}

/* Cantidad de un concepto del catalogo = suma de la cantidad VIGENTE de
   todos los objetos del plano ligados a el (ej. M-01..M-04 -> "Muro de
   block"). Solo suma objetos con la misma unidad del concepto; cualquier
   otro se reporta en `mismatched` en vez de mezclar m² con pza. */
export function conceptQuantityFromModel(model, conceptId, unit = null){
  const elements = [...(model?.walls || []), ...(model?.openings || []), ...(model?.spaces || [])]
    .filter(el => el.assignment?.conceptId === conceptId);
  let qty = 0;
  const elementIds = [], mismatched = [];
  for(const el of elements){
    const field = el.assignment.quantityField || buildElementTakeoff(model, el.id)?.primary.field;
    const l = takeoffLineValue(model, el.id, field);
    if(!l || l.value == null) continue;
    if(unit && l.unit !== unit){ mismatched.push(el.id); continue; }
    qty += Number(l.value);
    elementIds.push(el.id);
  }
  return { qty: Math.round(qty * 10000) / 10000, elementIds, mismatched };
}

/* Tras sincronizar con el catalogo: estampa en cada objeto ligado la cifra
   que se envio, para que isAssignmentStale detecte cambios posteriores. */
export function markConceptSynced(model, conceptId, patch = {}){
  const stamp = el => {
    if(el.assignment?.conceptId !== conceptId) return el;
    const field = el.assignment.quantityField || buildElementTakeoff(model, el.id)?.primary.field;
    const l = takeoffLineValue(model, el.id, field);
    return { ...el, assignment: { ...el.assignment, ...patch, syncedQty: l?.value ?? null, syncedAt: new Date().toISOString() } };
  };
  return {
    ...model,
    walls: (model.walls || []).map(stamp),
    openings: (model.openings || []).map(stamp),
    spaces: (model.spaces || []).map(stamp)
  };
}

/* Resumen del modelo (modo revision, punto 8, y barra de estado). */
export function summarizeCadModel(model){
  const issues = validateCadModel(model);
  const pendingIds = new Set(issues.filter(i => i.severity === 'pending' && i.id).map(i => i.id));
  const errorIds = new Set(issues.filter(i => i.severity === 'error' && i.id).map(i => i.id));
  const doors = (model?.openings || []).filter(o => o.type === OPENING_TYPE.DOOR);
  const windows = (model?.openings || []).filter(o => o.type === OPENING_TYPE.WINDOW);
  const wallMetrics = (model?.walls || []).map(w => computeWallMetrics(model, w));
  const spaceMetrics = (model?.spaces || []).map(s => computeSpaceMetrics(model, s));
  const confirmedWalls = (model?.walls || []).filter(w => w.review?.status !== REVIEW_STATUS.PENDIENTE).map(w => w.id);
  const sum = (arr, k) => Math.round(arr.reduce((s, m) => s + (m?.[k] || 0), 0) * 10000) / 10000;
  return {
    counts: {
      walls: (model?.walls || []).length,
      doors: doors.length,
      windows: windows.length,
      spaces: (model?.spaces || []).length,
      dimensions: (model?.dimensions || []).length
    },
    totals: {
      wallLength: sum(wallMetrics, 'length'),
      wallNetArea: sum(wallMetrics, 'netArea'),
      wallNetAreaConfirmed: sum(wallMetrics.filter(m => confirmedWalls.includes(m.id)), 'netArea'),
      spaceArea: sum(spaceMetrics, 'area')
    },
    pending: [...pendingIds],
    errors: [...errorIds],
    issues,
    scaleConfirmed: model?.scale?.status === 'CONFIRMADA',
    isValidated: pendingIds.size === 0 && errorIds.size === 0 && model?.scale?.status === 'CONFIRMADA'
  };
}
