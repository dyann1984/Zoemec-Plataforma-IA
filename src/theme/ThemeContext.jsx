import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { STORAGE_KEY, readInitialTheme } from './themeStorage.js';

/* Mismo criterio que I18nContext: clave global fija, no scopeada por
   usuario (el tema es una preferencia de dispositivo/navegador, debe
   sobrevivir login/logout). El toggle solo cambia data-theme en <html>;
   todo el color real vive en variables CSS (:root vs [data-theme="dark"]
   en src/style.css), este archivo no toca ningun color directamente.
   STORAGE_KEY/readInitialTheme viven en ./themeStorage.js (JS plano) para
   poder probarlos bajo node --test sin JSX -- ver
   src/theme/ThemeContext.test.js. */
export { STORAGE_KEY };
const ThemeContext = createContext(null);

export function ThemeProvider({ children }){
  const [theme, setThemeState] = useState(readInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const setTheme = useCallback((next) => {
    if(next !== 'light' && next !== 'dark') return;
    setThemeState(next);
    try{ localStorage.setItem(STORAGE_KEY, next); }catch{ /* almacenamiento no disponible */ }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState(prev => {
      const next = prev === 'light' ? 'dark' : 'light';
      try{ localStorage.setItem(STORAGE_KEY, next); }catch{ /* almacenamiento no disponible */ }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(){
  const ctx = useContext(ThemeContext);
  if(!ctx) throw new Error('useTheme debe usarse dentro de <ThemeProvider>');
  return ctx;
}
