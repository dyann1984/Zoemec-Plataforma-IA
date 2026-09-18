import React, { useState } from 'react';
import { useI18n } from '../../../i18n/I18nContext.jsx';
import { Icon } from '../../../components/ui/Icon.jsx';
import { EVIDENCE_TYPE, ANALYSIS_STATUS } from './evidenceAdapter.js';
import { Model3DPreview } from '../../levantamiento/Model3DPreview.jsx';

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatRelativeDate(ts, tr) {
  if (!ts) return '';
  const diffMs = Date.now() - Number(ts);
  if (diffMs < 0 || !Number.isFinite(diffMs)) return '';
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMin < 2) return tr('workspace.time.justNow') || 'Justo ahora';
  if (diffMin < 60) return tr('workspace.time.minutesAgo', { count: diffMin }) || `hace ${diffMin} min`;
  if (diffHours < 24) return tr('workspace.time.hoursAgo', { count: diffHours }) || `hace ${diffHours} h`;
  if (diffDays === 1) return tr('workspace.time.yesterday') || 'Ayer';
  if (diffDays < 30) return tr('workspace.time.daysAgo', { count: diffDays }) || `hace ${diffDays} d`;
  return new Date(ts).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function EvidenceGallery({
  records = [],
  onDeleteRecord,
  onNavigateToPlano,
  onNavigateToLevantamiento
}) {
  const { t: tr } = useI18n();
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [previewItem, setPreviewItem] = useState(null);

  const filters = [
    { id: 'all', label: tr('evidence.filterAll') || 'Todos' },
    { id: EVIDENCE_TYPE.PHOTO, label: tr('evidence.filterPhotos') || 'Fotos' },
    { id: EVIDENCE_TYPE.VIDEO, label: tr('evidence.filterVideos') || 'Videos' },
    { id: EVIDENCE_TYPE.PLANO, label: tr('evidence.filterPlanos') || 'Planos' },
    { id: EVIDENCE_TYPE.MODEL_3D, label: tr('evidence.filter3D') || 'Modelos 3D' },
    { id: EVIDENCE_TYPE.SURVEY, label: tr('evidence.filterSurveys') || 'Levantamientos' }
  ];

  const filteredRecords = records.filter(rec => {
    if (activeFilter !== 'all' && rec.type !== activeFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      return rec.name.toLowerCase().includes(q);
    }
    return true;
  });

  const getBadgeClass = (type) => {
    switch (type) {
      case EVIDENCE_TYPE.PHOTO: return 'badge-type-photo';
      case EVIDENCE_TYPE.VIDEO: return 'badge-type-video';
      case EVIDENCE_TYPE.PLANO: return 'badge-type-plano';
      case EVIDENCE_TYPE.MODEL_3D: return 'badge-type-3d';
      case EVIDENCE_TYPE.SURVEY: return 'badge-type-survey';
      default: return 'badge-type-default';
    }
  };

  const getTypeLabel = (type) => {
    switch (type) {
      case EVIDENCE_TYPE.PHOTO: return 'Foto';
      case EVIDENCE_TYPE.VIDEO: return 'Video';
      case EVIDENCE_TYPE.PLANO: return 'Plano PDF';
      case EVIDENCE_TYPE.MODEL_3D: return 'Modelo 3D';
      case EVIDENCE_TYPE.SURVEY: return 'Levantamiento';
      default: return 'Archivo';
    }
  };

  const getAnalysisStatusPill = (status) => {
    switch (status) {
      case ANALYSIS_STATUS.ANALYZED:
        return <span className="pill-status status-analyzed">{tr('evidence.statusAnalyzed') || 'Analizado'}</span>;
      case ANALYSIS_STATUS.IN_PROGRESS:
        return <span className="pill-status status-processing">{tr('evidence.statusProcessing') || 'En proceso'}</span>;
      default:
        return <span className="pill-status status-pending">{tr('evidence.statusPending') || 'Sin analizar'}</span>;
    }
  };

  return (
    <div className="evidence-gallery-container">
      <div className="gallery-toolbar">
        <div className="gallery-filters" role="tablist">
          {filters.map(f => (
            <button
              key={f.id}
              type="button"
              className={`gallery-filter-btn ${activeFilter === f.id ? 'active' : ''}`}
              onClick={() => setActiveFilter(f.id)}
            >
              {f.label}
              {f.id === 'all' && <span className="filter-count">{records.length}</span>}
            </button>
          ))}
        </div>

        <div className="gallery-search">
          <Icon name="search" size={15} />
          <input
            type="text"
            placeholder={tr('evidence.searchPlaceholder') || 'Buscar evidencia por nombre...'}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button type="button" className="clear-search-btn" onClick={() => setSearchQuery('')}>×</button>
          )}
        </div>
      </div>

      {filteredRecords.length === 0 ? (
        <div className="gallery-empty-state">
          <div className="empty-icon-wrap">
            <Icon name="folder" size={36} />
          </div>
          <h3>{tr('evidence.emptyTitle') || 'Sin evidencias en esta sección'}</h3>
          <p className="muted">
            {records.length === 0
              ? (tr('evidence.emptyDesc') || 'Aún no hay archivos cargados en este proyecto. Utiliza los botones superiores para registrar fotos, videos, planos o modelos 3D.')
              : (tr('evidence.emptyFilterDesc') || 'No se encontraron registros con el filtro seleccionado.')}
          </p>
        </div>
      ) : (
        <div className="evidence-grid">
          {filteredRecords.map(rec => (
            <div key={rec.id} className="evidence-card">
              <div className="evidence-card-thumb" onClick={() => setPreviewItem(rec)}>
                {rec.preview ? (
                  rec.type === EVIDENCE_TYPE.VIDEO ? (
                    <video src={rec.preview} className="thumb-media" preload="metadata" />
                  ) : (
                    <img src={rec.preview} alt={rec.name} className="thumb-media" />
                  )
                ) : (
                  <div className={`thumb-fallback fallback-${rec.type}`}>
                    <Icon
                      name={
                        rec.type === EVIDENCE_TYPE.PHOTO ? 'camera'
                        : rec.type === EVIDENCE_TYPE.VIDEO ? 'play'
                        : rec.type === EVIDENCE_TYPE.PLANO ? 'plano'
                        : rec.type === EVIDENCE_TYPE.MODEL_3D ? 'bim'
                        : 'proyectos'
                      }
                      size={32}
                    />
                  </div>
                )}
                <span className={`evidence-type-badge ${getBadgeClass(rec.type)}`}>
                  {getTypeLabel(rec.type)}
                </span>
              </div>

              <div className="evidence-card-body">
                <h4 className="evidence-card-title" title={rec.name}>{rec.name}</h4>
                <div className="evidence-card-meta">
                  <span className="meta-time">{formatRelativeDate(rec.createdAt, tr)}</span>
                  {rec.sizeBytes > 0 && (
                    <>
                      <span className="meta-dot">•</span>
                      <span className="meta-size">{formatFileSize(rec.sizeBytes)}</span>
                    </>
                  )}
                  {rec.metadata?.durationSeconds && (
                    <>
                      <span className="meta-dot">•</span>
                      <span className="meta-duration">{Math.round(rec.metadata.durationSeconds)}s</span>
                    </>
                  )}
                </div>

                <div className="evidence-card-status-row">
                  {getAnalysisStatusPill(rec.analysisStatus)}
                  <span className="meta-source-label">
                    {rec.source === 'survey' ? 'Levantamiento IA' : rec.source === 'plano' ? 'Visual / Plano' : 'Directa'}
                  </span>
                </div>
              </div>

              <div className="evidence-card-actions">
                <button
                  type="button"
                  className="btn-card-action btn-view"
                  onClick={() => setPreviewItem(rec)}
                >
                  <Icon name="eye" size={14} />
                  <span>{tr('evidence.actionView') || 'Ver'}</span>
                </button>

                {rec.type === EVIDENCE_TYPE.PLANO && (
                  <button
                    type="button"
                    className="btn-card-action btn-link-action"
                    onClick={() => onNavigateToPlano?.(rec.sourceRecordId)}
                    title="Abrir en espacio de cuantificación de planos"
                  >
                    <span>{tr('evidence.openInPlano') || 'Analizar plano'}</span>
                  </button>
                )}

                {rec.type === EVIDENCE_TYPE.SURVEY && (
                  <button
                    type="button"
                    className="btn-card-action btn-link-action"
                    onClick={() => onNavigateToLevantamiento?.(rec.sourceRecordId)}
                    title="Abrir detalles de levantamiento y espacios"
                  >
                    <span>{tr('evidence.openInSurvey') || 'Ver espacios'}</span>
                  </button>
                )}

                {onDeleteRecord && (
                  <button
                    type="button"
                    className="btn-card-delete"
                    onClick={() => onDeleteRecord(rec)}
                    title={tr('evidence.actionDelete') || 'Eliminar'}
                    aria-label="Eliminar evidencia"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de visualización previa */}
      {previewItem && (
        <div className="record-modal preview-modal-overlay" role="dialog" aria-modal="true">
          <div className="record-backdrop" onClick={() => setPreviewItem(null)} aria-hidden="true" />
          <div className="panel preview-modal-panel">
            <div className="preview-modal-head">
              <div className="preview-modal-title">
                <span className={`evidence-type-badge ${getBadgeClass(previewItem.type)}`}>
                  {getTypeLabel(previewItem.type)}
                </span>
                <b>{previewItem.name}</b>
              </div>
              <button
                type="button"
                className="btn-close-modal"
                onClick={() => setPreviewItem(null)}
              >
                ×
              </button>
            </div>

            <div className="preview-modal-content">
              {previewItem.type === EVIDENCE_TYPE.PHOTO && (
                <div className="preview-media-wrapper">
                  <img
                    src={previewItem.preview || previewItem.storagePath}
                    alt={previewItem.name}
                    className="full-preview-image"
                  />
                </div>
              )}

              {previewItem.type === EVIDENCE_TYPE.VIDEO && (
                <div className="preview-media-wrapper">
                  <video
                    src={previewItem.preview || previewItem.storagePath}
                    controls
                    autoPlay
                    className="full-preview-video"
                  />
                </div>
              )}

              {previewItem.type === EVIDENCE_TYPE.MODEL_3D && (
                <div className="preview-3d-wrapper">
                  {previewItem.metadata?.rawObject3D ? (
                    <Model3DPreview
                      object3D={previewItem.metadata.rawObject3D}
                      boundingBox={previewItem.metadata.boundingBox}
                    />
                  ) : (
                    <div className="preview-3d-placeholder">
                      <Icon name="bim" size={48} />
                      <p>Modelo 3D vinculado al proyecto.</p>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => {
                          setPreviewItem(null);
                          onNavigateToLevantamiento?.(previewItem.sourceRecordId);
                        }}
                      >
                        Abrir en visor 3D de Levantamiento
                      </button>
                    </div>
                  )}
                </div>
              )}

              {previewItem.type === EVIDENCE_TYPE.PLANO && (
                <div className="preview-plano-wrapper">
                  {previewItem.preview ? (
                    <img src={previewItem.preview} alt={previewItem.name} className="full-preview-image" />
                  ) : (
                    <div className="preview-plano-info">
                      <Icon name="plano" size={48} />
                      <h4>{previewItem.name}</h4>
                      <p className="muted">
                        {previewItem.metadata?.numPages || 1} página(s) • {previewItem.metadata?.elementCount || 0} elemento(s) cuantificados.
                      </p>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => {
                          setPreviewItem(null);
                          onNavigateToPlano?.(previewItem.sourceRecordId);
                        }}
                      >
                        Abrir en espacio de cuantificación vectorial
                      </button>
                    </div>
                  )}
                </div>
              )}

              {previewItem.type === EVIDENCE_TYPE.SURVEY && (
                <div className="preview-survey-wrapper">
                  <Icon name="proyectos" size={48} />
                  <h4>{previewItem.name}</h4>
                  <p className="muted">
                    {previewItem.metadata?.spacesCount || 0} espacio(s) capturados • {previewItem.metadata?.mediaCount || 0} archivo(s) de escaneo.
                  </p>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => {
                      setPreviewItem(null);
                      onNavigateToLevantamiento?.(previewItem.sourceRecordId);
                    }}
                  >
                    Ver detalle completo en Levantamiento IA
                  </button>
                </div>
              )}
            </div>

            <div className="preview-modal-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setPreviewItem(null)}
              >
                {tr('evidence.actionClose') || 'Cerrar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
