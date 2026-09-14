/* Esquema de alerta de Project Sentinel (Fase G). Una alerta es una
   ENTIDAD PERSISTENTE con identidad ESTABLE (seccion 6 del pedido) --
   nunca un objeto efimero recalculado en cada carga del Vault. Mismo
   idioma puro que catalogConceptoSchema.js/changeOrderSchema.js: sin
   Firestore, testeable sin montar nada. */
export const ALERT_SEVERITY = Object.freeze({ INFO: 'INFO', BAJA: 'BAJA', MEDIA: 'MEDIA', ALTA: 'ALTA', CRITICA: 'CRITICA' });
export const SEVERITY_RANK = Object.freeze({ CRITICA: 5, ALTA: 4, MEDIA: 3, BAJA: 2, INFO: 1 });

export const ALERT_STATUS = Object.freeze({ NUEVA: 'NUEVA', EN_REVISION: 'EN_REVISION', RESUELTA: 'RESUELTA', DESCARTADA: 'DESCARTADA' });

// Transiciones que un USUARIO puede ejecutar explicitamente (ver
// _route-sentinel.mjs#handleSetStatus). El reconciliador de Sentinel
// (sentinelDeduplication.js) tiene su PROPIA logica de reapertura
// automatica cuando una condicion resuelta reaparece -- eso no pasa por
// esta tabla, es un movimiento de sistema, no de usuario.
const LEGAL_TRANSITIONS = Object.freeze({
  NUEVA: ['EN_REVISION', 'RESUELTA', 'DESCARTADA'],
  EN_REVISION: ['RESUELTA', 'DESCARTADA', 'NUEVA'],
  RESUELTA: [],
  DESCARTADA: []
});
export function isLegalSentinelAlertTransition(from, to){
  if(from === to) return true;
  return (LEGAL_TRANSITIONS[from] || []).includes(to);
}

export const SENTINEL_ALERT_TYPE = Object.freeze({
  PRESUPUESTO_POR_AGOTARSE: 'PRESUPUESTO_POR_AGOTARSE',
  FORECAST_SOBRE_PRESUPUESTO: 'FORECAST_SOBRE_PRESUPUESTO',
  AVANCE_FISICO_RETRASADO: 'AVANCE_FISICO_RETRASADO',
  AVANCE_FINANCIERO_DESALINEADO: 'AVANCE_FINANCIERO_DESALINEADO',
  COMPROMISO_EXCESIVO: 'COMPROMISO_EXCESIVO',
  SOBRECONSUMO_CONCEPTO: 'SOBRECONSUMO_CONCEPTO',
  ORDEN_CAMBIO_PENDIENTE: 'ORDEN_CAMBIO_PENDIENTE',
  PRECIO_ANOMALO: 'PRECIO_ANOMALO',
  CONFIANZA_PRECIO_BAJA: 'CONFIANZA_PRECIO_BAJA',
  DOCUMENTO_FALTANTE: 'DOCUMENTO_FALTANTE',
  DATO_CRITICO_SIN_CONFIRMAR: 'DATO_CRITICO_SIN_CONFIRMAR',
  ESTIMACION_PENDIENTE: 'ESTIMACION_PENDIENTE',
  PAGO_PENDIENTE: 'PAGO_PENDIENTE',
  CAMBIO_PROJECT_HEALTH: 'CAMBIO_PROJECT_HEALTH',
  GARANTIA_POR_VENCER: 'GARANTIA_POR_VENCER',
  GARANTIA_VENCIDA: 'GARANTIA_VENCIDA',
  DOCUMENTACION_GARANTIA_FALTANTE: 'DOCUMENTACION_GARANTIA_FALTANTE'
});

/* Identidad estable (seccion 6): projectId + alertType + entidad afectada.
   `affectedEntity` es `{type, id}` (ej. {type:'CONCEPTO', id:'C-123'}) o
   null cuando la alerta es de PROYECTO completo (ej. FORECAST_SOBRE_PRESUPUESTO
   a nivel proyecto). El id de documento de Firestore ES esta identidad
   (sanitizada) -- upsert por id, nunca una query-then-write con carrera. */
export function computeAffectedEntityKey(affectedEntity){
  if(!affectedEntity) return 'PROJECT';
  return `${affectedEntity.type}:${affectedEntity.id}`;
}
export function computeAlertIdentity({ projectId, alertType, affectedEntity }){
  const raw = `${projectId}__${alertType}__${computeAffectedEntityKey(affectedEntity)}`;
  return raw.replace(/[^a-zA-Z0-9_:.-]/g, '_');
}

/* Cada alerta EXPLICA (seccion 4): que paso (title/message), por que
   importa (why), evidencia (evidence, siempre un objeto de datos REALES,
   nunca prosa inventada), entidad afectada, impacto estimado, accion
   recomendada, y una ruta de navegacion directa (seccion 8) -- nunca una
   alerta sin `actionRoute`. */
export function makeSentinelAlert({
  id = null, projectId, alertType, severity, affectedEntity = null,
  title, message, why = null, evidence = {}, impactoEstimado = null,
  accionRecomendada = null, actionRoute = null,
  status = ALERT_STATUS.NUEVA, firstDetectedAt = null, lastSeenAt = null,
  resolvedAt = null, resolvedBy = null, resolution = null, comment = null
} = {}){
  const now = new Date().toISOString();
  const identity = computeAlertIdentity({ projectId, alertType, affectedEntity });
  return {
    id: id || identity, identity, projectId, alertType, severity, affectedEntity,
    title, message, why, evidence, impactoEstimado, accionRecomendada, actionRoute,
    status, firstDetectedAt: firstDetectedAt || now, lastSeenAt: lastSeenAt || now,
    resolvedAt, resolvedBy, resolution, comment,
    createdAt: now, updatedAt: now
  };
}

export function validateSentinelAlert(alert){
  const errors = [];
  if(!alert || typeof alert !== 'object') errors.push('La alerta no tiene una forma valida.');
  if(!alert?.projectId) errors.push('La alerta debe pertenecer a un proyecto.');
  if(!Object.values(SENTINEL_ALERT_TYPE).includes(alert?.alertType)) errors.push('alertType invalido.');
  if(!Object.values(ALERT_SEVERITY).includes(alert?.severity)) errors.push('severity invalido.');
  if(!Object.values(ALERT_STATUS).includes(alert?.status)) errors.push('status invalido.');
  if(!alert?.title) errors.push('La alerta necesita un titulo.');
  if(!alert?.actionRoute) errors.push('La alerta necesita una ruta de accion (seccion 8: nunca sin ruta).');
  return { valid: errors.length === 0, errors };
}
