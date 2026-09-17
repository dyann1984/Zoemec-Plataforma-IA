export const WORKSPACE_STAGE_KEYS = Object.freeze([
  'evidencia',
  'cuantificacion',
  'costos',
  'revision',
  'entrega'
]);

const STORAGE_PREFIX = 'zoemec-workspace-navigation';

export function normalizeWorkspaceStage(stage) {
  return WORKSPACE_STAGE_KEYS.includes(stage) ? stage : 'evidencia';
}

export function resolveWorkspaceNavigation(saved, projects = []) {
  if (saved?.module !== 'project-workspace' || !saved.activeProjectId) {
    return { restore: false, module: 'inicio', activeProjectId: null, selectedProjectStage: 'evidencia' };
  }
  if (!projects.some(project => project.id === saved.activeProjectId)) {
    return { restore: false, module: 'cartera', activeProjectId: null, selectedProjectStage: 'evidencia' };
  }
  return {
    restore: true,
    module: 'project-workspace',
    activeProjectId: saved.activeProjectId,
    selectedProjectStage: normalizeWorkspaceStage(saved.selectedProjectStage)
  };
}

function storageKey(uid, organizationId) {
  return `${STORAGE_PREFIX}:${uid}:${organizationId || 'personal'}`;
}

export function readWorkspaceNavigation(storage, uid, organizationId) {
  if (!storage || !uid) return null;
  try {
    const raw = storage.getItem(storageKey(uid, organizationId));
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    return {
      module: value.module === 'project-workspace' ? value.module : 'inicio',
      activeProjectId: typeof value.activeProjectId === 'string' && value.activeProjectId
        ? value.activeProjectId
        : null,
      selectedProjectStage: normalizeWorkspaceStage(value.selectedProjectStage)
    };
  } catch {
    return null;
  }
}

export function writeWorkspaceNavigation(storage, uid, organizationId, state) {
  if (!storage || !uid) return;
  const value = {
    module: state?.module === 'project-workspace' ? 'project-workspace' : 'inicio',
    activeProjectId: typeof state?.activeProjectId === 'string' && state.activeProjectId
      ? state.activeProjectId
      : null,
    selectedProjectStage: normalizeWorkspaceStage(state?.selectedProjectStage)
  };
  try {
    storage.setItem(storageKey(uid, organizationId), JSON.stringify(value));
  } catch {
    // Navigation persistence is best effort and must not block the app.
  }
}

export function clearWorkspaceNavigation(storage, uid, organizationId) {
  if (!storage || !uid) return;
  try {
    storage.removeItem(storageKey(uid, organizationId));
  } catch {
    // Navigation persistence is best effort and must not block logout.
  }
}
