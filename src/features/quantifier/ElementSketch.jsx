/* Render SVG del croquis tecnico automatico (Fase B -- Cuantificador
   Parametrico ZOEMEC). Puramente presentacional: convierte los
   descriptores de src/domain/parametricSketch.js en SVG -- misma tecnica
   que src/features/levantamiento/SpaceFloorPlan2D.jsx (viewBox
   proporcional, sin libreria de dibujo), sin logica de negocio propia.

   Etiqueta obligatoria (pedido explicito): esto NUNCA es un plano
   estructural ejecutivo -- "Detalle técnico paramétrico generado por
   ZOEMEC" debe ser visible siempre que se muestre este croquis. */
import { useI18n } from '../../i18n/I18nContext.jsx';
import { buildElementSketch } from '../../domain/parametricSketch.js';

function renderElement(el, i){
  if(el.type === 'rect') return <rect key={i} x={el.x} y={el.y} width={el.w} height={el.h} fill={el.fill || 'none'} stroke={el.stroke} strokeWidth={el.strokeWidth} />;
  if(el.type === 'line') return <line key={i} x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} stroke={el.stroke} strokeWidth={el.strokeWidth} />;
  if(el.type === 'circle') return <circle key={i} cx={el.cx} cy={el.cy} r={el.r} fill={el.fill} />;
  if(el.type === 'text') return <text key={i} x={el.x} y={el.y} fontSize={el.size} textAnchor={el.anchor || 'middle'} fill={el.fill}>{el.text}</text>;
  return null;
}

export function ElementSketch({ elementId, inputs, params }){
  const { t: tr } = useI18n();
  const views = buildElementSketch(elementId, inputs, params);
  if(!views.length) return <p className="muted">{tr('levantamiento.quantSketchNeedsDataMsg')}</p>;

  return <div className="quant-sketch">
    <p className="quant-sketch-label">{tr('levantamiento.quantSketchLabel')}</p>
    <div className="quant-sketch-views">
      {views.map(view => <div key={view.id} className="quant-sketch-view">
        <svg viewBox={`0 0 ${view.width} ${view.height}`} role="img" aria-label={view.label}>
          {view.elements.map(renderElement)}
        </svg>
        <span className="muted">{view.label}</span>
      </div>)}
    </div>
    <p className="muted quant-sketch-caption">{tr('levantamiento.quantSketchCaption')}</p>
  </div>;
}
