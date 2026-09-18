/* "Asociar APU existente" (Fase D): busca por clave/descripcion/unidad/
   capitulo/region contra los APUs reales del usuario/organizacion (mismo
   arreglo `rawApus` que ya carga main.jsx), usando el motor de matching
   src/domain/apuMatchLookup.js#rankApuMatches (clon deliberado del pipeline
   de catalogLookup.js, ver ese archivo). Muestra el nivel de coincidencia
   ANTES de asociar -- nunca asocia solo. */
import { useMemo, useState } from 'react';
import { rankApuMatches } from '../../domain/apuMatchLookup.js';
import { money } from '../../lib/apuExport.js';

/* Reusa el sistema de badges de severidad ya establecido por
   ZoemecIntelligencePanel.jsx#CONFIDENCE_BADGE_CLASS (.zi-badge-*, src/style.css
   ~linea 2812) -- mismo vocabulario visual que confianza/Bid Risk en el
   resto de la app (alta confianza = clase "medium", visualmente calma;
   baja confianza = clase "critical"), nunca un semaforo rojo/amarillo/verde
   inventado aqui. */
function confidenceLabel(c){
  if(c >= 0.65) return { text: 'Alta', className: 'zi-badge-medium' };
  if(c >= 0.4) return { text: 'Media', className: 'zi-badge-high' };
  return { text: 'Baja', className: 'zi-badge-critical' };
}

export function ApuAssociationSearch({ concepto, apus, onAssociate, onClose }){
  const [query, setQuery] = useState(concepto.concept || '');
  const region = concepto.ubicacionEstructurada || null;

  const results = useMemo(() => {
    return rankApuMatches(apus, { desc: query, unidad: concepto.unit, clave: concepto.clave, capitulo: concepto.capitulo, region }, { limit: 8 });
  }, [apus, query, concepto.unit, concepto.clave, concepto.capitulo, region]);

  return (
    <div className="record-modal" role="dialog" aria-modal="true">
      <div className="record-backdrop" onClick={onClose}></div>
      <div className="panel record-form" style={{ maxWidth: 640 }}>
        <div className="record-form-head">
          <div><span>Catálogo de conceptos</span><h2>Asociar APU existente</h2></div>
          <button type="button" className="secondary" onClick={onClose}>Cerrar</button>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Concepto: <b>{concepto.concept}</b> · {concepto.unit} · {concepto.qty}
        </p>
        <div className="nf" style={{ marginBottom: 12 }}>
          <label>Buscar por descripción</label>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Describe el concepto para buscar coincidencias..." />
        </div>
        {!results.length && <p className="muted">Sin coincidencias reales todavía. Ajusta el texto de búsqueda o genera un APU nuevo para este concepto.</p>}
        <div className="apu-table-scroll">
          {results.map((r, idx) => {
            const conf = confidenceLabel(r.confidence);
            return (
              <div key={r.match.id || idx} className="saved-card" style={{ marginBottom: 8 }}>
                <div className="sc-clave">{r.match.clave || r.match.standardClave || 'Sin clave'} · {r.match.unit}</div>
                <div className="sc-concept">{r.match.concept}</div>
                <div className="sc-pu">
                  {money(r.match.calculated?.pu || r.match.pu || 0)} <small>por {r.match.unit}</small>
                </div>
                <div className="sc-actions" style={{ alignItems: 'center', gap: 8 }}>
                  <span className={`zi-badge ${conf.className}`}>{conf.text} · {Math.round(r.confidence * 100)}%</span>
                  {r.sameRegion === false && <small className="muted">de otra región</small>}
                  <button onClick={() => onAssociate(r.match.id, { matchConfidence: r.confidence, matchMethod: r.matchMethod })}>Asociar</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
