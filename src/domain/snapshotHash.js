/* Hash de integridad de snapshot (Fase 8, regla 13 del spec): identifica el
   contenido tecnico exacto usado para generar un dossier, para que quien lo
   reciba pueda confirmar que corresponde a la version que dice representar.
   Deliberadamente NO se llama "a prueba de fraude" en ningun lado (regla 13
   explicita) -- es un hash de integridad de contenido, no una firma
   criptografica de autoria.

   stableStringify (orden de llaves determinista, recursivo) es necesario
   porque JSON.stringify normal preserva el orden de insercion de cada
   objeto -- dos snapshots con el MISMO contenido pero construidos en
   distinto orden (ej. Object.assign vs spread en otro orden) darian hashes
   distintos sin esto, lo que haria fallar reproducibilidad (regla 23) sin
   ninguna razon real. */
function stableStringify(value){
  if(value === null || typeof value !== 'object') return JSON.stringify(value);
  if(Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function toHex(buffer){
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Web Crypto (crypto.subtle): disponible en browser y en Node >=19 via
   globalThis.crypto, sin agregar ninguna dependencia nueva -- mismo criterio
   ya aplicado en este proyecto para structuredClone (Fase 6). */
export async function computeSnapshotHash(snapshot){
  const canonical = stableStringify(snapshot ?? null);
  const data = new TextEncoder().encode(canonical);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}

export function shortHash(fullHash, length = 8){
  return String(fullHash ?? '').slice(0, length);
}
