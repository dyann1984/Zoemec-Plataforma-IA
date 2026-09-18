function clean(value) {
  return String(value ?? '').trim();
}

function eventTime(event) {
  const time = Date.parse(event?.timestamp || '');
  return Number.isFinite(time) ? time : 0;
}

function normalizeVersionIds(values = []) {
  return (Array.isArray(values) ? values : [])
    .map(clean)
    .filter(Boolean)
    .sort();
}

function sameVersionSet(left = [], right = []) {
  const a = normalizeVersionIds(left);
  const b = normalizeVersionIds(right);

  if (a.length !== b.length) return false;

  return a.every((value, index) => value === b[index]);
}

function versionIdForApu(apu) {
  const id = clean(apu?.id || apu?.apuId);
  if (!id) return null;

  const version = clean(apu?.currentVersion) || 'SIN_VERSION';
  return `${id}@${version}`;
}

export function computeDeliveryStageModel({
  projectId,
  apuDocs = [],
  exportEvents = []
} = {}) {
  const pid = clean(projectId);

  if (!pid) {
    return {
      projectId: null,
      status: 'pendiente',
      apuCount: 0,
      currentVersionIds: [],
      projectExports: [],
      currentExports: [],
      currentFormats: [],
      lastExport: null,
      lastCurrentExport: null,
      neverExported: false,
      isStale: false,
      reason: 'PROJECT_REQUIRED'
    };
  }

  const projectApus = (Array.isArray(apuDocs) ? apuDocs : [])
    .filter(apu => {
      const apuProjectId = clean(apu?.projectId ?? apu?.snapshot?.projectId);
      return apuProjectId === pid && !apu?.archivedAt;
    });

  const currentVersionIds = projectApus
    .map(versionIdForApu)
    .filter(Boolean)
    .sort();

  const projectExports = (Array.isArray(exportEvents) ? exportEvents : [])
    .filter(event =>
      event?.scope === 'PROJECT' &&
      clean(event?.projectId) === pid &&
      ['PDF', 'XLSX'].includes(event?.format)
    )
    .sort((a, b) => eventTime(b) - eventTime(a));

  const currentExports = projectExports
    .filter(event => sameVersionSet(event?.apuVersionIds, currentVersionIds));

  const currentFormats = [...new Set(
    currentExports
      .map(event => event?.format)
      .filter(format => ['PDF', 'XLSX'].includes(format))
  )];

  const lastExport = projectExports[0] || null;
  const lastCurrentExport = [...currentExports]
    .sort((a, b) => eventTime(b) - eventTime(a))[0] || null;

  const hasApus = currentVersionIds.length > 0;
  const neverExported = hasApus && projectExports.length === 0;
  const isStale = hasApus && projectExports.length > 0 && currentExports.length === 0;

  let status = 'pendiente';
  let reason = 'NO_DELIVERABLE_APUS';

  if (hasApus && currentExports.length === 0) {
    status = 'atencion';
    reason = isStale ? 'DELIVERY_OUTDATED' : 'NOT_EXPORTED';
  }

  if (hasApus && currentExports.length > 0) {
    status = 'completado';
    reason = 'CURRENT_DELIVERY_EXISTS';
  }

  return {
    projectId: pid,
    status,
    reason,
    apuCount: currentVersionIds.length,
    currentVersionIds,
    projectExports,
    currentExports,
    currentFormats,
    lastExport,
    lastCurrentExport,
    neverExported,
    isStale
  };
}

export { sameVersionSet };