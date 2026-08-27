/* Motor HIBRIDO de coincidencias del catalogo real (Biblioteca Inteligente,
   fase de correccion "Busqueda semantica"). Logica pura (sin React, sin
   Firebase): recibe el mismo `catalog` que ya consume matchPrice()
   (src/lib/excelImport.js) -- lista de filas {desc, unidad, precio, clave?,
   categoria?, sinonimos?[], tipo?, estado?, traceability?} -- y resuelve la
   MEJOR coincidencia para un insumo del motor de generacion.

   Pipeline EXTENSIBLE, en orden, se detiene en la primera etapa que
   encuentre algo real (nunca mezcla criterios de dos etapas distintas):

     1. clave_exacta            confidence 1.00
     2. alias_sinonimo          confidence 0.95
     3. descripcion_normalizada confidence 0.97 (misma descripcion del
        catalogo salvo acentos/mayusculas/puntuacion -- no es un alias
        registrado a mano, es el MISMO texto)
     4. categoria_unidad        confidence 0.40-0.65 (misma categoria Y
        misma unidad, con overlap de texto minimo pero real -- nunca ignora
        el texto por completo)
     5. fuzzy_token             confidence hasta 0.94 (Jaccard por tokens,
        umbral 0.34 -- el motor que ya existia, renombrado a proposito: esto
        NO es similitud semantica, es solape de palabras)
     6. semantic_provider       OPCIONAL -- solo corre si se pasa un
        proveedor real en options.semanticProvider (ver
        src/lib/semanticProvider.js) y ninguna etapa anterior encontro nada.
        Sin proveedor (caso por defecto, sin API externa), esta etapa nunca
        se ejecuta -- el sistema funciona igual que hoy y queda preparado
        para conectar embeddings/IA despues sin tocar este pipeline.

   No reemplaza matchPrice(): ese sigue siendo el motor exacto que ya usan
   apuFlow.js y el Excel de precios de Oficina Tecnica (comportamiento sin
   cambios). Nunca se sustituye un dato de plantilla por un match de baja
   confianza: por debajo del umbral de cada etapa, se pasa a la siguiente;
   si ninguna encuentra nada, se devuelve null (regla del usuario: no
   inventar, no fabricar coincidencias). */
import { tokenize, jaccard } from '../lib/excelImport.js';

const FUZZY_THRESHOLD = 0.34; // mismo umbral historico, por consistencia
const FUZZY_CONFIDENCE_CAP = 0.94; // por debajo de cualquier match exacto
const CATEGORIA_UNIDAD_MIN_OVERLAP = 0.05; // overlap minimo REAL de texto, nunca cero

function normalizeKey(v){
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function scopeByTipo(all, tipo){
  // `tipo` (opcional, encontrado como hueco real en la auditoria de
  // aceptacion): cuando se declara, solo compite contra filas del MISMO
  // tipo o SIN tipo declarado (catalogos legacy sin esa columna siguen
  // funcionando igual) -- evita que una tarifa de mano de obra "gane" por
  // similitud de texto contra un precio de material, y viceversa.
  return tipo ? all.filter(it => !it?.tipo || it.tipo === tipo) : all;
}

/* query: {desc, unidad?, categoria?, clave?, tipo?}.
   options: {semanticProvider?} -- ver NullSemanticProvider en
   src/lib/semanticProvider.js.
   Retorna null o {match, confidence (0-1), matchMethod}. */
export function findCatalogMatches(catalog, query, options = {}){
  const all = Array.isArray(catalog) ? catalog : [];
  const items = scopeByTipo(all, query?.tipo);
  if(!items.length) return null;
  const q = {
    desc: query?.desc || '',
    unidad: normalizeKey(query?.unidad || ''),
    categoria: normalizeKey(query?.categoria || ''),
    clave: normalizeKey(query?.clave || '')
  };
  const qDescKey = normalizeKey(q.desc);

  // 1) clave_exacta
  if(q.clave){
    const exact = items.find(it => it?.clave && normalizeKey(it.clave) === q.clave);
    if(exact) return { match: exact, confidence: 1, matchMethod: 'clave_exacta' };
  }

  // 2) alias_sinonimo
  if(qDescKey){
    const bySynonym = items.find(it => Array.isArray(it?.sinonimos)
      && it.sinonimos.some(s => normalizeKey(s) === qDescKey));
    if(bySynonym) return { match: bySynonym, confidence: 0.95, matchMethod: 'alias_sinonimo' };
  }

  // 3) descripcion_normalizada (texto identico salvo acentos/mayusculas/puntuacion)
  if(qDescKey){
    const byNormDesc = items.find(it => it?.desc && normalizeKey(it.desc) === qDescKey);
    if(byNormDesc) return { match: byNormDesc, confidence: 0.97, matchMethod: 'descripcion_normalizada' };
  }

  // 4) categoria_unidad (misma categoria Y misma unidad, con overlap de
  // texto minimo pero real -- nunca decide solo por categoria/unidad sin
  // ninguna relacion de texto)
  if(q.categoria && q.unidad){
    const dt = tokenize(q.desc);
    let bestCU = null, bestCUScore = 0;
    for(const it of items){
      if(!it?.categoria || !it?.unidad) continue;
      if(normalizeKey(it.categoria) !== q.categoria || normalizeKey(it.unidad) !== q.unidad) continue;
      const score = jaccard(dt, tokenize(it?.desc));
      if(score > bestCUScore){ bestCUScore = score; bestCU = it; }
    }
    if(bestCU && bestCUScore >= CATEGORIA_UNIDAD_MIN_OVERLAP && bestCUScore < FUZZY_THRESHOLD){
      return { match: bestCU, confidence: Math.min(0.65, 0.4 + bestCUScore), matchMethod: 'categoria_unidad' };
    }
  }

  // 5) fuzzy_token (Jaccard por tokens -- NUNCA se presenta como semantica)
  const dt = tokenize(q.desc);
  let best = null, bestScore = 0;
  for(const it of items){
    let score = jaccard(dt, tokenize(it?.desc));
    if(score <= 0) continue;
    if(q.categoria && it?.categoria && normalizeKey(it.categoria) === q.categoria) score += 0.1;
    if(q.unidad && it?.unidad && normalizeKey(it.unidad) === q.unidad) score += 0.05;
    if(score > bestScore){ bestScore = score; best = it; }
  }
  if(best && bestScore >= FUZZY_THRESHOLD){
    return { match: best, confidence: Math.min(bestScore, FUZZY_CONFIDENCE_CAP), matchMethod: 'fuzzy_token' };
  }

  // 6) semantic_provider (OPCIONAL -- sin API externa por defecto, ver
  // src/lib/semanticProvider.js). Solo corre si el llamador pasa un
  // proveedor real y disponible; nunca se activa por si solo.
  if(options.semanticProvider?.available){
    const result = options.semanticProvider.match(items, q);
    if(result?.match) return { match: result.match, confidence: result.confidence ?? 0.5, matchMethod: 'semantic_provider' };
  }

  return null;
}
