/* Diagnostico determinista del CONTEXTO de generacion de un APU (Fase 3.5).
   Puro, sin red ni React.

   PROPOSITO (bug reportado: APU diferente entre ADMIN y COLLABORATOR):
   audita, ANTES de disparar /api/generate-apu, todos los insumos que el
   motor va a recibir y produce un reporte trazable con warnings. Cuando
   dos usuarios generen el MISMO concepto en el MISMO proyecto, comparar
   estos reportes lado a lado permite detectar la asimetria SIN adivinar.

   Regla del encargo (§6): "Si una consulta falla por permisos, NO quiero
   que el sistema continue silenciosamente generando un APU inferior.
   Debe registrar error tecnico, degradar Confidence, mostrar advertencia
   si corresponde, usar fallback solo si esta disenado para ello, pero
   debe quedar trazable."

   Este modulo entrega el reporte. `CadPropertiesPanel`, `CatalogoModule`
   y el motor `enrichApuWithIntelligence2` lo consumen para:
   - mostrar warnings visibles al usuario ANTES de aceptar el APU;
   - estampar `apu.contextDiagnostics` en el resultado para auditoria;
   - decidir si degradar Confidence (nunca inventar). */

export const CONTEXT_WARNING = Object.freeze({
  EMPTY_CATALOG: 'EMPTY_CATALOG',
  SMALL_CATALOG: 'SMALL_CATALOG',
  MISSING_PROJECT_LOCATION: 'MISSING_PROJECT_LOCATION',
  MISSING_REFERENCE_PU: 'MISSING_REFERENCE_PU',
  ENRICHMENT_FAILED: 'ENRICHMENT_FAILED',
  PERMISSION_DEGRADATION: 'PERMISSION_DEGRADATION',
  LIBRARY_ACCESS_LOCAL_ONLY: 'LIBRARY_ACCESS_LOCAL_ONLY',
  NO_HISTORICAL_APUS: 'NO_HISTORICAL_APUS'
});

const SEVERITY_BY_CODE = Object.freeze({
  EMPTY_CATALOG: 'ALTA',
  SMALL_CATALOG: 'MEDIA',
  MISSING_PROJECT_LOCATION: 'MEDIA',
  MISSING_REFERENCE_PU: 'BAJA',
  ENRICHMENT_FAILED: 'ALTA',
  PERMISSION_DEGRADATION: 'CRITICA',
  LIBRARY_ACCESS_LOCAL_ONLY: 'MEDIA',
  NO_HISTORICAL_APUS: 'BAJA'
});

const SMALL_CATALOG_THRESHOLD = 30;

/* Contexto CANONICO que el motor recibe. Deliberadamente NO incluye role
   ni permisos: `generateAPU` (server) NO discrimina por rol -- si dos
   sesiones producen el mismo `contexto`, deben producir el mismo APU.
   Ese es el invariante que el test de paridad verifica.

   Campos:
     concept, unit, referencePU  -- entradas directas del usuario
     catalogSize                 -- numero de renglones del catalogo
                                    disponible LOCAL para este usuario
     project                     -- { id, ubicacion, ubicacionEstructurada,
                                       hasLocation }
     historicalApuCount          -- APUs del proyecto que el usuario ve
     libraryCount                -- documentos de biblioteca a los que el
                                    usuario tiene acceso (privados propios
                                    + globales)
     enrichmentFailed            -- boolean: enrichApuWithIntelligence2
                                    fallo (silent catch de Fase 1). null si
                                    todavia no se corrio.
     enrichmentError             -- mensaje real del fallo (nunca oculto)
     userScope                   -- { role, organizationId?, uid? } -- se
                                    usa SOLO en warnings de auditoria,
                                    NUNCA para cambiar el prompt/catalog. */
export function summarizeGenerationContext({
  concept = '', unit = '', referencePU = 0,
  catalogSize = 0, project = null,
  historicalApuCount = 0, libraryCount = 0,
  enrichmentFailed = null, enrichmentError = null,
  userScope = null
} = {}){
  const warnings = [];
  const push = (code, message, detail = {}) => warnings.push({ code, severity: SEVERITY_BY_CODE[code] || 'MEDIA', message, ...detail });

  if(catalogSize === 0){
    push(CONTEXT_WARNING.EMPTY_CATALOG,
      'La biblioteca de precios local esta vacia -- la IA generara la mayoria de precios sin evidencia de mercado (marcados "estimado_ia"). Importa precios o pide acceso a la biblioteca de la empresa.',
      { catalogSize });
  } else if(catalogSize < SMALL_CATALOG_THRESHOLD){
    push(CONTEXT_WARNING.SMALL_CATALOG,
      `La biblioteca local tiene ${catalogSize} referencias (recomendado: ${SMALL_CATALOG_THRESHOLD}+). Los precios pueden estar sub-representados.`,
      { catalogSize });
  }

  const hasLocation = Boolean(project?.ubicacionEstructurada || project?.locationCity || project?.locationState || project?.locationCountry);
  if(project && !hasLocation){
    push(CONTEXT_WARNING.MISSING_PROJECT_LOCATION,
      'El proyecto no tiene ubicacion estructurada -- Price Intelligence no podra regionalizar precios.',
      { projectId: project.id || null });
  }

  if(!(Number(referencePU) > 0)){
    push(CONTEXT_WARNING.MISSING_REFERENCE_PU,
      'Sin P.U. de referencia: la IA no tiene un ancla economica y puede desviarse mas de lo esperado.',
      { referencePU: Number(referencePU) || 0 });
  }

  if(enrichmentFailed === true){
    push(CONTEXT_WARNING.ENRICHMENT_FAILED,
      `Price Intelligence fallo durante el enriquecimiento -- el APU quedara sin precios de mercado reales. ${enrichmentError ? `Motivo: ${enrichmentError}` : 'Sin motivo reportado.'}`,
      { enrichmentError });
  }

  if(historicalApuCount === 0){
    push(CONTEXT_WARNING.NO_HISTORICAL_APUS,
      'No hay APUs historicos del proyecto para calibrar. La primera generacion puede requerir mas revision manual.');
  }

  // Advertencia arquitectonica: la biblioteca (users/{uid}/state/zoemec-catalogo
  // y coleccion `library` con scope ownerUid o visibility=global) NO es
  // multi-tenant. Un COLLABORATOR de la misma empresa NO ve la biblioteca
  // privada del ADMIN. Si el userScope declara pertenencia a organizacion
  // Y libraryCount = 0, es probable degradation por scope.
  if(userScope?.organizationId && libraryCount === 0){
    push(CONTEXT_WARNING.LIBRARY_ACCESS_LOCAL_ONLY,
      'Tu biblioteca de referencia esta vacia aunque perteneces a una empresa. La biblioteca de ZOEMEC hoy no se comparte entre miembros de la misma organizacion -- pide al administrador que suba documentos como "global" o importa los tuyos.',
      { organizationId: userScope.organizationId, libraryCount });
  }

  return {
    concept: String(concept || '').trim(),
    unit: String(unit || '').trim(),
    referencePU: Number(referencePU) || 0,
    catalogSize,
    projectId: project?.id || null,
    hasLocation,
    historicalApuCount,
    libraryCount,
    enrichmentFailed: enrichmentFailed === true,
    enrichmentError: enrichmentError || null,
    warnings,
    // scope agregado como diagnostico -- NO se usa para modificar
    // catalog/prompt/modelo. Sirve para que el APU guardado pueda
    // rastrear POR QUE dos usuarios obtuvieron resultados distintos.
    userScope: userScope ? {
      role: String(userScope.role || 'user'),
      organizationId: userScope.organizationId || null,
      uid: userScope.uid || null
    } : null,
    // Confidence penalty determinista: cuantos warnings ALTA/CRITICA
    // reducen la confianza declarada por la IA. La UI final aplica la
    // penalty; este modulo solo la calcula.
    confidencePenalty: warnings.filter(w => w.severity === 'ALTA' || w.severity === 'CRITICA').length * 5
  };
}

/* Compara dos reportes (ej. ADMIN vs COLLABORATOR sobre el MISMO concepto
   en el MISMO proyecto). Devuelve un objeto que la UI/tests pueden usar
   para reportar la diferencia con precision. */
export function diffGenerationContext(a, b){
  const diffs = [];
  const compare = (key, aValue, bValue) => {
    if(aValue !== bValue) diffs.push({ key, a: aValue, b: bValue });
  };
  compare('catalogSize', a?.catalogSize, b?.catalogSize);
  compare('hasLocation', a?.hasLocation, b?.hasLocation);
  compare('historicalApuCount', a?.historicalApuCount, b?.historicalApuCount);
  compare('libraryCount', a?.libraryCount, b?.libraryCount);
  compare('enrichmentFailed', a?.enrichmentFailed, b?.enrichmentFailed);

  const aCodes = new Set((a?.warnings || []).map(w => w.code));
  const bCodes = new Set((b?.warnings || []).map(w => w.code));
  const warningCodesDiff = [];
  aCodes.forEach(c => { if(!bCodes.has(c)) warningCodesDiff.push({ code: c, only: 'a' }); });
  bCodes.forEach(c => { if(!aCodes.has(c)) warningCodesDiff.push({ code: c, only: 'b' }); });

  return {
    fieldDiffs: diffs,
    warningCodesDiff,
    identical: diffs.length === 0 && warningCodesDiff.length === 0
  };
}
