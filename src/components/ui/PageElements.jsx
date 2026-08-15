import { Icon } from './Icon.jsx';

export function PageHead({kicker,title,desc,action}){return <div className="page-head"><div><span>{kicker}</span><h1>{title}</h1><p>{desc}</p></div>{action}</div>}

export function InfoCard({title,value,subtitle,actionLabel,onAction}){
  return <div className="info-card">
    <small>{title}</small>
    <b>{value}</b>
    <span>{subtitle}</span>
    {actionLabel && <button className="soft" onClick={onAction}>{actionLabel}</button>}
  </div>;
}

export function EmptyState({icon,title,text,actionLabel,onAction}){
  return <div className="empty-state">
    {icon && <span className="empty-state-icon"><Icon name={icon} size={30}/></span>}
    {title ? <><h3>{title}</h3><p>{text}</p></> : <p>{text}</p>}
    {actionLabel && onAction && <button className="soft" onClick={onAction}>{actionLabel}</button>}
  </div>;
}
