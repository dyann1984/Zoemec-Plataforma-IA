import { useEffect, useRef, useState } from 'react';

/* Menu de usuario del header nuevo (rediseno light-first): saca del topbar
   principal todo lo que no es "identidad + notificaciones" (tema, idioma,
   estado de servicios, cerrar sesion) sin eliminar nada -- se abre con un
   clic sobre el avatar, mismo patron de popover que "Crear +" en el
   sidebar. `children` es libre para que quien lo use decida que va dentro
   (los componentes CloudBadge/ProcessesIndicator/etc. viven en main.jsx). */
export function UserMenu({avatarLabel, name, subtitle, children}){
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if(!open) return;
    const onKey = (e) => { if(e.key === 'Escape') setOpen(false); };
    const onClick = (e) => { if(ref.current && !ref.current.contains(e.target)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick); };
  }, [open]);
  return <div className="user-menu" ref={ref}>
    <button type="button" className="user-menu-trigger" onClick={()=>setOpen(v=>!v)} aria-haspopup="true" aria-expanded={open}>
      <span className="avatar">{avatarLabel}</span>
      <span className="user-menu-name">{name}</span>
    </button>
    {open && <div className="user-menu-panel" role="menu">
      {subtitle && <div className="user-menu-subtitle">{subtitle}</div>}
      {children}
    </div>}
  </div>;
}
