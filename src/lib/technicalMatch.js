/* Validacion de equivalencia tecnica para Price Intelligence (ver
   api/_priceIntelligenceCore.mjs). Una referencia de mercado real (precio +
   URL real) NO es automaticamente comparable al recurso del APU: el caso
   golden de regresion es CLAVE 45 (ranurado), donde la busqueda real
   encontro un "disco diamantado de 14 pulgadas" (herramienta de corte de
   piso/losa industrial) para un recurso que en realidad necesita un disco
   pequeno de amoladora -- mismo texto "disco diamantado", producto
   incompatible.

   Principio de diseno (igual que el resto del motor de precios en esta
   sesion): la IA PROPONE hechos observables (que texto/atributos encontro en
   cada referencia, y que ficha tecnica describe al recurso que se busca);
   este modulo -- codigo puro, determinista, sin llamadas a red -- es quien
   DECIDE el puntaje de coincidencia. Nunca se confia en un "score" que la IA
   se autoasigne. */

function normalize(text){
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

function containsKeyword(haystack, keyword){
  const k = normalize(keyword);
  if(!k) return false;
  return normalize(haystack).includes(k);
}

/* Extrae el primer numero+unidad reconocible de un texto libre (pulgadas,
   cm, mm, kg, m2, m3, litros, pza) para comparacion dimensional aproximada.
   Best-effort: si no reconoce nada, retorna null -- eso simplemente no
   aporta puntaje por dimension, no bloquea el resto de la evaluacion. */
export function extractMeasurement(text){
  const t = normalize(text);
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(pulgadas?|["”]|cm|mm|kg|m2|m²|m3|m³|litros?|\bl\b|pza\b|piezas?)/);
  if(!m) return null;
  const unitRaw = m[2].replace(/["”]/, 'pulgadas').replace(/^piezas?$/, 'pza');
  return { value: parseFloat(m[1].replace(',', '.')), unit: unitRaw };
}

export const MATCH_VERDICT = Object.freeze({ ALTO: 'ALTO', MEDIO: 'MEDIO', BAJO: 'BAJO' });
export const MATCH_THRESHOLDS = Object.freeze({ ALTO: 85, MEDIO: 65 });

/* Puntua UNA referencia de mercado contra la ficha tecnica del recurso.
   ficha: {familia, uso, material, dimensiones, capacidad, keywordsObligatorias[],
           keywordsExcluyentes[], categoriaLaboral?, requiereFuenteEspecializada?}
   ref: {tipoProducto, descripcionEncontrada, material, dimension, presentacion,
         presentacionComparable, contextoUso, tipoFuenteSalarial?}
   Retorna {score(0-100), verdict, comparable, rejectReason, breakdown}. */
export function scoreReference(ficha = {}, ref = {}){
  const obligatorias = Array.isArray(ficha.keywordsObligatorias) ? ficha.keywordsObligatorias.filter(Boolean) : [];
  const excluyentes = Array.isArray(ficha.keywordsExcluyentes) ? ficha.keywordsExcluyentes.filter(Boolean) : [];
  const haystack = [ref.tipoProducto, ref.descripcionEncontrada, ref.material, ref.presentacion, ref.contextoUso].filter(Boolean).join(' | ');

  // Regla dura #1: cualquier keyword excluyente presente rechaza la
  // referencia de inmediato -- deteccion de categoria incorrecta (diametro
  // distinto, uso industrial distinto, producto premium incompatible,
  // accesorio en vez de consumible, maquina completa en vez de pieza). La IA
  // declara estas keywords en la ficha tecnica; el motor las hace cumplir.
  const matchedExclusion = excluyentes.find(k => containsKeyword(haystack, k));
  if(matchedExclusion){
    return { score: 0, verdict: MATCH_VERDICT.BAJO, comparable: false, rejectReason: `Categoria de producto incompatible: coincide con keyword excluyente "${matchedExclusion}".`, breakdown: { exclusion: matchedExclusion } };
  }

  // Regla dura #2: presentacion no comparable con certeza (ej. "cemento 2kg"
  // vs saco de 50kg sin poder confirmar que sea el mismo producto) rechaza
  // la referencia sin importar el resto del puntaje.
  const comparable = ref.presentacionComparable !== false;
  if(!comparable){
    return { score: 0, verdict: MATCH_VERDICT.BAJO, comparable: false, rejectReason: 'Presentacion no comparable con certeza contra la unidad requerida del APU (NO_COMPARABLE).', breakdown: { presentacion: 'no comparable' } };
  }

  let score = 0; let maxScore = 0; const breakdown = {};

  maxScore += 35;
  if(obligatorias.length){
    const found = obligatorias.filter(k => containsKeyword(haystack, k)).length;
    const pts = Math.round((found / obligatorias.length) * 35);
    score += pts; breakdown.tipoProducto = `${found}/${obligatorias.length} keywords obligatorias (${pts}/35)`;
  } else {
    score += 20; breakdown.tipoProducto = 'Sin keywords obligatorias declaradas en la ficha (20/35 por defecto)';
  }

  if(ficha.material){
    maxScore += 15;
    if(containsKeyword(haystack, ficha.material)){ score += 15; breakdown.material = `Coincide material "${ficha.material}" (15/15)`; }
    else breakdown.material = `No se confirmo material "${ficha.material}" en la referencia (0/15)`;
  }

  if(ficha.dimensiones){
    maxScore += 15;
    const fichaMeasure = extractMeasurement(ficha.dimensiones);
    const refMeasure = extractMeasurement(ref.dimension || ref.descripcionEncontrada);
    if(fichaMeasure && refMeasure && fichaMeasure.unit === refMeasure.unit){
      const diffPct = fichaMeasure.value > 0 ? Math.abs(refMeasure.value - fichaMeasure.value) / fichaMeasure.value : 1;
      if(diffPct <= 0.15){ score += 15; breakdown.dimension = `${refMeasure.value}${refMeasure.unit} vs ficha ${fichaMeasure.value}${fichaMeasure.unit} (dentro de +/-15%, 15/15)`; }
      else breakdown.dimension = `${refMeasure.value}${refMeasure.unit} vs ficha ${fichaMeasure.value}${fichaMeasure.unit} (fuera de tolerancia, 0/15)`;
    } else {
      breakdown.dimension = 'No se pudo comparar dimension numericamente entre referencia y ficha (0/15)';
    }
  }

  if(ficha.uso){
    maxScore += 10;
    if(containsKeyword(haystack, ficha.uso)){ score += 10; breakdown.uso = 'Contexto de uso coincide con la ficha (10/10)'; }
    else breakdown.uso = 'Contexto de uso no confirmado en la referencia (0/10)';
  }

  maxScore += 25;
  score += 25; // ya se confirmo comparable arriba (regla dura #2)
  breakdown.presentacion = 'Presentacion normalizable a la unidad requerida (25/25)';

  // Mano de obra: una fuente de salario minimo general (CONASAMI y similares)
  // respalda el piso salarial, pero NO valida por si sola el costo de una
  // categoria especializada -- se limita a MEDIO como maximo (ver Regla 6).
  let pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  let cappedReason = null;
  if(ficha.requiereFuenteEspecializada && ref.tipoFuenteSalarial === 'salario_minimo_general' && pct >= MATCH_THRESHOLDS.ALTO){
    pct = MATCH_THRESHOLDS.MEDIO;
    cappedReason = 'Fuente de salario minimo general no valida por si sola una categoria laboral especializada; limitado a MEDIO.';
  }

  const verdict = pct >= MATCH_THRESHOLDS.ALTO ? MATCH_VERDICT.ALTO : pct >= MATCH_THRESHOLDS.MEDIO ? MATCH_VERDICT.MEDIO : MATCH_VERDICT.BAJO;
  return {
    score: pct, verdict, comparable: true,
    rejectReason: verdict === MATCH_VERDICT.BAJO ? `Coincidencia tecnica insuficiente (${pct}%, minimo 65% para MEDIO).` : cappedReason,
    breakdown
  };
}

/* Aplica scoreReference a cada referencia encontrada y separa aceptadas
   (ALTO, participan en la mediana) de auxiliares (MEDIO, se muestran pero no
   entran a la estadistica) y rechazadas (BAJO, con motivo explicito). Nunca
   descarta informacion en silencio: toda referencia queda en el resultado
   con su veredicto y razon. */
export function evaluateReferences(ficha, referencias = []){
  const scored = referencias.map(ref => ({ ...ref, match: scoreReference(ficha, ref) }));
  const aceptadas = scored.filter(r => r.match.verdict === MATCH_VERDICT.ALTO);
  const auxiliares = scored.filter(r => r.match.verdict === MATCH_VERDICT.MEDIO);
  const rechazadas = scored.filter(r => r.match.verdict === MATCH_VERDICT.BAJO);
  return { scored, aceptadas, auxiliares, rechazadas };
}
