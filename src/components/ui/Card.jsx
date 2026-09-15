/* Tarjeta base del nuevo sistema visual (rediseno light-first): fondo
   blanco, borde 1px muy suave, radius 12px, sombra casi nula, padding
   generoso -- ver .card en style.css. Reemplaza los "cuadro dentro de
   cuadro" del dashboard anterior; una Card no anida otra Card. */
export function Card({children, className='', onClick, title, action}){
  const clickable = typeof onClick === 'function';
  return <div
    className={'card'+(clickable?' card-clickable':'')+(className?' '+className:'')}
    onClick={onClick}
    role={clickable?'button':undefined}
    tabIndex={clickable?0:undefined}
    onKeyDown={clickable?(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); onClick(e); } }:undefined}
  >
    {(title || action) && <div className="card-head">{title && <h3>{title}</h3>}{action}</div>}
    {children}
  </div>;
}
