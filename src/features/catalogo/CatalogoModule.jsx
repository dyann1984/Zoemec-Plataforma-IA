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
import { useEffect, useMemo, useState } from 'react';
import { fetchApuContextPreview } from '../library/orgLibraryCloud.js';
import { ContextSummary } from '../library/OrgLibraryPanel.jsx';
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
import { runCatalogBatch, selectBatchTargets } from './catalogBatchRunner.js';
import { GeneratorsViewer, quantitySourceLabel } from './GeneratorsViewer.jsx';
import { exportGeneratorsPdf, exportGeneratorsExcel } from '../../lib/generatorsExport.js';
import { loadOfficialLogo } from '../../lib/reports/reportPdfKit.js';
import { fmtQ } from '../../domain/quantityGenerators.js';
import { isRateLimitError, retryAfterSecondsOf, formatRetryAfter } from '../../domain/rateLimitStatus.js';

const STATUS_LABEL = {
  PENDIENTE: 'Pendiente', GENERANDO: 'Generando...', GENERADO: 'Generado',
  ASOCIADO: 'Asociado', ERROR: 'Error', REQUIERE_REVISION: 'Requiere revisión',
  PENDIENTE_LIMITE: 'Pendiente por límite' // F1: 429 -- sin APU, reintentable
};
const STATUS_BADGE_CLASS = {
  PENDIENTE: 'zi-badge-info', GENERANDO: 'zi-badge-high', GENERADO: 'zi-badge-medium',
  ASOCIADO: 'zi-badge-medium', ERROR: 'zi-badge-critical', REQUIERE_REVISION: 'zi-badge-high',
  PENDIENTE_LIMITE: 'zi-badge-high'
};
/* F1: "reintentar en ~N min" a partir del retryAt persistido por el servidor. */
function retryHint(concepto, now = Date.now()){
  if(concepto.status !== 'PENDIENTE_LIMITE') return null;
  const ms = concepto.retryAt ? new Date(concepto.retryAt).getTime() - now : 0;
  return ms > 0 ? `Reintentar ${formatRetryAfter(ms / 1000)}` : 'Listo para reintentar';
}
function ConceptStatusBadge({ status }){
  return <span className={`zi-badge ${STATUS_BADGE_CLASS[status] || 'zi-badge-info'}`}>{STATUS_LABEL[status] || status}</span>;
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
  const [generatorsId, setGeneratorsId] = useState(null); // F3: "Ver generadores"

  const projectApus = useMemo(() => (rawApus || []).filter(a => !a.archivedAt), [rawApus]);

  // P0 paridad: contexto con el que el SERVIDOR generara los APU de este
  // proyecto (empresa, region, biblioteca, precios de proyecto, historicos)
  // -- el mismo para cualquier miembro de la empresa (regla 20).
  const [genContext, setGenContext] = useState(null);
  const [genContextError, setGenContextError] = useState('');
  useEffect(() => {
    if(!organizationId || !activeProjectId) return;
    let alive = true;
    setGenContext(null); setGenContextError('');
    fetchApuContextPreview({ projectId: activeProjectId })
      .then(c => { if(alive) setGenContext(c); })
      .catch(err => { if(alive) setGenContextError(err.message); });
    return () => { alive = false; };
  }, [organizationId, activeProjectId]);

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
      // F1/P0: 429 -> PENDIENTE POR LIMITE (reintentable), nunca ERROR definitivo.
      if(isRateLimitError(err)) await setStatus(concepto.id, 'PENDIENTE_LIMITE', { error: err.message, retryAfterSeconds: retryAfterSecondsOf(err) }).catch(() => {});
      else await setStatus(concepto.id, 'ERROR', { error: err.message }).catch(() => {});
    }finally{
      markBusy(concepto.id, false);
    }
  };

  const handleBatch = async (onlyFailed = false) => {
    const targets = selectBatchTargets(conceptos, { onlyFailed });
    if(!targets.length) return;
    setBatchRunning(true);
    setBatchSummary(null);
    const jobId = beginJob('catalogo-batch', `${targets.length} concepto(s) del catálogo`);
    try{
      // F1/P0: runCatalogBatch distingue GENERADO / PENDIENTE POR LIMITE /
      // ERROR REAL (ver catalogBatchRunner.js).
      targets.forEach(c => markBusy(c.id, true));
      const summary = await runCatalogBatch({
        targets, concurrency: 3, batchId: jobId, setStatus,
        generate: (concepto) => generateApuForConcepto({ concepto, catalog, project: activeProject }),
        onItemDone: (concepto) => markBusy(concepto.id, false)
      });
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

  const pendingCount = selectBatchTargets(conceptos).length;
  const errorCount = conceptos.filter(c => c.status === 'ERROR').length;
  const rateLimitedCount = conceptos.filter(c => c.status === 'PENDIENTE_LIMITE').length;

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

      {organizationId && <div className="panel" style={{ marginBottom: 12, padding: '10px 16px' }}>
        <ContextSummary context={genContext} error={genContextError} />
      </div>}

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
        {conceptos.some(c => c.quantitySource === 'GENERATORS') && <>
          <button className="soft" onClick={async () => { try{ exportGeneratorsPdf({ conceptos, projectName: activeProject?.name || '', projectId: activeProjectId, project: activeProject, logo: await loadOfficialLogo() }); }catch(err){ window.zoemecNotify?.(err.message, 'error'); } }}>Generadores PDF</button>
          <button className="soft" onClick={() => exportGeneratorsExcel({ conceptos, projectName: activeProject?.name || '', projectId: activeProjectId, project: activeProject }).catch(err => window.zoemecNotify?.(err.message, 'error'))}>Generadores Excel</button>
        </>}
        {batchSummary && <small className="muted">Último lote: {batchSummary.ok + (batchSummary.review || 0)} generado(s){batchSummary.review ? ` (${batchSummary.review} requieren revisión)` : ''}, {batchSummary.rateLimited || 0} pendiente(s) por límite{batchSummary.rateLimited && batchSummary.retryAfterSeconds ? ` (reintentar ${formatRetryAfter(batchSummary.retryAfterSeconds)})` : ''}, {batchSummary.failed} con error, de {batchSummary.total}.</small>}
        {!batchSummary && rateLimitedCount > 0 && <small className="muted">{rateLimitedCount} concepto(s) pendiente(s) por límite temporal: se reintentan con "Generar APU para conceptos pendientes" cuando termine la espera.</small>}
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
                    <td>{fmtQ(c.qty)}<div><small className="muted">{quantitySourceLabel(c)}</small></div>
                      {c.generatorsStale && <div><small style={{ color: 'var(--danger)' }} title="La geometría del plano cambió; la cantidad no se actualiza hasta que confirmes en el plano (Revisar generadores).">⚠ Generadores desactualizados{Object.values(c.generatorStaleness || {})[0] ? ` (${fmtQ(Object.values(c.generatorStaleness)[0].fromQty)} → ${fmtQ(Object.values(c.generatorStaleness)[0].toQty)})` : ''}</small></div>}</td>
                    <td><ConceptStatusBadge status={c.status} />{c.statusError && <div><small style={{ color: c.status === 'PENDIENTE_LIMITE' ? 'var(--muted)' : 'var(--danger)' }}>{c.statusError}</small></div>}{retryHint(c) && <div><small className="muted">{retryHint(c)}</small></div>}</td>
                    <td>
                      <div className="sc-actions">
                        {c.quantitySource === 'GENERATORS' && <button className="soft" onClick={() => setGeneratorsId(c.id)}>Ver generadores</button>}
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

      {generatorsId && (() => {
        const concepto = conceptos.find(c => c.id === generatorsId);
        if(!concepto) return null;
        return <GeneratorsViewer concepto={concepto} projectName={activeProject?.name || ''} projectId={activeProjectId} project={activeProject} onClose={() => setGeneratorsId(null)} />;
      })()}
    </section>
  );
}
