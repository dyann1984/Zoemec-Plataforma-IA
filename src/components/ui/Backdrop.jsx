export function Backdrop(){
  return <svg className="backdrop" viewBox="0 0 1440 760" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <g className="bd-sky" stroke="currentColor" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      {/* edificio alto */}
      <rect x="120" y="300" width="150" height="380"/>
      {[330,370,410,450,490,530,570,610].map(y=><g key={y}><line x1="140" y1={y} x2="250" y2={y}/></g>)}
      {[160,195,230].map(x=><line key={x} x1={x} y1="300" x2={x} y2="680"/>)}
      {/* edificio medio */}
      <rect x="300" y="420" width="120" height="260"/>
      {[450,490,530,570,610,650].map(y=><line key={y} x1="316" y1={y} x2="404" y2={y}/>)}
      <line x1="360" y1="420" x2="360" y2="680"/>
      {/* torre derecha */}
      <rect x="1140" y="250" width="170" height="430"/>
      {[290,335,380,425,470,515,560,605,650].map(y=><line key={y} x1="1158" y1={y} x2="1292" y2={y}/>)}
      {[1180,1225,1270].map(x=><line key={x} x1={x} y1="250" x2={x} y2="680"/>)}
      {/* casa baja */}
      <path d="M470 680V560h140v120M460 560l80-50 80 50"/>
    </g>
    {/* grúa torre */}
    <g className="bd-crane" stroke="currentColor" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1="820" y1="680" x2="820" y2="180"/>
      <line x1="806" y1="680" x2="834" y2="680"/>
      <path d="M820 200l-26 26M820 240l-26 26M820 280l-26 26M820 320l-26 26M820 360l-26 26M820 200l26 26M820 240l26 26M820 280l26 26M820 320l26 26M820 360l26 26" strokeWidth="1"/>
      {/* pluma + contrapluma */}
      <line x1="600" y1="170" x2="1060" y2="170"/>
      <line x1="820" y1="150" x2="650" y2="170"/>
      <line x1="820" y1="150" x2="1000" y2="170"/>
      <path d="M600 170l40-0M680 170v0" strokeWidth="1"/>
      <line x1="620" y1="170" x2="640" y2="185"/>
      {/* cable + gancho (se mueve) */}
      <g className="bd-hook"><line x1="980" y1="170" x2="980" y2="300"/><path d="M974 300a6 6 0 1012 0v8a8 8 0 01-16 0"/></g>
    </g>
    {/* datum punteado que fluye */}
    <line className="bd-datum" x1="0" y1="700" x2="1440" y2="700" stroke="currentColor" strokeWidth="1.4" strokeDasharray="10 10"/>
  </svg>;
}
