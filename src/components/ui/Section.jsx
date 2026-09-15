/* Agrupador de secciones del nuevo dashboard/pantallas (rediseno light-first):
   un titulo H2 con aire real arriba y abajo, en vez de apilar paneles sin
   jerarquia. No es una Card -- no tiene fondo ni borde propio. */
export function Section({title, desc, action, children, className=''}){
  return <section className={'section'+(className?' '+className:'')}>
    <div className="section-head">
      <div>
        <h2>{title}</h2>
        {desc && <p>{desc}</p>}
      </div>
      {action}
    </div>
    {children}
  </section>;
}
