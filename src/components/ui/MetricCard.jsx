/* Tile de metrica del nuevo dashboard (rediseno light-first): reemplaza los
   ".precon-block"/".kpi-tile"/".status-card" oscuros y heterogeneos por una
   sola tarjeta consistente. `tone` solo colorea el valor (nunca el fondo
   completo de la tarjeta) para no volver a la "coleccion de cajas de color"
   -- 'good'|'warn'|'bad'|'neutral' (default). */
export function MetricCard({label, value, hint, tone='neutral', onClick}){
  const clickable = typeof onClick === 'function';
  return <div
    className={'metric-card'+(clickable?' metric-card-clickable':'')}
    onClick={onClick}
    role={clickable?'button':undefined}
    tabIndex={clickable?0:undefined}
    onKeyDown={clickable?(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); onClick(e); } }:undefined}
  >
    <span className="metric-card-label">{label}</span>
    <b className={'metric-card-value tone-'+tone}>{value}</b>
    {hint && <span className="metric-card-hint">{hint}</span>}
  </div>;
}
