import React, { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../i18n/I18nContext.jsx';
import { apiGetSafe } from '../../../services/apiClient.js';
import { analyzeOmittedCosts, computeReviewStageModel } from './reviewStageModel.js';

const money = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
  ? new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 }).format(Number(value))
  : null;

function regionalLabel(apu, tr) {
  const location = apu?.ubicacionEstructurada || {};
  const parts = [location.city, location.state, location.country].filter(Boolean);
  return parts.length ? parts.join(', ') : tr('reviewStage.regionNoData');
}

export function ReviewStage({ project, user, apus = [], catalogConceptos = [], onOpenApu, onModelChange }) {
  const { t: tr } = useI18n();
  const money2 = value => money(value) ?? tr('reviewStage.notEstimable');
  const statusLabel = {
    GENERADO: tr('reviewStage.statusGenerado'),
    REQUIERE_REVISION: tr('reviewStage.statusRequiereRevision'),
    REVISADO: tr('reviewStage.statusRevisado'),
    VALIDADO_POR_USUARIO: tr('reviewStage.statusValidado')
  };
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
            <span className="stage-num-tag">{tr('reviewStage.stageTag')}</span>
            <span className={`stepper-status-badge badge-status-${model.status}`}>
              {tr(`workspace.status.${model.status}`)}
            </span>
          </div>
          <div className="stage-placeholder-title-group">
            <div>
              <h2 className="stage-placeholder-h2">{tr('reviewStage.title')}</h2>
              <p className="stage-placeholder-desc">{tr('reviewStage.description')}</p>
            </div>
          </div>
        </div>

        <div className="stage-placeholder-context-grid review-stage-summary">
          <div className="stage-context-box"><span className="context-box-label">{tr('reviewStage.reviewableApus')}</span><span className="context-box-value">{model.reviewableCount}</span></div>
          <div className="stage-context-box"><span className="context-box-label">{tr('reviewStage.confidenceGlobal')}</span><span className="context-box-value">{model.confidenceAverage == null ? tr('reviewStage.insufficientEvidence') : `${model.confidenceAverage}%`}</span></div>
          <div className="stage-context-box"><span className="context-box-label">{tr('reviewStage.risksCriticalHigh')}</span><span className="context-box-value">{(model.riskCounts.CRITICAL || 0) + (model.riskCounts.HIGH || 0)}</span></div>
          <div className="stage-context-box"><span className="context-box-label">{tr('reviewStage.estimatedExposure')}</span><span className="context-box-value">{money2(model.estimatedExposure)}</span></div>
          <div className="stage-context-box"><span className="context-box-label">{tr('reviewStage.pendingChallenges')}</span><span className="context-box-value">{model.pendingChallenges}</span></div>
          <div className="stage-context-box"><span className="context-box-label">{tr('reviewStage.reviewedValidated')}</span><span className="context-box-value">{model.reviewedCount} / {model.reviewableCount}</span></div>
        </div>

        {loadingDecisions && <p className="muted">{tr('reviewStage.loadingDecisions')}</p>}
        {model.engineErrors.length > 0 && (
          <div className="stage-placeholder-notice">
            {tr('reviewStage.engineErrorsNotice')}
          </div>
        )}

        <div className="table-wrap cost-stage-table-wrap">
          <table className="data-table review-stage-table">
            <thead>
              <tr>
                <th>{tr('reviewStage.colConcept')}</th>
                <th>{tr('reviewStage.colConfidence')}</th>
                <th>{tr('reviewStage.colBidRisk')}</th>
                <th>{tr('reviewStage.colExposure')}</th>
                <th>{tr('reviewStage.colAudit')}</th>
                <th>{tr('reviewStage.colChallenges')}</th>
                <th>{tr('reviewStage.colRegion')}</th>
                <th>{tr('reviewStage.colHumanReview')}</th>
                <th>{tr('reviewStage.colStatus')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {model.results.map(result => {
                const confidence = result.confidence;
                const isHumanReviewed = ['REVISADO', 'VALIDADO_POR_USUARIO'].includes(result.humanStatus);
                const hasUnreviewedRisk = result.hasHighOrCriticalRisk && !isHumanReviewed;
                const confidenceNeedsAttention = ['LOW', 'INSUFFICIENT_EVIDENCE'].includes(result.confidence?.status);

                const rowStatus =
                  result.errors.length ||
                  result.criticalAuditFindings.length ||
                  result.pendingChallenges.length ||
                  hasUnreviewedRisk ||
                  !isHumanReviewed ||
                  confidenceNeedsAttention
                    ? 'atencion'
                    : 'completado';
                return (
                  <tr key={result.apuId} className={selected?.apuId === result.apuId ? 'is-selected' : ''}>
                    <td>{result.concept}</td>
                    <td>{confidence?.score == null ? tr('reviewStage.insufficientEvidence') : `${confidence.score}% ${confidence.status}`}</td>
                    <td>{result.riskSeverity || tr('reviewStage.notEstimable')}</td>
                    <td>{money2(result.bidRisk?.estimatedExposure)}</td>
                    <td>{result.auditFindings.length ? tr('reviewStage.findingsCount', { count: result.auditFindings.length }) : tr('reviewStage.noFindings')}</td>
                    <td>{tr('reviewStage.pendingCount', { count: result.pendingChallenges.length })}</td>
                    <td>{regionalLabel(result.apu, tr)}</td>
                    <td>{statusLabel[result.humanStatus] || result.humanStatus}</td>
                    <td><span className={`badge-status-${rowStatus}`}>{tr(`workspace.status.${rowStatus}`)}</span></td>
                    <td>
                      <button type="button" className="soft" onClick={() => setSelectedApuId(result.apuId)}>{tr('reviewStage.viewDetail')}</button>
                      {result.apu?.id && <button type="button" className="soft" onClick={() => onOpenApu?.(result.apu)}>{tr('reviewStage.openApu')}</button>}
                    </td>
                  </tr>
                );
              })}
              {!model.results.length && <tr><td colSpan="10" className="muted">{tr('reviewStage.noReviewableApus')}</td></tr>}
            </tbody>
          </table>
        </div>

        {selected && (
          <div className="review-stage-detail">
            <h3>{selected.concept}</h3>
            <div className="review-stage-detail-grid">
              <div><strong>{tr('reviewStage.detailConfidence')}</strong><p>{selected.confidence?.score == null ? 'INSUFFICIENT_EVIDENCE' : `${selected.confidence.score}% (${selected.confidence.status})`}</p></div>
              <div><strong>{tr('reviewStage.detailAudit')}</strong><p>{selected.auditFindings.map(finding => `${finding.severity}: ${finding.message}`).join(' · ') || tr('reviewStage.detailNoCurrentFindings')}</p></div>
              <div><strong>{tr('reviewStage.detailChallenges')}</strong><p>{selected.challenges.map(challenge => `${challenge.id}: ${challenge.decision?.decision || tr('reviewStage.detailNoDecision')}`).join(' · ') || tr('reviewStage.detailNoChallenges')}</p></div>
              <div><strong>{tr('reviewStage.detailBidRisk')}</strong><p>{selected.riskSeverity || tr('reviewStage.notEstimable')} · {money2(selected.bidRisk?.estimatedExposure)}</p></div>
              <div><strong>{tr('reviewStage.detailRegion')}</strong><p>{regionalLabel(selected.apu, tr)}</p></div>
              <div><strong>{tr('reviewStage.detailTraceability')}</strong><p>{tr('reviewStage.traceabilityLine', { apuId: selected.apu?.id || '—', version: selected.apu?.currentVersion || selected.apu?.version || tr('reviewStage.currentVersionFallback') })}</p></div>
            </div>
            <button type="button" className="soft" onClick={handleAnalyzeOmittedCosts} disabled={omittedCosts?.loading}>
              {omittedCosts?.loading ? tr('reviewStage.analyzing') : tr('reviewStage.analyzeOmittedCosts')}
            </button>
            {omittedCosts?.error && <p className="muted">{omittedCosts.error}</p>}
            {omittedCosts?.result && (
              <p className="muted">
                {omittedCosts.result.hallazgos?.length
                  ? tr('reviewStage.omittedRisksFound', { count: omittedCosts.result.hallazgos.length })
                  : tr('reviewStage.omittedRisksNone')}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export default ReviewStage;
