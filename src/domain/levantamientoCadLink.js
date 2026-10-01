/* F4 -- LEVANTAMIENTO UNIFICADO + CAD como fuente geometrica autoritativa.
   Modulo PURO (sin React/red), compartido por el cliente y el servidor.

   CADENA:  PROYECTO -> LEVANTAMIENTO -> PLANO (planoTakeoffs, versionado)
            -> cadModel -> 2D/3D -> GENERADORES (F3) -> concepto.qty -> F2.

   REGLA:
   - Un ESPACIO con plano CAD (survey.cadLinks[spaceId].planoId) toma TODA su
     geometria y sus cantidades del cadModel persistido en el servidor. Sus
     largo/ancho/alto capturados quedan solo como captura inicial (se
     conservan, no se editan ni se usan para cantidades).
   - Un espacio SIN CAD usa el calculo legacy (levantamientoCalc) y se
     etiqueta "Cantidad desde captura manual".
   - El levantamiento NO guarda copias de muros: solo la referencia al plano.

   MODOS:  LEGACY_MANUAL (ningun espacio con CAD) · CAD_AUTHORITATIVE (todos)
           · MIXTO (algunos). */
import { computeSpaceGeometry } from '../lib/levantamientoCalc.js';
import { computeSpaceMetrics, computeWallMetrics, OPENING_TYPE } from './cadModel.js';
import { ELEMENT_TYPE } from './levantamientoSchema.js';
import { surveyPlanoKey } from './surveyToCadModel.js';
import { rq } from './quantityGenerators.js';

export const GEOMETRY_MODE = Object.freeze({ LEGACY_MANUAL: 'LEGACY_MANUAL', CAD_AUTHORITATIVE: 'CAD_AUTHORITATIVE', MIXTO: 'MIXTO' });
export const QUANTITY_ORIGIN = Object.freeze({ CAD: 'CAD', MANUAL: 'CAPTURA_MANUAL' });
export const LEGACY_SOURCE = 'USER_BLOB';

export function spacePlanoId(survey, spaceId){
  return survey?.cadLinks?.[spaceId]?.planoId || null;
}
export function spaceHasCad(survey, spaceId){ return Boolean(spacePlanoId(survey, spaceId)); }

export function surveyGeometryMode(survey){
  const spaces = survey?.spaces || [];
  const withCad = spaces.filter(s => spaceHasCad(survey, s.id)).length;
  if(!spaces.length || withCad === 0) return GEOMETRY_MODE.LEGACY_MANUAL;
  return withCad === spaces.length ? GEOMETRY_MODE.CAD_AUTHORITATIVE : GEOMETRY_MODE.MIXTO;
}

/* Vincula un espacio con su plano CAD (primera generacion o migracion). */
export function linkSpaceToPlano(survey, spaceId, planoId, { at = new Date().toISOString(), by = null } = {}){
  return { ...survey, cadLinks: { ...(survey.cadLinks || {}), [spaceId]: { planoId, linkedAt: at, linkedBy: by } } };
}

/* MIGRACION PEREZOSA de un levantamiento del bloque por usuario:
     - NO muta el original (el bloque local queda intacto = rollback logico).
     - survey.cadPlanos[spaceId] (geometria editada) -> un plano por espacio
       (id estable surveyPlanoKey, el MISMO planoId que ya usan los
       generadores/catalogo), y el survey migrado solo guarda cadLinks.
     - legacyBackup conserva cadPlanos tal cual (congelado) durante V1.
   Idempotente: migrar dos veces produce lo mismo. */
export function prepareLegacyMigration(legacySurvey){
  if(!legacySurvey || typeof legacySurvey !== 'object') throw new Error('Levantamiento legado invalido.');
  const original = JSON.parse(JSON.stringify(legacySurvey));
  const { cadPlanos, ...rest } = original;
  let survey = { ...rest, cadLinks: { ...(rest.cadLinks || {}) } };
  const planos = [];
  for(const [spaceId, cadModel] of Object.entries(cadPlanos || {})){
    if(!cadModel || !(survey.spaces || []).some(s => s.id === spaceId)) continue;
    const planoId = surveyPlanoKey(survey.id, spaceId);
    planos.push({ planoId, spaceId, cadModel });
    survey = linkSpaceToPlano(survey, spaceId, planoId, { at: new Date(Number(original.updatedAt) || Date.now()).toISOString(), by: 'migracion' });
  }
  return {
    survey,
    planos,
    legacyBackup: cadPlanos ? { cadPlanos, capturedAt: new Date().toISOString(), source: LEGACY_SOURCE } : null,
    geometryMode: surveyGeometryMode(survey)
  };
}

/* Verificacion de la migracion: ningun dato del levantamiento se perdio. */
export function verifyMigration(legacySurvey, migrated){
  const errors = [];
  const { cadPlanos, ...rest } = legacySurvey || {};
  const { cadLinks, ...migratedRest } = migrated.survey || {};
  const strip = o => JSON.stringify({ ...o, updatedAt: undefined });
  if(strip(rest) !== strip(migratedRest)) errors.push('los datos del levantamiento cambiaron durante la migracion');
  for(const spaceId of Object.keys(cadPlanos || {})){
    if(!(legacySurvey.spaces || []).some(s => s.id === spaceId)) continue;
    const p = migrated.planos.find(x => x.spaceId === spaceId);
    if(!p) errors.push(`falta el plano del espacio ${spaceId}`);
    else if(JSON.stringify(p.cadModel) !== JSON.stringify(cadPlanos[spaceId])) errors.push(`el modelo CAD de ${spaceId} cambio`);
  }
  if(cadPlanos && JSON.stringify(migrated.legacyBackup?.cadPlanos) !== JSON.stringify(cadPlanos)) errors.push('respaldo legado incompleto');
  return errors;
}

/* Cantidades de UN cadModel (misma fuente que los generadores F3). */
export function cadModelQuantities(model){
  const walls = (model?.walls || []).map(w => computeWallMetrics(model, w));
  const spaces = (model?.spaces || []).map(s => computeSpaceMetrics(model, s));
  const openings = model?.openings || [];
  return {
    floorArea: rq(spaces.reduce((s, m) => s + m.area, 0)),
    ceilingArea: rq(spaces.reduce((s, m) => s + m.area, 0)),
    perimeter: rq(spaces.reduce((s, m) => s + m.perimeter, 0)),
    wallGrossArea: rq(walls.reduce((s, m) => s + m.grossArea, 0)),
    wallNetArea: rq(walls.reduce((s, m) => s + m.netArea, 0)),
    doorsCount: openings.filter(o => o.type === OPENING_TYPE.DOOR).length,
    windowsCount: openings.filter(o => o.type === OPENING_TYPE.WINDOW).length,
    scaleConfirmed: !model?.scale?.status || model.scale.status === 'CONFIRMADA'
  };
}

function legacySpaceQuantities(space){
  const g = computeSpaceGeometry(space);
  const count = t => (space.elements || []).filter(e => e.type === t).reduce((s, e) => s + (Number(e.quantity) || 1), 0);
  return {
    floorArea: rq(g.floorArea), ceilingArea: rq(g.ceilingArea), perimeter: rq(g.perimeter),
    wallGrossArea: rq(g.wallGrossArea), wallNetArea: rq(g.wallNetArea),
    doorsCount: count(ELEMENT_TYPE.DOOR), windowsCount: count(ELEMENT_TYPE.WINDOW), scaleConfirmed: true
  };
}

/* CUANTIFICACION DEL LEVANTAMIENTO: por espacio, CAD si existe (y su modelo
   esta cargado), si no captura manual. `cadModelsBySpace` = {spaceId: model}.
   Un espacio con CAD cuyo modelo aun no se cargo NUNCA cae en silencio al
   calculo legacy: queda `pending` y no suma. */
export function computeSurveyQuantities(survey, cadModelsBySpace = {}){
  const rows = (survey?.spaces || []).map(space => {
    const planoId = spacePlanoId(survey, space.id);
    if(planoId){
      const model = cadModelsBySpace[space.id];
      if(!model) return { spaceId: space.id, name: space.name, origin: QUANTITY_ORIGIN.CAD, planoId, pending: true, q: null };
      return { spaceId: space.id, name: space.name, origin: QUANTITY_ORIGIN.CAD, planoId, pending: false, q: cadModelQuantities(model) };
    }
    return { spaceId: space.id, name: space.name, origin: QUANTITY_ORIGIN.MANUAL, planoId: null, pending: false, q: legacySpaceQuantities(space) };
  });
  const keys = ['floorArea', 'ceilingArea', 'perimeter', 'wallGrossArea', 'wallNetArea', 'doorsCount', 'windowsCount'];
  const totals = Object.fromEntries(keys.map(k => [k, rq(rows.filter(r => r.q).reduce((s, r) => s + r.q[k], 0))]));
  return {
    rows,
    totals: { ...totals, spacesCount: rows.length },
    mode: surveyGeometryMode(survey),
    pendingSpaces: rows.filter(r => r.pending).map(r => r.spaceId),
    unconfirmedScale: rows.filter(r => r.q && !r.q.scaleConfirmed).map(r => r.spaceId),
    origins: [...new Set(rows.map(r => r.origin))]
  };
}
