const SOURCE_LABELS = Object.freeze({
  takeoff: 'Takeoff',
  survey: 'Survey',
  manual: 'Manual',
  import: 'Importado',
  imported: 'Importado'
});

export function isValidQuantity(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

export function getCanonicalPu(apu) {
  const pu = Number(apu?.calculated?.pu);
  return Number.isFinite(pu) && pu > 0 ? pu : null;
}

export function getConceptOrigin(concept) {
  const sourceType = String(concept?.sourceType || '').toLowerCase();
  if (SOURCE_LABELS[sourceType]) return SOURCE_LABELS[sourceType];
  if (concept?.origenElementoId || concept?.origenPlano) return 'Takeoff';
  if (concept?.surveyId || concept?.sourceRecordId) return 'Survey';
  if (concept?.imported || concept?.importSource) return 'Importado';
  return 'Manual';
}

export function getRegionalSummary(concept, apu) {
  const location = concept?.ubicacionEstructurada || apu?.ubicacionEstructurada || null;
  const regionalRows = [
    ...(apu?.materials || []),
    ...(apu?.labor || []),
    ...(apu?.herramientaMenor?.detalle || []),
    ...(apu?.equipment || []),
    ...(apu?.consumables || [])
  ];
  const rowWithRegion = regionalRows.find(row => row?.regionalFallbackLevel || row?.priceStatus);
  return {
    country: location?.country || location?.pais || '—',
    state: location?.state || location?.estado || '—',
    city: location?.city || location?.municipio || '—',
    level: rowWithRegion?.regionalFallbackLevel || 'sin dato',
    hasData: Boolean(rowWithRegion)
  };
}

export function classifyCostConcept(concept, apu) {
  const qtyValid = isValidQuantity(concept?.qty);
  const pu = getCanonicalPu(apu);
  let status = 'sin-cantidad';
  if (qtyValid && !concept?.apuId) status = 'falta-apu';
  else if (qtyValid && concept?.apuId && !pu) status = 'apu-incompleto';
  else if (qtyValid && concept?.apuId && pu) status = 'listo';
  return {
    concept,
    apu,
    qty: qtyValid ? Number(concept.qty) : 0,
    pu,
    importe: pu && qtyValid ? Number(concept.qty) * pu : 0,
    origin: getConceptOrigin(concept),
    regional: getRegionalSummary(concept, apu),
    status
  };
}

export function buildCostRows(conceptos = [], apus = [], projectId = null) {
  const apuById = new Map(
    apus.filter(apu => !projectId || apu?.projectId === projectId).map(apu => [apu.id, apu])
  );
  return conceptos
    .filter(concept => !projectId || concept?.projectId === projectId)
    .map(concept => classifyCostConcept(concept, apuById.get(concept.apuId)));
}

export function summarizeCosts(rows = []) {
  const quantified = rows.filter(row => isValidQuantity(row.concept?.qty));
  const ready = quantified.filter(row => row.status === 'listo');
  return {
    quantifiedCount: quantified.length,
    readyCount: ready.length,
    pendingCount: quantified.length - ready.length,
    subtotal: ready.reduce((sum, row) => sum + row.importe, 0),
    status: quantified.length === 0
      ? 'pendiente'
      : ready.length > 0 && ready.length === quantified.length
        ? 'completado'
        : 'atencion'
  };
}
