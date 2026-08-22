/* Cola robusta de generacion masiva de APU (endurecimiento RC4): logica PURA
   de la maquina de estados, sin Firestore ni React, para que sea probable
   con node:test sin depender de un navegador ni de la nube. main.jsx (o
   cualquier UI) solo llama estas funciones y conecta el resultado a un
   adaptador de persistencia (ver src/lib/apuBatchQueueCloud.js).

   Estados por concepto (uno de):
   pendiente -> analizando -> buscando_recursos -> cotizando -> calculando ->
   validando -> terminado | requiere_revision | error | cancelado

   Identidad de cada concepto = hoja + fila + clave (itemKey), NUNCA el
   contenido: dos renglones con el mismo texto/cantidad en filas distintas
   son items distintos (mismo principio que excelImport.js ya aplica a la
   extraccion). Esto es lo que permite "reintentar solo el fallido" y
   "proteccion contra generacion duplicada" sin ambiguedad. */

export const ITEM_STATUS = Object.freeze({
  PENDIENTE: 'pendiente',
  ANALIZANDO: 'analizando',
  BUSCANDO_RECURSOS: 'buscando_recursos',
  COTIZANDO: 'cotizando',
  CALCULANDO: 'calculando',
  VALIDANDO: 'validando',
  TERMINADO: 'terminado',
  REQUIERE_REVISION: 'requiere_revision',
  ERROR: 'error',
  CANCELADO: 'cancelado'
});

const TERMINAL_STATUSES = new Set([
  ITEM_STATUS.TERMINADO,
  ITEM_STATUS.REQUIERE_REVISION,
  ITEM_STATUS.ERROR,
  ITEM_STATUS.CANCELADO
]);

const IN_FLIGHT_STATUSES = new Set([
  ITEM_STATUS.ANALIZANDO,
  ITEM_STATUS.BUSCANDO_RECURSOS,
  ITEM_STATUS.COTIZANDO,
  ITEM_STATUS.CALCULANDO,
  ITEM_STATUS.VALIDANDO
]);

/* Identidad estable e independiente del contenido: hoja + numero de fila +
   clave. Si dos conceptos distintos del catalogo comparten clave (algo real,
   ver excelImport.js), la fila los distingue igual; nunca se calcula a
   partir de la descripcion/cantidad, que pueden repetirse legitimamente. */
export function itemKeyOf(item){
  const sheet = String(item?.sourceSheet ?? '').trim();
  const row = String(item?.rowNumber ?? '').trim();
  const code = String(item?.code ?? '').trim();
  return `${sheet}||${row}||${code}` || `sin-identidad-${Math.random()}`;
}

/* Construye el trabajo (job) a partir de la lista de conceptos seleccionada
   del catalogo: cada uno arranca en PENDIENTE, con su identidad fija desde
   el primer momento (no cambia aunque se reintente). catalogFingerprint es
   un hash simple del catalogo (nombre + N + primeras claves) para detectar,
   al reanudar, si el archivo que se volvio a subir es "el mismo lote" o uno
   distinto -- nunca se reanuda un lote con un catalogo diferente por error. */
export function createBatchJob({ batchId, fileName, items, catalogFingerprint }){
  const now = Date.now();
  const itemStates = items.map((item, index) => ({
    itemKey: itemKeyOf(item),
    index,
    item,
    status: ITEM_STATUS.PENDIENTE,
    attempts: 0,
    error: null,
    apu: null,
    startedAt: null,
    finishedAt: null
  }));
  return {
    batchId,
    fileName: fileName || '',
    catalogFingerprint: catalogFingerprint || '',
    total: itemStates.length,
    createdAt: now,
    updatedAt: now,
    cancelled: false,
    items: itemStates
  };
}

/* Hash simple y determinista (no criptografico) para "es el mismo catalogo":
   nombre + total + primeras/ultimas claves. Suficiente para distinguir "el
   mismo archivo que se estaba procesando" de "un catalogo distinto" al
   ofrecer reanudar -- no necesita resistir colisiones adversarias. */
export function fingerprintCatalog(fileName, items){
  const codes = items.map(i => String(i?.code ?? ''));
  const sample = [...codes.slice(0, 3), ...codes.slice(-3)].join(',');
  return `${fileName || ''}|${items.length}|${sample}`;
}

/* Items elegibles para lanzar ahora: PENDIENTE, respetando el limite de
   concurrencia (nunca mas de `limit` en vuelo a la vez). Nunca relanza un
   item ya en vuelo (protege contra generacion duplicada si esta funcion se
   llama mas de una vez, p. ej. tras reanudar). */
export function selectNextBatch(job, limit, inFlightKeys = new Set()){
  if(job.cancelled) return [];
  const availableSlots = limit - inFlightKeys.size;
  if(availableSlots <= 0) return [];
  return job.items
    .filter(it => it.status === ITEM_STATUS.PENDIENTE && !inFlightKeys.has(it.itemKey))
    .slice(0, availableSlots);
}

function updateItem(job, itemKey, patch){
  return {
    ...job,
    updatedAt: Date.now(),
    items: job.items.map(it => it.itemKey === itemKey ? { ...it, ...patch } : it)
  };
}

export function markItemStatus(job, itemKey, status, extra = {}){
  const patch = { status, ...extra };
  if(status === ITEM_STATUS.ANALIZANDO) patch.startedAt = patch.startedAt ?? Date.now();
  if(TERMINAL_STATUSES.has(status)) patch.finishedAt = Date.now();
  return updateItem(job, itemKey, patch);
}

/* Un item que termina en error NUNCA detiene el lote: solo se marca ese
   renglon, el resto sigue su curso (selectNextBatch simplemente lo salta,
   ya no esta en PENDIENTE). */
export function markItemError(job, itemKey, error){
  const current = job.items.find(it => it.itemKey === itemKey);
  return updateItem(job, itemKey, {
    status: ITEM_STATUS.ERROR,
    error: String(error?.message || error || 'error desconocido'),
    attempts: (current?.attempts || 0) + 1,
    finishedAt: Date.now()
  });
}

export function markItemDone(job, itemKey, apu, { requiresReview = false } = {}){
  const current = job.items.find(it => it.itemKey === itemKey);
  return updateItem(job, itemKey, {
    status: requiresReview ? ITEM_STATUS.REQUIERE_REVISION : ITEM_STATUS.TERMINADO,
    apu,
    error: null,
    attempts: (current?.attempts || 0) + 1,
    finishedAt: Date.now()
  });
}

/* "Reintentar solo los fallidos": vuelve ERROR -> PENDIENTE preservando el
   contador de intentos (para poder limitar reintentos automaticos si se
   quiere en el futuro) y el resto de los items INTACTOS -- nunca reprocesa
   los que ya terminaron bien. */
export function retryFailedItems(job){
  return {
    ...job,
    updatedAt: Date.now(),
    items: job.items.map(it => it.status === ITEM_STATUS.ERROR
      ? { ...it, status: ITEM_STATUS.PENDIENTE, error: null }
      : it)
  };
}

/* Cancelacion SEGURA: nunca toca items ya terminales (TERMINADO/
   REQUIERE_REVISION/ERROR ya escritos permanecen tal cual, nunca se pierden
   ni se marcan como cancelados). Los PENDIENTES (que aun no arrancaron) se
   marcan CANCELADO para que selectNextBatch nunca los recoja. Los que ya
   estan EN VUELO deben terminar su llamada en curso (el llamador debe dejar
   que la promesa in-flight resuelva y solo entonces detenerse -- cancelar()
   no interrumpe trabajo a medias, evita corromper un resultado parcial). */
export function cancelJob(job){
  return {
    ...job,
    cancelled: true,
    updatedAt: Date.now(),
    items: job.items.map(it => it.status === ITEM_STATUS.PENDIENTE
      ? { ...it, status: ITEM_STATUS.CANCELADO, finishedAt: Date.now() }
      : it)
  };
}

export function summarizeJob(job){
  const counts = { pendiente: 0, enProceso: 0, terminado: 0, requiere_revision: 0, error: 0, cancelado: 0 };
  job.items.forEach(it => {
    if(it.status === ITEM_STATUS.PENDIENTE) counts.pendiente++;
    else if(IN_FLIGHT_STATUSES.has(it.status)) counts.enProceso++;
    else if(it.status === ITEM_STATUS.TERMINADO) counts.terminado++;
    else if(it.status === ITEM_STATUS.REQUIERE_REVISION) counts.requiere_revision++;
    else if(it.status === ITEM_STATUS.ERROR) counts.error++;
    else if(it.status === ITEM_STATUS.CANCELADO) counts.cancelado++;
  });
  const done = counts.terminado + counts.requiere_revision + counts.error + counts.cancelado;
  return { total: job.total, ...counts, done, remaining: job.total - done };
}

export function isJobComplete(job){
  return job.items.every(it => TERMINAL_STATUSES.has(it.status));
}

export function isTerminalStatus(status){
  return TERMINAL_STATUSES.has(status);
}
