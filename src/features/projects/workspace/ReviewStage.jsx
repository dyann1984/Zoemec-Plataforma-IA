import React, { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../i18n/I18nContext.jsx';
import { apiGetSafe } from '../../../services/apiClient.js';
import { analyzeOmittedCosts, computeReviewStageModel } from './reviewStageModel.js';

const money = value => Number.isFinite(Number(value))
  ? new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 }).format(Number(value))
  : 'No estimable';

const statusLabel = {
  GENERADO: 'Generado',
  REQUIERE_REVISION: 'Requiere revisión',
  REVISADO: 'Revisado',
  VALIDADO_POR_USUARIO: 'Validado por usuario'
};

function regionalLabel(apu) {
  const location = apu?.ubicacionEstructurada || {};
  const parts = [location.city, location.state, location.country].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Regional: sin dato';
}

export function ReviewStage({ project, user, apus = [], catalogConceptos = [], onOpenApu, onModelChange }) {
  const { t: tr } = useI18n();
  const [decisions, setDecisions] = useState([]);
  const [selectedApuId, setSelectedApuId] = useState(null);
  const [omittedCosts, setOmittedCosts] = useState(null);
  const [loadingDecisions, setLoadingDecisions] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadDecisions() {
      if (!project?.id || !user?.uid) {
        setDecisions([]);
        return;
      }
      setLoadingDecisions(true);
      const response = await apiGetSafe(`/api/challenge-decisions?projectId=${encodeURIComponent(project.id)}`);
      if (active) {
        setDecisions(response?.decisions || []);
        setLoadingDecisions(false);
      }
    }
    loadDecisions();
    return () => { active = false; };
  }, [project?.id, user?.uid]);

  const model = useMemo(() => computeReviewStageModel({
    projectId: project?.id,
    apus,
    catalogConceptos,
    decisions
  }), [project?.id, apus, catalogConceptos, decisions]);

  useEffect(() => {
    onModelChange?.(model);
  }, [model, onModelChange]);

  const selected = model.results.find(result => result.apuId === selectedApuId) || model.results[0] || null;

  async function handleAnalyzeOmittedCosts() {
    if (!selected) return;
    setOmittedCosts({ loading: true, result: null });
    try {
      setOmittedCosts({ loading: false, result: await analyzeOmittedCosts(selected) });
    } catch (error) {
      setOmittedCosts({ loading: false, result: null, error: error.message });
    }
  }

  return (
    <section className="project-stage-content review-stage">
      <div className="stage-placeholder-card">
        <div className="stage-placeholder-header">
          <div className="stage-placeholder-badge-wrap">
            <span className="stage-num-tag">Etapa 4</span>
            <span className={`stepper-status-badge badge-status-${model.status}`}>
              {tr(`workspace.status.${model.status}`) || (model.status === 'atencion' ? 'Atención' : model.status === 'completado' ? 'Completado' : 'Pendiente')}
            </span>
          </div>
          <div className="stage-placeholder-title-group">
            <div>
              <h2 className="stage-placeholder-h2">Revisión</h2>
              <p className="stage-placeholder-desc">Evaluación de los costos existentes, sin modificar cantidades ni P.U.</p>
            </div>
          </div>
        </div>

        <div className="stage-placeholder-context-grid review-stage-summary">
          <div className="stage-context-box"><span className="context-box-label">APUs revisables</span><span className="context-box-value">{model.reviewableCount}</span></div>
          <div className="stage-context-box"><span className="context-box-label">Confidence global</span><span className="context-box-value">{model.confidenceAverage == null ? 'Evidencia insuficiente' : `${model.confidenceAverage}%`}</span></div>
          <div className="stage-context-box"><span className="context-box-label">Riesgos CRITICAL/HIGH</span><span className="context-box-value">{(model.riskCounts.CRITICAL || 0) + (model.riskCounts.HIGH || 0)}</span></div>
          <div className="stage-context-box"><span className="context-box-label">Exposición estimada</span><span className="context-box-value">{money(model.estimatedExposure)}</span></div>
          <div className="stage-context-box"><span className="context-box-label">Challenges pendientes</span><span className="context-box-value">{model.pendingChallenges}</span></div>
          <div className="stage-context-box"><span className="context-box-label">Revisados / validados</span><span className="context-box-value">{model.reviewedCount} / {model.reviewableCount}</span></div>
        </div>

        {loadingDecisions && <p className="muted">Cargando decisiones persistidas…</p>}
        {model.engineErrors.length > 0 && (
          <div className="stage-placeholder-notice">
            Algunos motores no pudieron ejecutarse. La revisión permanece en Atención.
          </div>
        )}

        <div className="table-wrap cost-stage-table-wrap">
          <table className="data-table review-stage-table">
            <thead><tr><th>Concepto</th><th>Confidence</th><th>Bid Risk</th><th>Exposición</th><th>Auditoría</th><th>Challenges</th><th>Región</th><th>Revisión humana</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {model.results.map(result => {
                const confidence = result.confidence;
                const rowStatus = result.errors.length || result.criticalAuditFindings.length || result.pendingChallenges.length || result.hasHighOrCriticalRisk || !['REVISADO', 'VALIDADO_POR_USUARIO'].includes(result.humanStatus) ? 'atencion' : 'completado';
                return (
                  <tr key={result.apuId} className={selected?.apuId === result.apuId ? 'is-selected' : ''}>
                    <td>{result.concept}</td>
                    <td>{confidence?.score == null ? 'Evidencia insuficiente' : `${confidence.score}% ${confidence.status}`}</td>
                    <td>{result.riskSeverity || 'No estimable'}</td>
                    <td>{money(result.bidRisk?.estimatedExposure)}</td>
                    <td>{result.auditFindings.length ? `${result.auditFindings.length} hallazgo(s)` : 'Sin hallazgos'}</td>
                    <td>{result.pendingChallenges.length} pendiente(s)</td>
                    <td>{regionalLabel(result.apu)}</td>
                    <td>{statusLabel[result.humanStatus] || result.humanStatus}</td>
                    <td><span className={`badge-status-${rowStatus}`}>{rowStatus === 'completado' ? 'Completado' : 'Atención'}</span></td>
                    <td>
                      <button type="button" className="soft" onClick={() => setSelectedApuId(result.apuId)}>Ver detalle</button>
                      {result.apu?.id && <button type="button" className="soft" onClick={() => onOpenApu?.(result.apu)}>Abrir APU</button>}
                    </td>
                  </tr>
                );
              })}
              {!model.results.length && <tr><td colSpan="10" className="muted">No hay APUs costados/revisables para este proyecto.</td></tr>}
            </tbody>
          </table>
        </div>

        {selected && (
          <div className="review-stage-detail">
            <h3>{selected.concept}</h3>
            <div className="review-stage-detail-grid">
              <div><strong>Confidence</strong><p>{selected.confidence?.score == null ? 'INSUFFICIENT_EVIDENCE' : `${selected.confidence.score}% (${selected.confidence.status})`}</p></div>
              <div><strong>Auditoría</strong><p>{selected.auditFindings.map(finding => `${finding.severity}: ${finding.message}`).join(' · ') || 'Sin hallazgos actuales'}</p></div>
              <div><strong>Challenges</strong><p>{selected.challenges.map(challenge => `${challenge.id}: ${challenge.decision?.decision || 'sin decisión'}`).join(' · ') || 'Sin challenges'}</p></div>
              <div><strong>Bid Risk</strong><p>{selected.riskSeverity || 'No estimable'} · {money(selected.bidRisk?.estimatedExposure)}</p></div>
              <div><strong>Región</strong><p>{regionalLabel(selected.apu)}</p></div>
              <div><strong>Trazabilidad</strong><p>APU {selected.apu?.id || '—'} · versión {selected.apu?.currentVersion || selected.apu?.version || 'vigente'}</p></div>
            </div>
            <button type="button" className="soft" onClick={handleAnalyzeOmittedCosts} disabled={omittedCosts?.loading}>
              {omittedCosts?.loading ? 'Analizando…' : 'Analizar costos omitidos'}
            </button>
            {omittedCosts?.error && <p className="muted">{omittedCosts.error}</p>}
            {omittedCosts?.result && <p className="muted">{omittedCosts.result.hallazgos?.length ? `${omittedCosts.result.hallazgos.length} riesgo(s) potencial(es), no confirmados como costo.` : 'No se detectaron riesgos potenciales.'}</p>}
          </div>
        )}
      </div>
    </section>
  );
}

export default ReviewStage;
