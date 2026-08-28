/* Persistencia de mediciones manuales de plano (Prioridad 4, fase de
   correccion). Logica pura (sin React, sin Firebase): decide la FORMA
   completa de lo que se guarda -- plano origen, calibracion, escala,
   puntos/poligonos, longitudes/areas, concepto vinculado, correcciones
   manuales, usuario/fecha, origen de medicion, confianza -- y mantiene un
   historial de cantidad ORIGINAL vs CORREGIDA (nunca se sobrescribe en
   silencio, mismo criterio que applyPlanoElementReview en planoReview.js).

   La persistencia real (localStorage project-scoped via useLocalState,
   mismo patron que `catalog`/`zoemec-biblioteca` en main.jsx) vive en
   main.jsx -- este modulo es puro y testeable sin React/localStorage. */

/* Hash corto y estable de un string (FNV-1a de 32 bits, en base36) -- SIN
   dependencias nuevas. Bug reportado (aislamiento de Takeoff 2D entre
   archivos): antes la identidad de un plano era SOLO su `fileName`; dos
   archivos distintos subidos con el MISMO nombre (caso real: exportar dos
   veces "plano.jpg" de fuentes distintas) compartian el mismo registro
   persistido por error. El nombre NO deja de guardarse (sigue siendo la
   referencia legible para el usuario), pero la identidad real para
   encontrar/aislar un registro ahora es nombre+hash de contenido -- ver
   findLatestTakeoffForFile. No es criptografico, no necesita serlo: solo
   necesita distinguir dos imagenes distintas de forma estable y barata. */
export function hashFileContent(value){
  const text = String(value || '');
  let hash = 2166136261;
  for(let i = 0; i < text.length; i++){
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createTakeoffRecord({ fileName, mimeType, fileDataUrl, fileHash, mode, points, calibration, elemento, concepto } = {}){
  const now = new Date().toISOString();
  return {
    id: `takeoff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
    origen: {
      fileName: fileName || '',
      mimeType: mimeType || '',
      // Identidad de contenido (ver hashFileContent arriba): se calcula
      // SIEMPRE a partir del dataURL real en memoria, ANTES de decidir si
      // se persiste completo o no -- asi que sobrevive aunque la imagen sea
      // demasiado grande para guardarse completa (guardia de abajo).
      fileHash: fileHash || (typeof fileDataUrl === 'string' && fileDataUrl ? hashFileContent(fileDataUrl) : null),
      // Guardia de tamaño real (localStorage tiene un limite ~5-10MB por
      // origen): una imagen grande NO se persiste completa -- se guarda
      // null y el nombre/fecha quedan como referencia, nunca se trunca en
      // silencio un dato que despues alguien crea completo.
      fileDataUrl: typeof fileDataUrl === 'string' && fileDataUrl.length <= 1_500_000 ? fileDataUrl : null,
      fileDemasiadoGrandeParaPersistir: typeof fileDataUrl === 'string' && fileDataUrl.length > 1_500_000
    },
    calibracion: calibration ? {
      pixelDistance: calibration.pixelDistance ?? null,
      realDistance: calibration.realDistance ?? null,
      scaleUnitsPerPixel: calibration.scale ?? null,
      unit: calibration.unit || null
    } : null,
    trazo: { mode: mode || null, points: Array.isArray(points) ? points : [] },
    medicion: {
      tipo: elemento?.tipo || null,
      descripcion: elemento?.descripcion || '',
      unidad: elemento?.unidad || null,
      cantidadPropuesta: elemento?.cantidadPropuesta ?? null,
      cantidadCorregida: null,
      descripcionCorregida: null,
      fuenteEscala: elemento?.fuenteEscala || null,
      origenMedicion: elemento?.origenMedicion || 'trazado_manual',
      confianzaIA: elemento?.confianzaIA ?? null,
      estado: elemento?.estado || null
    },
    conceptoVinculado: concepto || null,
    validatedBy: null,
    validatedAt: null,
    // Historial de cantidad: arranca con el trazo original, nunca se borra
    // al corregir -- ver applyManualCorrection.
    historial: [{
      cantidad: elemento?.cantidadPropuesta ?? null,
      descripcion: elemento?.descripcion || '',
      fecha: now,
      tipo: 'trazo_original'
    }]
  };
}

/* Aplica una correccion manual a un registro YA persistido -- conserva el
   valor original en `historial` (nunca lo sobrescribe), agrega la
   correccion como una entrada nueva con usuario/fecha. */
export function applyManualCorrection(record, { cantidadCorregida, descripcionCorregida, validatedBy, motivo } = {}){
  if(!record) return record;
  const now = new Date().toISOString();
  return {
    ...record,
    updatedAt: now,
    medicion: {
      ...record.medicion,
      cantidadCorregida: cantidadCorregida != null ? Number(cantidadCorregida) : (record.medicion.cantidadCorregida ?? null),
      descripcionCorregida: descripcionCorregida ?? record.medicion.descripcionCorregida ?? null,
      estado: 'VALIDADO_POR_USUARIO'
    },
    validatedBy: validatedBy || record.validatedBy || null,
    validatedAt: now,
    historial: [
      ...record.historial,
      {
        cantidad: cantidadCorregida != null ? Number(cantidadCorregida) : record.medicion.cantidadPropuesta,
        descripcion: descripcionCorregida || record.medicion.descripcion,
        fecha: now,
        tipo: 'correccion_manual',
        motivo: motivo || '',
        usuario: validatedBy || null
      }
    ]
  };
}

export function upsertTakeoffRecord(records, record){
  const list = Array.isArray(records) ? records : [];
  const idx = list.findIndex(r => r.id === record.id);
  if(idx === -1) return [record, ...list];
  const next = [...list];
  next[idx] = record;
  return next;
}

/* Busca el registro persistido mas reciente para un archivo -- permite
   reconstruir el trazo/calibracion al recargar el proyecto o al volver a
   abrir el mismo plano, sin volver a dibujarlo. `fileHash` (opcional, ver
   hashFileContent arriba) es la identidad real: cuando el LLAMADOR lo
   declara (siempre lo hace el flujo real, PlanoManualMeasure en main.jsx,
   porque ya tiene la imagen cargada en memoria), un registro SOLO cuenta
   como el mismo archivo si su propio `fileHash` coincide exactamente --
   nunca se asume que coincide solo porque el registro sea viejo y no traiga
   hash. Bug reportado y reproducido: con un fallback "sin hash, empareja
   por nombre igual", un registro persistido ANTES de esta correccion (sin
   fileHash) seguia emparejando por nombre para CUALQUIER archivo nuevo con
   ese mismo nombre, exactamente el caso que se pidio aislar -- de nada
   sirve declarar un hash si un registro sin hash lo puede seguir
   "ganando" por nombre. La unica vez que se empareja solo por nombre es
   cuando el LLAMADOR no tiene forma de calcular un hash (no le paso el
   parametro) -- compatibilidad real con codigo viejo que invoque esta
   funcion con 2 argumentos, no con datos viejos. */
export function findLatestTakeoffForFile(records, fileName, fileHash){
  const list = Array.isArray(records) ? records : [];
  const matches = list.filter(r => {
    if(!r.origen?.fileName || !fileName || r.origen.fileName !== fileName) return false;
    if(fileHash) return r.origen.fileHash === fileHash;
    return true;
  });
  if(!matches.length) return null;
  return matches.reduce((latest, r) => (r.updatedAt > latest.updatedAt ? r : latest));
}
