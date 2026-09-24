/* Biblioteca EMPRESARIAL (P0 paridad ADMIN vs COLLABORATOR). Muestra, con
   su ORIGEN explicito, los precios que la IA puede usar: Empresa, Proyecto,
   Personal y Global (regla 19), el contexto que usara la generacion de APU
   (regla 20) y, solo para el responsable de la empresa, la copia NO
   destructiva del catalogo personal a la biblioteca de la empresa con vista
   previa obligatoria (reglas 4 y 17).

   Un colaborador ve exactamente la misma biblioteca de empresa que el
   responsable; la unica diferencia de rol es que no puede modificarla. */
import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db, firebaseReady } from '../../firebase.js';
import { extractAllValidatedCatalogRows } from '../../domain/libraryReview.js';
import { isOrgManagerRole } from '../../domain/organization.js';
import {
  useOrgLibrary, archiveOrgLibraryEntry, createOrgLibraryEntries,
  previewPersonalImport, commitPersonalImport, fetchApuContextPreview
} from './orgLibraryCloud.js';

const ORIGIN_LABEL = { organization: 'Empresa', project: 'Proyecto', personal: 'Personal', global: 'Global' };
const ORIGIN_BADGE = { organization: 'zi-badge-medium', project: 'zi-badge-high', personal: 'zi-badge-info', global: 'zi-badge-info' };
const FILTERS = [['all', 'Todas'], ['organization', 'Empresa'], ['project', 'Proyecto'], ['personal', 'Personal'], ['global', 'Global']];
const money = n => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

function OriginBadge({ origin }){
  return <span className={`zi-badge ${ORIGIN_BADGE[origin] || 'zi-badge-info'}`}>{ORIGIN_LABEL[origin] || origin}</span>;
}

export function ContextSummary({ context, error }){
  if(error) return <p className="muted" style={{ color: 'var(--danger)' }}>No se pudo obtener el contexto de generación: {error}</p>;
  if(!context) return <p className="muted">Consultando el contexto de generación…</p>;
  const region = context.region ? [context.region.city, context.region.state].filter(Boolean).join(', ') : 'sin región';
  return <div className="muted" style={{ fontSize: '.82rem' }}>
    <b>Contexto de generación de APU:</b>{' '}
    {context.contextMode === 'organization' ? `Empresa: ${context.organizationName || context.organizationId}` : 'Personal (sin empresa)'}
    {' · '}Región: {region}
    {' · '}Catálogo empresa: {context.organizationValidCount} recursos
    {' · '}Precios proyecto: {context.projectPriceCount}
    {' · '}Históricos validados: {context.historicalOrgApuValidatedCount}
    {' · '}Huella: <code>{context.contextHash}</code>
    {(context.warnings || []).map(w => <div key={w.code} style={{ color: w.severity === 'ALTA' ? 'var(--danger)' : undefined }}>⚠ {w.message}</div>)}
  </div>;
}

export function OrgLibraryPanel({ user, orgSession, activeProjectId = null, personalCatalog = [] }){
  const organizationId = orgSession?.organization?.id || null;
  const isManager = isOrgManagerRole(orgSession?.membership?.role);
  const { entries, loading, error, reload } = useOrgLibrary(user, organizationId, { projectId: activeProjectId });
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [globalRows, setGlobalRows] = useState(null);
  const [globalError, setGlobalError] = useState('');
  const [context, setContext] = useState(null);
  const [contextError, setContextError] = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const [applyUpdates, setApplyUpdates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ description: '', unit: '', price: '', region: '', source: '', scope: 'organization' });

  useEffect(() => {
    if(!organizationId) return;
    let alive = true;
    setContext(null); setContextError('');
    fetchApuContextPreview({ projectId: activeProjectId })
      .then(c => { if(alive) setContext(c); })
      .catch(err => { if(alive) setContextError(err.message); });
    return () => { alive = false; };
  }, [organizationId, activeProjectId, entries.length]);

  useEffect(() => {
    if(!firebaseReady || !user?.uid || globalRows !== null || !(filter === 'all' || filter === 'global')) return;
    getDocs(query(collection(db, 'library'), where('visibility', '==', 'global')))
      .then(snap => setGlobalRows(extractAllValidatedCatalogRows(snap.docs.map(d => ({ id: d.id, ...d.data() })))))
      .catch(err => { setGlobalRows([]); setGlobalError(err?.message || 'No se pudo leer la biblioteca global.'); });
  }, [filter, user?.uid, globalRows]);

  const rows = useMemo(() => {
    const all = [
      ...entries.map(e => ({ key: e.id, origin: e.projectId ? 'project' : 'organization', description: e.description || e.code, unit: e.unit, price: e.price, region: e.region, source: e.source, date: e.date, id: e.id })),
      ...(personalCatalog || []).map((r, i) => ({ key: `personal-${i}`, origin: 'personal', description: r.desc, unit: r.unidad, price: r.precio, region: r.region || '', source: r.traceability?.sourceDocName || 'Catálogo personal', date: r.fecha || '' })),
      ...(globalRows || []).map((r, i) => ({ key: `global-${i}`, origin: 'global', description: r.desc, unit: r.unidad, price: r.precio, region: '', source: r.traceability?.sourceDocName || 'Biblioteca global', date: r.traceability?.validatedAt || '' }))
    ];
    const q = search.trim().toLowerCase();
    return all
      .filter(r => filter === 'all' || r.origin === filter)
      .filter(r => !q || `${r.description} ${r.source}`.toLowerCase().includes(q));
  }, [entries, personalCatalog, globalRows, filter, search]);

  if(!organizationId) return null;

  const runPreview = async () => {
    setBusy(true);
    try{ setImportPreview(await previewPersonalImport(personalCatalog)); setApplyUpdates(false); }
    catch(err){ alert(err.message); }
    finally{ setBusy(false); }
  };
  const runCommit = async () => {
    setBusy(true);
    try{
      const result = await commitPersonalImport(personalCatalog, { applyUpdates });
      alert(`Biblioteca de empresa actualizada: ${result.created} nuevos, ${result.updated} precios actualizados, ${result.unchanged} sin cambio, ${result.conflicts} conflictos (se conservó el precio de la empresa). Tu catálogo personal no se modificó.`);
      setImportPreview(null);
      reload();
    }catch(err){ alert(err.message); }
    finally{ setBusy(false); }
  };
  const addEntry = async () => {
    if(!draft.description.trim() || !draft.unit.trim() || !(Number(draft.price) > 0)){ alert('Captura descripción, unidad y precio mayor a cero.'); return; }
    setBusy(true);
    try{
      const res = await createOrgLibraryEntries([{ description: draft.description, unit: draft.unit, price: Number(draft.price), region: draft.region, source: draft.source }], { projectId: draft.scope === 'project' ? activeProjectId : null });
      if(res?.rejected?.length) alert(`No se agregó: ${res.rejected.map(r => r.reason).join(', ')}`);
      setDraft({ description: '', unit: '', price: '', region: '', source: '', scope: draft.scope });
      reload();
    }catch(err){ alert(err.message); }
    finally{ setBusy(false); }
  };
  const archive = async (id) => {
    if(!confirm('¿Archivar este recurso? Dejará de usarse para generar APU (se conserva en la auditoría).')) return;
    try{ await archiveOrgLibraryEntry(id); reload(); }catch(err){ alert(err.message); }
  };

  return <section className="panel" style={{ marginBottom: 14 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
      <div>
        <h3 style={{ margin: 0 }}>Biblioteca de la empresa · {orgSession.organization?.name || organizationId}</h3>
        <p className="muted" style={{ margin: '2px 0 0', fontSize: '.8rem' }}>
          {isManager
            ? 'Todos los miembros de tu empresa generan APU con esta misma biblioteca. Solo tú (responsable) puedes modificarla.'
            : 'Generas APU con esta misma biblioteca que usa el responsable de tu empresa. Solo el responsable puede modificarla.'}
        </p>
      </div>
      {isManager && personalCatalog?.length > 0 && <button className="soft" disabled={busy} onClick={runPreview}>Copiar mi catálogo a la empresa ({personalCatalog.length})</button>}
    </div>

    <div style={{ margin: '8px 0' }}><ContextSummary context={context} error={contextError} /></div>

    {importPreview && <div className="panel" style={{ margin: '8px 0', borderLeft: '3px solid var(--accent)' }}>
      <b>Vista previa de la copia (nada se ha escrito todavía)</b>
      <ul style={{ margin: '6px 0', paddingLeft: 18, fontSize: '.85rem' }}>
        <li>Registros revisados: {importPreview.summary.candidates}</li>
        <li>Nuevos para la empresa: <b>{importPreview.summary.toCreate}</b></li>
        <li>Ya existen con el mismo precio: {importPreview.summary.unchanged}</li>
        <li>Ya existen con precio distinto y el tuyo es más reciente: {importPreview.summary.toUpdate}</li>
        <li>Conflictos (tu precio es más viejo, se conserva el de la empresa): {importPreview.summary.conflicts}</li>
        <li>Duplicados dentro de tu catálogo: {importPreview.summary.duplicatesInBatch} · Inválidos (sin precio/unidad): {importPreview.summary.invalid}</li>
        <li>Regiones: {importPreview.summary.regions.join(', ')} · Fuentes: {importPreview.summary.sources.slice(0, 5).join(', ')}{importPreview.summary.sources.length > 5 ? '…' : ''}</li>
        {importPreview.summary.dateRange && <li>Fechas: {String(importPreview.summary.dateRange.from).slice(0, 10)} → {String(importPreview.summary.dateRange.to).slice(0, 10)}</li>}
      </ul>
      {importPreview.toUpdate.length > 0 && <details><summary>Precios que cambiarían ({importPreview.toUpdate.length})</summary>
        <ul style={{ fontSize: '.8rem' }}>{importPreview.toUpdate.slice(0, 20).map(u => <li key={u.existingId}>{u.description} ({u.unit}): {money(u.from)} → {money(u.to)}</li>)}</ul>
      </details>}
      {importPreview.summary.toUpdate > 0 && <label style={{ display: 'block', margin: '6px 0' }}>
        <input type="checkbox" checked={applyUpdates} onChange={e => setApplyUpdates(e.target.checked)} /> Actualizar también esos {importPreview.summary.toUpdate} precios de la empresa
      </label>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button disabled={busy || (importPreview.summary.toCreate === 0 && !(applyUpdates && importPreview.summary.toUpdate > 0))} onClick={runCommit}>Confirmar copia</button>
        <button className="soft" disabled={busy} onClick={() => setImportPreview(null)}>Cancelar</button>
      </div>
    </div>}

    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
      {FILTERS.map(([key, label]) => <button key={key} className={filter === key ? '' : 'soft'} onClick={() => setFilter(key)}>{label}</button>)}
      <input type="search" placeholder="Buscar insumo o fuente" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: '1 1 180px' }} />
    </div>
    {error && <p style={{ color: 'var(--danger)' }}>No se pudo leer la biblioteca de la empresa: {error}</p>}
    {globalError && (filter === 'global' || filter === 'all') && <p style={{ color: 'var(--danger)' }}>{globalError}</p>}
    {loading ? <p className="muted">Cargando biblioteca…</p> : rows.length === 0 ? <p className="muted">No hay recursos para este filtro.</p> :
      <div style={{ maxHeight: 360, overflow: 'auto' }}>
        <table style={{ width: '100%', fontSize: '.82rem', borderCollapse: 'collapse' }}>
          <thead><tr style={{ textAlign: 'left' }}><th>Origen</th><th>Insumo</th><th>Unidad</th><th>Precio</th><th>Región</th><th>Fuente</th><th>Fecha</th>{isManager && <th></th>}</tr></thead>
          <tbody>{rows.slice(0, 500).map(r => <tr key={r.key} style={{ borderTop: '1px solid var(--border, #eee)' }}>
            <td><OriginBadge origin={r.origin} /></td><td>{r.description}</td><td>{r.unit}</td><td>{money(r.price)}</td>
            <td>{r.region || '—'}</td><td>{r.source || '—'}</td><td>{String(r.date || '').slice(0, 10) || '—'}</td>
            {isManager && <td>{(r.origin === 'organization' || r.origin === 'project') && <button className="soft danger" onClick={() => archive(r.id)}>Archivar</button>}</td>}
          </tr>)}</tbody>
        </table>
        {rows.length > 500 && <p className="muted">Mostrando 500 de {rows.length}. Usa la búsqueda para acotar.</p>}
      </div>}

    {isManager && <details style={{ marginTop: 10 }}>
      <summary>Agregar recurso a la biblioteca de la empresa</summary>
      <div className="field-grid" style={{ marginTop: 6 }}>
        <div className="nf wide"><label>Descripción</label><input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></div>
        <div className="nf"><label>Unidad</label><input value={draft.unit} onChange={e => setDraft({ ...draft, unit: e.target.value })} /></div>
        <div className="nf"><label>Precio (MXN)</label><input type="number" value={draft.price} onChange={e => setDraft({ ...draft, price: e.target.value })} /></div>
        <div className="nf"><label>Región</label><input value={draft.region} onChange={e => setDraft({ ...draft, region: e.target.value })} placeholder="vacío = cualquier región" /></div>
        <div className="nf"><label>Fuente / evidencia</label><input value={draft.source} onChange={e => setDraft({ ...draft, source: e.target.value })} /></div>
        <div className="nf"><label>Alcance</label>
          <select value={draft.scope} onChange={e => setDraft({ ...draft, scope: e.target.value })}>
            <option value="organization">Toda la empresa</option>
            <option value="project" disabled={!activeProjectId}>Solo el proyecto activo</option>
          </select>
        </div>
      </div>
      <button disabled={busy} onClick={addEntry}>Agregar</button>
    </details>}
  </section>;
}
