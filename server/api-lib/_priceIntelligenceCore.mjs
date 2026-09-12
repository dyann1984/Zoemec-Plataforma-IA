/* Price Intelligence real con validacion de equivalencia tecnica.

   Pipeline obligatorio (ver src/lib/technicalMatch.js para el motor de
   puntaje, que es codigo puro y determinista, nunca un "score" que la IA se
   autoasigne):

     RECURSO DEL APU -> FICHA TECNICA -> BUSQUEDA WEB REAL -> ATRIBUTOS POR
     REFERENCIA -> technicalMatchScore (motor, no la IA) -> ESTADISTICA
     (solo con referencias ALTO) -> PRECIO PROPUESTO

   Caso golden de regresion: CLAVE 45 (ranurado). Una busqueda real
   encontraba un "disco diamantado de 14 pulgadas" (herramienta de corte de
   piso/losa industrial) para un recurso que en realidad necesita un disco
   pequeno de amoladora -- mismo texto "disco diamantado", producto
   incompatible. Ese error ya no debe alimentar la mediana: la IA declara
   keywords excluyentes en la ficha tecnica (ej. "14 pulgadas", "sierra de
   piso") y el motor rechaza cualquier referencia que las contenga, sin
   importar que tan buen precio tenga. */

import { evaluateReferences, MATCH_VERDICT } from '../../src/lib/technicalMatch.js';
import { findCountry, formatLocationDisplay, MEXICO_CODE } from '../../src/domain/geography.js';

const MODEL = process.env.OPENAI_PRICE_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';

async function callResponses(body){
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

function extractText(data){
  if(data?.output_text) return data.output_text;
  const parts = (Array.isArray(data?.output) ? data.output : [])
    .filter(item => item?.type === 'message')
    .flatMap(item => Array.isArray(item.content) ? item.content : [])
    .filter(c => c?.type === 'output_text')
    .map(c => c.text || '');
  return parts.join('\n');
}

function median(nums){
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/* Outlier DENTRO del grupo ya filtrado por equivalencia tecnica (ALTO): un
   precio que se desvia mas de 40% de la mediana de esas referencias. Regla
   simple y documentada, no una caja negra; solo excluye del "precio
   recomendado", nunca borra la referencia (se conserva marcada para
   auditoria). */
function detectOutliers(precios, med){
  if(!(med > 0)) return precios.map(() => false);
  return precios.map(p => Math.abs(p - med) / med > 0.4);
}

// Fase 2 (APU regionalizados): niveles que la propia IA autoreporta por
// referencia (mismo criterio que ya usa para presentacionComparable/
// tipoFuenteSalarial -- lo que la fuente dice, no un puntaje que el modelo
// se autoasigne). REGIONAL_CONFIDENCE se deriva de forma DETERMINISTA aqui
// mismo (nunca lo decide la IA) a partir de que nivelCobertura tuvieron las
// referencias que SI pasaron el filtro tecnico (ALTO) -- nunca se inventa
// una confianza regional sobre referencias que ni siquiera calificaron.
export const REGIONAL_COVERAGE = Object.freeze(['ciudad', 'estado', 'nacional', 'no_especificado']);

/* deriveRegionalConfidence: NUNCA la decide la IA -- se calcula aqui mismo,
   deterministicamente, a partir de que nivelCobertura autoreportaron las
   referencias que YA pasaron el filtro tecnico (ALTO/aceptadas). Si ninguna
   referencia aceptada trae nivel ciudad/estado, la confianza regional es
   BAJA y se debe mostrar el aviso honesto del brief ("informacion regional
   limitada...") -- nunca se sube la confianza solo porque el precio en si
   tenga buena evidencia tecnica (esa es una dimension distinta, ya cubierta
   por nivelEvidencia/priceConfidence). */
export function deriveRegionalConfidence(aceptadas){
  if(!aceptadas.length) return { regionalConfidence: null, regionalFallbackLevel: null };
  if(aceptadas.some(r => r.nivelCobertura === 'ciudad')) return { regionalConfidence: 'ALTA', regionalFallbackLevel: 'ciudad' };
  if(aceptadas.some(r => r.nivelCobertura === 'estado')) return { regionalConfidence: 'MEDIA', regionalFallbackLevel: 'estado' };
  return { regionalConfidence: 'BAJA', regionalFallbackLevel: 'nacional' };
}

function tipoTextoPara(kind){
  if(kind === 'labor') return 'salario base diario (por jornada, sin prestaciones) de este oficio de la construccion';
  if(kind === 'equipment') return 'costo de renta por dia de este equipo o maquinaria de construccion';
  if(kind === 'seguridad') return 'precio de venta al publico de esta pieza de equipo de proteccion personal (EPP), nueva';
  return 'precio unitario de venta de este material de construccion';
}

export async function searchMarketReferences({ description = '', unit = '', kind = 'materials', location = '', country = '', state = '', city = '', dateBase = '', categoriaLaboral = '' } = {}){
  if(!process.env.OPENAI_API_KEY) throw new Error('Falta OPENAI_API_KEY en Vercel.');
  const desc = String(description || '').trim();
  if(!desc) throw new Error('Falta la descripcion del insumo a consultar.');

  const laborNote = kind === 'labor'
    ? `\nEsta busqueda es de MANO DE OBRA. Categoria laboral declarada: "${categoriaLaboral || 'no especificada'}". Distingue explicitamente si tu fuente es (a) salario minimo general (CONASAMI o equivalente, que solo respalda el piso salarial, no una categoria especializada), (b) encuesta/tabulador de costos de construccion, o (c) salario reportado para esa categoria especifica. Reporta esto en "tipoFuenteSalarial": "salario_minimo_general" | "tabulador_construccion" | "salario_categoria_especifica".`
    : '';

  // Fase 2 (APU regionalizados): pais/estado/ciudad ESTRUCTURADOS (cuando el
  // proyecto los trae, ver src/domain/intelligence2Runtime.js) tienen
  // prioridad sobre `location` (texto libre legado, ej. projects.ubicacion
  // sin estructurar) -- nunca se pierden ambos, `location` sigue siendo el
  // respaldo para llamadores que todavia no migraron (api/market-price.mjs,
  // el sistema viejo src/domain/priceIntelligence.js). countryName tambien
  // decide "en Mexico" vs "en <pais>" en el PASO 2 -- por defecto sigue
  // siendo Mexico exactamente como antes de esta fase (ningun llamador
  // existente cambia de comportamiento si no manda country).
  const countryName = country ? (findCountry(country)?.name || country) : 'Mexico';
  const structuredLocation = formatLocationDisplay({ country, state, city });
  const locationContext = structuredLocation || location;
  const isMexico = !country || country === MEXICO_CODE;

  const prompt = `Vas a resolver el precio de un insumo de construccion en 2 pasos, en UNA sola respuesta JSON.

PASO 1 -- FICHA TECNICA del recurso, a partir de esta descripcion:
"${desc}"${unit ? ` (unidad requerida para el calculo: ${unit})` : ''}
Deriva: familia, uso dentro del concepto, material principal (si aplica), dimensiones/capacidad principales si el texto las trae (ej. "14 pulgadas", "20 kg"), keywords OBLIGATORIAS que cualquier producto/servicio equivalente debe cumplir (2-4 palabras clave), y keywords EXCLUYENTES que descartarian un producto de OTRA categoria aunque comparta palabras (ej. si el recurso es "disco" chico de amoladora, excluye "sierra de piso", "cortadora industrial", diametros claramente distintos, "maquina completa" cuando el recurso es solo una pieza/consumible).

PASO 2 -- BUSCA EN LA WEB el ${tipoTextoPara(kind)} en ${countryName}${locationContext ? ` (ubicacion de referencia: ${locationContext})` : ''}, en ${isMexico ? 'pesos mexicanos (MXN)' : 'la moneda local'}, con fecha base ${dateBase || 'hoy'}.${laborNote}
${locationContext ? `PRIORIZA fuentes que atiendan especificamente "${locationContext}" (sucursal local, distribuidor de esa plaza, tabulador regional) ANTES que una fuente generica nacional -- pero nunca inventes una fuente local que no exista: si de verdad no encuentras nada especifico de esa ubicacion, usa una fuente nacional confiable y dilo honestamente (ver nivelCobertura abajo).\n` : ''}Consulta VARIAS fuentes ${isMexico ? 'mexicanas' : `de ${countryName}`} reales y distintas entre si, en este orden de prioridad: fabricante, distribuidor autorizado, proveedor especializado, cadena comercial reconocida${isMexico ? ' (Home Depot Mexico, Construrama, ferreterias en linea, tabuladores CMIC/CNIC, CONASAMI para salarios)' : ''}. Reporta cada fuente por separado -- NO promedies ni resumas tu mismo, eso lo calcula el sistema.
Para CADA referencia reporta tambien los atributos que observaste en la pagina (no un puntaje, solo lo que dice la fuente): tipo de producto/servicio exacto, dimension/capacidad si aparece, material si aparece, presentacion original, si esa presentacion se puede convertir con CERTEZA a la unidad requerida (si no puedes estar seguro de la conversion, marca presentacionComparable:false -- NUNCA fuerces una conversion dudosa), y de que nivel geografico es realmente esa fuente: "ciudad" (especifica de "${city || locationContext}"), "estado" (especifica de "${state || locationContext}" pero no de esa ciudad puntual), "nacional" (generica, sin anclaje regional), o "no_especificado" (no puedes determinarlo). NUNCA marques "ciudad" o "estado" solo porque tu busqueda los menciono -- solo si la FUENTE misma es de ahi.

Devuelve SOLO un JSON valido, sin markdown ni texto adicional:
{
  "fichaTecnica": {
    "familia": "texto", "uso": "texto", "material": "texto o null",
    "dimensiones": "texto o null", "capacidad": "texto o null",
    "keywordsObligatorias": ["..."], "keywordsExcluyentes": ["..."]
  },
  "referencias": [
    {
      "proveedor": "nombre real de la fuente consultada",
      "url": "url real de la fuente",
      "precioOriginal": numero,
      "presentacionOriginal": "texto, ej. saco 20kg / cubeta 19L / pieza",
      "unidadOriginal": "texto",
      "factorConversion": numero (multiplicador para llegar a la unidad requerida; 1 si ya coincide),
      "precioNormalizado": numero (precio ya convertido a la unidad requerida),
      "fecha": "fecha de la fuente o de tu consulta",
      "tipoProducto": "texto -- que es exactamente, tal como lo describe la fuente",
      "dimension": "texto o null -- dimension/capacidad tal como aparece en la fuente",
      "material": "texto o null",
      "contextoUso": "texto o null -- para que aplicacion lo describe la fuente",
      "presentacionComparable": true|false,
      "nivelCobertura": "ciudad" | "estado" | "nacional" | "no_especificado"${kind === 'labor' ? ',\n      "tipoFuenteSalarial": "salario_minimo_general" | "tabulador_construccion" | "salario_categoria_especifica"' : ''}
    }
  ]
}
Incluye entre 1 y 5 referencias reales verificables. Si no encuentras ninguna fuente confiable, devuelve "referencias": [].`;

  const base = { model: MODEL, input: prompt };
  let out = await callResponses({ ...base, tools: [{ type: 'web_search' }] });
  if(!out.ok){
    out = await callResponses({
      ...base,
      tools: [{ type: 'web_search_preview', user_location: { type: 'approximate', country: 'MX' } }]
    });
  }
  if(!out.ok) throw new Error(out.data?.error?.message || `OpenAI API error ${out.status}`);

  const text = extractText(out.data);
  const clean = String(text || '').replace(/```json|```/g, '').trim();
  const jsonMatch = clean.match(/\{[\s\S]*\}/);
  const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { fichaTecnica: {}, referencias: [] };

  const fichaTecnica = {
    familia: String(parsed.fichaTecnica?.familia || '').trim(),
    uso: String(parsed.fichaTecnica?.uso || '').trim(),
    material: String(parsed.fichaTecnica?.material || '').trim() || null,
    dimensiones: String(parsed.fichaTecnica?.dimensiones || '').trim() || null,
    capacidad: String(parsed.fichaTecnica?.capacidad || '').trim() || null,
    keywordsObligatorias: Array.isArray(parsed.fichaTecnica?.keywordsObligatorias) ? parsed.fichaTecnica.keywordsObligatorias.map(String) : [],
    keywordsExcluyentes: Array.isArray(parsed.fichaTecnica?.keywordsExcluyentes) ? parsed.fichaTecnica.keywordsExcluyentes.map(String) : [],
    categoriaLaboral: categoriaLaboral || null,
    requiereFuenteEspecializada: kind === 'labor' && /especialista|soldador|electricista|plomero|instalador certificado|tecnico/i.test(categoriaLaboral || desc)
  };

  const referenciasCrudas = (Array.isArray(parsed.referencias) ? parsed.referencias : [])
    .map(r => {
      const factorConversion = Number(r.factorConversion) > 0 ? Number(r.factorConversion) : 1;
      const precioOriginal = Number(r.precioOriginal) || 0;
      const precioNormalizado = Number(r.precioNormalizado) > 0 ? Number(r.precioNormalizado) : precioOriginal / factorConversion;
      return {
        proveedor: String(r.proveedor || '').trim(),
        url: String(r.url || '').trim(),
        precioOriginal,
        presentacionOriginal: String(r.presentacionOriginal || '').trim(),
        unidadOriginal: String(r.unidadOriginal || unit || '').trim(),
        factorConversion,
        precioNormalizado,
        fecha: String(r.fecha || '').trim(),
        tipoProducto: String(r.tipoProducto || '').trim(),
        dimension: String(r.dimension || '').trim() || null,
        material: String(r.material || '').trim() || null,
        contextoUso: String(r.contextoUso || '').trim() || null,
        presentacionComparable: r.presentacionComparable !== false,
        nivelCobertura: REGIONAL_COVERAGE.includes(r.nivelCobertura) ? r.nivelCobertura : 'no_especificado',
        tipoFuenteSalarial: r.tipoFuenteSalarial || null
      };
    })
    .filter(r => r.precioNormalizado > 0);

  if(!referenciasCrudas.length){
    return { fichaTecnica, referencias: [], estadisticas: null, precioRecomendado: null, nivelEvidencia: 'ESTIMADO_IA', regionalConfidence: null, regionalFallbackLevel: null, ubicacionConsultada: locationContext || null };
  }

  const { scored, aceptadas, auxiliares, rechazadas } = evaluateReferences(fichaTecnica, referenciasCrudas);

  // Estadistica SOLO con referencias ALTO (tecnicamente equivalentes): nunca
  // se calcula una mediana con una muestra invalida (MEDIO/BAJO no
  // participan). Dentro de las ALTO, deteccion de outliers de precio.
  const referencias = scored.map(r => ({ ...r, outlier: false }));
  let estadisticas = null;
  let precioRecomendado = null;
  let nivelEvidencia = 'ESTIMADO_IA';
  const { regionalConfidence, regionalFallbackLevel } = deriveRegionalConfidence(aceptadas);

  if(aceptadas.length){
    const precios = aceptadas.map(r => r.precioNormalizado);
    const med = median(precios);
    const outlierFlags = detectOutliers(precios, med);
    aceptadas.forEach((r, i) => {
      const target = referencias.find(x => x === r || (x.proveedor === r.proveedor && x.url === r.url && x.precioNormalizado === r.precioNormalizado));
      if(target) target.outlier = outlierFlags[i];
    });
    const validos = precios.filter((_, i) => !outlierFlags[i]);
    const usados = validos.length ? validos : precios;
    estadisticas = {
      minimo: Math.min(...precios), maximo: Math.max(...precios),
      mediana: median(usados), promedio: usados.reduce((a, b) => a + b, 0) / usados.length,
      nFuentes: aceptadas.length, nFuentesAuxiliares: auxiliares.length, nFuentesRechazadas: rechazadas.length
    };
    precioRecomendado = estadisticas.mediana;
    nivelEvidencia = aceptadas.length >= 3 ? 'MERCADO' : 'REFERENCIAL';
  } else if(auxiliares.length){
    // Ninguna referencia ALTO: las MEDIO quedan visibles como auxiliares
    // (para revision humana) pero NO alimentan el precio recomendado.
    estadisticas = { minimo: null, maximo: null, mediana: null, promedio: null, nFuentes: 0, nFuentesAuxiliares: auxiliares.length, nFuentesRechazadas: rechazadas.length };
    nivelEvidencia = 'ESTIMADO_IA';
  }

  return { fichaTecnica, referencias, estadisticas, precioRecomendado, nivelEvidencia, regionalConfidence, regionalFallbackLevel, ubicacionConsultada: locationContext || null };
}
