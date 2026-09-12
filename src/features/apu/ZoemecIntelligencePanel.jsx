import React, { useMemo, useState, useEffect } from 'react';
import {
  computeZoemecIntelligence, summarizeIntelligence, describeImpact, AUDIT_SEVERITY_FILTERS,
  SCENARIO_LAB_KIND, SCENARIO_LAB_LABEL, buildScenarioLabChange, runScenarioLab, buildScenarioLabPrefillFromChallenge
} from './zoemecIntelligence.js';
import { money } from '../../lib/apuExport.js';
import { apuDataStateLabel } from '../../domain/apuSchema.js';
import { formatLocationDisplay } from '../../domain/geography.js';
import { MEMORY_SCOPE, MEMORY_TYPE, MEMORY_STATUS, buildMemoryEvidence } from '../../domain/technicalMemory.js';
import { challengeSeverity } from '../../domain/apuChallenge.js';
import { apiPost, apiGetSafe } from '../../services/apiClient.js';
import { useI18n } from '../../i18n/I18nContext.jsx';

const RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };
// Identificadores reales que ya existen en el APU (Fase 6): nunca se inventa
// un projectId/apuId nuevo -- si el proyecto no se ha capturado todavia, se
// usa un valor explicito de "sin capturar" en vez de fabricar uno.
// FASE 3 (aprendizaje progresivo SEGURO): antes solo usaba apu.proyecto (el
// NOMBRE del proyecto, texto libre) como "projectId" -- inofensivo mientras
// nada verificaba pertenencia real a un proyecto, pero la Parte 0 de esta
// fase SI la verifica (server/api-lib/_route-technical-memory.mjs#handleList
// ahora exige un documento real en `projects/{projectId}`). apu.projectId es
// el id REAL de Firestore que main.jsx ya adjunta a este mismo objeto (ver
// professionalApu en main.jsx) -- se prefiere aqui; el resto de la cadena de
// respaldo se conserva intacta para un APU nunca vinculado a un proyecto.
const projectIdOf = apu => apu?.projectId || apu?.proyecto || apu?.clave || apu?.id || 'sin-proyecto';
const apuIdOf = apu => apu?.id || apu?.clave || 'sin-id';
const AUDIT_SEVERITY_LABEL = { CRITICAL: 'CRÍTICO', HIGH: 'ALTO', MEDIUM: 'MEDIO', LOW: 'BAJO', INFO: 'INFO' };

/* Severidad SIEMPRE con texto+icono+color (regla 12 del spec) -- la palabra
   completa se imprime siempre, el color/forma es un refuerzo, nunca la
   unica senal. */
function SeverityBadge({ severity }){
  const sev = severity || 'INFO';
  return <span className={`zi-badge zi-badge-${sev.toLowerCase()}`}>{AUDIT_SEVERITY_LABEL[sev] || sev}</span>;
}

// Confidence usa el MISMO vocabulario HIGH/MEDIUM/LOW que Auditor, pero con
// significado invertido (HIGH=bueno en Confidence, HIGH=grave en Auditor) --
// mapeo de color separado a proposito, nunca reusar SeverityBadge aqui.
const CONFIDENCE_BADGE_CLASS = { HIGH: 'zi-badge-medium', MEDIUM: 'zi-badge-high', LOW: 'zi-badge-critical', INSUFFICIENT_EVIDENCE: 'zi-badge-info' };
function ConfidenceStatusBadge({ status }){
  return <span className={`zi-badge ${CONFIDENCE_BADGE_CLASS[status] || 'zi-badge-info'}`}>{status}</span>;
}

const DIMENSION_LABEL = { structure: 'Estructura', calculation: 'Cálculo', prices: 'Precios', productivity: 'Rendimientos', quantities: 'Cantidades', specification: 'Especificación', evidence: 'Evidencia', historicalConsistency: 'Consistencia histórica' };

/* Tarjeta generica para un finding de Auditor o de Bid Risk -- ambos
   comparten severity/category-ish+message/description+evidence+recommendation;
   unitImpact/projectImpact solo se muestran cuando el finding realmente los
   trae (Auditor no los tiene, Bid Risk si). */
function FindingCard({ finding, actions }){
  const hasImpact = finding.unitImpact !== undefined || finding.projectImpact !== undefined;
  const impact = hasImpact ? describeImpact(finding.projectImpact, finding.reason) : null;
  return <div className="zi-finding-card">
    <div className="zi-finding-head"><SeverityBadge severity={finding.severity} />{finding.category && <b>{String(finding.category).replace(/_/g, ' ')}</b>}</div>
    <div className="zi-finding-desc">{finding.message || finding.description}</div>
    {finding.evidence && <div className="zi-finding-meta">Evidencia: <b>{finding.evidence}</b></div>}
    {hasImpact && <div className="zi-finding-meta">
      {finding.unitImpact != null && <span>Impacto unitario: <b>{money(finding.unitImpact)}</b></span>}
      <span>Impacto proyecto: <b>{impact.display || money(impact.value)}</b></span>
    </div>}
    {finding.recommendation && <div className="zi-finding-meta">Recomendación: {finding.recommendation}</div>}
    {actions}
  </div>;
}

function SummaryBar({ summary, tr }){
  const bidRiskExposureLabel = !summary.bidRisk.severity ? null
    : summary.bidRisk.estimatedExposure > 0 ? `${money(summary.bidRisk.estimatedExposure)} exposición`
    : 'sin exposición monetizada';
  return <div className="zi-summary-bar">
    <div className="zi-summary-card">
      <span className="zi-summary-label">{tr('intel.confidenceLabel')}</span>
      <span className={`zi-summary-value${summary.confidence.score == null ? ' zi-empty' : ''}`}>{summary.confidence.display}</span>
      {summary.confidence.status && <span className="zi-summary-sub">{summary.confidence.status}</span>}
    </div>
    <div className="zi-summary-card">
      <span className="zi-summary-label">{tr('intel.bidRiskLabel')}</span>
      {summary.bidRisk.severity
        ? <span className="zi-summary-value"><SeverityBadge severity={summary.bidRisk.severity} /></span>
        : <span className="zi-summary-value zi-empty">{summary.bidRisk.display}</span>}
      {bidRiskExposureLabel && <span className="zi-summary-sub">{bidRiskExposureLabel}</span>}
    </div>
    <div className="zi-summary-card">
      <span className="zi-summary-label">{tr('intel.auditLabel')}</span>
      <span className="zi-summary-value">{summary.audit.count ?? summary.audit.display}</span>
      <span className="zi-summary-sub">{summary.audit.topSeverity ? `top: ${summary.audit.topSeverity}` : summary.audit.count === 0 ? 'sin hallazgos' : ''}</span>
    </div>
    <div className="zi-summary-card">
      <span className="zi-summary-label">{tr('intel.challengeLabel')}</span>
      <span className="zi-summary-value">{summary.challenge.count ?? summary.challenge.display}</span>
      <span className="zi-summary-sub">{summary.challenge.monetizableCount ? `${summary.challenge.monetizableCount} monetizable(s)` : summary.challenge.count === 0 ? 'sin cuestionamientos' : ''}</span>
    </div>
  </div>;
}

// Fase 2 (APU regionalizados por ubicacion): agrega los indicadores del
// brief (Ubicacion, Precio regional, Referencias, Confianza, Ultima
// actualizacion) a partir de lo que YA escribio materialPriceIntelligence2.js
// en cada renglon -- nunca recalcula ni inventa nada aqui, solo presenta.
// null cuando NINGUN recurso paso por busqueda de precio todavia (APU recien
// creado, o generado antes de esta fase) -- la seccion completa se oculta en
// ese caso, no se muestra un "0" ni una confianza inventada.
function computeRegionalSummary(apu){
  const rows = [
    ...(Array.isArray(apu?.materials) ? apu.materials : []),
    ...(Array.isArray(apu?.labor) ? apu.labor : []),
    ...(Array.isArray(apu?.equipment) ? apu.equipment : []),
    ...(Array.isArray(apu?.seguridad) ? apu.seguridad : [])
  ];
  const searched = rows.filter(r => r.priceStatus != null);
  if(!searched.length) return null;
  const counts = { ALTA: 0, MEDIA: 0, BAJA: 0, sinDato: 0 };
  let referencias = 0;
  let ultimaActualizacion = null;
  searched.forEach(r => {
    if(r.regionalConfidence === 'ALTA') counts.ALTA++;
    else if(r.regionalConfidence === 'MEDIA') counts.MEDIA++;
    else if(r.regionalConfidence === 'BAJA') counts.BAJA++;
    else counts.sinDato++;
    referencias += r.priceRecord?.references?.length || 0;
    if(r.searchedAt && (!ultimaActualizacion || r.searchedAt > ultimaActualizacion)) ultimaActualizacion = r.searchedAt;
  });
  const ubicacion = formatLocationDisplay(apu?.ubicacionEstructurada || {}) || apu?.ubicacion || null;
  const nivel = counts.ALTA > 0 ? 'ALTA' : counts.MEDIA > 0 ? 'MEDIA' : 'BAJA';
  return { ubicacion, nivel, counts, totalRecursos: searched.length, referencias, ultimaActualizacion };
}

const REGIONAL_BADGE_CLASS = { ALTA: 'zi-badge-low', MEDIA: 'zi-badge-medium', BAJA: 'zi-badge-high' };
const REGIONAL_LABEL = { ALTA: 'Confianza regional alta', MEDIA: 'Confianza regional media', BAJA: 'Confianza regional baja' };

function RegionalIntelligenceCard({ apu }){
  const summary = useMemo(() => computeRegionalSummary(apu), [apu]);
  if(!summary) return null;
  return <div className="zi-finding-card" style={{ marginBottom: 14 }}>
    <div className="zi-finding-head">
      <b>Inteligencia regional de costos</b>
      <span className={`zi-badge ${REGIONAL_BADGE_CLASS[summary.nivel]}`}>{REGIONAL_LABEL[summary.nivel]}</span>
    </div>
    <p className="zi-finding-desc">
      Ubicación: <b>{summary.ubicacion || 'Sin ubicación capturada en el proyecto'}</b><br/>
      Recursos con búsqueda de precio: <b>{summary.totalRecursos}</b> · Referencias usadas: <b>{summary.referencias}</b>
      {summary.ultimaActualizacion && <> · Última actualización: <b>{new Date(summary.ultimaActualizacion).toLocaleDateString('es-MX')}</b></>}
    </p>
    {summary.nivel === 'BAJA' && <p className="zi-finding-desc">Información regional limitada. ZOEMEC está utilizando referencias estatales y nacionales para complementar esta estimación.</p>}
  </div>;
}

function ResumenTab({ apu, intelligence, confidence, bidRisk }){
  return <div>
    <RegionalIntelligenceCard apu={apu} />
    {!confidence.ok && <div className="zi-error-box">Confidence no disponible: {confidence.error}</div>}
    {confidence.ok && <p>Recomendación de revisión: <b>{confidence.data.recommendation}</b></p>}
    {confidence.ok && confidence.data.criticalFactors.length > 0 && <div className="zi-error-box">Factores críticos que limitan el score: {confidence.data.criticalFactors.map(f => f.dimension).join(', ')}</div>}
    {!bidRisk.ok && <div className="zi-error-box">Bid Risk no disponible: {bidRisk.error}</div>}
    {bidRisk.ok && bidRisk.data.findings.length > 0 && <>
      <h4 style={{ margin: '10px 0 6px', fontSize: '.82rem' }}>Top riesgos</h4>
      <div className="zi-finding-list">{[...bidRisk.data.findings].sort((a, b) => RANK[b.severity] - RANK[a.severity]).slice(0, 3).map(f => <FindingCard key={f.id} finding={f} />)}</div>
    </>}
    {bidRisk.ok && bidRisk.data.findings.length === 0 && confidence.ok && confidence.data.status !== 'INSUFFICIENT_EVIDENCE' && <p className="zi-empty-box">Sin riesgos ni observaciones relevantes en este momento.</p>}
  </div>;
}

// FASE 3 (aprendizaje progresivo seguro): historicalConsistencyDimension
// (apuConfidence.js) ya reporta memoryApprovedRows=N en su `evidence` --
// nunca se modifica ese motor aqui (regla de esta fase), solo se LEE lo que
// ya calculo para mostrar un indicador honesto: nunca aparece si N es 0
// (memoria aprobada real y usada, no una suposicion de la UI).
function memoryCalibratedRowsFromDimension(dim){
  const raw = dim?.evidence?.find(e => e.startsWith('memoryApprovedRows='));
  const n = raw ? Number(raw.split('=')[1]) : 0;
  return Number.isFinite(n) ? n : 0;
}

function ConfidenceTab({ confidence }){
  if(!confidence.ok) return <div className="zi-error-box">Confidence no disponible: {confidence.error}</div>;
  const c = confidence.data;
  return <div>
    <p>Score global: <b>{c.score != null ? `${c.score}%` : 'SIN EVIDENCIA SUFICIENTE'}</b> · <ConfidenceStatusBadge status={c.status} /> · recomendación: <b>{c.recommendation}</b></p>
    <div className="zi-dim-grid">
      {Object.entries(c.dimensions).map(([name, dim]) => {
        const memoryCalibratedRows = memoryCalibratedRowsFromDimension(dim);
        return <div key={name} className="zi-dim-card">
          <div className="zi-dim-name"><span>{DIMENSION_LABEL[name] || name}</span><ConfidenceStatusBadge status={dim.status} /></div>
          <div className="zi-dim-score">{dim.score != null ? dim.score : '—'}</div>
          {dim.score != null && <div className="zi-dim-bar"><span style={{ width: `${dim.score}%` }} /></div>}
          {memoryCalibratedRows > 0 && <span className="zi-badge zi-badge-info">Aprendizaje aplicado: {memoryCalibratedRows} rendimiento(s) calibrado(s) por memoria técnica aprobada</span>}
          {dim.reasons.slice(0, 1).map((r, i) => <p key={i} className="zi-dim-reason">{r}</p>)}
          {dim.missingData.length > 0 && <p className="zi-dim-reason">Sin datos: {dim.missingData.join(', ')}</p>}
        </div>;
      })}
    </div>
  </div>;
}

function AuditoriaTab({ audit }){
  const [filter, setFilter] = useState(null);
  if(!audit.ok) return <div className="zi-error-box">Auditor no disponible: {audit.error}</div>;
  const findings = filter ? audit.data.findings.filter(f => f.severity === filter) : audit.data.findings;
  return <div>
    <div className="zi-filter-row">
      {AUDIT_SEVERITY_FILTERS.map(sev => <button key={sev} type="button" className={`zi-filter-chip${filter === sev ? ' active' : ''}`} onClick={() => setFilter(f => f === sev ? null : sev)}>
        {AUDIT_SEVERITY_LABEL[sev]} ({audit.data.summary[sev.toLowerCase()] ?? 0})
      </button>)}
    </div>
    {findings.length === 0 ? <div className="zi-empty-box">Sin hallazgos{filter ? ` de severidad ${AUDIT_SEVERITY_LABEL[filter]}` : ''}.</div>
      : <div className="zi-finding-list">{findings.map(f => <FindingCard key={f.id} finding={f} />)}</div>}
  </div>;
}

// Estado de revision derivado de datos PERSISTENTES reales (regla 11 del
// spec Fase 6) -- nunca de un estado local que se pierde al recargar.
const DECISION_REVIEW_LABEL = { MAINTAIN: 'MANTENIDO', JUSTIFY: 'JUSTIFICADO', CORRECT: 'CORREGIDO', DISMISS: 'DESCARTADO' };

// Fase 6.1: honestidad de verificacion (regla 15 del spec) -- nunca se
// esconde si la cifra guardada la calculo el motor del servidor o si es
// solo lo que el cliente reporto sin poder confirmarse.
const VERIFICATION_LABEL = { SERVER_VERIFIED: 'VERIFICADO POR SERVIDOR', UNVERIFIED_CLIENT_SNAPSHOT: 'SNAPSHOT NO VERIFICADO', NOT_VERIFIABLE: 'NO VERIFICABLE' };
const VERIFICATION_CLASS = { SERVER_VERIFIED: 'zi-badge-medium', UNVERIFIED_CLIENT_SNAPSHOT: 'zi-badge-info', NOT_VERIFIABLE: 'zi-badge-high' };
function VerificationBadge({ status }){
  if(!status) return null;
  return <span className={`zi-badge ${VERIFICATION_CLASS[status] || 'zi-badge-info'}`}>{VERIFICATION_LABEL[status] || status}</span>;
}
// Fase 6.1: estados reales de aplicacion de una correccion (regla 15) --
// APPLIED_LOCAL_ONLY nunca se muestra como "aplicado" a secas: este proyecto
// no tiene todavia una API de guardado server-side del APU (ver
// api/challenge-decisions.mjs cabecera), asi que "aplicado" real siempre
// significa "en el editor de este navegador, no persistido".
const APPLICATION_LABEL = { PENDING_APPLICATION: 'PENDIENTE DE APLICAR', APPLIED_LOCAL_ONLY: 'APLICADO (SOLO EN ESTE EDITOR, SIN GUARDAR)', FAILED: 'ERROR AL APLICAR' };

function ChallengeTab({ apu, challenge, onSimulate }){
  const apuId = apuIdOf(apu);
  const projectId = projectIdOf(apu);
  const [decisions, setDecisions] = useState(null); // {[challengeId]: decisionDoc} -- null = cargando
  const [saveState, setSaveState] = useState({}); // {[challengeId]: {status, message}}
  const [justifyDraft, setJustifyDraft] = useState({}); // {[challengeId]: texto en edicion}

  useEffect(() => {
    let alive = true;
    apiGetSafe(`/api/challenge-decisions?apuId=${encodeURIComponent(apuId)}`).then(data => {
      if(!alive) return;
      const map = {};
      (data?.decisions || []).forEach(d => { map[d.challengeId] = d; });
      setDecisions(map);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apuId]);

  const record = async (c, decision, reason) => {
    setSaveState(s => ({ ...s, [c.id]: { status: 'saving' } }));
    try{
      // Fase 6.1: clientSnapshot (lo que este editor ya calculo) va separado
      // de apuSnapshot (el APU completo, TAL COMO ESTA AHORA -- ver
      // api/challenge-decisions.mjs#verifyChallengeSnapshot) para que el
      // servidor recalcule con el mismo motor y el numero guardado como
      // "verificado" nunca dependa solo de lo que declare el cliente.
      const res = await apiPost('/api/challenge-decisions', {
        action: 'record', apuId, projectId, challengeId: c.id, decision, reason: reason || null,
        clientSnapshot: { category: c.category, currentValue: c.currentValue, baselineValue: c.baselineValue, baselineSource: c.baselineSource, deltaPct: c.deltaPct, unitImpact: c.unitImpact, projectImpact: c.projectImpact },
        apuSnapshot: apu
      });
      setDecisions(prev => ({ ...(prev || {}), [c.id]: res.decision }));
      setSaveState(s => ({ ...s, [c.id]: { status: 'saved' } }));
    }catch(err){
      setSaveState(s => ({ ...s, [c.id]: { status: 'error', message: err.message } }));
    }
  };

  if(!challenge.ok) return <div className="zi-error-box">Challenge no disponible: {challenge.error}</div>;
  if(!challenge.data.challenges.length) return <div className="zi-empty-box">Sin cuestionamientos de Challenge sobre este APU.</div>;
  return <div className="zi-finding-list">
    {challenge.data.challenges.map(c => {
      const persisted = decisions?.[c.id];
      const state = saveState[c.id];
      return <FindingCard key={c.id} finding={{ severity: challengeSeverity(c.category), category: c.category, message: c.title, evidence: c.baselineSource, unitImpact: c.unitImpact, projectImpact: c.projectImpact, reason: c.projectImpact == null ? 'PROJECT_QUANTITY_NOT_CAPTURED' : null }}
        actions={<div>
          {persisted && <p className="zi-finding-meta">Estado de revisión: <b>{DECISION_REVIEW_LABEL[persisted.decision] || 'PENDIENTE'}</b> ({persisted.actorEmail || persisted.actorUid}{persisted.reason ? ` — "${persisted.reason}"` : ''}) <VerificationBadge status={persisted.verificationStatus} /></p>}
          {persisted?.clientMismatch && <div className="zi-error-box">El servidor recalculó cifras distintas a las reportadas por el cliente al decidir: {persisted.differences.map((d, i) => <span key={d.field}>{i > 0 ? '; ' : ''}{d.field} (cliente: {d.client ?? '—'}, servidor: {d.server ?? '—'})</span>)}. Se conservó el valor del servidor.</div>}
          {persisted?.applicationStatus && <p className="zi-finding-meta">Aplicación de la corrección: <b>{APPLICATION_LABEL[persisted.applicationStatus] || persisted.applicationStatus}</b></p>}
          {!persisted && decisions !== null && <p className="zi-finding-meta">Estado de revisión: <b>PENDIENTE</b></p>}
          <div className="zi-finding-actions">
            <button className="soft" disabled={state?.status === 'saving'} onClick={() => record(c, 'MAINTAIN')}>Mantener</button>
            {/* Solo "rendimiento" tiene un valor de correccion real (baselineValue) --
                un challenge de "precio" no propone ningun precio corregido (no hay
                evidencia de cual seria el correcto, ver apuChallenge.js#priceChallenges),
                asi que no tiene sentido ofrecer "simular" ahi: no habria nada real que simular. */}
            {c.category === 'rendimiento' && c.resourceDescripcion && <button className="soft" onClick={() => onSimulate?.(c)}>Simular corrección</button>}
            <button className="soft" disabled={state?.status === 'saving'} onClick={() => setJustifyDraft(d => ({ ...d, [c.id]: d[c.id] ?? '' }))}>Justificar</button>
          </div>
          {justifyDraft[c.id] != null && <div className="zi-scenario-form" style={{ marginTop: 6 }}>
            <label style={{ flex: 1 }}>Justificación
              <input value={justifyDraft[c.id]} onChange={e => setJustifyDraft(d => ({ ...d, [c.id]: e.target.value }))} placeholder="Motivo real de mantener este valor" />
            </label>
            <button disabled={!justifyDraft[c.id] || state?.status === 'saving'} onClick={async () => { await record(c, 'JUSTIFY', justifyDraft[c.id]); setJustifyDraft(d => { const n = { ...d }; delete n[c.id]; return n; }); }}>Guardar justificación</button>
            <button className="ghost" onClick={() => setJustifyDraft(d => { const n = { ...d }; delete n[c.id]; return n; })}>Cancelar</button>
          </div>}
          {/* Regla 10: guardando/guardado/error explicitos, nunca "exito optimista" falso. */}
          {state?.status === 'saving' && <p className="zi-pending-note">Guardando…</p>}
          {state?.status === 'saved' && <p className="zi-pending-note">Guardado.</p>}
          {state?.status === 'error' && <div className="zi-error-box">No se pudo guardar: {state.message}</div>}
        </div>} />;
    })}
  </div>;
}

function BidRiskTab({ bidRisk }){
  if(!bidRisk.ok) return <div className="zi-error-box">Bid Risk no disponible: {bidRisk.error}</div>;
  const b = bidRisk.data;
  return <div>
    <p>Severidad global: <SeverityBadge severity={b.severity} /> · Exposición estimada: <b>{b.estimatedExposure > 0 ? money(b.estimatedExposure) : (b.findings.length ? 'NO CALCULABLE' : '$0')}</b></p>
    {b.findings.length === 0 ? <div className="zi-empty-box">Sin hallazgos de riesgo.</div>
      : <div className="zi-finding-list">{[...b.findings].sort((a, b2) => RANK[b2.severity] - RANK[a.severity]).map(f => <FindingCard key={f.id} finding={f} />)}</div>}
  </div>;
}

function ScenarioCompare({ result }){
  const { delta, confidence, bidRisk } = result;
  const projectDisplay = (base, label) => base != null ? money(base) : describeImpact(null, delta.reason).display;
  return <div className="zi-scenario-compare">
    <div className="zi-scenario-col"><h4>Base</h4>
      <div className="zi-scenario-row"><span>Costo unitario</span><b>{money(delta.baseUnitCost)}</b></div>
      <div className="zi-scenario-row"><span>Costo proyecto</span><b>{projectDisplay(delta.baseProjectCost)}</b></div>
      <div className="zi-scenario-row"><span>Confidence</span><b>{confidence.base.score != null ? `${confidence.base.score}% ${confidence.base.status}` : 'SIN EVIDENCIA'}</b></div>
      <div className="zi-scenario-row"><span>Bid Risk</span><SeverityBadge severity={bidRisk.base.severity} /></div>
    </div>
    <div className="zi-scenario-col"><h4>Escenario</h4>
      <div className="zi-scenario-row"><span>Costo unitario</span><b>{money(delta.scenarioUnitCost)}</b></div>
      <div className="zi-scenario-row"><span>Costo proyecto</span><b>{projectDisplay(delta.scenarioProjectCost)}</b></div>
      <div className="zi-scenario-row"><span>Delta</span><b className={`zi-scenario-delta ${delta.unitDelta >= 0 ? 'up' : 'down'}`}>{delta.unitDelta >= 0 ? '+' : ''}{money(delta.unitDelta)}{delta.percentDelta != null ? ` (${delta.percentDelta}%)` : ''}</b></div>
      <div className="zi-scenario-row"><span>Confidence</span><b>{confidence.scenario.score != null ? `${confidence.scenario.score}% ${confidence.scenario.status}` : 'SIN EVIDENCIA'}</b></div>
      <div className="zi-scenario-row"><span>Bid Risk</span><SeverityBadge severity={bidRisk.scenario.severity} /></div>
    </div>
  </div>;
}

function EscenariosTab({ apu, onChange, prefill }){
  const [kind, setKind] = useState(prefill?.kind || SCENARIO_LAB_KIND.MATERIAL_PERCENT);
  const [resourceDescripcion, setResourceDescripcion] = useState(prefill?.resourceDescripcion || '');
  const [value, setValue] = useState(prefill?.value != null ? String(prefill.value) : '');
  const [reason, setReason] = useState(prefill?.reason || '');
  const [result, setResult] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [decisionNote, setDecisionNote] = useState(null);
  const [applyError, setApplyError] = useState(null);

  const run = () => {
    const change = buildScenarioLabChange({ kind, resourceDescripcion, value, reason });
    if(!change){ setResult({ ok: false, error: 'Este tipo de cambio requiere un recurso específico.' }); return; }
    setResult(runScenarioLab(apu, [change]));
    setApplied(false);
    setApplyError(null);
    setDecisionNote(null);
  };

  /* Fase 6.1 -- correccion #2 del hardening: orden seguro de dos fases (el
     APU no tiene una API de guardado server-side con la que ser atomico, ver
     cabecera de api/challenge-decisions.mjs, asi que se usa el flujo
     explicito de dos fases que pide el spec en vez de fingir atomicidad).

     FASE 1: registrar la INTENCION (PENDING_APPLICATION) ANTES de tocar el
     APU. Si esto falla, el APU nunca se modifica -- ya no puede quedar
     "APU cambiado sin registro profesional de por que" (el bug real que
     reporto Fase 6).
     FASE 2 (solo si la 1 tuvo exito): aplicar localmente, y confirmar
     APPLIED_LOCAL_ONLY. Si la confirmacion de fase 2 falla, el APU YA se
     aplico en este editor (no tiene sentido revertir una edicion real del
     usuario por un fallo de red secundario) pero el registro del servidor
     se queda honestamente en PENDING_APPLICATION -- nunca se finge
     "aplicado" si la confirmacion no se pudo guardar. */
  const confirmApply = async () => {
    setConfirming(false);
    setApplyError(null);
    setDecisionNote(null);
    if(!prefill?.challengeId){
      onChange(result.data.scenario);
      setApplied(true);
      return;
    }
    setApplying(true);
    const apuId = apuIdOf(apu), projectId = projectIdOf(apu);
    try{
      await apiPost('/api/challenge-decisions', {
        action: 'record', apuId, projectId, challengeId: prefill.challengeId,
        decision: 'CORRECT', reason: prefill.reason, applicationStatus: 'PENDING_APPLICATION',
        clientSnapshot: prefill.challengeSnapshot, apuSnapshot: apu,
        requestedChange: { kind, resourceDescripcion, value: Number(value) }
      });
    }catch(err){
      setApplying(false);
      setApplyError(`No se registró la decisión de corregir -- el APU NO se modificó: ${err.message}`);
      return;
    }
    onChange(result.data.scenario);
    setApplied(true);
    setApplying(false);
    try{
      await apiPost('/api/challenge-decisions', {
        action: 'record', apuId, projectId, challengeId: prefill.challengeId,
        decision: 'CORRECT', applicationStatus: 'APPLIED_LOCAL_ONLY'
      });
      setDecisionNote('Decisión CORRECT confirmada: APLICADO (SOLO EN ESTE EDITOR, SIN GUARDAR). Usa "Guardar versión" para que sobreviva a esta sesión.');
    }catch(err){
      setDecisionNote(`El APU se aplicó en este editor, pero no se pudo confirmar el registro de aplicación (queda como PENDIENTE DE APLICAR, no se finge aplicado): ${err.message}`);
    }
  };

  return <div>
    <div className="zi-scenario-form">
      <label>Tipo de cambio
        <select value={kind} onChange={e => setKind(e.target.value)}>
          {Object.values(SCENARIO_LAB_KIND).map(k => <option key={k} value={k}>{SCENARIO_LAB_LABEL[k]}</option>)}
        </select>
      </label>
      <label>Recurso (descripción exacta{kind === SCENARIO_LAB_KIND.RESOURCE_PRICE ? ', requerido' : ', vacío = todos'})
        <input value={resourceDescripcion} onChange={e => setResourceDescripcion(e.target.value)} placeholder="Ej. Acero de refuerzo fy=4200" />
      </label>
      <label>Valor {kind === SCENARIO_LAB_KIND.RESOURCE_PRICE ? '(precio absoluto)' : '(%)'}
        <input type="number" value={value} onChange={e => setValue(e.target.value)} />
      </label>
      <label>Motivo (opcional)
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Ej. Alza reportada por proveedor" />
      </label>
      <button onClick={run} disabled={!value}>Simular</button>
    </div>

    {result && !result.ok && <div className="zi-error-box">No se pudo simular: {result.error}</div>}
    {result?.ok && result.data.warnings.length > 0 && <div className="zi-error-box">{result.data.warnings.map((w, i) => <div key={i}>{w.message}</div>)}</div>}
    {result?.ok && result.data.appliedChanges.length === 0 && <div className="zi-empty-box">Ningún recurso coincidió con este cambio -- nada que simular.</div>}
    {result?.ok && result.data.appliedChanges.length > 0 && <>
      <ScenarioCompare result={result.data} />
      <p className="zi-finding-meta">Cambios aplicados: {result.data.appliedChanges.map((c, i) => <span key={i}>{c.resourceDescripcion}: {c.field} {c.previousValue?.toFixed ? c.previousValue.toFixed(2) : c.previousValue} → {c.newValue?.toFixed ? c.newValue.toFixed(2) : c.newValue}{i < result.data.appliedChanges.length - 1 ? '; ' : ''}</span>)}</p>
      {!applied && !confirming && <button onClick={() => setConfirming(true)} disabled={applying}>Aplicar al APU</button>}
      {confirming && <div className="pro-modal"><div>
        <button onClick={() => setConfirming(false)}>×</button>
        <h2>Confirmar aplicación al APU</h2>
        <p>Esto va a modificar el APU que estás editando (mismo mecanismo que cualquier edición manual — no se guarda como versión hasta que uses "Guardar versión").</p>
        <ul>{result.data.appliedChanges.map((c, i) => <li key={i}>{c.resourceDescripcion}: {c.field} de {c.previousValue?.toFixed ? c.previousValue.toFixed(2) : c.previousValue} a {c.newValue?.toFixed ? c.newValue.toFixed(2) : c.newValue}</li>)}</ul>
        <p>Delta de costo unitario: <b>{money(result.data.delta.unitDelta)}</b></p>
        <button onClick={confirmApply} disabled={applying}>{applying ? 'Registrando…' : 'Confirmar y aplicar'}</button>
        <button onClick={() => setConfirming(false)} disabled={applying}>Cancelar</button>
      </div></div>}
      {applyError && <div className="zi-error-box">{applyError}</div>}
      {applied && <p className="zi-pending-note">Aplicado al APU en edición. Usa "Guardar versión" en la barra de acciones para persistirlo.</p>}
      {decisionNote && <p className="zi-pending-note">{decisionNote}</p>}
    </>}
  </div>;
}

function MemoryEntryCard({ entry, canModerate, onApprove, onReject, busy }){
  const cls = entry.status === MEMORY_STATUS.APPROVED ? 'zi-badge-medium' : entry.status === MEMORY_STATUS.REJECTED ? 'zi-badge-critical' : entry.status === MEMORY_STATUS.SUPERSEDED ? 'zi-badge-low' : 'zi-badge-info';
  const [rejectDraft, setRejectDraft] = useState(null);
  return <div className="zi-memory-entry">
    <div className="zi-finding-head"><span className={`zi-badge ${cls}`}>{entry.status}</span><span className="zi-memory-scope">{entry.scope}</span><b>{entry.type.replace(/_/g, ' ')}</b></div>
    <div className="zi-finding-desc">{entry.subject?.resourceDescripcion || entry.subject?.primaryActivity || 'sin subject'} → {entry.value} {entry.unit || ''}</div>
    <p className="zi-finding-meta">Creado por: <b>{entry.createdBy}</b>{entry.approvedBy ? <> · Aprobado por: <b>{entry.approvedBy}</b></> : ''}{entry.rejectionReason ? <> · Motivo de rechazo: {entry.rejectionReason}</> : ''}</p>
    {entry.status === MEMORY_STATUS.PROPOSED && <p className="zi-pending-note">Propuesta — requiere aprobación humana antes de poder usarse en decisiones automáticas.</p>}
    {/* Regla 4/10: APROBAR/RECHAZAR solo se muestran si el usuario tiene el
        permiso real (admin, ver policy documentada en api/technical-memory.mjs)
        -- esto es solo UX, la barrera REAL es el 403 del servidor si alguien
        se lo salta. */}
    {canModerate && entry.status === MEMORY_STATUS.PROPOSED && <div className="zi-finding-actions">
      <button className="soft" disabled={busy} onClick={() => onApprove(entry)}>Aprobar</button>
      <button className="soft" disabled={busy} onClick={() => setRejectDraft(rejectDraft == null ? '' : null)}>Rechazar</button>
    </div>}
    {rejectDraft != null && <div className="zi-scenario-form" style={{ marginTop: 6 }}>
      <label style={{ flex: 1 }}>Motivo del rechazo<input value={rejectDraft} onChange={e => setRejectDraft(e.target.value)} /></label>
      <button disabled={!rejectDraft || busy} onClick={() => { onReject(entry, rejectDraft); setRejectDraft(null); }}>Confirmar rechazo</button>
      <button className="ghost" onClick={() => setRejectDraft(null)}>Cancelar</button>
    </div>}
  </div>;
}

// FASE 3: entries/onRefresh ahora vienen del panel padre (ZoemecIntelligencePanel),
// que resuelve la MISMA memoria del proyecto para alimentar Confidence/
// Challenge -- una sola peticion compartida en vez de que esta pestaña hiciera
// la suya propia por separado (que antes dejaba esa memoria sin usar en
// ningun otro lado).
function MemoriaTab({ apu, user, entries, error: fetchError, onRefresh }){
  const projectId = projectIdOf(apu);
  const [error, setError] = useState(null);
  const [proposing, setProposing] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [form, setForm] = useState({ type: MEMORY_TYPE.APPROVED_YIELD, resourceDescripcion: apu.labor?.[0]?.descripcion || '', value: '' });

  const propose = async () => {
    if(!form.value) return;
    setError(null);
    try{
      await apiPost('/api/technical-memory', {
        action: 'proposal', scope: MEMORY_SCOPE.PROJECT, type: form.type,
        subject: { primaryActivity: apu.primaryActivity || undefined, resourceDescripcion: form.resourceDescripcion || undefined },
        value: Number(form.value), context: { projectId },
        provenance: { apuId: apuIdOf(apu), wasCorrection: true, sourceType: 'HUMAN_CORRECTION' }
      });
      setProposing(false);
      setForm(f => ({ ...f, value: '' }));
      onRefresh();
    }catch(err){ setError(err.message); }
  };

  const approve = async (entry) => {
    setBusyId(entry.id); setError(null);
    try{ await apiPost('/api/technical-memory', { action: 'approve', id: entry.id }); onRefresh(); }
    catch(err){ setError(err.message); }
    finally{ setBusyId(null); }
  };
  const reject = async (entry, reason) => {
    setBusyId(entry.id); setError(null);
    try{ await apiPost('/api/technical-memory', { action: 'reject', id: entry.id, reason }); onRefresh(); }
    catch(err){ setError(err.message); }
    finally{ setBusyId(null); }
  };

  return <div>
    <div className="zi-session-note">Memoria del proyecto: persistida en Firestore vía api/technical-memory.mjs (Fase 6) — sobrevive a recargar la página. Aprobar/Rechazar requieren rol de administrador (no existe todavía un rol de "supervisor" dedicado). Una entrada APPROVED se usa automáticamente para calibrar Confidence y Challenge de este proyecto.</div>
    {(error || fetchError) && <div className="zi-error-box">{error || fetchError}</div>}
    {entries === null ? <p className="muted">Cargando…</p>
      : entries.length === 0 ? <div className="zi-empty-box">Sin entradas de memoria para este proyecto todavía.</div>
      : entries.map(e => <MemoryEntryCard key={e.id} entry={e} canModerate={Boolean(user?.isAdmin)} onApprove={approve} onReject={reject} busy={busyId === e.id} />)}
    {!proposing ? <button className="soft" onClick={() => setProposing(true)}>Proponer desde corrección</button> : <div className="zi-scenario-form">
      <label>Tipo
        <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
          {Object.values(MEMORY_TYPE).map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
      </label>
      <label>Recurso<input value={form.resourceDescripcion} onChange={e => setForm(f => ({ ...f, resourceDescripcion: e.target.value }))} /></label>
      <label>Valor aprobado<input type="number" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} /></label>
      <button onClick={propose} disabled={!form.value}>Crear propuesta</button>
      <button className="ghost" onClick={() => setProposing(false)}>Cancelar</button>
    </div>}
  </div>;
}

const PROVENANCE_KINDS = ['materials', 'labor', 'equipment', 'consumables', 'seguridad'];
function EvidenciaTab({ apu }){
  const rows = PROVENANCE_KINDS.flatMap(kind => (apu[kind] || []).map((row, index) => ({ kind, index, row })));
  if(!rows.length) return <div className="zi-empty-box">Este APU no tiene renglones todavía.</div>;
  return <div style={{ overflowX: 'auto' }}>
    <table className="zi-evidence-table">
      <thead><tr><th>Tipo</th><th>Recurso</th><th>Precio/Salario</th><th>Rendimiento</th><th>Fuente</th><th>Región</th><th>Estado</th></tr></thead>
      <tbody>{rows.map(({ kind, index, row }) => <tr key={`${kind}-${index}`}>
        <td>{kind}</td><td>{row.descripcion || '—'}</td>
        <td>{money(row.precioUnitario ?? row.salarioBase ?? row.tarifa ?? 0)}</td>
        <td>{row.rendimiento != null ? row.rendimiento.toFixed(3) : '—'}{row.rendimientoFuente ? ` (${row.rendimientoFuente})` : ''}</td>
        <td>{row.fuente?.proveedor || 'Sin proveedor'}{row.fuente?.fecha ? ` · ${row.fuente.fecha}` : ''}</td>
        {/* Fase 2: region = ubicacion consultada al buscar este precio (no el
            proveedor); nivelCobertura = si la fuente usada de verdad era de
            ese nivel geografico, autoreportado por la busqueda, nunca
            inventado aqui. */}
        <td>{row.fuente?.region ? <>{row.fuente.region}{row.fuente?.nivelCobertura ? <><br/><small>{row.fuente.nivelCobertura}</small></> : ''}</> : '—'}</td>
        <td>{apuDataStateLabel(row.fuente?.estado)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function HistorialTab({ history, onRestore }){
  if(!history?.length) return <div className="zi-empty-box">Sin versiones guardadas todavía.</div>;
  return <div className="zi-finding-list">{[...history].reverse().map(v => <div key={v.version} className="zi-finding-card">
    <div className="zi-finding-head"><b>{v.version}</b><span className="zi-finding-meta">{v.at}</span></div>
    <div className="zi-finding-meta">Autor: <b>{v.user || '—'}</b> · Motivo: {v.reason || '—'} · P.U.: <b>{money(v.unitPrice)}</b></div>
    {onRestore && <div className="zi-finding-actions"><button className="soft" onClick={() => onRestore(v)}>Restaurar esta versión</button></div>}
  </div>)}</div>;
}

const TAB_KEYS = ['resumen', 'confidence', 'bidrisk', 'auditoria', 'challenge', 'escenarios', 'evidencia', 'memoria', 'historial'];

/* ZOEMEC INTELLIGENCE (Fase 5 + Fase 6): unico punto de montaje de los 4
   motores de dominio dentro del editor, mas persistencia real de Memoria
   Tecnica y decisiones de Challenge (Fase 6 -- api/technical-memory.mjs,
   api/challenge-decisions.mjs). `apu` es el mismo objeto real que ya usa
   ProfessionalApuEditor (nunca una copia/mock) -- useMemo recalcula solo
   cuando la referencia de `apu` cambia (el editor ya reemplaza `apu` por un
   objeto nuevo en cada edicion via structuredClone+onChange, asi que la
   referencia es una dependencia valida y evita recalculos en cada render
   sin necesidad de un deep-equal costoso). */
export function ZoemecIntelligencePanel({ apu, onChange, history, onRestoreVersion, user }){
  const { t: tr } = useI18n();
  const projectId = projectIdOf(apu);
  // FASE 3 (aprendizaje progresivo seguro): la memoria del proyecto se
  // resuelve UNA vez aqui arriba (antes vivia solo dentro de MemoriaTab,
  // desconectada de Confidence/Challenge) -- se comparte con MemoriaTab via
  // props en vez de que cada uno haga su propia peticion. Se piden TODOS los
  // estados (no solo APPROVED): MemoriaTab necesita ver PROPOSED para poder
  // revisarlas; buildMemoryEvidence/resolveTechnicalMemory ya filtran a
  // APPROVED por su cuenta (technicalMemory.js#isEligible), asi que pasar
  // aqui las demas nunca cambia el resultado de Confidence/Challenge.
  const [memoryEntries, setMemoryEntries] = useState(null); // null = cargando
  const [memoryError, setMemoryError] = useState(null);
  const refreshMemory = () => {
    apiGetSafe(`/api/technical-memory?projectId=${encodeURIComponent(projectId)}`)
      .then(data => { setMemoryEntries(data?.entries || []); setMemoryError(null); })
      .catch(err => setMemoryError(err.message));
  };
  useEffect(() => { refreshMemory(); /* eslint-disable-next-line */ }, [projectId]);

  const memoryEvidence = useMemo(() => {
    if(!memoryEntries?.length || !Array.isArray(apu.labor) || !apu.labor.length) return undefined;
    const queries = apu.labor
      .filter(row => row?.descripcion)
      .map(row => ({ type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: apu.primaryActivity || undefined, resourceDescripcion: row.descripcion }, context: { projectId } }));
    return queries.length ? buildMemoryEvidence(memoryEntries, queries) : undefined;
  }, [memoryEntries, apu.labor, apu.primaryActivity, projectId]);

  const intelligence = useMemo(() => computeZoemecIntelligence(apu, memoryEvidence), [apu, memoryEvidence]);
  const summary = useMemo(() => summarizeIntelligence(intelligence), [intelligence]);
  const [tab, setTab] = useState('resumen');
  const [prefill, setPrefill] = useState(null);

  // Solo llega aqui para category:'rendimiento' (ChallengeTab ya filtra el
  // boton). Logica de conversion probada en zoemecIntelligence.test.js.
  const simulateFromChallenge = (challengeFinding) => {
    setPrefill(buildScenarioLabPrefillFromChallenge(challengeFinding));
    setTab('escenarios');
  };

  return <section className="zi-panel">
    <div className="zi-panel-head"><h2>ZOEMEC INTELLIGENCE</h2><span className="zi-subtitle">{tr('intel.panelSubtitle')}</span></div>
    <SummaryBar summary={summary} tr={tr} />
    <div className="zi-tabs" role="tablist">
      {TAB_KEYS.map(key => <button key={key} type="button" role="tab" aria-selected={tab === key} className={`zi-tab${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>{tr(`intel.tabs.${key}`)}</button>)}
    </div>
    <div className="zi-tabpanel">
      {tab === 'resumen' && <ResumenTab apu={apu} intelligence={intelligence} confidence={intelligence.confidence} bidRisk={intelligence.bidRisk} />}
      {tab === 'confidence' && <ConfidenceTab confidence={intelligence.confidence} />}
      {tab === 'bidrisk' && <BidRiskTab bidRisk={intelligence.bidRisk} />}
      {tab === 'auditoria' && <AuditoriaTab audit={intelligence.audit} />}
      {tab === 'challenge' && <ChallengeTab apu={apu} challenge={intelligence.challenge} onSimulate={simulateFromChallenge} />}
      {tab === 'escenarios' && <EscenariosTab apu={apu} onChange={onChange} prefill={prefill} />}
      {tab === 'evidencia' && <EvidenciaTab apu={apu} />}
      {tab === 'memoria' && <MemoriaTab apu={apu} user={user} entries={memoryEntries} error={memoryError} onRefresh={refreshMemory} />}
      {tab === 'historial' && <HistorialTab history={history} onRestore={onRestoreVersion} />}
    </div>
  </section>;
}
