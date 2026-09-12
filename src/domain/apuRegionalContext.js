/* P1 (correccion de regresion en produccion, "la regionalizacion no es
   visible ni trazable"): agrega SOLO lectura/resumen sobre datos que YA
   calcula materialPriceIntelligence2.js por renglon (regionalConfidence,
   regionalFallbackLevel, priceStatus, fuente.region/nivelCobertura) --
   este modulo NUNCA vuelve a calcular una busqueda de precio ni inventa un
   nivel de cobertura que ningun renglon reporto. Puro, testeable con
   node --test (sin React/Firebase/OpenAI). */

export const REGIONAL_COVERAGE_LEVEL = Object.freeze({
  CIUDAD: 'ciudad', ESTADO: 'estado', NACIONAL: 'nacional', SIN_DATO: 'sin_dato'
});

const REGIONAL_RESOURCE_KINDS = ['materials', 'labor', 'equipment', 'consumables', 'seguridad'];
const CONFIDENCE_RANK = { ALTA: 3, MEDIA: 2, BAJA: 1 };

/* Ubicacion ESTRUCTURADA del APU (snapshot del proyecto al momento de
   generarlo, ver src/domain/geography.js#buildProjectLocationSnapshot) --
   deliberadamente NUNCA los campos de texto libre legados apu.pais/estado/
   municipio (esos son historicos, no alimentan ninguna busqueda regional
   real desde Fase 2). */
export function getApuLocation(apu){
  const loc = apu?.ubicacionEstructurada || {};
  return { country: loc.country || null, state: loc.state || null, city: loc.city || null };
}

export function hasApuLocation(apu){
  const loc = getApuLocation(apu);
  return Boolean(loc.country || loc.state || loc.city);
}

/* Recolecta, por cada renglon con evidencia de precio (Intelligence2 ya
   corrio sobre el), su nivel de cobertura real y su confianza -- nunca
   asume "sin dato" = "nacional": son cosas distintas (uno es ausencia de
   busqueda, el otro es una busqueda real que solo encontro referencia
   nacional). */
export function collectRegionalRows(apu){
  const rows = [];
  for(const kind of REGIONAL_RESOURCE_KINDS){
    for(const row of (apu?.[kind] || [])){
      if(!row) continue;
      const hasRegionalData = row.regionalFallbackLevel != null || row.priceStatus != null;
      rows.push({
        kind,
        descripcion: row.descripcion || '',
        hasRegionalData,
        level: hasRegionalData ? (row.regionalFallbackLevel || REGIONAL_COVERAGE_LEVEL.NACIONAL) : REGIONAL_COVERAGE_LEVEL.SIN_DATO,
        confidence: row.regionalConfidence || null,
        priceStatus: row.priceStatus || null,
        region: row.fuente?.region || null,
        precio: row.precioUnitario ?? row.salarioBase ?? row.tarifa ?? null,
        referencias: row.regionalIntelligence?.nObservaciones ?? null
      });
    }
  }
  return rows;
}

/* Resumen agregado para el bloque "Contexto regional del APU": conteo por
   nivel de cobertura + confianza dominante. "Dominante" = la confianza mas
   frecuente ENTRE los renglones que SI tienen dato -- nunca se promedia
   ALTA+BAJA a "MEDIA" artificialmente, se reporta la que de verdad
   predomina. null cuando NINGUN renglon ha corrido Intelligence2 todavia
   (ausencia real de dato, no una BAJA confianza inventada). */
export function summarizeRegionalCoverage(apu){
  const rows = collectRegionalRows(apu);
  const withData = rows.filter(r => r.hasRegionalData);
  const coverageByLevel = {
    [REGIONAL_COVERAGE_LEVEL.CIUDAD]: 0, [REGIONAL_COVERAGE_LEVEL.ESTADO]: 0,
    [REGIONAL_COVERAGE_LEVEL.NACIONAL]: 0, [REGIONAL_COVERAGE_LEVEL.SIN_DATO]: 0
  };
  rows.forEach(r => { coverageByLevel[r.level] = (coverageByLevel[r.level] || 0) + 1; });

  let dominantConfidence = null;
  if(withData.length){
    const counts = {};
    withData.forEach(r => { if(r.confidence) counts[r.confidence] = (counts[r.confidence] || 0) + 1; });
    const entries = Object.entries(counts);
    if(entries.length){
      dominantConfidence = entries.sort((a, b) => (b[1] - a[1]) || (CONFIDENCE_RANK[b[0]] - CONFIDENCE_RANK[a[0]]))[0][0];
    }
  }

  // Nivel de cobertura "principal" a mostrar en el resumen de una linea: el
  // mas GRANULAR que aparezca al menos una vez entre los renglones CON dato
  // -- si hay aunque sea un renglon con referencia de ciudad real, vale la
  // pena decir "Ciudad" (el usuario puede entrar al detalle por renglon
  // para ver cuales cayeron a estado/nacional, nunca se oculta ahi).
  let primaryLevel = null;
  if(withData.length){
    if(coverageByLevel[REGIONAL_COVERAGE_LEVEL.CIUDAD] > 0) primaryLevel = REGIONAL_COVERAGE_LEVEL.CIUDAD;
    else if(coverageByLevel[REGIONAL_COVERAGE_LEVEL.ESTADO] > 0) primaryLevel = REGIONAL_COVERAGE_LEVEL.ESTADO;
    else primaryLevel = REGIONAL_COVERAGE_LEVEL.NACIONAL;
  }

  return {
    location: getApuLocation(apu),
    hasLocation: hasApuLocation(apu),
    totalRows: rows.length,
    rowsWithData: withData.length,
    coverageByLevel,
    primaryLevel,
    dominantConfidence
  };
}
