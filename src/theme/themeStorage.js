/* Logica pura de persistencia del tema, separada de ThemeContext.jsx a
   proposito: ese archivo tiene JSX, y node --test (sin Vite/Babel de por
   medio) no puede parsear JSX -- importar algo de un .jsx ahi truena con
   SyntaxError antes de correr un solo assert. Este archivo es JS plano,
   se puede importar tanto desde ThemeContext.jsx (Vite lo transpila
   normal) como desde ThemeContext.test.js (node --test, sin transpilar). */
export const STORAGE_KEY = 'zoemec-theme';

/* Precedencia: 1) preferencia guardada explicitamente por el usuario,
   2) prefers-color-scheme del sistema operativo/navegador (si nunca
   eligio nada), 3) 'light' si ninguno de los dos esta disponible (ej.
   bajo node --test plano, sin window). */
export function readInitialTheme(){
  try{
    const stored = localStorage.getItem(STORAGE_KEY);
    if(stored === 'light' || stored === 'dark') return stored;
  }catch{ /* almacenamiento no disponible */ }
  try{
    if(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches){
      return 'dark';
    }
  }catch{ /* matchMedia no disponible */ }
  return 'light';
}
