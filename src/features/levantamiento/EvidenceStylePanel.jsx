/* Fase 2 (evolucion integral, puente hacia Fase 3 "Propuesta con IA"):
   panel "Estilo y materiales" -- controlado, sin estado propio de negocio
   (todo vive en el `value` que le pasa el padre, normalizado siempre con
   normalizeStylePreferences antes de subir por onChange). Compartido entre
   PhoneScanSurveyForm.jsx e Import3DSurveyForm.jsx -- ambos wizards de
   evidencia deben ofrecer exactamente el mismo panel, nunca dos versiones
   que diverjan. */
import {
  STYLE_COLOR_OPTIONS, STYLE_MATERIAL_OPTIONS, ARCHITECTURAL_STYLE_OPTIONS,
  makeEmptyStylePreferences, normalizeStylePreferences
} from '../../domain/evidenceStylePreferences.js';
import { useI18n } from '../../i18n/I18nContext.jsx';

function toggleInList(list, value){
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value];
}

export function EvidenceStylePanel({ value, onChange }){
  const { t: tr } = useI18n();
  const prefs = value || makeEmptyStylePreferences();
  const update = (patch) => onChange(normalizeStylePreferences({ ...prefs, ...patch }));

  return <div className="evidence-style-panel">
    <h4 style={{ margin: '0 0 4px' }}>{tr('levantamiento.styleTitle')}</h4>
    <p className="muted" style={{ fontSize: '.78rem', marginTop: 0 }}>{tr('levantamiento.styleHint')}</p>

    <div className="nf wide" style={{ marginBottom: 8 }}>
      <label>{tr('levantamiento.styleColorsLabel')}</label>
      <div className="visual-actions" style={{ flexWrap: 'wrap' }}>
        {STYLE_COLOR_OPTIONS.map(color => (
          <button key={color} type="button" className={prefs.colors.includes(color) ? '' : 'soft'}
            onClick={() => update({ colors: toggleInList(prefs.colors, color) })}>
            {tr(`levantamiento.styleColor_${color}`)}
          </button>
        ))}
        <input
          type="color" value={prefs.customColorHex || '#888888'}
          onChange={e => update({ customColorHex: e.target.value })}
          title={tr('levantamiento.styleColorCustom')}
          style={{ width: 30, height: 30, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
        />
      </div>
    </div>

    <div className="nf wide" style={{ marginBottom: 8 }}>
      <label>{tr('levantamiento.styleMaterialsLabel')}</label>
      <div className="visual-actions" style={{ flexWrap: 'wrap' }}>
        {STYLE_MATERIAL_OPTIONS.map(material => (
          <button key={material} type="button" className={prefs.materials.includes(material) ? '' : 'soft'}
            onClick={() => update({ materials: toggleInList(prefs.materials, material) })}>
            {tr(`levantamiento.styleMaterial_${material}`)}
          </button>
        ))}
      </div>
    </div>

    <div className="nf wide" style={{ marginBottom: 8 }}>
      <label>{tr('levantamiento.styleFinishLabel')}</label>
      <input
        value={prefs.acabado} onChange={e => update({ acabado: e.target.value })}
        placeholder={tr('levantamiento.styleFinishPlaceholder')}
      />
    </div>

    <div className="nf wide">
      <label>{tr('levantamiento.styleArchStyleLabel')}</label>
      <div className="visual-actions" style={{ flexWrap: 'wrap' }}>
        {ARCHITECTURAL_STYLE_OPTIONS.map(estilo => (
          <button key={estilo} type="button" className={prefs.estilo === estilo ? '' : 'soft'}
            onClick={() => update({ estilo: prefs.estilo === estilo ? null : estilo })}>
            {tr(`levantamiento.styleArch_${estilo}`)}
          </button>
        ))}
      </div>
    </div>
  </div>;
}
