/* Calculos geometricos de Levantamiento IA (Fase 1). Modulo puro, sin
   React/DOM ni Firestore -- mismo espiritu que src/lib/apuCalc.js: funciones
   deterministas que reciben datos y regresan totales, testeables con
   node --test sin mocks.

   Unidades: metricas (metros lineales/cuadrados/cubicos), espacios
   rectangulares (largo x ancho x alto). */
import { ELEMENT_TYPE } from '../domain/levantamientoSchema.js';

function toSafeNonNegativeNumber(v){
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/* Area de un elemento individual (puerta/ventana/abertura: ancho x alto x
   cantidad; muro/viga capturado por longitud: largo x alto). Elementos sin
   dimensiones utiles regresan area 0 en vez de lanzar, igual que
   toSafeNonNegativeNumber en apuCalc.js. */
export function computeElementArea(element){
  if(!element) return 0;
  const width = toSafeNonNegativeNumber(element.width);
  const height = toSafeNonNegativeNumber(element.height);
  const length = toSafeNonNegativeNumber(element.length);
  const quantity = toSafeNonNegativeNumber(element.quantity) || 1;
  if(element.type === ELEMENT_TYPE.WALL || element.type === ELEMENT_TYPE.BEAM){
    return length * height * quantity;
  }
  return width * height * quantity;
}

function sumElementsArea(elements, types){
  return (elements || [])
    .filter(el => types.includes(el?.type))
    .reduce((acc, el) => acc + computeElementArea(el), 0);
}

/* Geometria de un espacio rectangular a partir de largo/ancho/alto (seccion
   4B del sprint), descontando puertas y ventanas capturadas como elementos
   del area bruta de muros. Regresa un objeto nuevo -- no muta el space
   recibido. */
export function computeSpaceGeometry(space){
  const length = toSafeNonNegativeNumber(space?.length);
  const width = toSafeNonNegativeNumber(space?.width);
  const height = toSafeNonNegativeNumber(space?.height);
  const elements = space?.elements || [];

  const floorArea = length * width;
  const ceilingArea = length * width;
  const perimeter = 2 * (length + width);
  const wallGrossArea = perimeter * height;
  const doorsArea = sumElementsArea(elements, [ELEMENT_TYPE.DOOR]);
  const windowsArea = sumElementsArea(elements, [ELEMENT_TYPE.WINDOW]);
  const openingsArea = sumElementsArea(elements, [ELEMENT_TYPE.OPENING]);
  const wallNetArea = Math.max(0, wallGrossArea - doorsArea - windowsArea - openingsArea);
  const volume = length * width * height;

  return { floorArea, ceilingArea, perimeter, wallGrossArea, doorsArea, windowsArea, wallNetArea, volume };
}

/* Regresa un Space nuevo con geometria + area de cada elemento recalculadas.
   Nunca confia en valores capturados a mano (floorArea, wallNetArea, etc.):
   siempre se derivan de length/width/height y de los elementos. */
export function recomputeSpace(space){
  if(!space) return space;
  const elements = (space.elements || []).map(el => ({ ...el, area: computeElementArea(el) }));
  const geometry = computeSpaceGeometry({ ...space, elements });
  return { ...space, elements, ...geometry };
}

/* Regresa un Survey nuevo con todos sus espacios recalculados. */
export function recomputeSurvey(survey){
  if(!survey) return survey;
  return { ...survey, spaces: (survey.spaces || []).map(recomputeSpace) };
}

/* Totales agregados de un levantamiento completo, usados por la tarjeta
   resumen (seccion 2 del sprint: area de piso, muros, plafones, puertas,
   ventanas). Recalcula primero (recomputeSurvey) para no depender de que el
   caller ya haya recalculado. */
export function aggregateSurveyTotals(survey){
  const computed = recomputeSurvey(survey);
  const spaces = computed.spaces || [];
  const totals = spaces.reduce((acc, space) => {
    acc.floorArea += space.floorArea;
    acc.ceilingArea += space.ceilingArea;
    acc.wallGrossArea += space.wallGrossArea;
    acc.wallNetArea += space.wallNetArea;
    (space.elements || []).forEach(el => {
      if(el.type === ELEMENT_TYPE.DOOR) acc.doorsCount += toSafeNonNegativeNumber(el.quantity) || 1;
      if(el.type === ELEMENT_TYPE.WINDOW) acc.windowsCount += toSafeNonNegativeNumber(el.quantity) || 1;
    });
    return acc;
  }, { floorArea: 0, ceilingArea: 0, wallGrossArea: 0, wallNetArea: 0, doorsCount: 0, windowsCount: 0 });
  return { ...totals, spacesCount: spaces.length };
}
