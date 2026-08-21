import { useMemo, useState } from 'react';
import { migrateLegacyApuToV2 } from '../../domain/apuSchema.js';
import { finalizeProfessionalAPU } from '../../domain/apuProfessional.js';
import {
  buildReviewRow, filterReviewRows, REVIEW_FILTER,
  applyRevisionDecision, applyRendimientoDecision, suggestDeviationCategory,
  REVISION_STATUS, REVISION_STATUS_LABEL, RENDIMIENTO_FUENTE
} from '../../domain/apuReview.js';

const FILTERS = [
  [REVIEW_FILTER.TODOS, 'Todos'],
  [REVIEW_FILTER.VALIDADOS, 'Validados'],
  [REVIEW_FILTER.DIFERENCIA_25, 'Diferencia >25%'],
  [REVIEW_FILTER.BAJA_EVIDENCIA, 'Baja evidencia'],
  [REVIEW_FILTER.RENDIMIENTO_SIN_VALIDAR, 'Rendimiento sin validar'],
  [REVIEW_FILTER.PRECIOS_PENDIENTES, 'Precios pendientes']
];

const money = v => v == null ? '—' : new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(v);
const pct = v => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;

function toV2(apu){ return apu?.schemaVersion === 2 ? apu : migrateLegacyApuToV2(apu); }

function estadoBadgeColor(estado){
  if(estado === REVISION_STATUS.VALIDADO_POR_USUARIO) return '#1E7D32';
  if(estado === REVISION_STATUS.REVISADO) return '#1578B7';
  if(estado === REVISION_STATUS.REQUIERE_REVISION) return '#B54A62';
  return '#8A6B2E';
}

/* Bandeja de Revision Tecnica (Fase 8): opera SIEMPRE sobre APUs ya
   generados (prop apus, tal cual vive en "Mis APU") -- nunca llama IA ni
   Price Intelligence. onUpdateApu(nextRawApu) es responsabilidad del padre
   (normalmente: reemplazar el APU en la lista guardada, mismo patron que
   ProfessionalApuEditor.onSave). */
export function RevisionBandeja({ apus = [], user, onUpdateApu }){
  const [filter, setFilter] = useState(REVIEW_FILTER.TODOS);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [rendimientoDrafts, setRendimientoDrafts] = useState({});

  const finalized = useMemo(() => apus.map(raw => {
    try{ return { raw, apu: finalizeProfessionalAPU(toV2(raw)) }; }
    catch{ return null; }
  }).filter(Boolean), [apus]);

  const rows = useMemo(() => finalized.map(({ apu }) => buildReviewRow(apu)), [finalized]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([key]) => [key, filterReviewRows(rows, key).length])), [rows]);
  const filtered = useMemo(() => {
    const base = filterReviewRows(rows, filter);
    const q = search.trim().toLowerCase();
    if(!q) return base;
    return base.filter(r => String(r.clave).toLowerCase().includes(q) || String(r.concept || '').toLowerCase().includes(q));
  }, [rows, filter, search]);

  if(!apus.length) return null;

  const openEntry = openId != null ? finalized.find(({ apu }) => apu.id === openId) : null;
  const openRow = openEntry ? rows.find(r => r.id === openId) : null;

  const persist = (rawApu, nextApuV2) => {
    if(onUpdateApu) onUpdateApu({ ...nextApuV2, id: rawApu.id || nextApuV2.id });
  };

  const decide = (status) => {
    if(!openEntry) return;
    const next = applyRevisionDecision(openEntry.apu, { status, usuario: user?.name || user?.email || '', motivo });
    persist(openEntry.raw, next);
    setMotivo('');
  };

  const confirmRendimiento = (laborIndex) => {
    if(!openEntry) return;
    const draft = rendimientoDrafts[laborIndex] || {};
    const row = openEntry.apu.labor[laborIndex];
    const next = applyRendimientoDecision(openEntry.apu, {
      laborIndex,
      rendimiento: draft.rendimiento != null ? draft.rendimiento : row.rendimiento,
      cuadrilla: draft.cuadrilla != null ? draft.cuadrilla : row.cuadrilla,
      confirmado: true, usuario: user?.name || user?.email || '', guardarEnHistorico: true
    });
    persist(openEntry.raw, next);
  };

  return <div className="panel revision-bandeja">
    <h3>Bandeja de revisión técnica <small>({rows.length} concepto{rows.length === 1 ? '' : 's'})</small></h3>
    <p className="muted">Basada en los APUs ya generados en este proyecto. No se vuelve a llamar IA ni Price Intelligence al abrir esta bandeja.</p>
    <div className="lib-toolbar pro">
      <div className="lib-tabs">{FILTERS.map(([key, label]) => <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{label} ({counts[key]})</button>)}</div>
      <input className="batch-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por clave o concepto..." />
    </div>
    <div className="lib-table">
      <table className="data-table">
        <thead><tr><th>Clave</th><th>Concepto</th><th>PU original</th><th>PU ZOEMEC</th><th>Diferencia %</th><th>Confianza</th><th>Evidencia mercado</th><th>Estado</th></tr></thead>
        <tbody>{filtered.map(r => <tr key={r.id} className="row-clickable" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
          <td>{r.clave}</td>
          <td>{String(r.concept || '').slice(0, 70)}</td>
          <td>{money(r.puOriginal)}</td>
          <td>{money(r.puCalculado)}</td>
          <td style={{ color: r.diferenciaPct != null && Math.abs(r.diferenciaPct) > 25 ? '#B54A62' : undefined, fontWeight: r.diferenciaPct != null && Math.abs(r.diferenciaPct) > 25 ? 'bold' : undefined }}>{pct(r.diferenciaPct)}</td>
          <td>{r.confianza != null ? `${r.confianza}% ${r.confianzaNivel}` : '—'}</td>
          <td>{r.evidenciaMercado}%</td>
          <td><span className="cat-badge" style={{ background: estadoBadgeColor(r.estado), color: '#fff' }}>{REVISION_STATUS_LABEL[r.estado] || r.estado}</span></td>
        </tr>)}
        {!filtered.length && <tr><td colSpan={8}>Sin conceptos para este filtro.</td></tr>}
        </tbody>
      </table>
    </div>

    {openEntry && openRow && <div className="panel revision-detail">
      <h4>{openRow.clave} — {openRow.concept}</h4>

      <b>Resumen de revisión</b>
      <div className="revision-summary-grid">
        <div><small>PU original</small><b>{money(openRow.puOriginal)}</b></div>
        <div><small>PU ZOEMEC</small><b>{money(openRow.puCalculado)}</b></div>
        <div><small>Diferencia absoluta</small><b>{money(openRow.diferenciaAbsoluta)}</b></div>
        <div><small>Diferencia %</small><b>{pct(openRow.diferenciaPct)}</b></div>
        <div><small>Confianza técnica</small><b>{openRow.confianzaTecnica}%</b></div>
        <div><small>Confianza de precios</small><b>{openRow.confianzaPrecios}%</b></div>
        <div><small>Cobertura de mercado</small><b>{openRow.evidenciaMercado}%</b></div>
        <div><small>Rendimientos</small><b>{openRow.rendimientoValidado ? 'Validados' : 'No validados'}</b></div>
        <div><small>Estado</small><b><span className="cat-badge" style={{ background: estadoBadgeColor(openRow.estado), color: '#fff' }}>{REVISION_STATUS_LABEL[openRow.estado] || openRow.estado}</span></b></div>
      </div>
      {openRow.motivos?.length > 0 && <p className="muted">Motivos automáticos de revisión: {openRow.motivos.join(', ')}</p>}

      <b>Principales causas de variación (desglose real del P.U. calculado)</b>
      <p className="muted">{openRow.explain.nota}</p>
      <ul className="exec-checklist">
        {openRow.explain.componentesDirectos.map(c => <li key={c.componente}><b>{c.label}:</b> {money(c.monto)} ({c.pctDelDirecto}% del costo directo){openRow.explain.componenteDominante?.componente === c.componente ? ' — componente dominante' : ''}</li>)}
      </ul>
      {openRow.explain.recursoDominante && <p><b>Recurso individual de mayor peso:</b> "{openRow.explain.recursoDominante.descripcion}" ({openRow.explain.recursoDominante.clave}, {openRow.explain.recursoDominante.kindLabel}) — {money(openRow.explain.recursoDominante.costo)} ({openRow.explain.recursoDominante.pctDelDirecto}% del costo directo), {openRow.explain.recursoDominante.nRefsAlto > 0 ? `${openRow.explain.recursoDominante.nRefsAlto} referencia(s) técnica(s) ALTO` : openRow.explain.recursoDominante.nRefs > 0 ? `${openRow.explain.recursoDominante.nRefs} referencia(s) sin calificar ALTO` : 'sin evidencia de mercado registrada'}.</p>}
      {openRow.diferenciaPct != null && Math.abs(openRow.diferenciaPct) > 25 && <p><b>Categoría de desviación sugerida:</b> {suggestDeviationCategory(openEntry.apu).categoria} — {suggestDeviationCategory(openEntry.apu).evidencia.join(' ')}</p>}

      <b>Calibración de rendimiento</b>
      <table className="data-table">
        <thead><tr><th>Recurso</th><th>Cuadrilla</th><th>Rendimiento</th><th>Fuente</th><th></th></tr></thead>
        <tbody>{(openEntry.apu.labor || []).map((r, i) => {
          const draft = rendimientoDrafts[i] || {};
          return <tr key={i}>
            <td>{r.descripcion}</td>
            <td><input type="number" style={{ width: 60 }} defaultValue={r.cuadrilla} onChange={e => setRendimientoDrafts(d => ({ ...d, [i]: { ...d[i], cuadrilla: Number(e.target.value) } }))} /></td>
            <td><input type="number" style={{ width: 70 }} defaultValue={r.rendimiento} onChange={e => setRendimientoDrafts(d => ({ ...d, [i]: { ...d[i], rendimiento: Number(e.target.value) } }))} /></td>
            <td>{r.rendimientoFuente ? `Rendimiento ${r.rendimientoFuente.toLowerCase()}` : 'Rendimiento IA'}</td>
            <td><button type="button" className="soft" onClick={() => confirmRendimiento(i)}>{r.rendimientoFuente === RENDIMIENTO_FUENTE.VALIDADO ? 'Revalidar' : 'Confirmar rendimiento'}</button></td>
          </tr>;
        })}</tbody>
      </table>

      <b>Aprobación</b>
      <div className="inline-tools">
        <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Motivo / observación (opcional)" style={{ flex: 1 }} />
        <button type="button" className="soft" onClick={() => decide(REVISION_STATUS.REVISADO)}>Marcar revisado</button>
        <button type="button" onClick={() => decide(REVISION_STATUS.VALIDADO_POR_USUARIO)}>Validar por usuario</button>
      </div>
      {(openEntry.apu.revisionLog || []).length > 0 && <ul className="exec-checklist">
        {openEntry.apu.revisionLog.map((e, i) => <li key={i}><b>{REVISION_STATUS_LABEL[e.status] || e.status}</b> — {e.usuario || 'usuario'} — {new Date(e.fecha).toLocaleString('es-MX')}{e.motivo ? ` — ${e.motivo}` : ''}</li>)}
      </ul>}
      <button type="button" className="link-inline" onClick={() => setOpenId(null)}>Cerrar ▴</button>
    </div>}
  </div>;
}
