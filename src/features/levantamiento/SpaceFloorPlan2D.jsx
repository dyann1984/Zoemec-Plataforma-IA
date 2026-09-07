import { useI18n } from '../../i18n/I18nContext.jsx';
import { buildSpaceGeometryModel } from '../../domain/surveyGeometryModel.js';
import { ELEMENT_TYPE } from '../../domain/levantamientoSchema.js';

const fmt = (n) => (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* Plano 2D automatico de un Space (Fase 1.5, seccion 5 del pedido). Lee
   EXCLUSIVAMENTE de src/domain/surveyGeometryModel.js (la misma fuente que
   usa Survey3DViewer.jsx) -- ningun calculo de muros/posicion propio aqui,
   para que plano 2D y modelo 3D nunca puedan discrepar entre si.

   SVG puro -- sin canvas, sin libreria de dibujo -- porque la geometria ya
   es vectorial (largo/ancho reales), no un trazo sobre una imagen escaneada
   (eso es src/main.jsx#PlanoManualMeasure, que trabaja sobre pixeles de una
   imagen real; no se reutiliza aqui porque no acepta geometria sintetica).
   Responsive por diseno: usa viewBox en vez de un ancho fijo en px. */
export function SpaceFloorPlan2D({ space }){
  const { t: tr } = useI18n();
  const length = Number(space?.length) || 0;
  const width = Number(space?.width) || 0;

  if(!(length > 0) || !(width > 0)){
    return <div className="panel"><p className="muted">{tr('levantamiento.plan2dNeedsDimsMsg')}</p></div>;
  }

  const model = buildSpaceGeometryModel(space);
  const openingsWithWarnings = model.openings.filter(o => o.warnings.length > 0);

  const PAD = Math.max(length, width) * 0.18 + 0.6; // margen para cotas/etiquetas, proporcional al tamaño del espacio
  const viewW = length + PAD * 2;
  const viewH = width + PAD * 2;
  const ox = PAD, oy = PAD; // origen del rectangulo dentro del viewBox
  const dimFont = Math.max(length, width) * 0.032;
  const wallLabelFont = dimFont * 0.9;
  const thickness = Math.max(length, width) * 0.018;

  let doorIdx = 0, windowIdx = 0;
  const openingLabels = new Map(model.openings.map(op => {
    const isDoor = op.type === ELEMENT_TYPE.DOOR;
    return [op.id, isDoor ? `P-${String(++doorIdx).padStart(2, '0')}` : `V-${String(++windowIdx).padStart(2, '0')}`];
  }));

  return <div className="survey-plan2d">
    {openingsWithWarnings.length > 0 && <p className="muted survey-plan2d-warning">{tr('levantamiento.wallWarningTitle')}</p>}
    <svg viewBox={`0 0 ${viewW} ${viewH}`} className="survey-plan2d-svg" role="img" aria-label={tr('levantamiento.plan2dAriaLabel', { name: space.name || '' })}>
      {/* Muros como segmentos reales (huecos donde hay puerta/ventana) -- misma
          tejeduria que usa el modelo 3D (surveyGeometryModel.js#buildWallSegments),
          pero en planta (vista de arriba) solo importa si un tramo llega de piso
          a techo: un segmento de dintel (sobre una puerta) o de pretil (bajo una
          ventana) NUNCA llega de piso a techo, asi que aqui se excluyen -- de lo
          contrario el hueco se veria "tapado" por la linea del muro y solo se
          notaria el simbolo de puerta/ventana encima, no un hueco real. */}
      {model.walls.map(wall => wall.segments.filter(seg => seg.yBase === 0 && seg.yTop === wall.height).map((seg, i) => {
        const t0 = wall.length > 0 ? seg.x0 / wall.length : 0;
        const t1 = wall.length > 0 ? seg.x1 / wall.length : 1;
        const p0 = { x: ox + wall.from.x + (wall.to.x - wall.from.x) * t0, y: oy + wall.from.y + (wall.to.y - wall.from.y) * t0 };
        const p1 = { x: ox + wall.from.x + (wall.to.x - wall.from.x) * t1, y: oy + wall.from.y + (wall.to.y - wall.from.y) * t1 };
        return <line key={`${wall.id}-${i}`} x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke="var(--ink,#1a1a1a)" strokeWidth={Math.max(length, width) * 0.012} />;
      }))}

      {/* Cotas + etiquetas de muro. Los muros horizontales (M-01/M-03) apilan
          cota+etiqueta VERTICALMENTE (misma X, distinta Y) porque el texto
          fluye horizontal -- apilar asi nunca se traslapa. Los muros
          verticales (M-02/M-04) son el caso espejo: si se apilaran por X en
          vez de por Y, dos textos horizontales cercanos SI se traslapan (el
          ancho del texto no depende de la orientacion del muro) -- por eso
          aqui se separan a lo largo del propio muro (distinto punto t) con
          un mismo offset de salida chico, igual que el patron horizontal
          pero con los ejes intercambiados. */}
      {model.walls.map((wall, i) => {
        const midX = ox + (wall.from.x + wall.to.x) / 2;
        const midY = oy + (wall.from.y + wall.to.y) / 2;
        const isHorizontal = i % 2 === 0;
        if(isHorizontal){
          const dimOffset = i === 0 ? -PAD * 0.2 : PAD * 0.2;
          const labelOffset = i === 0 ? -PAD * 0.45 : PAD * 0.45;
          return <g key={wall.id}>
            <text x={midX} y={midY + dimOffset} fontSize={dimFont} textAnchor="middle" fill="var(--ink,#1a1a1a)">{fmt(wall.length)} m</text>
            <text x={midX} y={midY + labelOffset} fontSize={wallLabelFont} textAnchor="middle" fill="var(--muted,#888)">{wall.id}</text>
          </g>;
        }
        const outX = i === 1 ? PAD * 0.3 : -PAD * 0.3;
        const dimY = oy + wall.from.y + (wall.to.y - wall.from.y) * 0.32;
        const labelY = oy + wall.from.y + (wall.to.y - wall.from.y) * 0.7;
        return <g key={wall.id}>
          <text x={midX + outX} y={dimY} fontSize={dimFont} textAnchor="middle" fill="var(--ink,#1a1a1a)">{fmt(wall.length)} m</text>
          <text x={midX + outX} y={labelY} fontSize={wallLabelFont} textAnchor="middle" fill="var(--muted,#888)">{wall.id}</text>
        </g>;
      })}

      {/* Puertas y ventanas, en el hueco resuelto por el modelo. La etiqueta
          (P-XX/V-XX) se desplaza hacia AFUERA del muro que la contiene --
          -Y para M-01, +Y para M-03, +X para M-02, -X para M-04 -- nunca a
          lo largo del muro (eso la haria chocar con la cota/etiqueta del
          propio muro calculadas arriba). */}
      {model.openings.map(op => {
        const wallIndex = model.walls.findIndex(w => w.id === op.wallId);
        const cx = ox + op.center.x;
        const cy = oy + op.center.y;
        const isDoor = op.type === ELEMENT_TYPE.DOOR;
        const label = openingLabels.get(op.id);
        const hasWarning = op.warnings.length > 0;
        const halfW = (Number(op.width) || 0.6) / 2;
        const dx = Math.cos(op.angle) * halfW;
        const dy = Math.sin(op.angle) * halfW;
        const labelOut = thickness * 4 + wallLabelFont * 0.6;
        const labelX = wallIndex === 1 ? cx + labelOut : wallIndex === 3 ? cx - labelOut : cx;
        const labelY = wallIndex === 0 ? cy - labelOut : wallIndex === 2 ? cy + labelOut : cy;
        return <g key={op.id}>
          {isDoor
            ? <>
                <line x1={cx - dx} y1={cy - dy} x2={cx + dx} y2={cy + dy} stroke={hasWarning ? 'var(--danger,#c0392b)' : 'var(--accent,#8a5a34)'} strokeWidth={thickness * 2.2} strokeDasharray={hasWarning ? '2,2' : undefined} />
                <path d={`M ${cx - dx} ${cy - dy} A ${halfW * 2} ${halfW * 2} 0 0 1 ${cx - dx + dy * 1.4} ${cy - dy - dx * 1.4}`} fill="none" stroke="var(--accent,#8a5a34)" strokeWidth={thickness * 0.5} strokeDasharray="3,2" />
              </>
            : <line x1={cx - dx} y1={cy - dy} x2={cx + dx} y2={cy + dy} stroke={hasWarning ? 'var(--danger,#c0392b)' : 'var(--info,#2f7fd1)'} strokeWidth={thickness * 2.2} strokeDasharray={hasWarning ? '2,2' : `${thickness * 1.5},${thickness}`} />}
          <text x={labelX} y={labelY} fontSize={wallLabelFont} textAnchor="middle" fill={hasWarning ? 'var(--danger,#c0392b)' : 'var(--ink,#1a1a1a)'}>{label}{hasWarning ? ' ⚠' : ''}</text>
        </g>;
      })}

      {/* Area en el centro */}
      <text x={ox + length / 2} y={oy + width / 2} fontSize={dimFont * 1.3} textAnchor="middle" dominantBaseline="middle" fill="var(--ink,#1a1a1a)" fontWeight="600">
        {fmt(model.geometry.floorArea)} m²
      </text>
    </svg>
    <p className="muted survey-plan2d-caption">{tr('levantamiento.plan2dCaption', { doors: model.openings.filter(o => o.type === ELEMENT_TYPE.DOOR).length, windows: model.openings.filter(o => o.type === ELEMENT_TYPE.WINDOW).length })}</p>
  </div>;
}
