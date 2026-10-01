/* F3 -- NUMEROS GENERADORES persistentes y trazabilidad geometrica.
   Modulo PURO (sin React/red/IA), compartido por el CAD (construye), el
   servidor (valida y recalcula la cantidad del concepto), el Catalogo
   ("Ver generadores") y el exportador de generadores.

   CADENA:  ELEMENTO CAD -> GENERADOR -> concepto.qty -> (F2) Presupuesto/Explosion.
   La Explosion NUNCA consulta la geometria: solo concepto.qty.

   POLITICA DE PRECISION (unica, documentada)
   ------------------------------------------
   - Toda cantidad geometrica se guarda con 4 decimales (QUANTITY_DECIMALS),
     el mismo r4 que ya usan las metricas de cadModel.js. Las operaciones del
     generador se calculan SOBRE los valores ya redondeados que muestra
     (L_r4 x H_r4, bruto_r4 - sum(deduccion_r4)), para que la aritmetica del
     documento se pueda verificar a mano.
   - concepto.qty (fuente GENERATORS) = r4( SUM(generador.netQuantity) ). Ese
     MISMO numero lo usan Presupuesto y Explosion (F2): no hay otra cifra.
   - La presentacion redondea a 2 decimales (DISPLAY_DECIMALS) con la misma
     funcion en pantalla, PDF y XLSX. Nunca se redondea un valor intermedio
     para calcular.

   ESTADOS
     COMPLETO      -- todas las dimensiones requeridas existen.
     INCOMPLETO    -- falta una dimension requerida (se dice cual); netQuantity=null
                      y NO aporta cantidad (nunca se inventa: espesor por defecto,
                      altura de plafon no capturada, escala sin confirmar).
     INCONSISTENTE -- las deducciones superan el bruto: netQuantity=0 (nunca
                      negativo) y se reporta la diferencia. */
import { CAD_KIND, OPENING_TYPE, SCALE_STATUS, DIMENSION_SOURCE, findElement, computeWallMetrics, computeSpaceMetrics, resolveDimension, openingsOnWall, polygonArea, wallHeightSource, wallThicknessSource, spaceCeilingHeightSource, dimensionSourceLabel } from './cadModel.js';

/* F4: advertencia (no bloquea) cuando la cantidad depende de una dimension
   por defecto -- el documento nunca la presenta como medida en obra. */
function defaultDimensionIssues(sources){
  const defaults = Object.entries(sources).filter(([, s]) => s === DIMENSION_SOURCE.DEFAULT).map(([k]) => k);
  return defaults.length ? [{ code: 'DIMENSION_POR_DEFECTO', severity: 'ADVERTENCIA', message: `Usa ${defaults.join(', ')} por defecto (${dimensionSourceLabel(DIMENSION_SOURCE.DEFAULT)}): confirma la medida en obra.`, dimensions: defaults }] : [];
}

export const GENERATOR_SCHEMA_VERSION = 1;
export const QUANTITY_DECIMALS = 4;
export const DISPLAY_DECIMALS = 2;
const EPS = 0.00011; // tolerancia de verificacion aritmetica (redondeo r4 de cada termino)

export const GENERATOR_STATUS = Object.freeze({ COMPLETO: 'COMPLETO', INCOMPLETO: 'INCOMPLETO', INCONSISTENTE: 'INCONSISTENTE' });
export const OPERATION_TYPE = Object.freeze({
  AREA_MURO: 'AREA_MURO',             // longitud x altura - vanos
  AREA_RECTANGULO: 'AREA_RECTANGULO', // largo x ancho (espacio rectangular)
  AREA_POLIGONO: 'AREA_POLIGONO',     // area de poligono (formula de Gauss sobre vertices)
  AREA_ACABADO_MUROS: 'AREA_ACABADO_MUROS', // perimetro x altura de plafon
  LONGITUD: 'LONGITUD',
  VOLUMEN: 'VOLUMEN',
  PIEZAS: 'PIEZAS'
});
export const QUANTITY_SOURCE_KIND = Object.freeze({ MANUAL: 'MANUAL', GENERATORS: 'GENERATORS' });

export const rq = n => Math.round((Number(n) || 0) * 10 ** QUANTITY_DECIMALS) / 10 ** QUANTITY_DECIMALS;
export const fmtQ = n => (n == null || !Number.isFinite(Number(n))) ? '—' : Number(n).toLocaleString('es-MX', { minimumFractionDigits: DISPLAY_DECIMALS, maximumFractionDigits: DISPLAY_DECIMALS });

export function generatorId(planoId, elementId, quantityField){
  return `${planoId || 'SIN_PLANO'}::${elementId}::${quantityField}`;
}

/* Huella determinista de lo que el generador midio: si cambia, el generador
   guardado esta DESACTUALIZADO. (FNV-1a, sin dependencias.) */
export function geometryHash(g){
  const basis = JSON.stringify({ t: g.operationType, d: g.dimensions, x: (g.deductions || []).map(d => [d.elementId, d.quantity]), n: g.netQuantity, s: g.status });
  let h = 2166136261;
  for(let i = 0; i < basis.length; i++){ h ^= basis.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36).toUpperCase().padStart(7, '0');
}

function base({ planoId, projectId, conceptId, fileName, sourceRevision, element, kind, elementType, quantityField, unit, description }){
  const now = new Date().toISOString();
  return {
    schemaVersion: GENERATOR_SCHEMA_VERSION,
    generatorId: generatorId(planoId, element.id, quantityField),
    projectId: projectId || null,
    conceptId: conceptId || null,
    planoId: planoId || null,
    elementId: element.id,
    elementCode: element.id,
    elementKind: kind,
    elementType,
    description,
    spaceId: kind === CAD_KIND.SPACE ? element.id : null,
    location: element.name ? String(element.name) : null,
    quantityField,
    unit,
    source: { kind: 'CAD', planoId: planoId || null, fileName: fileName || null, sourceRevision: sourceRevision ?? null },
    createdAt: now,
    updatedAt: now
  };
}

function finish(g, { gross, deductions = [], net, missing = [], extraIssues = [], dimensionSources = null }){
  const issues = [...extraIssues];
  if(dimensionSources) g = { ...g, dimensionSources, usesDefaults: Object.values(dimensionSources).includes(DIMENSION_SOURCE.DEFAULT) };
  let status = GENERATOR_STATUS.COMPLETO;
  if(missing.length){
    status = GENERATOR_STATUS.INCOMPLETO;
    issues.push({ code: 'DIMENSION_FALTANTE', message: `Generador incompleto: falta ${missing.join(', ')}.`, missing });
  }
  // Una dimension que ya falta no se reporta ademas como "por defecto".
  if(dimensionSources){
    const notMissing = Object.fromEntries(Object.entries(dimensionSources).filter(([k]) => !missing.some(m => String(m).includes(k))));
    issues.push(...defaultDimensionIssues(notMissing));
  }
  const deductionsTotal = rq(deductions.reduce((s, d) => s + d.quantity, 0));
  let netQuantity = status === GENERATOR_STATUS.INCOMPLETO ? null : rq(net);
  if(status !== GENERATOR_STATUS.INCOMPLETO && gross != null && deductionsTotal > gross + EPS){
    status = GENERATOR_STATUS.INCONSISTENTE;
    issues.push({ code: 'DEDUCCIONES_EXCEDEN_BRUTO', message: `Las deducciones (${fmtQ(deductionsTotal)}) superan la cantidad bruta (${fmtQ(gross)}): se reporta 0, nunca negativo. Revisa los vanos de ${g.elementId}.`, gross, deductionsTotal });
    netQuantity = 0;
  }
  const out = { ...g, grossQuantity: gross == null ? null : rq(gross), deductions, deductionsTotal, netQuantity, status, issues };
  return { ...out, geometryHash: geometryHash(out) };
}

function scaleMissing(model){
  return model?.scale?.status && model.scale.status !== SCALE_STATUS.CONFIRMADA ? ['escala confirmada del plano'] : [];
}

/* Lineas de cantidad disponibles por tipo de elemento (mismos campos que
   cadTakeoff.buildElementTakeoff, para que la liga concepto/elemento siga
   siendo la misma). */
export function buildGenerator(model, elementId, quantityField, ctx = {}){
  const found = findElement(model, elementId);
  if(!found) return null;
  const { kind, element } = found;
  const common = { ...ctx, element, kind, quantityField };

  if(kind === CAD_KIND.WALL){
    const m = computeWallMetrics(model, element);
    const L = m.length, H = m.height, T = m.thickness;
    const missing = [...scaleMissing(model), ...(H > 0 ? [] : ['altura del muro'])];
    const hSrc = { altura: wallHeightSource(element) };
    const deductions = openingsOnWall(model, element.id).map(o => {
      const deducted = m.openings.find(x => x.id === o.id)?.area ?? 0;
      const w = rq(o.width), h = rq(o.height);
      const clipped = Math.abs(rq(w * h) - deducted) > EPS;
      return {
        elementId: o.id, elementType: o.type === OPENING_TYPE.DOOR ? 'puerta' : 'ventana',
        description: `${o.type === OPENING_TYPE.DOOR ? 'Puerta' : 'Ventana'} ${o.id}`,
        dimensions: { width: w, height: h, sill: rq(o.sill || 0) },
        operation: { factors: [w, h], expression: `${fmtQ(w)} × ${fmtQ(h)}` },
        quantity: deducted,
        note: clipped ? 'Descuento recortado a la altura/longitud del muro.' : null
      };
    });
    if(quantityField === 'length'){
      return finish({ ...base({ ...common, elementType: 'muro', unit: 'm', description: `Muro ${element.id} (longitud)` }),
        operationType: OPERATION_TYPE.LONGITUD, dimensions: { length: L }, operation: { factors: [L], expression: `${fmtQ(L)}` } },
      { gross: L, net: L, missing: scaleMissing(model) });
    }
    const gross = rq(L * H);
    if(quantityField === 'grossArea'){
      return finish({ ...base({ ...common, elementType: 'muro', unit: 'm²', description: `Muro ${element.id} (área bruta)` }),
        operationType: OPERATION_TYPE.AREA_MURO, dimensions: { length: L, height: H }, operation: { factors: [L, H], expression: `${fmtQ(L)} × ${fmtQ(H)}` } },
      { gross, net: gross, missing, dimensionSources: hSrc });
    }
    const dedTotal = rq(deductions.reduce((s, d) => s + d.quantity, 0));
    const netArea = rq(Math.max(0, gross - dedTotal));
    if(quantityField === 'netVolume'){
      const volMissing = [...missing, ...(wallThicknessSource(element) === DIMENSION_SOURCE.DEFAULT || !(T > 0) ? ['espesor del muro (el valor actual es un default, no una medida)'] : [])];
      return finish({ ...base({ ...common, elementType: 'muro', unit: 'm³', description: `Muro ${element.id} (volumen neto)` }),
        operationType: OPERATION_TYPE.VOLUMEN, dimensions: { length: L, height: H, thickness: T, netArea },
        operation: { factors: [netArea, T], expression: `(${fmtQ(L)} × ${fmtQ(H)} − ${fmtQ(dedTotal)}) × ${fmtQ(T)}` } },
      { gross: rq(gross * T), deductions: deductions.map(d => ({ ...d, quantity: rq(d.quantity * T), operation: { ...d.operation, expression: `${d.operation.expression} × ${fmtQ(T)}` } })), net: rq(netArea * T), missing: volMissing, dimensionSources: { ...hSrc, espesor: wallThicknessSource(element) } });
    }
    // netArea (cantidad principal de un muro)
    return finish({ ...base({ ...common, elementType: 'muro', unit: 'm²', description: `Muro ${element.id}` }),
      operationType: OPERATION_TYPE.AREA_MURO, dimensions: { length: L, height: H },
      operation: { factors: [L, H], expression: `${fmtQ(L)} × ${fmtQ(H)}` } },
    { gross, deductions, net: gross - dedTotal, missing, dimensionSources: hSrc });
  }

  if(kind === CAD_KIND.OPENING){
    const isDoor = element.type === OPENING_TYPE.DOOR;
    const w = rq(element.width), h = rq(element.height);
    const label = isDoor ? 'Puerta' : 'Ventana';
    if(quantityField === 'area'){
      return finish({ ...base({ ...common, elementType: isDoor ? 'puerta' : 'ventana', unit: 'm²', description: `${label} ${element.id} (área del vano)` }),
        operationType: OPERATION_TYPE.AREA_RECTANGULO, dimensions: { width: w, height: h }, operation: { factors: [w, h], expression: `${fmtQ(w)} × ${fmtQ(h)}` } },
      { gross: rq(w * h), net: rq(w * h), missing: scaleMissing(model) });
    }
    return finish({ ...base({ ...common, elementType: isDoor ? 'puerta' : 'ventana', unit: 'pza', description: `${label} ${element.id} ${fmtQ(w)} × ${fmtQ(h)} m` }),
      operationType: OPERATION_TYPE.PIEZAS, dimensions: { pieces: 1, width: w, height: h }, operation: { factors: [1], expression: '1 pza' } },
    { gross: 1, net: 1 });
  }

  if(kind === CAD_KIND.SPACE){
    const m = computeSpaceMetrics(model, element);
    const rect = rectangleSides(element.points);
    const pts = (element.points || []).map(p => ({ x: rq(p.x), y: rq(p.y) }));
    const heightDeclared = Number(element.ceilingHeight) > 0;
    const heightMissing = heightDeclared ? [] : ['altura de plafón del espacio (no capturada)'];
    const areaOp = rect
      ? { operationType: OPERATION_TYPE.AREA_RECTANGULO, dimensions: { length: rect.a, width: rect.b }, operation: { factors: [rect.a, rect.b], expression: `${fmtQ(rect.a)} × ${fmtQ(rect.b)}` } }
      : { operationType: OPERATION_TYPE.AREA_POLIGONO, dimensions: { vertices: pts }, operation: { factors: [], expression: `Área de polígono de ${pts.length} vértices (fórmula de Gauss)` } };
    const areaVal = rect ? rq(rect.a * rect.b) : m.area;
    const name = element.name || element.id;
    if(quantityField === 'perimeter'){
      return finish({ ...base({ ...common, elementType: 'espacio', unit: 'm', description: `${element.id} ${name} (perímetro)` }),
        operationType: OPERATION_TYPE.LONGITUD, dimensions: { perimeter: m.perimeter }, operation: { factors: [m.perimeter], expression: rect ? `2 × (${fmtQ(rect.a)} + ${fmtQ(rect.b)})` : `Perímetro de ${pts.length} lados` } },
      { gross: m.perimeter, net: m.perimeter, missing: scaleMissing(model) });
    }
    if(quantityField === 'wallFinishArea' || quantityField === 'volume'){
      const H = heightDeclared ? rq(element.ceilingHeight) : null;
      const isVol = quantityField === 'volume';
      const value = H == null ? null : rq(isVol ? areaVal * H : m.perimeter * H);
      return finish({ ...base({ ...common, elementType: 'espacio', unit: isVol ? 'm³' : 'm²', description: `${element.id} ${name} (${isVol ? 'volumen' : 'acabado en muros'})` }),
        operationType: isVol ? OPERATION_TYPE.VOLUMEN : OPERATION_TYPE.AREA_ACABADO_MUROS,
        dimensions: isVol ? { area: areaVal, height: H } : { perimeter: m.perimeter, height: H },
        operation: { factors: isVol ? [areaVal, H] : [m.perimeter, H], expression: `${fmtQ(isVol ? areaVal : m.perimeter)} × ${H == null ? '¿altura?' : fmtQ(H)}` } },
      { gross: value, net: value, missing: [...scaleMissing(model), ...heightMissing], dimensionSources: H == null ? null : { 'altura de plafón': spaceCeilingHeightSource(element) } });
    }
    // area / floorArea / ceilingArea: misma superficie del poligono
    const label = quantityField === 'ceilingArea' ? 'plafón' : quantityField === 'floorArea' ? 'piso' : 'área';
    return finish({ ...base({ ...common, elementType: 'espacio', unit: 'm²', description: `${element.id} ${name} (${label})` }), ...areaOp },
      { gross: areaVal, net: areaVal, missing: scaleMissing(model) });
  }

  // Cota: longitud medida
  const r = resolveDimension(model, element);
  return finish({ ...base({ ...common, elementType: 'cota', unit: 'm', description: `Cota ${element.id}` }),
    operationType: OPERATION_TYPE.LONGITUD, dimensions: { length: r.value }, operation: { factors: [r.value], expression: fmtQ(r.value) } },
  { gross: r.value, net: r.value, missing: [...scaleMissing(model), ...(r.value == null ? ['referencia de la cota'] : [])] });
}

/* Rectangulo (4 vertices, angulos rectos): lados a/b. null si no lo es. */
export function rectangleSides(points){
  const p = points || [];
  if(p.length !== 4) return null;
  const v = i => ({ x: p[(i + 1) % 4].x - p[i].x, y: p[(i + 1) % 4].y - p[i].y });
  const len = w => Math.hypot(w.x, w.y);
  for(let i = 0; i < 4; i++){
    const a = v(i), b = v((i + 1) % 4);
    if(Math.abs(a.x * b.x + a.y * b.y) > 1e-6 * len(a) * len(b)) return null;
  }
  const a = rq(len(v(0))), b = rq(len(v(1)));
  if(Math.abs(a * b - polygonArea(p)) > 0.001) return null;
  return { a, b };
}

/* Generadores de TODOS los elementos del modelo ligados a un concepto
   (element.assignment.conceptId). Un elemento eliminado del plano ya no
   aparece -> deja de aportar en la siguiente sincronizacion controlada. */
export function buildConceptGenerators(model, conceptId, ctx = {}){
  const elements = [...(model?.walls || []), ...(model?.openings || []), ...(model?.spaces || []), ...(model?.dimensions || [])]
    .filter(el => el.assignment?.conceptId === conceptId);
  return elements
    .map(el => buildGenerator(model, el.id, el.assignment.quantityField || defaultField(model, el.id), { ...ctx, conceptId }))
    .filter(Boolean)
    .sort((a, b) => a.elementId.localeCompare(b.elementId, 'es', { numeric: true }));
}

function defaultField(model, id){
  const f = findElement(model, id);
  if(!f) return null;
  if(f.kind === CAD_KIND.WALL) return 'netArea';
  if(f.kind === CAD_KIND.OPENING) return 'pieces';
  if(f.kind === CAD_KIND.SPACE) return 'area';
  return 'distance';
}

/* Regla UNICA de cantidad de un concepto desde generadores. Solo suman los
   COMPLETO e INCONSISTENTE (este ultimo aporta 0 y queda reportado); los
   INCOMPLETO no aportan. Unidades distintas a la del concepto nunca se
   mezclan (se reportan). */
export function aggregateGenerators(generators = [], conceptUnit = null){
  const norm = u => String(u || '').trim().toLowerCase().replace('²', '2').replace('³', '3');
  const list = Array.isArray(generators) ? generators : [];
  const counted = [], incomplete = [], inconsistent = [], unitMismatch = [];
  for(const g of list){
    if(conceptUnit && norm(g.unit) !== norm(conceptUnit)){ unitMismatch.push(g.elementId); continue; }
    if(g.status === GENERATOR_STATUS.INCOMPLETO){ incomplete.push(g.elementId); continue; }
    if(g.status === GENERATOR_STATUS.INCONSISTENTE) inconsistent.push(g.elementId);
    counted.push(g);
  }
  const qty = rq(counted.reduce((s, g) => s + (Number(g.netQuantity) || 0), 0));
  return {
    qty,
    elementIds: [...new Set(list.map(g => g.elementId))],
    countedElementIds: counted.map(g => g.elementId),
    incomplete, inconsistent, unitMismatch,
    total: list.length
  };
}

/* Comparacion guardado vs recalculado (DESACTUALIZADO). */
export const GENERATOR_CHANGE = Object.freeze({ SIN_CAMBIO: 'SIN_CAMBIO', MODIFICADO: 'MODIFICADO', NUEVO: 'NUEVO', ELIMINADO: 'ELIMINADO' });
export function diffGenerators(stored = [], fresh = []){
  const byId = new Map((stored || []).map(g => [g.generatorId, g]));
  const freshIds = new Set((fresh || []).map(g => g.generatorId));
  const changes = [];
  for(const g of fresh || []){
    const prev = byId.get(g.generatorId);
    if(!prev) changes.push({ generatorId: g.generatorId, elementId: g.elementId, change: GENERATOR_CHANGE.NUEVO, from: null, to: g.netQuantity });
    else if(prev.geometryHash !== g.geometryHash) changes.push({ generatorId: g.generatorId, elementId: g.elementId, change: GENERATOR_CHANGE.MODIFICADO, from: prev.netQuantity, to: g.netQuantity });
  }
  for(const g of stored || []){
    if(!freshIds.has(g.generatorId)) changes.push({ generatorId: g.generatorId, elementId: g.elementId, change: GENERATOR_CHANGE.ELIMINADO, from: g.netQuantity, to: null });
  }
  return { stale: changes.length > 0, changes };
}

/* Verificacion aritmetica INDEPENDIENTE (la usa el servidor antes de aceptar
   generadores del cliente): el documento debe cuadrar consigo mismo. */
export function verifyGenerator(g){
  const errors = [];
  if(!g || typeof g !== 'object') return ['generador invalido'];
  if(!g.generatorId || !g.elementId) errors.push('falta generatorId/elementId');
  if(!Object.values(GENERATOR_STATUS).includes(g.status)) errors.push('status invalido');
  if(g.status === GENERATOR_STATUS.INCOMPLETO){
    if(g.netQuantity != null) errors.push('un generador INCOMPLETO no puede tener cantidad');
    return errors;
  }
  const net = Number(g.netQuantity);
  if(!Number.isFinite(net) || net < 0) errors.push('netQuantity debe ser >= 0');
  const factors = g.operation?.factors || [];
  if(g.operationType === OPERATION_TYPE.AREA_POLIGONO){
    const pts = g.dimensions?.vertices || [];
    if(Math.abs(rq(polygonArea(pts)) - Number(g.grossQuantity)) > 0.001) errors.push('area de poligono no corresponde a los vertices');
  } else if(factors.length){
    const product = factors.reduce((p, f) => p * Number(f), 1);
    if(g.operationType === OPERATION_TYPE.VOLUMEN){
      // volumen: los factores (area neta x espesor, o area x altura) dan el NETO
      if(g.status !== GENERATOR_STATUS.INCONSISTENTE && Math.abs(rq(product) - net) > EPS) errors.push(`volumen (${net}) != producto de dimensiones (${rq(product)})`);
    } else if(Math.abs(rq(product) - Number(g.grossQuantity)) > EPS){
      errors.push(`bruto (${g.grossQuantity}) != producto de dimensiones (${rq(product)})`);
    }
  }
  const ded = (g.deductions || []).reduce((s, d) => s + Number(d.quantity || 0), 0);
  if(Math.abs(rq(ded) - Number(g.deductionsTotal || 0)) > EPS) errors.push('deductionsTotal no corresponde a la suma de deducciones');
  const expected = g.status === GENERATOR_STATUS.INCONSISTENTE ? 0 : rq(Math.max(0, Number(g.grossQuantity) - rq(ded)));
  if(g.operationType !== OPERATION_TYPE.VOLUMEN && Math.abs(expected - net) > EPS) errors.push(`neto (${net}) != bruto - deducciones (${expected})`);
  if(g.status !== GENERATOR_STATUS.INCONSISTENTE && rq(ded) > Number(g.grossQuantity) + EPS) errors.push('deducciones superan el bruto sin marcarse INCONSISTENTE');
  return errors;
}

/* Texto profesional de un generador (pantalla, PDF y XLSX usan ESTA funcion):
     M-01  4.50 × 2.70 = 12.15 m²
           − Puerta P-01  0.90 × 2.10 = 1.89 m²
           = 10.26 m² */
export function describeGenerator(g){
  const u = g.unit || '';
  const lines = [];
  if(g.status === GENERATOR_STATUS.INCOMPLETO){
    lines.push(`${g.elementCode}  ${g.operation?.expression || ''}  →  GENERADOR INCOMPLETO`);
    (g.issues || []).forEach(i => lines.push(`      ${i.message}`));
    return lines;
  }
  lines.push(`${g.elementCode}  ${g.operation?.expression || ''} = ${fmtQ(g.grossQuantity)} ${u}`);
  (g.deductions || []).forEach(d => lines.push(`      − ${d.description}  ${d.operation?.expression || ''} = ${fmtQ(d.quantity)} ${u}${d.note ? ` (${d.note})` : ''}`));
  if((g.deductions || []).length) lines.push(`      = ${fmtQ(g.netQuantity)} ${u} NETOS`);
  (g.issues || []).forEach(i => lines.push(`      ! ${i.message}`));
  return lines;
}

/* F4-QA: una linea "operacion = cantidad" para la revision ANTES/NUEVO:
     4.00 × 3.50 = 14.00 m²   ·   4.50 × 2.70 = 12.15 − 1.89 = 10.26 m²
   Sin generador (elemento nuevo o eliminado): "—". */
export function generatorOperationText(g, unit = g?.unit || ''){
  if(!g) return '— (sin elemento)';
  const u = unit ? ` ${unit}` : '';
  if(g.status === GENERATOR_STATUS.INCOMPLETO) return `${g.operation?.expression || ''} → INCOMPLETO`;
  const net = (g.deductions || []).length ? ` − ${fmtQ(g.deductionsTotal)} = ${fmtQ(g.netQuantity)}` : '';
  return `${g.operation?.expression || ''} = ${fmtQ(g.grossQuantity)}${net}${u}`;
}
