import { Icon } from './Icon.jsx';

/* Barra de pestanas contextual usada arriba de las pantallas que un mismo
   grupo de navegacion primario (Costos, Reportes) reagrupa. No sustituye
   la navegacion de cada pantalla -- solo la agrupa visualmente: cada boton
   sigue llamando a setModule con la misma clave que ya usaba el sidebar
   antiguo, asi que ninguna pantalla cambia de props ni de logica. */
export function SubNavTabs({items, active, onSelect}){
  return <div className="subnav-tabs" role="tablist">
    {items.map(({key,icon,label})=>
      <button key={key} role="tab" aria-selected={active===key} className={active===key?'active':''} onClick={()=>onSelect(key)}>
        {icon && <Icon name={icon} size={16}/>}
        <span>{label}</span>
      </button>
    )}
  </div>;
}
