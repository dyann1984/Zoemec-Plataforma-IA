/* Historial de Project Health (Fase G, seccion 9 del pedido). Persiste
   snapshots de un score YA calculado por projectHealth.js -- este modulo
   NUNCA calcula Health, solo decide CUANDO vale la pena guardar un
   snapshot nuevo (para no llenar la coleccion con un registro identico en
   cada apertura del Vault) y como resumir la evolucion guardada
   ("85 → 82 → 74 → 78"). */
function toNumber(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }

/* Solo vale la pena un snapshot nuevo si el score cambio (aunque sea 1
   punto) o el nivel/semaforo cambio -- comparar contra el ULTIMO snapshot
   guardado, nunca contra un promedio ni una ventana de tiempo. Sin
   snapshot previo, siempre se guarda el primero. */
export function shouldRecordHealthSnapshot(lastSnapshot, currentHealth){
  if(!currentHealth) return false;
  if(!lastSnapshot) return true;
  return lastSnapshot.score !== currentHealth.score || lastSnapshot.level !== currentHealth.level;
}

export function makeHealthSnapshot({ id = null, projectId, health, at = new Date().toISOString() }){
  return {
    id, projectId, score: health.score, level: health.level, label: health.label,
    dimensions: Object.fromEntries(Object.entries(health.dimensions || {}).map(([key, d]) => [key, d.score])),
    at
  };
}

/* summarizeHealthTrend: lista ordenada cronologicamente + la flecha de
   texto pedida en el ejemplo del brief ("85 → 82 → 74 → 78") + que
   dimensiones cambiaron mas entre el penultimo y el ultimo snapshot
   (nunca inventa una causa si no hay al menos 2 snapshots). */
export function summarizeHealthTrend(history = []){
  const sorted = [...history].filter(h => h?.at).sort((a, b) => new Date(a.at) - new Date(b.at));
  const scoresLabel = sorted.map(h => h.score).join(' → ');
  if(sorted.length < 2) return { scoresLabel, points: sorted, dimensionChanges: [] };
  const prev = sorted[sorted.length - 2];
  const last = sorted[sorted.length - 1];
  const keys = new Set([...Object.keys(prev.dimensions || {}), ...Object.keys(last.dimensions || {})]);
  const dimensionChanges = [...keys]
    .map(key => ({ key, before: prev.dimensions?.[key] ?? null, after: last.dimensions?.[key] ?? null, delta: toNumber(last.dimensions?.[key]) - toNumber(prev.dimensions?.[key]) }))
    .filter(c => c.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { scoresLabel, points: sorted, dimensionChanges };
}
