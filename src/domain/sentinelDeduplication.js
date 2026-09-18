/* Deduplicacion de Project Sentinel (Fase G, seccion 6 del pedido). Nunca
   crea una alerta nueva solo porque se volvio a abrir el Vault -- compara
   las alertas CANDIDATAS de esta corrida (sentinelRules.js) contra las YA
   persistidas por identidad estable (projectId + alertType + entidad
   afectada, ver sentinelAlertSchema.js#computeAlertIdentity):
     - identidad nueva            -> CREAR (status NUEVA).
     - identidad existente, activa (NUEVA/EN_REVISION) -> ACTUALIZAR
       (lastSeenAt/evidencia/severidad refrescados, firstDetectedAt y
       status intactos -- nunca se pierde cuando se detecto por primera vez).
     - identidad existente, RESUELTA/DESCARTADA, pero la condicion
       REAPARECIO -> REABRIR a NUEVA (la resolucion anterior queda intacta
       en el documento como contexto historico, nunca se borra -- el
       registro append-only real vive en sentinelAlertsAudit).
     - identidad YA persistida (activa) que NO aparece entre las
       candidatas de esta corrida -> la condicion desaparecio, se
       AUTO-RESUELVE (resolvedBy:'system'). */
export function reconcileSentinelAlerts(candidates = [], existingAlerts = [], { now = new Date().toISOString() } = {}){
  const existingByIdentity = new Map(existingAlerts.map(a => [a.identity, a]));
  const seenIdentities = new Set();
  const toCreate = [];
  const toUpdate = [];

  candidates.forEach(candidate => {
    seenIdentities.add(candidate.identity);
    const existing = existingByIdentity.get(candidate.identity);
    if(!existing){
      toCreate.push({ ...candidate, firstDetectedAt: now, lastSeenAt: now, createdAt: now, updatedAt: now });
      return;
    }
    if(existing.status === 'RESUELTA' || existing.status === 'DESCARTADA'){
      toUpdate.push({
        ...existing, ...candidate, id: existing.id, identity: existing.identity,
        status: 'NUEVA', firstDetectedAt: existing.firstDetectedAt, lastSeenAt: now, updatedAt: now,
        reopenedAt: now, reopenedFromStatus: existing.status,
        // La resolucion/descarte anterior NUNCA se borra (seccion 5: "no
        // borrar historial") -- el spread de `candidate` de arriba trae
        // resolvedAt/resolvedBy/resolution en null (un candidato recien
        // evaluado nunca los conoce), asi que se restauran explicitamente
        // desde `existing` como contexto historico visible en el documento.
        resolvedAt: existing.resolvedAt, resolvedBy: existing.resolvedBy,
        resolution: existing.resolution, comment: existing.comment
      });
      return;
    }
    // Activa (NUEVA/EN_REVISION): refresca evidencia/severidad, conserva estado y fecha de deteccion original.
    toUpdate.push({
      ...existing, ...candidate, id: existing.id, identity: existing.identity, status: existing.status,
      firstDetectedAt: existing.firstDetectedAt, lastSeenAt: now, updatedAt: now
    });
  });

  const toAutoResolve = existingAlerts
    .filter(a => (a.status === 'NUEVA' || a.status === 'EN_REVISION') && !seenIdentities.has(a.identity))
    .map(a => ({
      ...a, status: 'RESUELTA', resolvedAt: now, resolvedBy: 'system',
      resolution: 'La condición que originó esta alerta ya no se cumple (resuelta automáticamente).',
      updatedAt: now
    }));

  return { toCreate, toUpdate, toAutoResolve };
}
