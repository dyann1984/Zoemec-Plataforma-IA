/* Timeline del Project Vault (Fase F, seccion 8 del pedido). Lee los
   registros de auditoria/ledgers YA existentes (apuAudit, presupuestoAudit,
   changeOrdersAudit, etc. -- ver server/api-lib/_route-project-vault.mjs)
   y los consolida en una linea de tiempo legible. NUNCA crea una coleccion
   de auditoria nueva -- esta funcion es puramente de lectura/formato sobre
   eventos que otros routes ya escribieron.

   Contrato de entrada: cada `record` ya viene NORMALIZADO por el llamador
   (server-side, donde se conoce el shape real de Firestore Timestamp) a
   `{ source, action, previousStatus, newStatus, projectId, at (ISO string
   o comparable por Date), actor, meta }` -- esta funcion pura nunca conoce
   Firestore, solo ordena/etiqueta. */

const LABELS = {
  PROYECTO: {
    PROJECT_CREATED: () => 'Proyecto creado',
    PROJECT_UPDATED: () => 'Datos del proyecto actualizados',
    PROJECT_ARCHIVED: () => 'Proyecto archivado'
  },
  PLANO: {
    PLANO_TAKEOFF_CREATED: () => 'Plano cargado',
    PLANO_TAKEOFF_VERSION_SAVED: () => 'Plano actualizado',
    PLANO_TAKEOFF_VERSION_RESTORED: () => 'Version de plano restaurada',
    PLANO_TAKEOFF_ARCHIVED: () => 'Plano archivado'
  },
  CATALOGO: {
    CATALOGO_CONCEPTO_CREATED: () => 'Concepto agregado al catalogo',
    CATALOGO_CONCEPTO_UPDATED: () => 'Concepto del catalogo editado',
    CATALOGO_CONCEPTO_DEDUP_UPDATED: () => 'Concepto actualizado desde el mismo origen',
    CATALOGO_CONCEPTO_STATUS_CHANGED: (r) => r.newStatus === 'GENERADO' ? 'APU generado para un concepto' : `Concepto ${(r.newStatus || '').toLowerCase()}`,
    CATALOGO_CONCEPTO_APU_ASOCIADO: () => 'APU existente asociado a un concepto',
    CATALOGO_CONCEPTO_ARCHIVED: () => 'Concepto archivado'
  },
  APU: {
    APU_CREATED: () => 'APU creado',
    APU_VERSION_SAVED: () => 'APU actualizado (nueva version)',
    APU_VERSION_RESTORED: () => 'Version de APU restaurada',
    APU_ARCHIVED: () => 'APU archivado',
    APU_PROJECT_LINKED: () => 'APU vinculado al proyecto'
  },
  PRESUPUESTO: {
    PRESUPUESTO_CREATED: () => 'Presupuesto creado',
    PRESUPUESTO_VERSION_SAVED: () => 'Presupuesto actualizado (nueva version)',
    PRESUPUESTO_VERSION_RESTORED: () => 'Version de presupuesto restaurada',
    PRESUPUESTO_BASELINE_APPROVED: () => 'Baseline aprobado',
    PRESUPUESTO_ARCHIVED: () => 'Presupuesto archivado'
  },
  ORDEN_CAMBIO: {
    CHANGE_ORDER_CREATED: (r) => `Orden de cambio ${r.meta?.folio || ''} creada`.trim(),
    CHANGE_ORDER_STATUS_CHANGED: (r) => ({
      EN_REVISION: 'Orden de cambio enviada a revision', APROBADA: 'Orden de cambio aprobada',
      RECHAZADA: 'Orden de cambio rechazada', CANCELADA: 'Orden de cambio cancelada'
    }[r.newStatus] || `Orden de cambio: ${r.newStatus}`)
  },
  COMPROMISO: {
    COMMITMENT_CREATED: () => 'Compromiso registrado',
    COMMITMENT_STATUS_CHANGED: (r) => ({ CERRADO: 'Compromiso cerrado', CANCELADO: 'Compromiso cancelado' }[r.newStatus] || `Compromiso: ${r.newStatus}`)
  },
  ESTIMACION: {
    ESTIMATE_CREATED: () => 'Estimacion de obra creada',
    ESTIMATE_STATUS_CHANGED: (r) => r.newStatus === 'AUTORIZADA' ? 'Estimacion autorizada' : `Estimacion: ${r.newStatus}`
  },
  AVANCE: { PROGRESS_ENTRY_CREATED: (r) => `Avance registrado${r.meta?.motivo ? `: ${r.meta.motivo}` : ''}` },
  PAGO: { PAYMENT_CREATED: (r) => `Pago registrado${r.meta?.proveedor ? ` a ${r.meta.proveedor}` : ''}` },
  EXPORTACION: { EXPORT_EVENT: (r) => `Exportacion generada (${r.meta?.scope || 'documento'}, ${r.meta?.format || ''})`.trim() },
  DNA: { CONSTRUCTION_DNA_VERSION_CREATED: (r) => `Construction DNA generado (${r.meta?.version || ''})`.trim() }
};

export function describeTimelineEvent(record){
  const bySource = LABELS[record.source];
  const formatter = bySource?.[record.action];
  return formatter ? formatter(record) : (record.action || 'Evento');
}

export function buildProjectVaultTimeline(records = [], { limit = 50 } = {}){
  const withDate = (records || []).filter(r => r?.at).map(r => ({ ...r, atMs: new Date(r.at).getTime() })).filter(r => Number.isFinite(r.atMs));
  const sorted = withDate.sort((a, b) => b.atMs - a.atMs);
  return sorted.slice(0, limit).map(({ atMs, ...r }) => ({ ...r, label: describeTimelineEvent(r) }));
}
