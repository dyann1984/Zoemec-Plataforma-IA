/* Catalogo de conceptos (Fase D): eslabon persistente entre Cuantificacion y
   APU. Desde cada concepto: asociar un APU existente (apuMatchLookup.js),
   generar con IA (motor real /api/generate-apu, ver generateApuForConcepto.js),
   generar con el Cuantificador Parametrico (QuantifierWizard.jsx, motor real
   ya terminado) cuando aplica, o dejarlo pendiente. Generacion masiva
   persistente para los conceptos PENDIENTE, con reintento de solo los
   fallidos -- el estado DURABLE de cada concepto vive en catalogConceptos
   (Firestore, via server/api-lib/_route-catalogo-conceptos.mjs), asi que un
   fallo de 1 de 30 nunca pierde el progreso de los otros 29, y sobrevive
   tanto un cambio de pantalla como una recarga de la pagina. */
import { useMemo, useState } from 'react';
import { PageHead, EmptyState } from '../../components/ui/PageElements.jsx';
import { useCatalogConceptos } from './catalogConceptosCloud.js';
import { useProjectApus } from './projectApusCloud.js';
import { generateApuForConcepto, persistGeneratedApu } from './generateApuForConcepto.js';
import { ApuAssociationSearch } from './ApuAssociationSearch.jsx';
import { QuantifierWizard } from '../quantifier/QuantifierWizard.jsx';
import { suggestParametricElements } from '../../domain/parametricCompatibilityBridge.js';
import { migrateLegacyApuToV2 } from '../../domain/apuSchema.js';
import { PRESUPUESTO_CAPITULOS, capituloLabel } from '../../domain/presupuestoCapitulos.js';
import { useAiJobs } from '../../contexts/AiJobsContext.jsx';

const STATUS_LABEL = {
  PENDIENTE: 'Pendiente', GENERANDO: 'Generando...', GENERADO: 'Generado',
  ASOCIADO: 'Asociado', ERROR: 'Error', REQUIERE_REVISION: 'Requiere revisión'
};
const STATUS_BADGE_CLASS = {
  PENDIENTE: 'zi-badge-info', GENERANDO: 'zi-badge-high', GENERADO: 'zi-badge-medium',
  ASOCIADO: 'zi-badge-medium', ERROR: 'zi-badge-critical', REQUIERE_REVISION: 'zi-badge-high'
};
function ConceptStatusBadge({ status }){
  return <span className={`zi-badge ${STATUS_BADGE_CLASS[status] || 'zi-badge-info'}`}>{STATUS_LABEL[status] || status}</span>;
}

/* Ejecuta hasta `limit` generaciones en paralelo, nunca mas -- un lote de 30
   conceptos no debe disparar 30 llamadas simultaneas a la IA. */
async function runWithConcurrency(items, limit, worker){
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while(cursor < items.length){
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export function CatalogoModule({ user, organizationId, activeProjectId, activeProject, catalog = [], onNeedProject, setModule, onNavigateToPlano }){
  const { conceptos, loading, error, create, update, setStatus, associateApu, archive } = useCatalogConceptos(user, activeProjectId);
  // Copia PROPIA y fresca de los APUs del proyecto (nunca el `rawApus` de
  // main.jsx, que es el cache de sesion del editor de APU y no se entera de
  // un APU creado por generateApuForConcepto.js hasta recargar la pagina --
  // ver projectApusCloud.js). Se refresca explicitamente tras cada accion
  // que crea o asocia un APU, para que "Asociar APU existente" y el
  // Presupuesto vean el resultado de inmediato, sin depender de un reload.
  const { apus: rawApus, reload: reloadApus } = useProjectApus(user, activeProjectId);
  const { beginJob, completeJob, failJob } = useAiJobs();
  const [draft, setDraft] = useState({ clave: '', capitulo: 'OTROS', concept: '', unit: '', qty: '' });
  const [associatingId, setAssociatingId] = useState(null);
  const [parametricId, setParametricId] = useState(null);
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchSummary, setBatchSummary] = useState(null);

  const projectApus = useMemo(() => (rawApus || []).filter(a => !a.archivedAt), [rawApus]);

  const markBusy = (id, isBusy) => setBusyIds(prev => {
    const next = new Set(prev);
    if(isBusy) next.add(id); else next.delete(id);
    return next;
  });

  const runGenerateAI = async (concepto) => {
    markBusy(concepto.id, true);
    try{
      await setStatus(concepto.id, 'GENERANDO', { batchId: null });
      const { apuId, requiresReview } = await generateApuForConcepto({ concepto, catalog, project: activeProject });
      await setStatus(concepto.id, requiresReview ? 'REQUIERE_REVISION' : 'GENERADO', { apuId });
      reloadApus();
    }catch(err){
      await setStatus(concepto.id, 'ERROR', { error: err.message }).catch(() => {});
    }finally{
      markBusy(concepto.id, false);
    }
  };

  const handleBatch = async (onlyFailed = false) => {
    const targets = conceptos.filter(c => onlyFailed ? c.status === 'ERROR' : c.status === 'PENDIENTE');
    if(!targets.length) return;
    setBatchRunning(true);
    setBatchSummary(null);
    const jobId = beginJob('catalogo-batch', `${targets.length} concepto(s) del catálogo`);
    let done = 0, ok = 0, failed = 0;
    try{
      await runWithConcurrency(targets, 3, async (concepto) => {
        markBusy(concepto.id, true);
        try{
          await setStatus(concepto.id, 'GENERANDO', { batchId: jobId });
          const { apuId, requiresReview } = await generateApuForConcepto({ concepto, catalog, project: activeProject });
          await setStatus(concepto.id, requiresReview ? 'REQUIERE_REVISION' : 'GENERADO', { apuId, batchId: jobId });
          ok++;
        }catch(err){
          await setStatus(concepto.id, 'ERROR', { error: err.message, batchId: jobId }).catch(() => {});
          failed++;
        }finally{
          done++;
          markBusy(concepto.id, false);
        }
      });
      const summary = { total: targets.length, ok, failed };
      setBatchSummary(summary);
      reloadApus();
      completeJob(jobId, summary, { label: `Generación de lote (${targets.length} conceptos)` });
    }catch(err){
      failJob(jobId, err, { label: 'Generación de lote' });
    }finally{
      setBatchRunning(false);
    }
  };

  const handleParametricGenerated = async (concepto, apuDraftV1) => {
    setParametricId(null);
    markBusy(concepto.id, true);
    try{
      await setStatus(concepto.id, 'GENERANDO');
      // assembleAPUFromParametricResult (parametricApuAssembler.js) entrega
      // esquema v1 (renglones-array) -- misma migracion que ya usa main.jsx
      // antes de finalizeProfessionalAPU (ver test/parametricApuPipeline.e2e.test.mjs).
      const apuDraft = migrateLegacyApuToV2(apuDraftV1);
      const { apuId, requiresReview } = await persistGeneratedApu({
        apuDraft, concepto, project: activeProject,
        reason: `Generado con Cuantificador Paramétrico desde Catálogo (concepto ${concepto.id})`
      });
      await setStatus(concepto.id, requiresReview ? 'REQUIERE_REVISION' : 'GENERADO', { apuId });
      reloadApus();
    }catch(err){
      await setStatus(concepto.id, 'ERROR', { error: err.message }).catch(() => {});
    }finally{
      markBusy(concepto.id, false);
    }
  };

  const handleAssociate = async (concepto, apuId, matchInfo) => {
    setAssociatingId(null);
    await associateApu(concepto.id, apuId, matchInfo);
    reloadApus();
  };

  const addManualConcept = async (e) => {
    e.preventDefault();
    if(!draft.concept.trim() || !draft.unit.trim() || !(Number(draft.qty) > 0)) return;
    await create([{ ...draft, qty: Number(draft.qty) }]);
    setDraft({ clave: '', capitulo: 'OTROS', concept: '', unit: '', qty: '' });
  };

  const pendingCount = conceptos.filter(c => c.status === 'PENDIENTE').length;
  const errorCount = conceptos.filter(c => c.status === 'ERROR').length;

  if(!activeProjectId){
    return <section>
      <PageHead kicker="Catálogo" title="Catálogo de conceptos" desc="Asocia, genera o deja pendiente el APU de cada concepto del proyecto." />
      <div className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '14px 18px' }}>
        <p className="muted" style={{ margin: 0 }}>Necesitas un proyecto activo para ver su catálogo de conceptos.</p>
        <button onClick={onNeedProject}>Crear/elegir proyecto</button>
      </div>
    </section>;
  }

  return (
    <section>
      <PageHead
        kicker="Catálogo"
        title="Catálogo de conceptos"
        desc="Desde cada concepto: asocia un APU existente, genera con IA, genera con el Cuantificador Paramétrico, o déjalo pendiente."
        action={<button onClick={() => setModule?.('presupuestos')}>Ver Presupuesto</button>}
      />

      <div className="panel" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Agregar concepto</h2>
        <form onSubmit={addManualConcept} className="field-grid">
          <div className="nf"><label>Clave</label><input value={draft.clave} onChange={e => setDraft({ ...draft, clave: e.target.value })} placeholder="Opcional" /></div>
          <div className="nf">
            <label>Capítulo</label>
            <select value={draft.capitulo} onChange={e => setDraft({ ...draft, capitulo: e.target.value })}>
              {PRESUPUESTO_CAPITULOS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div className="nf wide"><label>Descripción</label><input value={draft.concept} onChange={e => setDraft({ ...draft, concept: e.target.value })} placeholder="Ej. Muro de block hueco 15 cm" /></div>
          <div className="nf"><label>Unidad</label><input value={draft.unit} onChange={e => setDraft({ ...draft, unit: e.target.value })} placeholder="m²" /></div>
          <div className="nf"><label>Cantidad</label><input type="number" min="0" step="any" value={draft.qty} onChange={e => setDraft({ ...draft, qty: e.target.value })} placeholder="0" /></div>
          <div className="form-actions"><button type="submit">Agregar al catálogo</button></div>
        </form>
      </div>

      <div className="panel" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <b>Generación masiva</b>
        <button disabled={!pendingCount || batchRunning} onClick={() => handleBatch(false)}>
          {batchRunning ? 'Generando…' : `Generar APU para conceptos pendientes (${pendingCount})`}
        </button>
        <button className="soft" disabled={!errorCount || batchRunning} onClick={() => handleBatch(true)}>
          Reintentar solo fallidos ({errorCount})
        </button>
        {batchSummary && <small className="muted">Último lote: {batchSummary.ok} generado(s), {batchSummary.failed} con error, de {batchSummary.total}.</small>}
      </div>

      {error && <div className="panel" style={{ borderColor: 'var(--danger)' }}><p className="muted">{error}</p></div>}
      {loading && !conceptos.length && <p className="muted">Cargando catálogo…</p>}

      {!loading && !conceptos.length
        ? <div className="panel"><EmptyState icon="apu" title="Catálogo vacío" text="Agrega un concepto arriba, o envía elementos validados desde Levantamiento/Plano." /></div>
        : <div className="apu-table-scroll">
          <table className="budget-table">
            <thead><tr><th>Clave</th><th>Capítulo</th><th>Descripción</th><th>Unidad</th><th>Cantidad</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>
              {conceptos.map(c => {
                const parametricSuggestions = suggestParametricElements(c);
                const busy = busyIds.has(c.id);
                return (
                  <tr key={c.id}>
                    <td>{c.clave || '—'}</td>
                    <td>{capituloLabel(c.capitulo)}</td>
                    <td>{c.concept}</td>
                    <td>{c.unit}</td>
                    <td>{c.qty}</td>
                    <td><ConceptStatusBadge status={c.status} />{c.statusError && <div><small style={{ color: 'var(--danger)' }}>{c.statusError}</small></div>}</td>
                    <td>
                      <div className="sc-actions">
                        <button className="soft" disabled={busy} onClick={() => setAssociatingId(c.id)}>Asociar APU existente</button>
                        <button className="soft" disabled={busy} onClick={() => runGenerateAI(c)}>{busy ? 'Generando…' : 'Generar con IA'}</button>
                        {parametricSuggestions.length > 0 && (
                          <button className="soft" disabled={busy} onClick={() => setParametricId(c.id)}>Generar con cuantificador</button>
                        )}
                        {c.origenPlano?.planoTakeoffId && (
                          <button className="soft" onClick={() => onNavigateToPlano?.({ kind: 'plano-takeoff-vector', planoTakeoffId: c.origenPlano.planoTakeoffId, elementId: c.origenPlano.elementoId, page: c.origenPlano.page })}>Ver en plano</button>
                        )}
                        {c.origenPlano && !c.origenPlano.planoTakeoffId && (
                          <button className="soft" onClick={() => onNavigateToPlano?.({ kind: 'plano-takeoff-image' })}>Ver en plano</button>
                        )}
                        <button className="soft danger" disabled={busy} onClick={() => archive(c.id)}>Archivar</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>}

      {associatingId && (() => {
        const concepto = conceptos.find(c => c.id === associatingId);
        if(!concepto) return null;
        return (
          <ApuAssociationSearch
            concepto={concepto}
            apus={projectApus}
            onAssociate={(apuId, matchInfo) => handleAssociate(concepto, apuId, matchInfo)}
            onClose={() => setAssociatingId(null)}
          />
        );
      })()}

      {parametricId && (() => {
        const concepto = conceptos.find(c => c.id === parametricId);
        if(!concepto) return null;
        return (
          <div className="record-modal" role="dialog" aria-modal="true">
            <div className="record-backdrop" onClick={() => setParametricId(null)}></div>
            <div className="panel record-form" style={{ maxWidth: 780 }}>
              <div className="record-form-head">
                <div><span>Catálogo de conceptos</span><h2>Generar con cuantificador — {concepto.concept}</h2></div>
                <button type="button" className="secondary" onClick={() => setParametricId(null)}>Cerrar</button>
              </div>
              <QuantifierWizard
                user={user} catalog={catalog} organizationId={organizationId} activeProjectId={activeProjectId}
                onCancel={() => setParametricId(null)}
                onApuGenerated={(apuDraft) => handleParametricGenerated(concepto, apuDraft)}
              />
            </div>
          </div>
        );
      })()}
    </section>
  );
}
