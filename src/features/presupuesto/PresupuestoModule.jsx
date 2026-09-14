/* Presupuesto (Fase D): agrega los conceptos del Catalogo con su APU
   asociado en subtotales por capitulo + costo directo total + importe
   total. Reusa SIN reimplementar: calcAPU/calcAPUv2 (cada APU ya trae
   direct/pu/iva calculados con indirectos+financiamiento+utilidad+cargos
   incluidos, ver src/lib/apuCalc.js#applyCascade -- este modulo nunca vuelve
   a aplicar esa cascada), runApuConfidence/runBidRisk (confianza/riesgo por
   concepto), ExplosionsPanel (Fase A, boton "Ver explosiones"), y el
   versionado/Baseline de _route-presupuestos.mjs via presupuestoCloud.js. */
import { useMemo, useState } from 'react';
import { PageHead, EmptyState } from '../../components/ui/PageElements.jsx';
import { useCatalogConceptos } from '../catalogo/catalogConceptosCloud.js';
import { useProjectApus } from '../catalogo/projectApusCloud.js';
import { usePresupuesto } from './presupuestoCloud.js';
import { aggregatePresupuesto } from '../../domain/presupuestoAggregation.js';
import { capituloLabel } from '../../domain/presupuestoCapitulos.js';
import { calcAPUv2 } from '../../lib/apuCalc.js';
import { runApuConfidence } from '../../domain/apuConfidence.js';
import { runBidRisk } from '../../domain/bidRisk.js';
import { money } from '../../lib/apuExport.js';
import { exportPresupuestoExcel, exportPresupuestoPDF } from '../../lib/presupuestoExport.js';
import { uid } from '../../utils/id.js';
import ExplosionsPanel from '../explosions/ExplosionsPanel.jsx';

const CONFIDENCE_BADGE_CLASS = { HIGH: 'zi-badge-medium', MEDIUM: 'zi-badge-high', LOW: 'zi-badge-critical', INSUFFICIENT_EVIDENCE: 'zi-badge-info' };
function ConfidenceBadge({ status }){
  if(!status) return <span className="muted">—</span>;
  return <span className={`zi-badge ${CONFIDENCE_BADGE_CLASS[status] || 'zi-badge-info'}`}>{status}</span>;
}
function BidRiskBadge({ severity }){
  if(!severity) return <span className="muted">—</span>;
  return <span className={`zi-badge zi-badge-${severity.toLowerCase()}`}>{severity}</span>;
}

function originCantidad(concepto){
  if(concepto.origenPlano) return `Plano${concepto.origenPlano.fileName ? ` (${concepto.origenPlano.fileName})` : ''}`;
  return 'Manual';
}
function originPrecio(concepto, apu){
  if(concepto.status === 'ASOCIADO') return 'APU asociado';
  if(apu?.templateGenerated) return 'Paramétrico';
  if(apu) return 'IA';
  return '—';
}

export function PresupuestoModule({ user, activeProjectId, activeProject, onNeedProject, setModule, onNavigateToPlano }){
  const { conceptos, loading: loadingConceptos } = useCatalogConceptos(user, activeProjectId);
  // Copia propia y fresca de los APUs del proyecto -- nunca el `rawApus`
  // (cache de sesion del editor de APU en main.jsx), ver projectApusCloud.js.
  const { apus: rawApus } = useProjectApus(user, activeProjectId);
  const { presupuesto, versions, saveVersion, create, approveBaseline } = usePresupuesto(user, activeProjectId);
  const [saving, setSaving] = useState(false);
  const [explosionsOpen, setExplosionsOpen] = useState(false);
  const [approving, setApproving] = useState(false);

  const apuById = useMemo(() => new Map((rawApus || []).map(a => [a.id, a])), [rawApus]);

  const aggregation = useMemo(() => {
    const rows = conceptos.map(c => {
      const apu = c.apuId ? apuById.get(c.apuId) : null;
      const totals = apu ? (apu.calculated || calcAPUv2(apu)) : null;
      const confidence = apu ? runApuConfidence(apu).status : null;
      const bidRisk = apu ? runBidRisk(apu).severity : null;
      return {
        conceptoId: c.id, clave: c.clave, capitulo: c.capitulo, concept: c.concept, unit: c.unit, qty: c.qty,
        apuId: c.apuId || null, apuVersionId: c.apuVersionId || null,
        pu: totals?.pu ?? 0, direct: totals?.direct ?? 0, iva: totals?.iva ?? 0,
        confidenceStatus: confidence, bidRiskSeverity: bidRisk,
        origenCantidad: originCantidad(c), origenPrecio: originPrecio(c, apu),
        // Trazabilidad Presupuesto -> Concepto -> APU -> Plano (Fase D.1,
        // punto 2): se preserva tal cual el origenPlano del concepto (nunca
        // se recalcula aqui) para que "Ver en plano" sepa que planoTakeoffId/
        // pagina/elemento abrir.
        origenPlano: c.origenPlano || null
      };
    });
    return aggregatePresupuesto(rows);
  }, [conceptos, apuById]);

  const handleSave = async () => {
    setSaving(true);
    try{
      const snapshot = { conceptos: aggregation.rows, capituloSubtotals: aggregation.capituloSubtotals, costoDirectoTotal: aggregation.costoDirectoTotal, importeTotal: aggregation.importeTotal };
      if(presupuesto) await saveVersion(snapshot, { reason: 'Actualizado desde el Catálogo' });
      else await create('PRE-' + uid(), snapshot, { reason: 'Presupuesto inicial' });
    }finally{
      setSaving(false);
    }
  };

  const handleApproveBaseline = async () => {
    setApproving(true);
    try{ await approveBaseline(); }
    finally{ setApproving(false); }
  };

  if(!activeProjectId){
    return <section>
      <PageHead kicker="Presupuesto" title="Presupuesto" desc="Costo directo, subtotales por capítulo y trazabilidad completa hacia el plano." />
      <div className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '14px 18px' }}>
        <p className="muted" style={{ margin: 0 }}>Necesitas un proyecto activo para ver su presupuesto.</p>
        <button onClick={onNeedProject}>Crear/elegir proyecto</button>
      </div>
    </section>;
  }

  return (
    <section>
      <PageHead
        kicker="Presupuesto"
        title={activeProject?.name || 'Presupuesto'}
        desc="Cantidad × Precio Unitario = Importe. El precio unitario de cada APU ya incluye indirectos, financiamiento, utilidad y cargos adicionales."
        action={<button onClick={() => setModule?.('catalogo')}>Ir al Catálogo</button>}
      />

      {loadingConceptos && !conceptos.length && <p className="muted">Cargando…</p>}
      {!loadingConceptos && !conceptos.length
        ? <div className="panel"><EmptyState icon="presupuestos" title="Sin conceptos todavía" text="Agrega conceptos en el Catálogo y genera o asocia su APU para verlos aquí." /></div>
        : <>
          <div className="panel" style={{ marginBottom: 16, display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
            <div><small className="muted">Costo directo total</small><h2 style={{ margin: 0 }}>{money(aggregation.costoDirectoTotal)}</h2></div>
            <div><small className="muted">Importe total</small><h2 style={{ margin: 0 }}>{money(aggregation.importeTotal)}</h2></div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {presupuesto?.baselineVersion
                ? <span className="zi-badge zi-badge-medium">Baseline: {presupuesto.baselineVersion}</span>
                : <button className="soft" disabled={!presupuesto || approving} onClick={handleApproveBaseline}>{approving ? 'Aprobando…' : 'Aprobar como Baseline'}</button>}
              <button className="soft" disabled={saving} onClick={handleSave}>{saving ? 'Guardando…' : (presupuesto ? `Guardar nueva versión (actual ${presupuesto.currentVersion})` : 'Guardar presupuesto')}</button>
              <button className="soft" onClick={() => setExplosionsOpen(true)}>Ver explosiones</button>
              <button className="soft" onClick={() => exportPresupuestoExcel({ presupuesto: presupuesto || { projectId: activeProjectId }, aggregation, projectName: activeProject?.name })}>Excel</button>
              <button className="soft" onClick={() => exportPresupuestoPDF({ presupuesto: presupuesto || { projectId: activeProjectId }, aggregation, projectName: activeProject?.name })}>PDF</button>
            </div>
          </div>

          {aggregation.capituloSubtotals.map(cap => (
            <div className="panel" key={cap.capitulo} style={{ marginBottom: 16 }}>
              <div className="module-subhead"><div><h2 style={{ margin: 0 }}>{cap.label}</h2></div><b>{money(cap.importe)}</b></div>
              <div className="apu-table-scroll">
                <table className="budget-table">
                  <thead><tr><th>Clave</th><th>Descripción</th><th>Unidad</th><th>Cantidad</th><th>P.U.</th><th>Importe</th><th>APU</th><th>Confianza</th><th>Bid Risk</th><th>Origen cant.</th><th>Origen precio</th><th></th></tr></thead>
                  <tbody>
                    {aggregation.rows.filter(r => r.capitulo === cap.capitulo).map(r => (
                      <tr key={r.conceptoId}>
                        <td>{r.clave || '—'}</td>
                        <td>{r.concept}</td>
                        <td>{r.unit}</td>
                        <td>{r.qty}</td>
                        <td>{money(r.pu)}</td>
                        <td>{money(r.importe)}</td>
                        <td>{r.apuId ? 'Sí' : <span className="muted">Pendiente</span>}</td>
                        <td><ConfidenceBadge status={r.confidenceStatus} /></td>
                        <td><BidRiskBadge severity={r.bidRiskSeverity} /></td>
                        <td>{r.origenCantidad}</td>
                        <td>{r.origenPrecio}</td>
                        <td>
                          {r.origenPlano?.planoTakeoffId
                            ? <button className="soft" onClick={() => onNavigateToPlano?.({ kind: 'plano-takeoff-vector', planoTakeoffId: r.origenPlano.planoTakeoffId, elementId: r.origenPlano.elementoId, page: r.origenPlano.page })}>Ver en plano</button>
                            : r.origenPlano
                              ? <button className="soft" onClick={() => onNavigateToPlano?.({ kind: 'plano-takeoff-image' })}>Ver en plano</button>
                              : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {versions.length > 0 && (
            <div className="panel">
              <h2 style={{ marginTop: 0 }}>Historial de versiones</h2>
              <ul>{versions.map(v => <li key={v.version}>{v.version} · {v.at ? new Date(v.at).toLocaleString('es-MX') : ''} · {v.reason || ''}{presupuesto?.baselineVersion === v.version && ' · Baseline'}</li>)}</ul>
            </div>
          )}
        </>}

      {explosionsOpen && <ExplosionsPanel projectId={activeProjectId} onClose={() => setExplosionsOpen(false)} />}
    </section>
  );
}
