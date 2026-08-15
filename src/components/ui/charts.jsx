/* Graficas SVG ligeras (sin librerias externas): dona de segmentos y
   sparkline. Puramente presentacionales, sin logica de negocio. */

export function Donut({segments,size=150,thickness=22,center,sub}){
  const total=segments.reduce((a,s)=>a+(s.value||0),0)||1;
  const r=(size-thickness)/2, c=2*Math.PI*r; let off=0;
  return <div className="donut-wrap"><svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="donut">
    <g transform={`rotate(-90 ${size/2} ${size/2})`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--line)" strokeWidth={thickness}/>
      {segments.map((s,i)=>{const len=(s.value/total)*c; const el=<circle key={i} cx={size/2} cy={size/2} r={r} fill="none" stroke={s.color} strokeWidth={thickness} strokeDasharray={`${len} ${c-len}`} strokeDashoffset={-off}/>; off+=len; return el;})}
    </g>
    {center!==undefined && <text x="50%" y="46%" textAnchor="middle" className="donut-c">{center}</text>}
    {sub && <text x="50%" y="60%" textAnchor="middle" className="donut-s">{sub}</text>}
  </svg></div>;
}

export function Spark({points,h=72,color='var(--teal)'}){
  const w=300, max=Math.max(...points), min=Math.min(...points), rng=(max-min)||1, step=w/(points.length-1);
  const pts=points.map((p,i)=>`${i*step},${h-((p-min)/rng)*(h-14)-7}`).join(' ');
  return <svg viewBox={`0 0 ${w} ${h}`} className="spark" preserveAspectRatio="none" width="100%" height={h}>
    <polygon points={`0,${h} ${pts} ${w},${h}`} fill="var(--mint)"/>
    <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
  </svg>;
}
