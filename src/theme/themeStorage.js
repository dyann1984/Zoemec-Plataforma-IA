/* Logica pura de persistencia del tema, separada de ThemeContext.jsx a
   proposito: ese archivo tiene JSX, y node --test (sin Vite/Babel de por
   medio) no puede parsear JSX -- importar algo de un .jsx ahi truena con
   SyntaxError antes de correr un solo assert. Este archivo es JS plano,
   se puede importar tanto desde ThemeContext.jsx (Vite lo transpila
   normal) como desde ThemeContext.test.js (node --test, sin transpilar). */
export const STORAGE_KEY = 'zoemec-theme';

/* Precedencia (cambio deliberado: claro por defecto): 1) preferencia
   guardada explicitamente por el usuario, 2) 'light' siempre que no haya
   nada guardado -- YA NO se sigue prefers-color-scheme del sistema en la
   primera visita, para que la landing y el resto de la app arranquen en
   claro de forma consistente sin importar el modo del SO/navegador del
   visitante. El usuario sigue pudiendo cambiar a oscuro con el toggle, y
   esa eleccion sí se respeta y persiste (ver STORAGE_KEY arriba). */
export function readInitialTheme(){
  try{
    const stored = localStorage.getItem(STORAGE_KEY);
    if(stored === 'light' || stored === 'dark') return stored;
  }catch{ /* almacenamiento no disponible */ }
  return 'light';
}
