/* Motor de reglas de Project Sentinel (Fase G). PURO: recibe datos YA
   calculados por otros motores (Project Health, Control Presupuestal,
   Bid Risk, Confidence, Construction DNA, calidad de datos) y produce
   alertas CANDIDATAS -- nunca recalcula ninguno de esos motores, nunca
   llama IA para decidir severidad (regla explicita del pedido: "la
   severidad debe ser explicable y derivada de reglas documentadas").
   Cada regla documenta su umbral en el propio comentario -- son numeros
   fijos, revisables, nunca "decision del modelo". El llamador
   (server/api-lib/_route-sentinel.mjs) es quien persiste/deduplica estas
   candidatas contra las alertas ya existentes (ver sentinelDeduplication.js). */
import { SENTINEL_ALERT_TYPE as TYPE, ALERT_SEVERITY as SEV, makeSentinelAlert } from './sentinelAlertSchema.js';

function toNumber(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }
function daysBetween(a, b){ return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000); }

function alert(projectId, alertType, severity, { affectedEntity, title, message, why, evidence, impactoEstimado, accionRecomendada, actionRoute }){
  return makeSentinelAlert({ projectId, alertType, severity, affectedEntity, title, message, why, evidence, impactoEstimado, accionRecomendada, actionRoute });
}

/* 1. Presupuesto proximo a agotarse: por concepto, cuanto le queda
   (vigente - comprometido - ejecutado) como % del vigente. <=5% ALTA,
   <=15% MEDIA. Ya agotado (<=0) NO es esta regla -- eso ya lo cubre
   Control Presupuestal como CONCEPTO_AGOTADO (Fase E), Sentinel no lo
   repite con otro nombre. */
function ruleBudgetNearlyExhausted(projectId, rows){
  const out = [];
  (rows || []).forEach(r => {
    if(!(r.presupuestoVigente > 0)) return;
    const disponible = r.presupuestoVigente - r.comprometido - r.ejecutado;
    const pctDisponible = (disponible / r.presupuestoVigente) * 100;
    if(pctDisponible <= 0 || pctDisponible > 15) return;
    const severity = pctDisponible <= 5 ? SEV.ALTA : SEV.MEDIA;
    out.push(alert(projectId, TYPE.PRESUPUESTO_POR_AGOTARSE, severity, {
      affectedEntity: { type: 'CONCEPTO', id: r.conceptoId },
      title: `"${r.concept}" está por agotar su presupuesto`,
      message: `Solo queda ${pctDisponible.toFixed(1)}% del presupuesto vigente de este concepto.`,
      why: 'Si se agota, cualquier avance adicional queda sin presupuesto para cubrirlo.',
      evidence: { presupuestoVigente: r.presupuestoVigente, comprometido: r.comprometido, ejecutado: r.ejecutado, disponible },
      impactoEstimado: disponible,
      accionRecomendada: 'Revisar si se necesita una orden de cambio antes de seguir comprometiendo/ejecutando.',
      actionRoute: { module: 'control-presupuestal', tab: 'presupuesto', conceptoId: r.conceptoId }
    }));
  });
  return out;
}

/* 2. Forecast sobre presupuesto: variacionPct del proyecto (EAC vs
   vigente, Fase E). >30% CRITICA, >15% ALTA, >5% MEDIA, >0 BAJA. */
function ruleForecastOverBudget(projectId, totals){
  if(totals?.variacionPct == null || totals.variacionPct <= 0) return [];
  const pct = totals.variacionPct;
  const severity = pct > 30 ? SEV.CRITICA : pct > 15 ? SEV.ALTA : pct > 5 ? SEV.MEDIA : SEV.BAJA;
  return [alert(projectId, TYPE.FORECAST_SOBRE_PRESUPUESTO, severity, {
    affectedEntity: null,
    title: `Forecast excede presupuesto vigente en ${pct.toFixed(1)}%`,
    message: `El costo estimado al cierre (EAC) es mayor al presupuesto vigente.`,
    why: 'A este ritmo, el proyecto cerrará por encima de lo presupuestado.',
    evidence: { presupuestoVigente: totals.vigente, eac: totals.eac, variacion: totals.variacion },
    impactoEstimado: totals.variacion,
    accionRecomendada: 'Revisar conceptos con mayor desviación en Control Presupuestal.',
    actionRoute: { module: 'control-presupuestal', tab: 'forecast' }
  })];
}

/* 3/4. Avance fisico retrasado vs avance financiero desalineado: ambas
   nacen de la MISMA desviacion fisico-financiera real (Fase E), pero en
   direcciones opuestas -- sin fecha de inicio/objetivo capturada en el
   proyecto (auditado en Fase F: no existe ese dato), la unica senal real
   de "atraso" disponible es contra lo YA facturado/certificado, nunca un
   cronograma inventado. Umbral: |desviacion| > 15 puntos porcentuales. */
function ruleProgressMisalignment(projectId, rows){
  const out = [];
  (rows || []).forEach(r => {
    if(r.desviacionFisicoFinanciero == null) return;
    const dev = r.desviacionFisicoFinanciero;
    if(Math.abs(dev) <= 15) return;
    const severity = Math.abs(dev) > 40 ? SEV.ALTA : SEV.MEDIA;
    if(dev < 0){
      // avanceFisico < avanceFinanciero: se ha certificado/pagado mas de lo que fisicamente se ha ejecutado.
      out.push(alert(projectId, TYPE.AVANCE_FISICO_RETRASADO, severity, {
        affectedEntity: { type: 'CONCEPTO', id: r.conceptoId },
        title: `"${r.concept}" tiene avance físico atrasado respecto a lo facturado`,
        message: `Avance físico ${r.avanceFisicoPct?.toFixed(1)}% vs avance financiero ${r.avanceFinancieroPct?.toFixed(1)}%.`,
        why: 'Se está certificando/pagando por trabajo que aún no se ha ejecutado físicamente.',
        evidence: { avanceFisicoPct: r.avanceFisicoPct, avanceFinancieroPct: r.avanceFinancieroPct, desviacion: dev },
        impactoEstimado: null,
        accionRecomendada: 'Verificar en campo el avance real antes de autorizar más estimaciones.',
        actionRoute: { module: 'control-presupuestal', tab: 'avance', conceptoId: r.conceptoId }
      }));
    }else{
      // avanceFisico > avanceFinanciero: hay trabajo real sin facturar/certificar aun.
      out.push(alert(projectId, TYPE.AVANCE_FINANCIERO_DESALINEADO, severity, {
        affectedEntity: { type: 'CONCEPTO', id: r.conceptoId },
        title: `"${r.concept}" tiene avance financiero desalineado del avance físico`,
        message: `Avance físico ${r.avanceFisicoPct?.toFixed(1)}% vs avance financiero ${r.avanceFinancieroPct?.toFixed(1)}%.`,
        why: 'Hay trabajo ejecutado que todavía no se ha estimado/facturado -- riesgo de flujo de efectivo.',
        evidence: { avanceFisicoPct: r.avanceFisicoPct, avanceFinancieroPct: r.avanceFinancieroPct, desviacion: dev },
        impactoEstimado: null,
        accionRecomendada: 'Generar la estimación pendiente de este concepto.',
        actionRoute: { module: 'control-presupuestal', tab: 'estimaciones', conceptoId: r.conceptoId }
      }));
    }
  });
  return out;
}

/* 5. Compromiso excesivo: reusa directamente la alerta ya calculada por
   Control Presupuestal (Fase E, COMPROMETIDO_EXCESIVO) -- Sentinel la
   absorbe en su propio tipo/identidad para poder persistirla/deduplicarla,
   nunca reevalua la condicion desde cero. */
function ruleExcessiveCommitment(projectId, controlPresupuestalAlerts){
  return (controlPresupuestalAlerts || [])
    .filter(a => a.type === 'COMPROMETIDO_EXCESIVO')
    .map(a => alert(projectId, TYPE.COMPROMISO_EXCESIVO, SEV.MEDIA, {
      affectedEntity: a.conceptoId ? { type: 'CONCEPTO', id: a.conceptoId } : null,
      title: 'Comprometido excede lo que queda por ejecutar', message: a.message, why: null,
      evidence: { message: a.message }, impactoEstimado: null,
      accionRecomendada: 'Revisar el compromiso y confirmar si aplica una orden de cambio.',
      actionRoute: { module: 'control-presupuestal', tab: 'presupuesto', conceptoId: a.conceptoId || null }
    }));
}

/* 6. Sobreconsumo de concepto: resultado YA calculado por
   resourceOverconsumption.js (seccion 10), Sentinel solo lo traduce a
   alerta -- nunca vuelve a comparar cantidades aqui. */
function ruleResourceOverconsumption(projectId, overconsumptionRows){
  return (overconsumptionRows || []).filter(r => r.hasOverconsumption).map(r => alert(projectId, TYPE.SOBRECONSUMO_CONCEPTO, r.severity, {
    affectedEntity: { type: 'RECURSO', id: r.resourceKey },
    title: `Sobreconsumo detectado: ${r.descripcion}`,
    message: `Cantidad ${r.comparisonLabel} (${r.actual}) supera la presupuestada (${r.presupuestada}) en ${r.desviacionPct.toFixed(1)}%.`,
    why: 'El recurso se está usando/comprando por encima de lo calculado en el APU.',
    evidence: { presupuestada: r.presupuestada, actual: r.actual, fuente: r.fuente },
    impactoEstimado: r.impactoEstimado,
    accionRecomendada: 'Revisar consumo real contra la explosión de recursos del proyecto.',
    actionRoute: { module: 'control-presupuestal', tab: 'presupuesto' }
  }));
}

/* 7. Orden de cambio pendiente: mismo criterio que Fase E/Vault
   (EN_REVISION), reusado tal cual, nunca reevaluado. */
function rulePendingChangeOrder(projectId, changeOrders){
  return (changeOrders || []).filter(c => c.status === 'EN_REVISION').map(c => alert(projectId, TYPE.ORDEN_CAMBIO_PENDIENTE, SEV.BAJA, {
    affectedEntity: { type: 'ORDEN_CAMBIO', id: c.id },
    title: `Orden de cambio ${c.folio || c.id} pendiente de decidir`,
    message: `"${c.concept || c.clave || ''}" tiene una orden de cambio en revisión.`,
    why: 'Mientras no se decide, el presupuesto vigente real del concepto es incierto.',
    evidence: { folio: c.folio, motivo: c.motivo, impactoEconomico: c.impactoEconomico },
    impactoEstimado: c.impactoEconomico,
    accionRecomendada: 'Aprobar o rechazar la orden de cambio.',
    actionRoute: { module: 'control-presupuestal', tab: 'ordenes', changeOrderId: c.id }
  }));
}

/* 8. Precio anomalo: reusa Bid Risk (categorias PRICE_WITHOUT_EVIDENCE /
   REGIONAL_PRICE_RISK, motor ya existente) -- nunca una comparacion de
   precios nueva aqui. */
function rulePriceAnomaly(projectId, bidRiskProject){
  const PRICE_CATEGORIES = new Set(['PRICE_WITHOUT_EVIDENCE', 'REGIONAL_PRICE_RISK']);
  return (bidRiskProject?.topRisks || [])
    .filter(r => (r.topFindings || []).some(f => PRICE_CATEGORIES.has(f.category)))
    .map(r => {
      const finding = r.topFindings.find(f => PRICE_CATEGORIES.has(f.category));
      return alert(projectId, TYPE.PRECIO_ANOMALO, r.severity === 'CRITICAL' ? SEV.CRITICA : SEV.ALTA, {
        affectedEntity: { type: 'APU', id: r.apuId },
        title: `Precio anómalo detectado en "${r.concept}"`,
        message: finding?.description || 'Bid Risk detectó un precio sin evidencia de mercado suficiente.',
        why: finding?.reason || null,
        evidence: { category: finding?.category, unitImpact: finding?.unitImpact, projectImpact: finding?.projectImpact },
        impactoEstimado: r.estimatedExposure,
        accionRecomendada: finding?.recommendation || 'Verificar el precio contra evidencia de mercado real.',
        actionRoute: { module: 'apu', apuId: r.apuId }
      });
    });
}

/* 9. Baja confianza de precio: APUs con Confidence LOW/INSUFFICIENT_EVIDENCE
   (motor existente, nunca reevaluado). */
function ruleLowPriceConfidence(projectId, confidenceProject){
  return (confidenceProject?.perApu || [])
    .filter(p => p.status === 'LOW' || p.status === 'INSUFFICIENT_EVIDENCE')
    .map(p => alert(projectId, TYPE.CONFIANZA_PRECIO_BAJA, p.status === 'INSUFFICIENT_EVIDENCE' ? SEV.ALTA : SEV.MEDIA, {
      affectedEntity: { type: 'APU', id: p.apuId },
      title: `"${p.concept}" tiene confianza ${p.status === 'INSUFFICIENT_EVIDENCE' ? 'sin evidencia suficiente' : 'baja'}`,
      message: `Score de Confidence: ${p.score ?? '—'}.`,
      why: 'Un precio con baja confianza puede estar sub/sobre-estimado sin evidencia real que lo respalde.',
      evidence: { score: p.score, status: p.status },
      impactoEstimado: null,
      accionRecomendada: 'Revisar el APU y su evidencia de precio en el motor de Confidence.',
      actionRoute: { module: 'apu', apuId: p.apuId }
    }));
}

/* 10. Documento faltante: calidad de datos (Fase F) marca la dimension
   "documentos" ausente. */
function ruleMissingDocument(projectId, dataQuality){
  const dim = (dataQuality?.dimensions || []).find(d => d.key === 'documentos');
  if(!dim || dim.present) return [];
  return [alert(projectId, TYPE.DOCUMENTO_FALTANTE, SEV.BAJA, {
    affectedEntity: null,
    title: 'El proyecto no tiene documentos vinculados',
    message: 'Ni evidencia ni exportaciones registradas todavía.',
    why: 'Sin documentos, el expediente del proyecto queda incompleto para auditoría o entrega.',
    evidence: {}, impactoEstimado: null,
    accionRecomendada: 'Vincular evidencia o generar un export desde el Project Vault.',
    actionRoute: { module: 'vault' }
  })];
}

/* 11. Dato critico sin confirmar: dimensiones criticas de calidad de
   datos (ubicacion/presupuesto/apu) ausentes -- distinto de "documentos"
   (regla 10) y de "responsables" (cubierto por Project Health/Datos). */
function ruleUnconfirmedCriticalData(projectId, dataQuality){
  const CRITICAL = new Set(['ubicacion', 'presupuesto', 'apu']);
  return (dataQuality?.dimensions || [])
    .filter(d => CRITICAL.has(d.key) && !d.present)
    .map(d => alert(projectId, TYPE.DATO_CRITICO_SIN_CONFIRMAR, SEV.MEDIA, {
      affectedEntity: { type: 'DATA_QUALITY_DIM', id: d.key },
      title: `Dato crítico sin confirmar: ${d.label}`,
      message: `La dimensión "${d.label}" del expediente sigue sin información real.`,
      why: 'Sin este dato, otros calculos del proyecto (Control Presupuestal, Forecast, Confidence) quedan incompletos.',
      evidence: {}, impactoEstimado: null,
      accionRecomendada: `Completar ${d.label} del proyecto.`,
      actionRoute: { module: 'vault' }
    }));
}

/* 12. Estimacion pendiente: BORRADOR por mas de 7 dias (edad real desde
   createdAt, nunca una fecha inventada) -- escalada documentada: >30 dias
   ALTA, >14 dias MEDIA, >7 dias BAJA. */
function rulePendingEstimate(projectId, estimates, now){
  return (estimates || [])
    .filter(e => e.status === 'BORRADOR')
    .map(e => ({ e, age: daysBetween(e.createdAt, now) }))
    .filter(({ age }) => age > 7)
    .map(({ e, age }) => alert(projectId, TYPE.ESTIMACION_PENDIENTE, age > 30 ? SEV.ALTA : age > 14 ? SEV.MEDIA : SEV.BAJA, {
      affectedEntity: { type: 'ESTIMACION', id: e.id },
      title: `Estimación №${e.numero} sin autorizar hace ${age} días`,
      message: `Importe bruto: ${e.importeBruto}.`, why: 'Una estimación sin autorizar retrasa el pago real de lo ya ejecutado.',
      evidence: { numero: e.numero, importeBruto: e.importeBruto, diasSinAutorizar: age }, impactoEstimado: e.totalEstimado,
      accionRecomendada: 'Autorizar o corregir la estimación pendiente.',
      actionRoute: { module: 'control-presupuestal', tab: 'estimaciones', estimateId: e.id }
    }));
}

/* 13. Pago pendiente: estimaciones AUTORIZADA cuyo total pagado (via los
   pagos reales que la referencian) sigue por debajo de su totalEstimado
   -- calculo directo sobre datos reales, nunca inventado. */
function rulePendingPayment(projectId, estimates, payments){
  const paidByEstimate = new Map();
  (payments || []).forEach(p => { if(p.estimacionId) paidByEstimate.set(p.estimacionId, (paidByEstimate.get(p.estimacionId) || 0) + toNumber(p.monto)); });
  return (estimates || [])
    .filter(e => e.status === 'AUTORIZADA')
    .map(e => ({ e, pagado: paidByEstimate.get(e.id) || 0 }))
    .filter(({ e, pagado }) => pagado < toNumber(e.totalEstimado) - 0.01)
    .map(({ e, pagado }) => {
      const saldo = toNumber(e.totalEstimado) - pagado;
      const pct = e.totalEstimado > 0 ? (saldo / e.totalEstimado) * 100 : 0;
      return alert(projectId, TYPE.PAGO_PENDIENTE, pct > 75 ? SEV.MEDIA : SEV.BAJA, {
        affectedEntity: { type: 'ESTIMACION', id: e.id },
        title: `Estimación №${e.numero} con saldo por pagar`,
        message: `Pagado ${pagado.toFixed(2)} de ${e.totalEstimado.toFixed(2)} (saldo ${saldo.toFixed(2)}).`,
        why: 'Un saldo sin pagar puede indicar un problema de flujo de efectivo o un pago olvidado.',
        evidence: { totalEstimado: e.totalEstimado, pagado, saldo }, impactoEstimado: saldo,
        accionRecomendada: 'Registrar el pago pendiente o confirmar la razón del retraso.',
        actionRoute: { module: 'control-presupuestal', tab: 'pagos', estimateId: e.id }
      });
    });
}

/* 14. Cambio significativo de Project Health: compara el score ACTUAL
   (ya calculado por projectHealth.js) contra el ultimo snapshot guardado
   en el historial (projectHealthHistory.js) -- nunca recalcula Health,
   solo compara. Umbral: 8 puntos de diferencia, documentado (mismo orden
   de magnitud que la brecha entre niveles del semaforo). */
function ruleHealthChange(projectId, currentHealth, previousHealthSnapshot){
  if(!previousHealthSnapshot || currentHealth == null) return [];
  const delta = currentHealth.score - previousHealthSnapshot.score;
  if(Math.abs(delta) < 8) return [];
  const worsened = delta < 0;
  const severity = Math.abs(delta) >= 20 ? SEV.ALTA : SEV.MEDIA;
  return [alert(projectId, TYPE.CAMBIO_PROJECT_HEALTH, worsened ? severity : SEV.INFO, {
    affectedEntity: null,
    title: `Project Health ${worsened ? 'empeoró' : 'mejoró'} de ${previousHealthSnapshot.score} a ${currentHealth.score}`,
    message: `Nivel: ${previousHealthSnapshot.level} → ${currentHealth.level}.`,
    why: worsened ? 'Una caída significativa indica que uno o más ejes del proyecto se deterioraron.' : 'Una mejora significativa confirma que las acciones tomadas funcionaron.',
    evidence: { anterior: previousHealthSnapshot.score, actual: currentHealth.score, drivers: currentHealth.drivers?.map(d => d.key) || [] },
    impactoEstimado: null,
    accionRecomendada: worsened ? 'Revisar qué dimensiones bajaron en Project Health.' : null,
    actionRoute: { module: 'vault' }
  })];
}

/* 15-17. Garantias (seccion 14): usan el MISMO motor Sentinel, no otro
   sistema -- reciben componentes de activo YA resueltos (con su estado de
   garantia calculado por assetComponentSchema.js#computeWarrantyStatus). */
function ruleWarranties(projectId, componentsWithWarrantyStatus){
  const out = [];
  (componentsWithWarrantyStatus || []).forEach(c => {
    if(c.warrantyStatus === 'POR_VENCER'){
      out.push(alert(projectId, TYPE.GARANTIA_POR_VENCER, c.diasRestantes <= 15 ? SEV.ALTA : SEV.MEDIA, {
        affectedEntity: { type: 'COMPONENTE', id: c.id },
        title: `Garantía de "${c.nombre}" vence en ${c.diasRestantes} días`,
        message: `Fabricante: ${c.fabricante || 'Sin información'}.`, why: 'Después del vencimiento, reparaciones/reemplazos dejan de estar cubiertos.',
        evidence: { garantiaVigenciaHasta: c.garantiaVigenciaHasta, diasRestantes: c.diasRestantes }, impactoEstimado: c.costo,
        accionRecomendada: 'Gestionar la garantía o planear el reemplazo antes de que venza.',
        actionRoute: { module: 'vault', tab: 'activo', componentId: c.id }
      }));
    }else if(c.warrantyStatus === 'VENCIDA'){
      out.push(alert(projectId, TYPE.GARANTIA_VENCIDA, SEV.MEDIA, {
        affectedEntity: { type: 'COMPONENTE', id: c.id },
        title: `Garantía de "${c.nombre}" ya venció`,
        message: `Venció hace ${Math.abs(c.diasRestantes)} días.`, why: 'Cualquier falla ahora corre por cuenta del proyecto, sin cobertura del proveedor.',
        evidence: { garantiaVigenciaHasta: c.garantiaVigenciaHasta }, impactoEstimado: c.costo,
        accionRecomendada: 'Evaluar contratar mantenimiento o presupuestar el reemplazo.',
        actionRoute: { module: 'vault', tab: 'activo', componentId: c.id }
      }));
    }
    if(c.warrantyStatus !== 'SIN_DATOS' && !c.documentoGarantiaUrl){
      out.push(alert(projectId, TYPE.DOCUMENTACION_GARANTIA_FALTANTE, SEV.BAJA, {
        affectedEntity: { type: 'COMPONENTE', id: c.id },
        title: `Falta el documento de garantía de "${c.nombre}"`,
        message: 'El componente declara garantía pero no tiene ficha/documento adjunto.',
        why: 'Sin el documento, la garantía puede ser difícil de hacer valer ante el proveedor.',
        evidence: {}, impactoEstimado: null,
        accionRecomendada: 'Adjuntar el documento de garantía del componente.',
        actionRoute: { module: 'vault', tab: 'activo', componentId: c.id }
      }));
    }
  });
  return out;
}

/* evaluateSentinelRules: unico punto de entrada. `bundle` trae TODO ya
   calculado por el llamador -- ver server/api-lib/_route-sentinel.mjs.
   Devuelve alertas CANDIDATAS (sin persistir, sin deduplicar). */
export function evaluateSentinelRules({
  projectId, controlPresupuestalRows = [], controlPresupuestalTotals = null, controlPresupuestalAlerts = [],
  bidRiskProject = null, confidenceProject = null, changeOrders = [], estimates = [], payments = [],
  dataQuality = null, overconsumptionRows = [], health = null, previousHealthSnapshot = null,
  componentsWithWarrantyStatus = [], now = new Date().toISOString()
} = {}){
  return [
    ...ruleBudgetNearlyExhausted(projectId, controlPresupuestalRows),
    ...ruleForecastOverBudget(projectId, controlPresupuestalTotals),
    ...ruleProgressMisalignment(projectId, controlPresupuestalRows),
    ...ruleExcessiveCommitment(projectId, controlPresupuestalAlerts),
    ...ruleResourceOverconsumption(projectId, overconsumptionRows),
    ...rulePendingChangeOrder(projectId, changeOrders),
    ...rulePriceAnomaly(projectId, bidRiskProject),
    ...ruleLowPriceConfidence(projectId, confidenceProject),
    ...ruleMissingDocument(projectId, dataQuality),
    ...ruleUnconfirmedCriticalData(projectId, dataQuality),
    ...rulePendingEstimate(projectId, estimates, now),
    ...rulePendingPayment(projectId, estimates, payments),
    ...ruleHealthChange(projectId, health, previousHealthSnapshot),
    ...ruleWarranties(projectId, componentsWithWarrantyStatus)
  ];
}
