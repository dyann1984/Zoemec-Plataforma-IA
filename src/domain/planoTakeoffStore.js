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

export function createTakeoffRecord({ fileName, mimeType, fileDataUrl, mode, points, calibration, elemento, concepto } = {}){
  const now = new Date().toISOString();
  return {
    id: `takeoff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
    origen: {
      fileName: fileName || '',
      mimeType: mimeType || '',
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

/* Busca el registro persistido mas reciente para un archivo (por nombre) --
   permite reconstruir el trazo/calibracion al recargar el proyecto sin
   volver a dibujarlo, cuando el usuario vuelve a abrir el mismo plano. */
export function findLatestTakeoffForFile(records, fileName){
  const list = Array.isArray(records) ? records : [];
  const matches = list.filter(r => r.origen?.fileName && fileName && r.origen.fileName === fileName);
  if(!matches.length) return null;
  return matches.reduce((latest, r) => (r.updatedAt > latest.updatedAt ? r : latest));
}
