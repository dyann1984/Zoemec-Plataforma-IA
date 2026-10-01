/* F3 -- "Ver generadores" de un concepto del Catalogo. Muestra, sin
   recalcular nada, los generadores PERSISTIDOS del concepto: elemento,
   operacion, deducciones, neto, estado y total = concepto.qty. Mismas filas
   que el exportador (buildGeneratorReport), para que pantalla y documento
   nunca difieran. */
import { buildGeneratorReport, exportGeneratorsPdf, exportGeneratorsExcel } from '../../lib/generatorsExport.js';
import { fmtQ, GENERATOR_STATUS } from '../../domain/quantityGenerators.js';
import { loadOfficialLogo } from '../../lib/reports/reportPdfKit.js';

export function quantitySourceLabel(c){
  if(c?.quantitySource === 'GENERATORS'){
    const n = (c.elementIds || []).length;
    return `Generadores · ${n} elemento${n === 1 ? '' : 's'} del plano`;
  }
  return 'Manual';
}

export function GeneratorsViewer({ concepto, projectName, projectId, project = null, onClose }){
  const [r] = buildGeneratorReport([concepto]);
  const last = (concepto.quantityHistory || []).slice(-1)[0] || null;
  return <div className="record-modal" role="dialog" aria-modal="true" aria-label="Generadores del concepto">
    <div className="record-backdrop" onClick={onClose}></div>
    <div className="panel record-form" style={{ maxWidth: 900, width: '95vw' }}>
      <div className="record-form-head">
        <div><span>Números generadores</span><h2>{concepto.clave ? `${concepto.clave} · ` : ''}{concepto.concept}</h2></div>
        <button type="button" className="secondary" onClick={onClose}>Cerrar</button>
      </div>
      {!r ? <p className="muted">Este concepto tiene cantidad manual: no proviene de elementos del plano.</p> : <>
        <p style={{ margin: '0 0 8px' }}>
          <b>Cantidad: {fmtQ(r.qty)} {r.unit}</b> <span className="muted">· Origen: {r.elements.length} elemento(s) del plano</span>
          {!r.cuadra && <b style={{ color: 'var(--danger)' }}> · NO CUADRA con la suma de generadores ({fmtQ(r.total)})</b>}
        </p>
        {concepto.generatorsStale && <p style={{ color: 'var(--danger)', margin: '0 0 8px' }}>
          <b>Generadores desactualizados</b>: la geometría del plano cambió. {Object.values(concepto.generatorStaleness || {}).map(st => `${fmtQ(st.fromQty)} → ${fmtQ(st.toQty)} ${r.unit} (${(st.changes || []).map(ch => `${ch.elementId}: ${fmtQ(ch.from)} → ${fmtQ(ch.to)}`).join(', ')})`).join(' · ')}. Confirma en el plano con “Revisar generadores”; el presupuesto no cambia hasta entonces.
        </p>}
        {(r.incomplete.length > 0 || r.inconsistent.length > 0) && <p style={{ color: 'var(--danger)', margin: '0 0 8px' }}>
          {r.incomplete.length > 0 && <>Incompletos (no suman): {r.incomplete.join(', ')}. </>}
          {r.inconsistent.length > 0 && <>Inconsistentes (deducciones &gt; bruto): {r.inconsistent.join(', ')}.</>}
        </p>}
        <div className="apu-table-scroll"><table className="budget-table">
          <thead><tr><th>Elemento</th><th>Operación</th><th>Bruto</th><th>Deducción</th><th>Neto</th><th>Estado</th></tr></thead>
          <tbody>
            {r.elements.map(e => [
              <tr key={e.code}>
                <td><b>{e.code}</b></td><td>{e.expression}</td>
                <td>{e.status === GENERATOR_STATUS.INCOMPLETO ? '—' : fmtQ(e.gross)}</td><td />
                <td><b>{e.status === GENERATOR_STATUS.INCOMPLETO ? '—' : fmtQ(e.net)}</b></td>
                <td>{e.status}{e.counted ? '' : ' (no suma)'}</td>
              </tr>,
              ...e.deductions.map((d, i) => <tr key={`${e.code}-d${i}`} className="muted"><td /><td>− {d.description} {d.expression}{d.note ? ` (${d.note})` : ''}</td><td /><td>{fmtQ(d.quantity)}</td><td /><td /></tr>),
              ...e.issues.map((msg, i) => <tr key={`${e.code}-i${i}`}><td /><td colSpan={5}><small style={{ color: 'var(--danger)' }}>! {msg}</small></td></tr>)
            ])}
            <tr><td><b>TOTAL</b></td><td /><td /><td /><td><b>{fmtQ(r.total)} {r.unit}</b></td><td /></tr>
          </tbody>
        </table></div>
        {last && <p className="muted" style={{ fontSize: '.8rem' }}>
          Último cambio: {fmtQ(last.from)} → {fmtQ(last.to)} {r.unit} · {last.at ? new Date(last.at).toLocaleString('es-MX') : ''} · {last.actor || ''}{last.planoRevision != null ? ` · rev. ${last.planoRevision} del plano` : ''}{last.revision ? ` · revisión ${last.revision} de generadores` : ''}
          {(last.changes || []).length > 0 && <> · {(last.changes || []).map(ch => `${ch.elementId}: ${fmtQ(ch.from)}→${fmtQ(ch.to)}`).join(', ')}</>}
        </p>}
        <div className="form-actions">
          <button type="button" className="soft" onClick={async () => exportGeneratorsPdf({ conceptos: [concepto], projectName, projectId, project, logo: await loadOfficialLogo() })}>PDF</button>
          <button type="button" className="soft" onClick={() => exportGeneratorsExcel({ conceptos: [concepto], projectName, projectId, project })}>Excel</button>
        </div>
      </>}
    </div>
  </div>;
}
