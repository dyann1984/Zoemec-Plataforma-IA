/* Bandeja consolidada de alertas del Project Vault (Fase F, seccion 11 del
   pedido). REUSA las alertas de motores YA existentes -- Confidence Engine,
   Bid Risk, Control Presupuestal (Fase E) -- nunca inventa una regla de
   riesgo nueva aqui. Deliberadamente NO es Project Sentinel (eso es Fase G,
   instruccion explicita): esta funcion solo normaliza y prioriza lo que
   esos 3 motores YA calcularon, en un vocabulario unico de prioridad. */

export const VAULT_ALERT_PRIORITY = Object.freeze({ CRITICA: 'CRITICA', ALTA: 'ALTA', MEDIA: 'MEDIA', BAJA: 'BAJA' });

const SEVERITY_TO_PRIORITY = { CRITICAL: 'CRITICA', HIGH: 'ALTA', MEDIUM: 'MEDIA', LOW: 'BAJA' };
const PRIORITY_RANK = { CRITICA: 4, ALTA: 3, MEDIA: 2, BAJA: 1 };

function toFixedSafe(v){ const n = Number(v); return Number.isFinite(n) ? n.toFixed(2) : '0.00'; }

/* controlPresupuestalAlerts: salida de controlPresupuestalAlerts.js#computeControlPresupuestalAlerts,
   ya trae {type, severity, scope, conceptoId, message}. bidRiskProject:
   salida de bidRisk.js#runProjectBidRisk (topRisks). confidenceProject:
   salida de apuConfidence.js#runProjectConfidence (perApu). */
export function consolidateProjectVaultAlerts({ controlPresupuestalAlerts = [], bidRiskProject = null, confidenceProject = null } = {}){
  const alerts = [];

  (controlPresupuestalAlerts || []).forEach((a, i) => {
    alerts.push({ id: `cp-${i}`, source: 'CONTROL_PRESUPUESTAL', priority: SEVERITY_TO_PRIORITY[a.severity] || 'MEDIA', message: a.message, conceptoId: a.conceptoId || null });
  });

  (bidRiskProject?.topRisks || []).forEach(r => {
    if(r.severity === 'LOW') return; // ruido para una bandeja consolidada -- el detalle de Bid Risk sigue mostrando todo
    alerts.push({ id: `br-${r.apuId}`, source: 'BID_RISK', priority: SEVERITY_TO_PRIORITY[r.severity] || 'MEDIA', message: `"${r.concept}" tiene riesgo ${r.severity} en su oferta (exposicion estimada $${toFixedSafe(r.estimatedExposure)}).`, apuId: r.apuId });
  });

  (confidenceProject?.perApu || []).forEach(p => {
    if(p.status === 'LOW'){
      alerts.push({ id: `cf-${p.apuId}`, source: 'CONFIDENCE', priority: 'MEDIA', message: `"${p.concept}" tiene confianza BAJA (score ${p.score ?? '—'}).`, apuId: p.apuId });
    }else if(p.status === 'INSUFFICIENT_EVIDENCE'){
      alerts.push({ id: `cf-${p.apuId}`, source: 'CONFIDENCE', priority: 'ALTA', message: `"${p.concept}" no tiene evidencia suficiente para evaluar su confianza.`, apuId: p.apuId });
    }
  });

  return alerts.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]);
}
