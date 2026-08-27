/* Modelo tecnico 3D parametrico (punto 18 del spec del usuario): deriva
   geometria DETERMINISTA (nunca generativa/IA) a partir de dimensiones que
   YA existen y estan validadas en el APU -- cantidadObra (area real de la
   partida) + apu.variables (altura/espesor detectados del texto del
   concepto, ver conceptVariablesFromParsed en src/lib/excelImport.js).

   Regla critica del usuario: "Nunca fabricar geometria faltante". Esta
   funcion NUNCA inventa una altura de muro o un espesor de losa que no
   viene de un dato real -- cuando falta, la dimension queda en null y se
   reporta en `missingDimensions`, para que Technical3DViewer.jsx pida al
   usuario que la capture a mano antes de renderizar el volumen completo.
   Solo el area/footprint (que SI viene de cantidadObra, un dato real del
   APU) se calcula siempre.

   Alcance de esta fase (deliberado, no exhaustivo): piso, plafon (losas
   horizontales) y block/muro (superficie vertical). Cualquier otra
   disciplina, o un APU sin cantidadObra/con una unidad no soportada,
   retorna {ok:false, reason:'REQUIERE_VALIDACION'} explicito -- nunca una
   caja generica inventada para "que se vea algo". */

const SUPPORTED_TYPES = Object.freeze({ piso: 'floor', plafon_suspendido: 'ceiling', block: 'wall' });

function normalizeUnit(unit){
  return String(unit || '').replace(/\s+/g, '').replace('m2', 'm²');
}

/* Convierte una medida capturada en mm/cm/m a metros. Sin unidad declarada,
   asume que el numero YA esta en metros (mismo criterio que el resto del
   motor usa para "height"/"thickness" quando no hay unidad explicita en el
   texto del concepto). */
function toMeters(value, unit){
  if(value == null) return null;
  const n = Number(value);
  if(!Number.isFinite(n) || n <= 0) return null;
  const u = String(unit || '').toLowerCase();
  if(u === 'mm') return n / 1000;
  if(u === 'cm') return n / 100;
  return n;
}

/* Footprint cuadrado de area equivalente: es una ASUNCION EXPLICITA (nunca
   la forma real del espacio, que no esta disponible sin un plano/geometria
   real) -- se documenta en footprintSource para que la UI lo deje claro,
   nunca se presenta como si fuera la forma real medida. */
function squareFootprint(areaM2){
  const side = Math.sqrt(Math.max(areaM2, 0));
  return { width: Number(side.toFixed(3)), depth: Number(side.toFixed(3)) };
}

export function deriveGeometryFromApu(apu = {}){
  const tipo = apu.primaryActivity || null;
  const unit = normalizeUnit(apu.unit);
  const cantidad = Number(apu.cantidadObra);
  const variables = apu.variables || {};

  if(!(cantidad > 0)){
    return { ok: false, reason: 'REQUIERE_VALIDACION', missing: ['cantidadObra'], message: 'No hay cantidad de obra capturada: no se puede derivar ninguna geometria real.' };
  }
  if(unit !== 'm²'){
    return { ok: false, reason: 'REQUIERE_VALIDACION', missing: ['unidad_no_soportada'], message: `La unidad "${apu.unit || ''}" no tiene un modelo geometrico soportado en esta fase (solo m²).` };
  }
  const elementType = SUPPORTED_TYPES[tipo];
  if(!elementType){
    return { ok: false, reason: 'REQUIERE_VALIDACION', missing: ['disciplina_no_soportada_para_3d'], message: `La disciplina "${tipo || 'desconocida'}" todavia no tiene un modelo tecnico 3D en esta fase (piso, plafon y muro/block si).` };
  }

  const heightM = toMeters(variables.height, variables.heightUnit);
  const thicknessM = toMeters(variables.thickness, variables.thicknessUnit);
  const missingDimensions = [];
  let dimensions, footprintSource;

  if(elementType === 'wall'){
    dimensions = {
      area: cantidad,
      width: heightM ? Number((cantidad / heightM).toFixed(3)) : null,
      height: heightM,
      thickness: thicknessM
    };
    if(heightM == null) missingDimensions.push('height');
    if(thicknessM == null) missingDimensions.push('thickness');
    footprintSource = 'area_real_del_apu';
  } else {
    const { width, depth } = squareFootprint(cantidad);
    dimensions = { width, depth, thickness: thicknessM };
    if(thicknessM == null) missingDimensions.push('thickness');
    footprintSource = 'cuadrado_de_igual_area_asumido (forma real del espacio no disponible sin un plano)';
  }

  return {
    ok: true,
    elements: [{
      id: `${elementType}-1`,
      type: elementType,
      clave: apu.clave || null,
      label: apu.concept || '',
      dimensions,
      missingDimensions,
      cantidad,
      unidad: apu.unit,
      footprintSource
    }],
    requiresManualInput: missingDimensions.length > 0
  };
}

/* Aplica dimensiones capturadas a mano por el usuario (Technical3DViewer.jsx)
   sobre un elemento ya derivado -- nunca sustituye deriveGeometryFromApu,
   solo completa lo que faltaba. Recalcula el campo derivado (width de un
   muro, dado area+height) cuando aplica. */
export function applyManualDimensions(element, manualValues = {}){
  const dimensions = { ...element.dimensions };
  Object.entries(manualValues).forEach(([key, value]) => {
    const n = Number(value);
    if(Number.isFinite(n) && n > 0) dimensions[key] = n;
  });
  if(element.type === 'wall' && dimensions.height && dimensions.area){
    dimensions.width = Number((dimensions.area / dimensions.height).toFixed(3));
  }
  const missingDimensions = (element.missingDimensions || []).filter(key => dimensions[key] == null);
  return { ...element, dimensions, missingDimensions };
}
