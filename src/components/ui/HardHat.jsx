export function HardHat({size=46}){
  return <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="38" r="16" fill="#ffe0c2"/>
    <path d="M22 36c0 6 4 11 10 11s10-5 10-11" fill="none" stroke="var(--petrol)" strokeWidth="2" strokeLinecap="round"/>
    <circle cx="27" cy="38" r="1.8" fill="var(--petrol)"/><circle cx="37" cy="38" r="1.8" fill="var(--petrol)"/>
    <path d="M16 30a16 16 0 0132 0z" fill="#D6A23E"/>
    <rect x="13" y="29" width="38" height="4.5" rx="2.2" fill="#c08f2f"/>
    <rect x="30.5" y="14" width="3" height="14" rx="1.5" fill="#c08f2f"/>
  </svg>;
}
