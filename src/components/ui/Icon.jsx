import { ICONS } from '../../config/icons.jsx';

export function Icon({name,size=20}){
  return <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]||ICONS.doc}</svg>;
}
