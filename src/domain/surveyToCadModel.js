/* Adaptador Space (Levantamiento IA) -> cadModel (Plano Inteligente).
   Modulo puro, sin React ni Firebase.

   PROPOSITO (Fase 1 del plan integral): dar al Levantamiento manual una
   entrada a CadWorkspace SIN duplicar el motor geometrico. Un Space
   rectangular con largo/ancho/alto + puertas/ventanas por muro se convierte
   en un cadModel real -- muros con eje (x1,y1)->(x2,y2) + espesor, aberturas
   con wallId+offset+width+height+sill, una cota por muro y un espacio con
   los 4 vertices -- reutilizando las MISMAS mutaciones publicas de cadModel
   (addWall/addOpening/addSpace/addDimension), no una copia paralela.

   CONSISTENCIA DE IDS (regla explicita del brief §33/§34):
   - Los muros se agregan en el orden M-01..M-04 exactamente como los
     enumera surveyGeometryModel.buildSpaceWalls -- allocateId de cadModel
     asigna IDs por prefijo desde 01, asi que M-01 aqui es el MISMO muro
     "arriba" que ya se ve en SpaceFloorPlan2D/Survey3DViewer.
   - Cada muro guarda sourceElementId = space.id y cada abertura guarda
     sourceElementId = element.id del Space original -- trazabilidad
     BIDIRECCIONAL hacia el Space aunque el usuario despues edite geometria
     en el CAD.
   - En la primera derivacion se pasa `existingModel = null`: se construye
     un modelo nuevo. En re-aperturas posteriores, se pasa el
     survey.cadModel guardado y esta funcion NO lo toca -- es la garantia
     de que "no hay migracion destructiva Survey<->CAD" (regla 9 del
     encargo): una vez derivado, el cadModel es la fuente editable y el
     Space en la pestana Datos sigue siendo el declarado por el maestro.

   ORIGEN ELEMENTO ID (regla 8 del encargo): el llamador debe pasar como
   `planoId` de CadWorkspace la convencion `survey:{surveyId}:{spaceId}`.
   syncQuantificationToCatalog en quantificationCostBridge.js ya arma
   origenElementoId = `${planoId}:${elementId}` -- no hay que tocar ese
   modulo. */
import { createEmptyCadModel, addWall, addOpening, addSpace, addDimension, OPENING_TYPE, CAD_SOURCE, DIMENSION_SOURCE } from './cadModel.js';
import { buildSpaceWalls } from './surveyGeometryModel.js';
import { ELEMENT_TYPE } from './levantamientoSchema.js';

const DEFAULT_WALL_THICKNESS = 0.12;

function toNum(v){
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/* Deriva un cadModel completo desde un Space del Levantamiento. Retorna
   { model, spaceId } -- spaceId es el ID que cadModel asigno al espacio,
   para poder relacionar despues.

   `wallThickness` (opcional): permite fijar el espesor de todos los muros
   derivados. Si no se pasa, se usa el default de 0.12 m -- el valor tipico
   para un muro de tabique 12 en Mexico, mismo default que ManualSurveyForm
   ya usa para el caso obligatorio del brief §39. El usuario puede editar
   despues cada muro por separado en el panel de propiedades de CadWorkspace. */
export function surveyToCadModel(space, { wallThickness = null } = {}){
  if(!space) throw new Error('surveyToCadModel requiere un space valido.');
  const length = toNum(space.length);
  const width = toNum(space.width);
  const height = toNum(space.height);
  if(!(length > 0) || !(width > 0) || !(height > 0)){
    throw new Error('El espacio necesita largo, ancho y alto mayores que cero para derivar el CAD.');
  }
  // F4: el espesor solo es "capturado" si el llamador lo dio; el 0.12 de
  // respaldo queda marcado DEFAULT (antes se registraba como USUARIO y un
  // volumen podia parecer medido). La altura SI es medida en obra.
  const thicknessGiven = Number(wallThickness) > 0;
  const thickness = thicknessGiven ? Number(wallThickness) : DEFAULT_WALL_THICKNESS;
  const thicknessSource = thicknessGiven ? DIMENSION_SOURCE.MANUAL : DIMENSION_SOURCE.DEFAULT;

  let model = createEmptyCadModel({
    defaults: { wallHeight: height, wallThickness: thickness }
  });

  // 1) Cuatro muros canonicos en el mismo orden que surveyGeometryModel.
  const walls = buildSpaceWalls({ length, width, height });
  const wallIdMap = new Map(); // WALL_IDS de survey -> id real que cadModel asigno
  for(const w of walls){
    const res = addWall(model, {
      x1: w.from.x, y1: w.from.y, x2: w.to.x, y2: w.to.y,
      thickness, height,
      thicknessSource, heightSource: DIMENSION_SOURCE.SURVEY,
      source: CAD_SOURCE.USER,
      sourceElementId: space.id || null
    });
    model = res.model;
    wallIdMap.set(w.id, res.id);
  }

  // 2) Aberturas: puertas y ventanas del Space, colocadas en el muro que ya
  //    declararon (wallId). Si el elemento no trae wallId (levantamiento
  //    guardado antes de Fase 1.5), no se coloca aqui -- se registra en
  //    unplaced para que la UI pida al usuario elegir el muro (mismo criterio
  //    que resolveOpening: nunca se inventa una ubicacion como si fuera del
  //    usuario). Un opening sin muro es una advertencia visible, no un fallo
  //    silencioso.
  const unplaced = [];
  const openingIdMap = new Map(); // element.id del Space -> id real que cadModel asigno

  for(const el of (space.elements || [])){
    if(el?.type !== ELEMENT_TYPE.DOOR && el?.type !== ELEMENT_TYPE.WINDOW) continue;
    const cadWallId = wallIdMap.get(el.wallId);
    if(!cadWallId){ unplaced.push({ id: el.id, type: el.type, reason: 'sin_muro_asignado' }); continue; }
    const w = walls.find(x => x.id === el.wallId);
    const opWidth = toNum(el.width);
    const opHeight = toNum(el.height);
    if(!(opWidth > 0) || !(opHeight > 0)){
      unplaced.push({ id: el.id, type: el.type, reason: 'dimensiones_invalidas' });
      continue;
    }
    if(opWidth > w.length){
      unplaced.push({ id: el.id, type: el.type, reason: 'excede_longitud_del_muro' });
      continue;
    }
    // Si el usuario no dio offset, se centra el hueco en el muro -- misma
    // regla que addOpening cuando no se pasa offset, pero aqui se hace
    // explicito para que el resultado sea determinista sin depender del
    // default interno de cadModel.
    const rawOffset = Number.isFinite(Number(el.offset)) ? Number(el.offset) : (w.length - opWidth) / 2;
    const maxOffset = Math.max(0, w.length - opWidth);
    const offset = Math.min(Math.max(rawOffset, 0), maxOffset);
    // Cantidad: el Space guarda `quantity` (ej. 2 ventanas iguales) -- se
    // agrega una abertura por pieza para que cadModel muestre y cuantifique
    // cada una por separado (regla de "una entidad por objeto real de obra").
    const pieces = Math.max(1, Math.round(toNum(el.quantity) || 1));
    for(let i = 0; i < pieces; i++){
      const res = addOpening(model, {
        type: el.type === ELEMENT_TYPE.DOOR ? OPENING_TYPE.DOOR : OPENING_TYPE.WINDOW,
        wallId: cadWallId,
        // Piezas iguales se colocan en secuencia; si no caben todas, la que
        // se sale se guarda con offset recortado y validateCadModel la
        // marca (regla de fallar visible en vez de silencioso).
        offset: Math.min(offset + i * (opWidth + 0.05), maxOffset),
        width: opWidth,
        height: opHeight,
        sill: el.type === ELEMENT_TYPE.WINDOW ? toNum(el.sillHeight) : 0,
        source: CAD_SOURCE.USER,
        sourceElementId: el.id
      });
      model = res.model;
      if(i === 0) openingIdMap.set(el.id, res.id);
    }
  }

  // 3) Espacio: rectangulo del Space como poligono de 4 vertices. Esto es
  //    lo que da la lectura de piso/plafon/volumen del CAD sin depender de
  //    formulas nuevas -- computeSpaceMetrics de cadTakeoff ya calcula todo
  //    desde el poligono.
  const points = [
    { x: 0, y: 0 }, { x: length, y: 0 }, { x: length, y: width }, { x: 0, y: width }
  ];
  const spaceRes = addSpace(model, {
    name: space.name || 'Espacio', points, ceilingHeight: height, ceilingHeightSource: DIMENSION_SOURCE.SURVEY,
    source: CAD_SOURCE.USER
  });
  model = spaceRes.model;

  // 4) Una cota lineal por muro, ligada al muro (dimension.ref.kind='wall')
  //    -- se actualiza sola cuando el usuario cambia la longitud del muro,
  //    mismo comportamiento que resolveDimension ya garantiza. El offset de
  //    la linea de cota es negativo para muros "arriba" (M-01) y "izquierda"
  //    (M-04), positivo para los otros -- las cotas quedan por fuera del
  //    rectangulo, no atravesando el interior.
  const dimensionOffsets = { 0: -0.6, 1: 0.6, 2: 0.6, 3: -0.6 };
  Array.from(wallIdMap.values()).forEach((cadWallId, i) => {
    const res = addDimension(model, { wallId: cadWallId, offset: dimensionOffsets[i] ?? 0.5, source: CAD_SOURCE.USER });
    model = res.model;
  });

  return { model, spaceId: spaceRes.id, wallIdMap: Object.fromEntries(wallIdMap), openingIdMap: Object.fromEntries(openingIdMap), unplaced };
}

/* Construye la convencion de `planoId` que CadWorkspace/cadConceptService
   usaran para generar `origenElementoId` estable. Debe ser DETERMINISTA
   sobre el (surveyId, spaceId): la misma cadena regenerada dos veces
   apunta al mismo elemento en el catalogo, evitando duplicados en
   syncQuantificationToCatalog. */
export function surveyPlanoKey(surveyId, spaceId){
  if(!surveyId || !spaceId) throw new Error('surveyPlanoKey necesita surveyId y spaceId.');
  return `survey:${surveyId}:${spaceId}`;
}
