import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { Section } from '../../components/ui/Section.jsx';
import { MetricCard } from '../../components/ui/MetricCard.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { LocationPicker } from '../../components/ui/LocationPicker.jsx';
import { validateProjectDraft } from '../../domain/projectDraftValidation.js';
import { hasAnyLocation, formatLocationDisplay } from '../../domain/geography.js';
import { computeBidReadiness } from '../../domain/bidReadiness.js';
import { exportProjectDossierPdf } from '../../lib/apuProjectDossierPdf.js';
import { exportProjectDossierExcel } from '../../lib/apuProjectDossierXlsx.js';
import ExplosionsPanel from '../explosions/ExplosionsPanel.jsx';
import { money } from '../../lib/apuExport.js';
import { uid } from '../../utils/id.js';

function formatRelativeTime(ts) {
  if (!ts) return null;
  const time = typeof ts === 'number' ? ts : ts?.toMillis ? ts.toMillis() : new Date(ts).getTime();
  if (Number.isNaN(time)) return null;

  const now = Date.now();
  const diffMs = now - time;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 2) return 'Hace unos momentos';
  if (diffMinutes < 60) return `Hace ${diffMinutes} min`;
  if (diffHours < 24) return `Hace ${diffHours} h`;
  if (diffDays === 1) return 'Ayer';
  if (diffDays < 7) return `Hace ${diffDays} d`;
  return new Date(time).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getProjectLastActivity(project, apus = [], budgets = []) {
  const projectApus = apus.filter(a => (a?.projectId ?? null) === project.id);
  const projectBudgets = budgets.filter(b => (b?.projectId ?? null) === project.id);

  const timestamps = [
    project.updatedAt?.toMillis?.() || (typeof project.updatedAt === 'number' ? project.updatedAt : null),
    project.createdAt?.toMillis?.() || (typeof project.createdAt === 'number' ? project.createdAt : null),
    ...projectApus.map(a => a?.updatedAt?.toMillis?.() || (typeof a?.updatedAt === 'number' ? a.updatedAt : null)),
    ...projectBudgets.map(b => b?.updatedAt?.toMillis?.() || (typeof b?.updatedAt === 'number' ? b.updatedAt : null)),
  ].filter(Boolean);

  if (!timestamps.length) {
    if (project.date) return project.date;
    return null;
  }

  const latest = Math.max(...timestamps);
  return formatRelativeTime(latest);
}

function getProjectIntelligence(project, apus = []) {
  const projectApus = apus.filter(a => (a?.projectId ?? null) === project.id);
  if (!projectApus.length) {
    return { confidence: null, risk: null, riskTone: 'neutral', confidenceTone: 'neutral' };
  }
  try {
    const readiness = computeBidReadiness(projectApus);
    const avgScore = readiness.confidenceProject?.averageScore;
    const confidence = avgScore != null ? Math.round(avgScore) : null;
    const confTone = confidence == null ? 'neutral' : confidence >= 70 ? 'good' : confidence >= 40 ? 'warn' : 'bad';

    const riskProj = readiness.riskProject;
    let risk = null;
    let rTone = 'neutral';
    if (riskProj) {
      if (riskProj.critical > 0) { risk = 'Crítico'; rTone = 'bad'; }
      else if (riskProj.high > 0) { risk = 'Alto'; rTone = 'bad'; }
      else if (riskProj.medium > 0) { risk = 'Medio'; rTone = 'warn'; }
      else { risk = 'Bajo'; rTone = 'good'; }
    }

    return { confidence, confidenceTone: confTone, risk, riskTone: rTone };
  } catch {
    return { confidence: null, risk: null, riskTone: 'neutral', confidenceTone: 'neutral' };
  }
}

function normalizeStatusClass(status = '') {
  const s = String(status).toLowerCase();
  if (s.includes('ejecuc') || s.includes('activo')) return 'active';
  if (s.includes('cotiz')) return 'quote';
  if (s.includes('cerrad') || s.includes('termin')) return 'closed';
  if (s.includes('paus')) return 'paused';
  return 'draft';
}

export function ProjectsView({
  projects = [],
  setProjects,
  clients = [],
  setClients,
  activeProjectId,
  setActiveProjectId,
  setModule,
  onOpenWorkspace,
  onDeleteProjectData,
  openCreateProject = false,
  onHandledCreateProject,
  apus = [],
  budgets = []
}) {
  const { t: tr } = useI18n();

  // Limpiar proyectos basura heredados
  useEffect(() => {
    const cleaned = projects.filter(p => !(p?.name === 'Nuevo proyecto' && p?.client === 'Cliente por definir' && Number(p?.budget || 0) === 0 && Number(p?.progress || 0) === 0));
    if (cleaned.length !== projects.length) setProjects(cleaned);
  }, [projects, setProjects]);

  const [currentTab, setCurrentTab] = useState('obras'); // 'obras' | 'clientes'
  const [filter, setFilter] = useState('todos'); // 'todos' | 'activos' | 'terminados'
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [startPrompt, setStartPrompt] = useState(false);

  // Clientes
  const [clientSearch, setClientSearch] = useState('');
  const [showClientForm, setShowClientForm] = useState(false);
  const [clientDraft, setClientDraft] = useState({ name: '', type: 'Empresa', contact: '', phone: '', email: '', rfc: '', status: 'Prospecto' });

  // Disparador exterior (Crear + -> Nueva obra)
  useEffect(() => {
    if (openCreateProject) {
      setCurrentTab('obras');
      setEditingId(null);
      setDraft({ name: '', client: '', ubicacion: '', locationCountry: '', locationState: '', locationCity: '', moneda: 'MXN', budget: '', progress: 0, status: 'Anteproyecto' });
      setFormErrors({});
      setShowForm(true);
      onHandledCreateProject?.();
    }
  }, [openCreateProject, onHandledCreateProject]);

  const [draft, setDraft] = useState({
    name: '',
    client: '',
    ubicacion: '',
    locationCountry: '',
    locationState: '',
    locationCity: '',
    moneda: 'MXN',
    budget: '',
    progress: 0,
    status: 'Anteproyecto'
  });
  const [formErrors, setFormErrors] = useState({});
  const nameInputRef = useRef(null);
  const clientInputRef = useRef(null);

  // Dossier y Explosiones
  const [dossierState, setDossierState] = useState(null);
  const [explosionsProjectId, setExplosionsProjectId] = useState(null);

  const generateProjectDossier = async (projectId, format) => {
    setDossierState({ projectId, format, status: 'generating' });
    try {
      const run = format === 'PDF' ? exportProjectDossierPdf : exportProjectDossierExcel;
      await run({ projectId });
      setDossierState(null);
    } catch (err) {
      setDossierState({ projectId, format, status: 'error', message: err.message });
    }
  };

  const handleOpenProject = (projectId) => {
    setActiveProjectId?.(projectId);
    if (onOpenWorkspace) {
      onOpenWorkspace(projectId);
    } else {
      setModule?.('project-workspace');
    }
  };

  const handleEditProject = (project) => {
    setEditingId(project.id);
    setDraft({
      name: project.name || '',
      client: project.client || '',
      ubicacion: project.ubicacion || '',
      locationCountry: project.locationCountry || '',
      locationState: project.locationState || '',
      locationCity: project.locationCity || '',
      moneda: project.moneda || 'MXN',
      budget: project.budget !== undefined ? String(project.budget) : '',
      progress: project.progress || 0,
      status: project.status || 'Anteproyecto'
    });
    setFormErrors({});
    setShowForm(true);
  };

  const handleNewProjectClick = () => {
    setEditingId(null);
    setDraft({ name: '', client: '', ubicacion: '', locationCountry: '', locationState: '', locationCity: '', moneda: 'MXN', budget: '', progress: 0, status: 'Anteproyecto' });
    setFormErrors({});
    setShowForm(true);
  };

  const clearDraft = () => {
    setDraft({ name: '', client: '', ubicacion: '', locationCountry: '', locationState: '', locationCity: '', moneda: 'MXN', budget: '', progress: 0, status: 'Anteproyecto' });
    setFormErrors({});
  };

  const saveProject = (e) => {
    e?.preventDefault?.();
    const errors = validateProjectDraft(draft);
    if (Object.keys(errors).length) {
      setFormErrors(errors);
      (errors.name ? nameInputRef : clientInputRef).current?.focus();
      return;
    }
    setFormErrors({});

    const hasStructuredLocation = hasAnyLocation({ country: draft.locationCountry, state: draft.locationState, city: draft.locationCity });
    const resolvedUbicacion = hasStructuredLocation
      ? (formatLocationDisplay({ country: draft.locationCountry, state: draft.locationState, city: draft.locationCity }) || '')
      : draft.ubicacion.trim();

    if (editingId) {
      // Editar existente
      setProjects(projects.map(p => p.id === editingId ? {
        ...p,
        name: draft.name.trim(),
        client: draft.client.trim(),
        ubicacion: resolvedUbicacion,
        locationCountry: draft.locationCountry || null,
        locationState: draft.locationState || null,
        locationCity: draft.locationCity || null,
        moneda: draft.moneda || 'MXN',
        progress: Number(draft.progress) || 0,
        budget: Number(draft.budget) || 0,
        status: draft.status || 'Anteproyecto',
        updatedAt: Date.now()
      } : p));
      setShowForm(false);
      setEditingId(null);
    } else {
      // Nuevo proyecto
      const next = {
        id: 'PRO-' + uid(),
        name: draft.name.trim(),
        client: draft.client.trim(),
        ubicacion: resolvedUbicacion,
        locationCountry: draft.locationCountry || null,
        locationState: draft.locationState || null,
        locationCity: draft.locationCity || null,
        moneda: draft.moneda || 'MXN',
        progress: Number(draft.progress) || 0,
        budget: Number(draft.budget) || 0,
        status: draft.status || 'Anteproyecto',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      setProjects([next, ...projects]);
      setActiveProjectId?.(next.id);
      clearDraft();
      setShowForm(false);
      setStartPrompt(true);
    }
  };

  const removeProject = (projectId) => {
    const p = projects.find(x => x.id === projectId);
    if (!p) return;
    if (!confirm(tr('projects.confirmDelete', { name: p.name || tr('projects.defaultProjectName') }))) return;
    setProjects(projects.filter(x => x.id !== projectId));
    if (projectId) onDeleteProjectData?.(projectId);
    if (projectId === activeProjectId) {
      const remaining = projects.find(x => x.id !== projectId);
      setActiveProjectId?.(remaining?.id || null);
    }
  };

  // Clientes: Guardar y Borrar
  const saveClient = () => {
    if (!clientDraft.name.trim() || !clientDraft.contact.trim()) {
      alert(tr('clients.requiredFieldsAlert'));
      return;
    }
    const next = {
      id: 'CLI-' + uid(),
      name: clientDraft.name.trim(),
      type: clientDraft.type,
      contact: clientDraft.contact.trim(),
      phone: clientDraft.phone.trim(),
      email: clientDraft.email.trim(),
      rfc: clientDraft.rfc.trim().toUpperCase(),
      projects: 0,
      budgets: 0,
      amount: 0,
      status: clientDraft.status
    };
    setClients([next, ...clients]);
    setClientDraft({ name: '', type: 'Empresa', contact: '', phone: '', email: '', rfc: '', status: 'Prospecto' });
    setShowClientForm(false);
  };

  const removeClient = (clientId) => {
    const c = clients.find(x => x.id === clientId);
    if (!c) return;
    if (!confirm(`¿Eliminar cliente "${c.name}"?`)) return;
    setClients(clients.filter(x => x.id !== clientId));
  };

  // Cálculos de métricas globales
  const activeCount = useMemo(() => {
    return projects.filter(p => {
      const s = String(p.status || '').toLowerCase();
      return !s.includes('cerrad') && !s.includes('termin');
    }).length;
  }, [projects]);

  const completedCount = useMemo(() => {
    return projects.filter(p => {
      const s = String(p.status || '').toLowerCase();
      return s.includes('cerrad') || s.includes('termin');
    }).length;
  }, [projects]);

  const totalBudget = useMemo(() => {
    return projects.reduce((sum, p) => sum + (Number(p.budget) || 0), 0);
  }, [projects]);

  // Filtrado de obras
  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter(p => {
      // Filtro de estado
      const s = String(p.status || '').toLowerCase();
      const isFinished = s.includes('cerrad') || s.includes('termin');
      if (filter === 'activos' && isFinished) return false;
      if (filter === 'terminados' && !isFinished) return false;

      // Buscador
      if (q) {
        const matchName = String(p.name || '').toLowerCase().includes(q);
        const matchClient = String(p.client || '').toLowerCase().includes(q);
        const matchUbicacion = String(p.ubicacion || '').toLowerCase().includes(q);
        if (!matchName && !matchClient && !matchUbicacion) return false;
      }
      return true;
    });
  }, [projects, filter, search]);

  // Filtrado de clientes
  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(c => {
      const matchName = String(c.name || '').toLowerCase().includes(q);
      const matchContact = String(c.contact || '').toLowerCase().includes(q);
      const matchEmail = String(c.email || '').toLowerCase().includes(q);
      const matchRfc = String(c.rfc || '').toLowerCase().includes(q);
      return matchName || matchContact || matchEmail || matchRfc;
    });
  }, [clients, clientSearch]);

  return (
    <div className="projects-view-container">
      {/* Encabezado principal */}
      <div className="projects-page-head">
        <div className="projects-page-titles">
          <h1>{tr('projects.pageTitle')}</h1>
          <p>{tr('projects.pageDesc')}</p>
        </div>
        <div className="projects-page-actions">
          {currentTab === 'obras' ? (
            <button type="button" className="btn-primary-action" onClick={handleNewProjectClick}>
              <Icon name="plus" size={16} />
              <span>{tr('projects.newProject').replace(/^\+\s*/, '')}</span>
            </button>
          ) : (
            <button type="button" className="btn-primary-action" onClick={() => setShowClientForm(true)}>
              <Icon name="plus" size={16} />
              <span>{tr('clients.newClient')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Resumen de métricas superiores */}
      <Section title={tr('projects.summaryTitle')} className="projects-summary-section">
        <div className="metric-row">
          <MetricCard
            label={tr('projects.metricTotal')}
            value={String(projects.length)}
            tone="neutral"
          />
          <MetricCard
            label={tr('projects.metricActive')}
            value={String(activeCount)}
            tone={activeCount > 0 ? 'good' : 'neutral'}
          />
          {totalBudget > 0 && (
            <MetricCard
              label={tr('projects.metricBudget')}
              value={money(totalBudget)}
              tone="neutral"
            />
          )}
          <MetricCard
            label={tr('projects.metricClients')}
            value={String(clients.length)}
            tone="neutral"
            onClick={() => setCurrentTab('clientes')}
          />
        </div>
      </Section>

      {/* Selector de pestaña Obras / Clientes */}
      <div className="projects-tabs-bar" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={currentTab === 'obras'}
          className={'projects-tab' + (currentTab === 'obras' ? ' active' : '')}
          onClick={() => setCurrentTab('obras')}
        >
          <Icon name="proyectos" size={16} />
          <span>{tr('projects.tabObras')} ({projects.length})</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={currentTab === 'clientes'}
          className={'projects-tab' + (currentTab === 'clientes' ? ' active' : '')}
          onClick={() => setCurrentTab('clientes')}
        >
          <Icon name="clientes" size={16} />
          <span>{tr('projects.tabClientes')} ({clients.length})</span>
        </button>
      </div>

      {/* PESTAÑA 1: OBRAS */}
      {currentTab === 'obras' && (
        <div className="projects-tab-content">
          {projects.length > 0 && (
            <div className="projects-toolbar">
              {/* Buscador */}
              <div className="projects-search-box">
                <Icon name="search" size={16} />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={tr('projects.searchPlaceholder')}
                  aria-label={tr('projects.searchPlaceholder')}
                />
                {search && (
                  <button type="button" className="btn-search-clear" onClick={() => setSearch('')} aria-label="Limpiar búsqueda">
                    ×
                  </button>
                )}
              </div>

              {/* Filtros simples */}
              <div className="projects-filters-group" role="group" aria-label="Filtro de obras">
                <button
                  type="button"
                  className={'filter-pill' + (filter === 'todos' ? ' active' : '')}
                  onClick={() => setFilter('todos')}
                >
                  {tr('projects.filterAll')} ({projects.length})
                </button>
                <button
                  type="button"
                  className={'filter-pill' + (filter === 'activos' ? ' active' : '')}
                  onClick={() => setFilter('activos')}
                >
                  {tr('projects.filterActive')} ({activeCount})
                </button>
                <button
                  type="button"
                  className={'filter-pill' + (filter === 'terminados' ? ' active' : '')}
                  onClick={() => setFilter('terminados')}
                >
                  {tr('projects.filterCompleted')} ({completedCount})
                </button>
              </div>
            </div>
          )}

          {/* Estado vacío si no hay proyectos */}
          {projects.length === 0 ? (
            <Card className="projects-empty-card">
              <div className="projects-empty-inner">
                <div className="projects-empty-icon">
                  <Icon name="proyectos" size={40} />
                </div>
                <h2>{tr('projects.emptyStateTitle')}</h2>
                <p>{tr('projects.emptyStateDesc')}</p>
                <button type="button" className="btn-primary-action" onClick={handleNewProjectClick}>
                  <Icon name="plus" size={16} />
                  <span>{tr('projects.emptyStateCta')}</span>
                </button>
              </div>
            </Card>
          ) : filteredProjects.length === 0 ? (
            /* Estado de sin resultados para búsqueda/filtro */
            <Card className="projects-empty-card">
              <div className="projects-empty-inner">
                <p>{tr('projects.noFilterResults')}</p>
                <button
                  type="button"
                  className="btn-secondary-action"
                  onClick={() => { setSearch(''); setFilter('todos'); }}
                >
                  {tr('projects.resetFilters')}
                </button>
              </div>
            </Card>
          ) : (
            /* Lista / cuadrícula de tarjetas limpias */
            <div className="projects-grid">
              {filteredProjects.map(p => {
                const isActive = p.id === activeProjectId;
                const lastActivity = getProjectLastActivity(p, apus, budgets) || tr('projects.lastActivityNone');
                const intelligence = getProjectIntelligence(p, apus);

                const projectBudget = Number(p.budget || 0);
                const projectBudgetsTotal = budgets
                  .filter(b => (b?.projectId ?? null) === p.id)
                  .reduce((sum, b) => sum + (Number(b.total) || 0), 0);
                const realBudget = projectBudget > 0 ? projectBudget : projectBudgetsTotal > 0 ? projectBudgetsTotal : null;

                const hasMetrics = realBudget !== null || intelligence.confidence !== null || intelligence.risk !== null;

                return (
                  <Card key={p.id} className={'project-clean-card' + (isActive ? ' is-active-card' : '')}>
                    {/* Encabezado de la tarjeta */}
                    <div className="project-card-header">
                      <div className="project-card-badges">
                        <span className={'project-status-pill status-' + normalizeStatusClass(p.status)}>
                          {p.status || 'Anteproyecto'}
                        </span>
                        {isActive && (
                          <span className="project-active-badge">
                            <span className="active-dot" />
                            {tr('projects.activeIndicator')}
                          </span>
                        )}
                      </div>
                      <div className="project-card-quick-actions">
                        <button
                          type="button"
                          className="btn-icon-subtle"
                          title="Editar obra"
                          onClick={() => handleEditProject(p)}
                          aria-label="Editar obra"
                        >
                          <Icon name="search" size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn-icon-subtle btn-delete-danger"
                          title={tr('projects.delete')}
                          onClick={() => removeProject(p.id)}
                          aria-label={tr('projects.delete')}
                        >
                          ×
                        </button>
                      </div>
                    </div>

                    {/* Título de la obra */}
                    <h3 className="project-card-title">{p.name}</h3>

                    {/* Metadatos ordenados */}
                    <div className="project-card-meta">
                      <div className="meta-row">
                        <span className="meta-label">{tr('projects.fieldClient')}:</span>
                        <span className="meta-value">{p.client || '—'}</span>
                      </div>
                      <div className="meta-row">
                        <span className="meta-label">{tr('projects.fieldLocation')}:</span>
                        <span className="meta-value">{p.ubicacion || '—'}</span>
                      </div>
                      <div className="meta-row">
                        <span className="meta-label">{tr('projects.lastActivity')}:</span>
                        <span className="meta-value">{lastActivity}</span>
                      </div>
                    </div>

                    {/* Métricas reales (solo cuando existen datos) */}
                    {hasMetrics && (
                      <div className="project-card-metrics-strip">
                        {realBudget !== null && (
                          <div className="meta-cell">
                            <small>{tr('projects.fieldBudget')}</small>
                            <b>{money(realBudget)}</b>
                          </div>
                        )}
                        {intelligence.confidence !== null && (
                          <div className="meta-cell">
                            <small>{tr('dash.metricConfidence')}</small>
                            <b className={'tone-' + intelligence.confidenceTone}>{intelligence.confidence}%</b>
                          </div>
                        )}
                        {intelligence.risk !== null && (
                          <div className="meta-cell">
                            <small>{tr('dash.metricRisk')}</small>
                            <b className={'tone-' + intelligence.riskTone}>{intelligence.risk}</b>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Pie de tarjeta con acción principal y herramientas secundarias */}
                    <div className="project-card-footer">
                      <button
                        type="button"
                        className="btn-open-project"
                        onClick={() => handleOpenProject(p.id)}
                      >
                        <span>{tr('projects.openProject')}</span>
                        <span className="arrow">→</span>
                      </button>

                      <div className="project-card-dossier-actions">
                        <button
                          type="button"
                          className="btn-export-tiny"
                          title={tr('projects.dossierPdf')}
                          disabled={dossierState?.projectId === p.id && dossierState?.status === 'generating'}
                          onClick={() => generateProjectDossier(p.id, 'PDF')}
                        >
                          {dossierState?.projectId === p.id && dossierState?.format === 'PDF' && dossierState?.status === 'generating' ? '...' : 'PDF'}
                        </button>
                        <button
                          type="button"
                          className="btn-export-tiny"
                          title={tr('projects.dossierExcel')}
                          disabled={dossierState?.projectId === p.id && dossierState?.status === 'generating'}
                          onClick={() => generateProjectDossier(p.id, 'XLSX')}
                        >
                          {dossierState?.projectId === p.id && dossierState?.format === 'XLSX' && dossierState?.status === 'generating' ? '...' : 'XLSX'}
                        </button>
                        <button
                          type="button"
                          className="btn-export-tiny"
                          title={tr('projects.explosionsButton')}
                          onClick={() => setExplosionsProjectId(p.id)}
                        >
                          <Icon name="costos" size={13} />
                        </button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* PESTAÑA 2: CLIENTES */}
      {currentTab === 'clientes' && (
        <div className="projects-tab-content">
          <div className="projects-toolbar">
            <div className="projects-search-box">
              <Icon name="search" size={16} />
              <input
                type="text"
                value={clientSearch}
                onChange={e => setClientSearch(e.target.value)}
                placeholder={tr('clients.searchPlaceholder')}
                aria-label={tr('clients.searchPlaceholder')}
              />
              {clientSearch && (
                <button type="button" className="btn-search-clear" onClick={() => setClientSearch('')}>
                  ×
                </button>
              )}
            </div>
          </div>

          {filteredClients.length === 0 ? (
            <Card className="projects-empty-card">
              <div className="projects-empty-inner">
                <p>No se encontraron clientes.</p>
                <button type="button" className="btn-primary-action" onClick={() => setShowClientForm(true)}>
                  <Icon name="plus" size={16} />
                  <span>{tr('clients.newClient')}</span>
                </button>
              </div>
            </Card>
          ) : (
            <div className="clients-grid-v2">
              {filteredClients.map(c => (
                <Card key={c.id} className="client-clean-card">
                  <div className="client-card-top">
                    <div className="client-avatar-v2">{(c.name || 'C')[0]?.toUpperCase()}</div>
                    <div className="client-titles">
                      <h4>{c.name}</h4>
                      <span className="client-type-badge">{c.type || 'Empresa'}</span>
                    </div>
                    <button
                      type="button"
                      className="btn-icon-subtle btn-delete-danger"
                      title="Eliminar cliente"
                      onClick={() => removeClient(c.id)}
                    >
                      ×
                    </button>
                  </div>
                  <div className="client-meta-list">
                    <div className="meta-row">
                      <span className="meta-label">{tr('clients.fieldContact')}:</span>
                      <span className="meta-value">{c.contact || '—'}</span>
                    </div>
                    {c.phone && (
                      <div className="meta-row">
                        <span className="meta-label">{tr('clients.fieldPhone')}:</span>
                        <span className="meta-value">{c.phone}</span>
                      </div>
                    )}
                    {c.email && (
                      <div className="meta-row">
                        <span className="meta-label">{tr('clients.fieldEmail')}:</span>
                        <span className="meta-value">{c.email}</span>
                      </div>
                    )}
                    {c.rfc && (
                      <div className="meta-row">
                        <span className="meta-label">{tr('clients.fieldRfc')}:</span>
                        <span className="meta-value">{c.rfc}</span>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODAL: NUEVO / EDITAR PROYECTO */}
      {showForm && (
        <div className="record-modal projects-modal" role="dialog" aria-modal="true">
          <div className="record-backdrop" onClick={() => setShowForm(false)} />
          <div className="record-form project-form-v2">
            <div className="record-form-head">
              <div>
                <span>{tr('projects.formEyebrow')}</span>
                <h2>{editingId ? tr('projects.editProject') : tr('projects.formTitle')}</h2>
              </div>
              <button type="button" className="btn-close-modal" onClick={() => setShowForm(false)} aria-label={tr('projects.cancel')}>
                ×
              </button>
            </div>

            <form onSubmit={saveProject} noValidate>
              <div className="field-grid">
                <div className={`nf${formErrors.name ? ' has-error' : ''}`}>
                  <label>{tr('projects.fieldName')}</label>
                  <input
                    ref={nameInputRef}
                    value={draft.name}
                    onChange={e => {
                      setDraft({ ...draft, name: e.target.value });
                      if (formErrors.name) setFormErrors({ ...formErrors, name: undefined });
                    }}
                    placeholder={tr('projects.fieldNamePlaceholder')}
                    aria-required="true"
                    aria-invalid={!!formErrors.name}
                  />
                  {formErrors.name && <span className="nf-error-msg">{formErrors.name}</span>}
                </div>

                <div className={`nf${formErrors.client ? ' has-error' : ''}`}>
                  <label>{tr('projects.fieldClient')}</label>
                  <input
                    ref={clientInputRef}
                    value={draft.client}
                    onChange={e => {
                      setDraft({ ...draft, client: e.target.value });
                      if (formErrors.client) setFormErrors({ ...formErrors, client: undefined });
                    }}
                    placeholder={tr('projects.fieldClientPlaceholder')}
                    aria-required="true"
                    aria-invalid={!!formErrors.client}
                  />
                  {formErrors.client && <span className="nf-error-msg">{formErrors.client}</span>}
                </div>

                <LocationPicker
                  country={draft.locationCountry}
                  state={draft.locationState}
                  city={draft.locationCity}
                  onChange={({ country, state, city }) => setDraft({ ...draft, locationCountry: country, locationState: state, locationCity: city })}
                />

                <div className="nf">
                  <label>{tr('projects.fieldCurrency')}</label>
                  <select value={draft.moneda} onChange={e => setDraft({ ...draft, moneda: e.target.value })}>
                    <option>MXN</option>
                    <option>USD</option>
                  </select>
                </div>

                <div className="nf">
                  <label>{tr('projects.fieldBudget')}</label>
                  <input
                    type="number"
                    value={draft.budget}
                    onChange={e => setDraft({ ...draft, budget: e.target.value })}
                    placeholder="0.00"
                  />
                </div>

                <div className="nf">
                  <label>{tr('projects.fieldStatus')}</label>
                  <select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}>
                    <option>Anteproyecto</option>
                    <option>Cotizacion</option>
                    <option>En ejecucion</option>
                    <option>Pausado</option>
                    <option>Cerrado</option>
                  </select>
                </div>

                <div className="nf wide">
                  <label>{tr('projects.fieldProgress', { pct: draft.progress })}</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={draft.progress}
                    onChange={e => setDraft({ ...draft, progress: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-actions-v2">
                <button type="button" className="btn-secondary-action" onClick={clearDraft}>
                  {tr('projects.clear')}
                </button>
                <button type="button" className="btn-secondary-action" onClick={() => setShowForm(false)}>
                  {tr('projects.cancel')}
                </button>
                <button type="submit" className="btn-primary-action">
                  {editingId ? tr('projects.saveChanges') : tr('projects.createAndStart')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: PROYECTO CREADO */}
      {startPrompt && (
        <div className="record-modal" role="dialog" aria-modal="true">
          <div className="record-backdrop" onClick={() => setStartPrompt(false)} />
          <div className="record-form start-prompt-form">
            <h2>{tr('projects.createdTitle')}</h2>
            <p className="muted">{tr('projects.createdDesc')}</p>
            <div className="form-actions-v2" style={{ justifyContent: 'center' }}>
              <button
                type="button"
                className="btn-primary-action"
                onClick={() => { setStartPrompt(false); setModule?.('apu'); }}
              >
                {tr('projects.pasteConcept')}
              </button>
              <button
                type="button"
                className="btn-secondary-action"
                onClick={() => { setStartPrompt(false); setModule?.('apu'); }}
              >
                {tr('projects.importExcel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: NUEVO CLIENTE */}
      {showClientForm && (
        <div className="record-modal" role="dialog" aria-modal="true">
          <div className="record-backdrop" onClick={() => setShowClientForm(false)} />
          <div className="record-form client-form-v2">
            <div className="record-form-head">
              <div>
                <span>{tr('clients.formEyebrow')}</span>
                <h2>{tr('clients.formTitle')}</h2>
              </div>
              <button type="button" className="btn-close-modal" onClick={() => setShowClientForm(false)}>
                ×
              </button>
            </div>

            <div className="field-grid">
              <div className="nf">
                <label>{tr('clients.fieldName')}</label>
                <input value={clientDraft.name} onChange={e => setClientDraft({ ...clientDraft, name: e.target.value })} placeholder={tr('clients.fieldNamePlaceholder')} />
              </div>
              <div className="nf">
                <label>{tr('clients.fieldType')}</label>
                <select value={clientDraft.type} onChange={e => setClientDraft({ ...clientDraft, type: e.target.value })}>
                  <option>Empresa</option>
                  <option>Gobierno</option>
                  <option>Particular</option>
                  <option>Proveedor</option>
                </select>
              </div>
              <div className="nf">
                <label>{tr('clients.fieldContact')}</label>
                <input value={clientDraft.contact} onChange={e => setClientDraft({ ...clientDraft, contact: e.target.value })} placeholder={tr('clients.fieldContactPlaceholder')} />
              </div>
              <div className="nf">
                <label>{tr('clients.fieldPhone')}</label>
                <input value={clientDraft.phone} onChange={e => setClientDraft({ ...clientDraft, phone: e.target.value })} placeholder={tr('clients.fieldPhonePlaceholder')} />
              </div>
              <div className="nf">
                <label>{tr('clients.fieldEmail')}</label>
                <input type="email" value={clientDraft.email} onChange={e => setClientDraft({ ...clientDraft, email: e.target.value })} placeholder={tr('clients.fieldEmailPlaceholder')} />
              </div>
              <div className="nf">
                <label>{tr('clients.fieldRfc')}</label>
                <input value={clientDraft.rfc} onChange={e => setClientDraft({ ...clientDraft, rfc: e.target.value })} placeholder={tr('clients.fieldRfcPlaceholder')} />
              </div>
              <div className="nf">
                <label>{tr('clients.fieldStatus')}</label>
                <select value={clientDraft.status} onChange={e => setClientDraft({ ...clientDraft, status: e.target.value })}>
                  <option>Prospecto</option>
                  <option>Activo</option>
                  <option>En seguimiento</option>
                  <option>Inactivo</option>
                </select>
              </div>
            </div>

            <div className="form-actions-v2">
              <button
                type="button"
                className="btn-secondary-action"
                onClick={() => setClientDraft({ name: '', type: 'Empresa', contact: '', phone: '', email: '', rfc: '', status: 'Prospecto' })}
              >
                {tr('projects.clear')}
              </button>
              <button type="button" className="btn-secondary-action" onClick={() => setShowClientForm(false)}>
                {tr('projects.cancel')}
              </button>
              <button type="button" className="btn-primary-action" onClick={saveClient}>
                {tr('clients.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Panel de explosiones */}
      {explosionsProjectId && (
        <ExplosionsPanel projectId={explosionsProjectId} onClose={() => setExplosionsProjectId(null)} />
      )}
    </div>
  );
}
