import { NField } from '../../components/ui/FormFields.jsx';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { ELEMENT_TYPE, makeEmptyElement } from '../../domain/levantamientoSchema.js';
import { computeSpaceGeometry } from '../../lib/levantamientoCalc.js';

const fmt = (n) => (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* Tarjeta de captura/edicion de un espacio (room). Usada tanto en
   ManualSurveyForm (alta de un levantamiento nuevo) como en SurveyDetail
   (edicion de un levantamiento ya guardado) -- misma UI, mismo comportamiento
   en ambos lados del flujo. */
export function SpaceCard({ space, onUpdate, onRemove }){
  const { t: tr } = useI18n();
  const geometry = computeSpaceGeometry(space);
  const doors = space.elements.filter(e => e.type === ELEMENT_TYPE.DOOR);
  const windows = space.elements.filter(e => e.type === ELEMENT_TYPE.WINDOW);

  const setField = (field, value) => onUpdate({ ...space, [field]: value });
  const addElement = (type, defaults) => onUpdate({ ...space, elements: [...space.elements, makeEmptyElement({ type, ...defaults })] });
  const updateElement = (id, field, value) => onUpdate({ ...space, elements: space.elements.map(e => e.id === id ? { ...e, [field]: value } : e) });
  const removeElement = (id) => onUpdate({ ...space, elements: space.elements.filter(e => e.id !== id) });

  return <div className="survey-space-card">
    <div className="survey-space-head">
      <div className="nf wide"><label>{tr('levantamiento.spaceNameLabel')}</label><input value={space.name} onChange={e => setField('name', e.target.value)} placeholder={tr('levantamiento.spaceNamePlaceholder')} /></div>
      {onRemove && <a onClick={onRemove} style={{ color: 'var(--danger)', cursor: 'pointer' }}>{tr('levantamiento.removeSpace')}</a>}
    </div>
    <div className="field-grid">
      <NField label={tr('levantamiento.lengthLabel')} value={space.length} on={v => setField('length', v)} />
      <NField label={tr('levantamiento.widthLabel')} value={space.width} on={v => setField('width', v)} />
      <NField label={tr('levantamiento.heightLabel')} value={space.height} on={v => setField('height', v)} />
    </div>
    <div className="survey-stat-grid">
      <div><small>{tr('levantamiento.floorAreaLabel')}</small><b>{fmt(geometry.floorArea)} m²</b></div>
      <div><small>{tr('levantamiento.ceilingAreaLabel')}</small><b>{fmt(geometry.ceilingArea)} m²</b></div>
      <div><small>{tr('levantamiento.perimeterLabel')}</small><b>{fmt(geometry.perimeter)} ml</b></div>
      <div><small>{tr('levantamiento.wallGrossLabel')}</small><b>{fmt(geometry.wallGrossArea)} m²</b></div>
      <div><small>{tr('levantamiento.wallNetLabel')}</small><b>{fmt(geometry.wallNetArea)} m²</b></div>
      <div><small>{tr('levantamiento.volumeLabel')}</small><b>{fmt(geometry.volume)} m³</b></div>
    </div>

    <div className="survey-elements-block">
      <div className="survey-elements-head"><b>{tr('levantamiento.doorsLabel')}</b><button type="button" className="soft" onClick={() => addElement(ELEMENT_TYPE.DOOR, { width: 0.9, height: 2.1, quantity: 1 })}>{tr('levantamiento.addDoor')}</button></div>
      {doors.map(door => <div className="survey-element-row" key={door.id}>
        <NField label={tr('levantamiento.elementWidthLabel')} value={door.width} on={v => updateElement(door.id, 'width', v)} />
        <NField label={tr('levantamiento.elementHeightLabel')} value={door.height} on={v => updateElement(door.id, 'height', v)} />
        <NField label={tr('levantamiento.elementQtyLabel')} value={door.quantity} on={v => updateElement(door.id, 'quantity', v)} step="1" />
        <a onClick={() => removeElement(door.id)} style={{ color: 'var(--danger)', cursor: 'pointer' }}>{tr('levantamiento.remove')}</a>
      </div>)}
    </div>

    <div className="survey-elements-block">
      <div className="survey-elements-head"><b>{tr('levantamiento.windowsLabel')}</b><button type="button" className="soft" onClick={() => addElement(ELEMENT_TYPE.WINDOW, { width: 1.2, height: 1.2, quantity: 1 })}>{tr('levantamiento.addWindow')}</button></div>
      {windows.map(win => <div className="survey-element-row" key={win.id}>
        <NField label={tr('levantamiento.elementWidthLabel')} value={win.width} on={v => updateElement(win.id, 'width', v)} />
        <NField label={tr('levantamiento.elementHeightLabel')} value={win.height} on={v => updateElement(win.id, 'height', v)} />
        <NField label={tr('levantamiento.elementQtyLabel')} value={win.quantity} on={v => updateElement(win.id, 'quantity', v)} step="1" />
        <a onClick={() => removeElement(win.id)} style={{ color: 'var(--danger)', cursor: 'pointer' }}>{tr('levantamiento.remove')}</a>
      </div>)}
    </div>
  </div>;
}
