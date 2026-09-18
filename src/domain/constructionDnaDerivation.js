/* Derivacion PURA del Construction DNA (Fase F) a partir de datos YA
   reales del proyecto -- catalogo de conceptos, presupuesto agregado
   (Fase D), explosion de recursos (Fase A) y Confidence (motor existente,
   nunca duplicado). Ningun campo se inventa: si no hay evidencia real para
   un campo, queda `field(null)` (ver constructionDnaSchema.js) y la UI
   debe mostrar "Sin informacion" -- nunca un placeholder que parezca dato
   real.

   Deteccion de sistema constructivo/instalaciones: por PRESENCIA de
   conceptos reales en el capitulo correspondiente (nunca un catalogo de
   "sistemas constructivos" inventado) mas coincidencia de palabras clave
   sobre la descripcion real del concepto (ej. "losa", "impermeabilizante")
   -- ambas son lecturas de datos reales ya capturados, nunca fabricacion. */
import { field, DNA_ORIGIN, makeEmptyConstructionDna } from './constructionDnaSchema.js';
import { capituloLabel } from './presupuestoCapitulos.js';

function toNumber(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }

function conceptosByCapitulo(catalogConceptos, capitulo){
  return (catalogConceptos || []).filter(c => c.capitulo === capitulo && !c.archivedAt);
}

function matchKeyword(text, keywords){
  const t = String(text || '').toLowerCase();
  return keywords.some(k => t.includes(k));
}

/* Sistema constructivo por capitulo: lista las claves/descripciones reales
   de los conceptos encontrados (evidencia), nunca solo un "Si/No". */
function detectSystemFromCapitulo(catalogConceptos, capitulo){
  const found = conceptosByCapitulo(catalogConceptos, capitulo);
  if(!found.length) return EMPTY;
  return field(found.map(c => ({ clave: c.clave || null, concept: c.concept, qty: c.qty, unit: c.unit })), DNA_ORIGIN.DETECTED);
}

/* Cubiertas no tiene capitulo propio en PRESUPUESTO_CAPITULOS -- se detecta
   por palabra clave dentro de ESTRUCTURA/ACABADOS (unica senal real
   disponible; sin capitulo dedicado, nunca se inventa uno). */
function detectCubiertas(catalogConceptos){
  const keywords = ['losa de azotea', 'azotea', 'cubierta', 'impermeabiliz', 'techumbre'];
  const found = (catalogConceptos || []).filter(c => !c.archivedAt && matchKeyword(c.concept, keywords));
  if(!found.length) return EMPTY;
  return field(found.map(c => ({ clave: c.clave || null, concept: c.concept, qty: c.qty, unit: c.unit })), DNA_ORIGIN.DETECTED);
}

const INSTALACION_KEYWORDS = {
  electrica: ['electric', 'iluminacion', 'contacto electrico', 'tablero electrico'],
  hidraulica: ['hidraulic', 'agua potable', 'cisterna', 'bomba de agua'],
  sanitaria: ['sanitari', 'drenaje', 'albañal', 'fosa septica']
};

function detectInstalaciones(catalogConceptos){
  const instalacionesConceptos = conceptosByCapitulo(catalogConceptos, 'INSTALACIONES');
  const buckets = { electrica: [], hidraulica: [], sanitaria: [], especiales: [] };
  instalacionesConceptos.forEach(c => {
    const bucket = Object.keys(INSTALACION_KEYWORDS).find(k => matchKeyword(c.concept, INSTALACION_KEYWORDS[k]));
    buckets[bucket || 'especiales'].push({ clave: c.clave || null, concept: c.concept, qty: c.qty, unit: c.unit });
  });
  return {
    electrica: buckets.electrica.length ? field(buckets.electrica, DNA_ORIGIN.DETECTED) : EMPTY,
    hidraulica: buckets.hidraulica.length ? field(buckets.hidraulica, DNA_ORIGIN.DETECTED) : EMPTY,
    sanitaria: buckets.sanitaria.length ? field(buckets.sanitaria, DNA_ORIGIN.DETECTED) : EMPTY,
    especiales: buckets.especiales.length ? field(buckets.especiales, DNA_ORIGIN.DETECTED) : EMPTY
  };
}

/* Muros/losas (geometria): suma de cantidad de conceptos reales cuya
   descripcion/capitulo indica ese elemento -- unidad se conserva tal cual
   viene del concepto (nunca se asume m² si el capturista uso otra). */
function sumByKeyword(catalogConceptos, keywords){
  const found = (catalogConceptos || []).filter(c => !c.archivedAt && matchKeyword(c.concept, keywords));
  if(!found.length) return null;
  const byUnit = new Map();
  found.forEach(c => byUnit.set(c.unit || '—', (byUnit.get(c.unit || '—') || 0) + toNumber(c.qty)));
  return [...byUnit.entries()].map(([unit, qty]) => ({ qty, unit }));
}

const EMPTY = field(null);

function deriveGeometria(catalogConceptos){
  const areasPrincipales = (catalogConceptos || [])
    .filter(c => !c.archivedAt)
    .reduce((acc, c) => {
      const existing = acc.find(a => a.capitulo === c.capitulo);
      if(existing) existing.qty += toNumber(c.qty);
      else acc.push({ capitulo: c.capitulo, label: capituloLabel(c.capitulo), qty: toNumber(c.qty), unit: c.unit });
      return acc;
    }, []);

  const muros = sumByKeyword(catalogConceptos, ['muro', 'block', 'tabique', 'tabicón']);
  const losas = sumByKeyword(catalogConceptos, ['losa']);
  const elementosEstructurales = conceptosByCapitulo(catalogConceptos, 'ESTRUCTURA')
    .map(c => ({ clave: c.clave || null, concept: c.concept, qty: c.qty, unit: c.unit }));

  return {
    // Ni el proyecto ni ningun otro modulo capturan superficie construida o
    // numero de niveles hoy -- nunca se inventan, quedan "Sin informacion".
    superficieConstruida: EMPTY,
    niveles: EMPTY,
    areasPrincipales: areasPrincipales.length ? field(areasPrincipales, DNA_ORIGIN.DERIVED) : EMPTY,
    muros: muros ? field(muros, DNA_ORIGIN.DERIVED) : EMPTY,
    losas: losas ? field(losas, DNA_ORIGIN.DERIVED) : EMPTY,
    elementosEstructurales: elementosEstructurales.length ? field(elementosEstructurales, DNA_ORIGIN.DETECTED) : EMPTY
  };
}

function deriveSistemaConstructivo(catalogConceptos){
  return {
    cimentacion: detectSystemFromCapitulo(catalogConceptos, 'CIMENTACION'),
    estructura: detectSystemFromCapitulo(catalogConceptos, 'ESTRUCTURA'),
    muros: detectSystemFromCapitulo(catalogConceptos, 'ALBANILERIA'),
    cubiertas: detectCubiertas(catalogConceptos),
    acabados: detectSystemFromCapitulo(catalogConceptos, 'ACABADOS')
  };
}

/* Recursos principales: top 5 por importe de la explosion YA calculada
   (Fase A, computeExplosionData) -- nunca se vuelve a sumar el consumo a
   mano aqui, la Explosion es la unica fuente de verdad de recursos. */
function topByImporte(rows, n = 5){
  return [...(rows || [])]
    .sort((a, b) => toNumber(b.importe ?? b.total) - toNumber(a.importe ?? a.total))
    .slice(0, n)
    .map(r => ({ descripcion: r.descripcion || r.concept || '—', unidad: r.unidad || r.unit || null, importe: toNumber(r.importe ?? r.total) }));
}

function deriveRecursos(explosionData){
  const materiales = topByImporte(explosionData?.materials?.rows || explosionData?.materials);
  const manoObra = topByImporte(explosionData?.labor?.rows || explosionData?.labor);
  const maquinaria = topByImporte([...(explosionData?.machinery?.maquinaria || []), ...(explosionData?.machinery?.equipo || [])]);
  return {
    materialesPrincipales: materiales.length ? field(materiales, DNA_ORIGIN.DERIVED) : EMPTY,
    manoDeObra: manoObra.length ? field(manoObra, DNA_ORIGIN.DERIVED) : EMPTY,
    maquinariaEquipo: maquinaria.length ? field(maquinaria, DNA_ORIGIN.DERIVED) : EMPTY
  };
}

/* Costos: familias = subtotales por capitulo YA agregados (Fase D,
   aggregatePresupuesto) -- nunca un recalculo nuevo. Nivel de confianza =
   el MISMO resultado de runProjectConfidence (Confidence Engine, Fase 6),
   nunca un score de confianza distinto inventado para el DNA. */
function deriveCostos({ capituloSubtotals, ubicacionEstructurada, confidenceProject }){
  const familias = (capituloSubtotals || []).filter(c => c.importe > 0).map(c => ({ capitulo: c.capitulo, label: c.label, importe: c.importe }));
  return {
    familiasPrincipales: familias.length ? field(familias, DNA_ORIGIN.DERIVED) : EMPTY,
    costosRegionales: ubicacionEstructurada && (ubicacionEstructurada.city || ubicacionEstructurada.state || ubicacionEstructurada.country)
      ? field(ubicacionEstructurada, DNA_ORIGIN.DETECTED) : EMPTY,
    nivelConfianza: confidenceProject && confidenceProject.averageScore != null
      ? field({ averageScore: confidenceProject.averageScore, high: confidenceProject.high, medium: confidenceProject.medium, low: confidenceProject.low, insufficientEvidence: confidenceProject.insufficientEvidence }, DNA_ORIGIN.DERIVED)
      : EMPTY
  };
}

/* deriveConstructionDna: unico punto de entrada. Recibe datos YA
   calculados/fetched por el llamador (server/api-lib/_route-construction-dna.mjs)
   -- esta funcion nunca hace I/O, solo interpreta. */
export function deriveConstructionDna({
  id = null, projectId, catalogConceptos = [], capituloSubtotals = [],
  explosionData = null, ubicacionEstructurada = null, confidenceProject = null
} = {}){
  const empty = makeEmptyConstructionDna({ id, projectId });
  return {
    ...empty,
    geometria: deriveGeometria(catalogConceptos),
    sistemaConstructivo: deriveSistemaConstructivo(catalogConceptos),
    instalaciones: detectInstalaciones(catalogConceptos),
    recursos: deriveRecursos(explosionData),
    costos: deriveCostos({ capituloSubtotals, ubicacionEstructurada, confidenceProject })
  };
}
