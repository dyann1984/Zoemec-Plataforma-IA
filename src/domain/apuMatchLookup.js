/* Motor de coincidencias de APU EXISTENTE para el Catalogo de conceptos
   (Fase D, "Asociar APU existente"). Clon deliberado del pipeline hibrido
   de src/domain/catalogLookup.js#findCatalogMatches -- MISMAS etapas, MISMO
   orden, MISMOS umbrales -- pero buscando contra un arreglo de APUs reales
   (snapshot.clave/concept/unit, ver apuSchema.js) en vez de renglones del
   catalogo de precios. No sustituye ni modifica findCatalogMatches: ese
   sigue siendo el motor de precios; este es el motor de "que APU ya
   generado se parece a este concepto".

   Diferencia real frente a catalogLookup.js: agrega una etapa de REGION
   (getApuLocation/buildLocationFingerprintKey, src/domain/apuRegionalContext.js
   y geography.js) que NUNCA excluye un match de otra region -- solo lo
   penaliza en confianza y lo marca `sameRegion:false`, porque la regla de
   regionalizacion del proyecto es "nunca decidir en silencio", no "nunca
   mostrar". El capitulo, cuando ambos lados lo declaran, suma un empate
   adicional (igual criterio que categoria_unidad en catalogLookup.js) --
   un APU historico sin capitulo (dato que no existia antes de Fase D)
   simplemente no participa de esa bonificacion, no se descalifica. */
import { tokenize, jaccard } from '../lib/excelImport.js';
import { getApuLocation } from './apuRegionalContext.js';
import { buildLocationFingerprintKey } from './geography.js';

const FUZZY_THRESHOLD = 0.34;
const FUZZY_CONFIDENCE_CAP = 0.94;
const CATEGORIA_UNIDAD_MIN_OVERLAP = 0.05;
const REGION_MISMATCH_PENALTY = 0.15;

function normalizeKey(v){
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function apuClave(apu){ return apu?.clave || apu?.standardClave || ''; }
function apuDesc(apu){ return apu?.concept || ''; }
function apuUnit(apu){ return apu?.unit || ''; }

function sameRegion(apuLocation, queryLocation){
  if(!queryLocation) return null; // sin ubicacion en la consulta: no se evalua, no se penaliza
  const a = buildLocationFingerprintKey(apuLocation || {});
  const b = buildLocationFingerprintKey(queryLocation || {});
  if(!a.country && !a.state && !a.city) return null; // el APU no tiene ubicacion: tampoco se evalua
  return a.country === b.country && a.state === b.state && a.city === b.city;
}

function applyRegionPenalty(confidence, regionMatch){
  if(regionMatch === false) return Math.max(0, confidence - REGION_MISMATCH_PENALTY);
  return confidence;
}

/* query: {desc, unidad?, clave?, capitulo?, region?:{country,state,city}}.
   apus: arreglo de snapshots de APU (apu.clave/apu.concept/apu.unit/
   apu.ubicacionEstructurada, mas apu.id/apu.capitulo si estan disponibles).
   Retorna null o {match, confidence (0-1), matchMethod, sameRegion:bool|null}. */
export function findApuMatches(apus, query, options = {}){
  const items = Array.isArray(apus) ? apus.filter(Boolean) : [];
  if(!items.length) return null;
  const q = {
    desc: query?.desc || '',
    unidad: normalizeKey(query?.unidad || ''),
    capitulo: normalizeKey(query?.capitulo || ''),
    clave: normalizeKey(query?.clave || '')
  };
  const qDescKey = normalizeKey(q.desc);
  const queryRegion = query?.region || null;

  const finish = (match, confidence, matchMethod) => {
    const regionMatch = sameRegion(getApuLocation(match), queryRegion);
    return { match, confidence: applyRegionPenalty(confidence, regionMatch), matchMethod, sameRegion: regionMatch };
  };

  // 1) clave_exacta
  if(q.clave){
    const exact = items.find(it => apuClave(it) && normalizeKey(apuClave(it)) === q.clave);
    if(exact) return finish(exact, 1, 'clave_exacta');
  }

  // 2) descripcion_normalizada (mismo texto salvo acentos/mayusculas/puntuacion)
  if(qDescKey){
    const byNormDesc = items.find(it => apuDesc(it) && normalizeKey(apuDesc(it)) === qDescKey);
    if(byNormDesc) return finish(byNormDesc, 0.97, 'descripcion_normalizada');
  }

  // 3) capitulo_unidad (mismo capitulo Y misma unidad, con overlap de texto
  // minimo pero real -- solo corre si AMBOS lados declaran capitulo)
  if(q.capitulo && q.unidad){
    const dt = tokenize(q.desc);
    let bestCU = null, bestCUScore = 0;
    for(const it of items){
      if(!it?.capitulo || !apuUnit(it)) continue;
      if(normalizeKey(it.capitulo) !== q.capitulo || normalizeKey(apuUnit(it)) !== q.unidad) continue;
      const score = jaccard(dt, tokenize(apuDesc(it)));
      if(score > bestCUScore){ bestCUScore = score; bestCU = it; }
    }
    if(bestCU && bestCUScore >= CATEGORIA_UNIDAD_MIN_OVERLAP && bestCUScore < FUZZY_THRESHOLD){
      return finish(bestCU, Math.min(0.65, 0.4 + bestCUScore), 'capitulo_unidad');
    }
  }

  // 4) fuzzy_token
  const dt = tokenize(q.desc);
  let best = null, bestScore = 0;
  for(const it of items){
    let score = jaccard(dt, tokenize(apuDesc(it)));
    if(score <= 0) continue;
    if(q.capitulo && it?.capitulo && normalizeKey(it.capitulo) === q.capitulo) score += 0.1;
    if(q.unidad && apuUnit(it) && normalizeKey(apuUnit(it)) === q.unidad) score += 0.05;
    if(score > bestScore){ bestScore = score; best = it; }
  }
  if(best && bestScore >= FUZZY_THRESHOLD){
    return finish(best, Math.min(bestScore, FUZZY_CONFIDENCE_CAP), 'fuzzy_token');
  }

  return null;
}

/* Variante que devuelve TODOS los candidatos por encima del umbral, no solo
   el mejor -- la UI de "Asociar APU existente" necesita mostrar una lista
   con confianza para que el usuario elija, no solo auto-asociar el primero.
   Reusa exactamente la misma logica de scoring de fuzzy_token (unica etapa
   que tiene sentido rankear en lista; las etapas exactas de arriba, si
   encuentran algo, siempre son la mejor opcion posible). */
export function rankApuMatches(apus, query, options = {}){
  const top = findApuMatches(apus, query, options);
  const items = Array.isArray(apus) ? apus.filter(Boolean) : [];
  const dt = tokenize(query?.desc || '');
  const q = { unidad: normalizeKey(query?.unidad || ''), capitulo: normalizeKey(query?.capitulo || '') };
  const queryRegion = query?.region || null;
  const ranked = items
    .map(it => {
      let score = jaccard(dt, tokenize(apuDesc(it)));
      if(q.capitulo && it?.capitulo && normalizeKey(it.capitulo) === q.capitulo) score += 0.1;
      if(q.unidad && apuUnit(it) && normalizeKey(apuUnit(it)) === q.unidad) score += 0.05;
      const regionMatch = sameRegion(getApuLocation(it), queryRegion);
      return { match: it, confidence: applyRegionPenalty(Math.min(score, FUZZY_CONFIDENCE_CAP), regionMatch), matchMethod: 'fuzzy_token', sameRegion: regionMatch };
    })
    .filter(r => r.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);
  if(top && !ranked.some(r => r.match === top.match)) ranked.unshift(top);
  return ranked.slice(0, options.limit || 10);
}
