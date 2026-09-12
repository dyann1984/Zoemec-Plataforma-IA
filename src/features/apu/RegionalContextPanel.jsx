/* P1 (correccion de regresion en produccion, "la regionalizacion no es
   visible ni trazable"): bloque visible ARRIBA del generador de APU --
   nunca queda oculto solo en backend. Consume summarizeRegionalCoverage
   (src/domain/apuRegionalContext.js, puro y probado) -- este componente
   solo pinta lo que ese modulo ya calculo, nunca vuelve a decidir un
   nivel de cobertura o confianza por su cuenta. */
import { summarizeRegionalCoverage } from '../../domain/apuRegionalContext.js';

const LEVEL_LABEL = { ciudad: 'Ciudad', estado: 'Estado', nacional: 'País' };
const CONFIDENCE_LABEL = { ALTA: 'Alta', MEDIA: 'Media', BAJA: 'Baja' };

export function RegionalContextPanel({ apu, onConfigureLocation }){
  const summary = summarizeRegionalCoverage(apu);
  const { location } = summary;

  return <section className="pro-regional-context panel">
    <h3 className="pro-section-title pro-section-title-first">Contexto regional del APU</h3>
    {!summary.hasLocation
      ? <div className="survey-opening-warning">
          <p>Este proyecto no tiene ubicación definida. Selecciona País, Estado y Ciudad para obtener costos regionales.</p>
          {onConfigureLocation && <button type="button" className="soft" onClick={onConfigureLocation}>Configurar ubicación</button>}
        </div>
      : <div className="pro-header-grid">
          <div><small>País</small><b>{location.country || '—'}</b></div>
          <div><small>Estado</small><b>{location.state || '—'}</b></div>
          <div><small>Ciudad</small><b>{location.city || '—'}</b></div>
          <div><small>Cobertura de costos</small><b>{summary.primaryLevel ? LEVEL_LABEL[summary.primaryLevel] : 'Sin datos todavía'}</b></div>
          <div><small>Confianza regional</small><b>{summary.dominantConfidence ? CONFIDENCE_LABEL[summary.dominantConfidence] : 'Sin datos todavía'}</b></div>
        </div>}
    {summary.hasLocation && summary.rowsWithData === 0 && <p className="muted" style={{ fontSize: '.78rem', marginTop: 8 }}>
      Ningún insumo de este APU ha buscado precio regional todavía -- usa "Actualizar precios" o el panel de Inteligencia de Costos para obtenerlo.
    </p>}
    {summary.hasLocation && summary.rowsWithData > 0 && summary.rowsWithData < summary.totalRows && <p className="muted" style={{ fontSize: '.78rem', marginTop: 8 }}>
      {summary.rowsWithData} de {summary.totalRows} insumo(s) ya tienen contexto regional -- el resto sigue con el precio capturado, sin buscar todavía.
    </p>}
  </section>;
}
