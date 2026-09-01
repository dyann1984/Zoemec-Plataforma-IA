import React, { createContext, useContext, useState, useMemo, useCallback } from 'react';
import { STORAGE_KEY, readInitialLocale, translate } from './i18nStorage.js';

/* Preferencia de idioma: deliberadamente NO usa useLocalState/scopedKey (ver
   src/utils/scopedStorage.js) porque esa capa namespacea por usuario activo
   -- un ajuste de idioma/dispositivo debe sobrevivir login/logout y cambios
   de cuenta, no reiniciarse. Clave global fija en localStorage, igual
   patron que el tema (ver src/theme/ThemeContext.jsx).
   STORAGE_KEY/readInitialLocale/translate viven en ./i18nStorage.js (JS
   plano) para poder probarlos bajo node --test sin JSX -- ver
   src/i18n/I18nContext.test.js. */
export { STORAGE_KEY };
const I18nContext = createContext(null);

export function I18nProvider({ children }){
  const [locale, setLocaleState] = useState(readInitialLocale);

  const setLocale = useCallback((next) => {
    if(next !== 'es' && next !== 'en') return;
    setLocaleState(next);
    try{ localStorage.setItem(STORAGE_KEY, next); }catch{ /* almacenamiento no disponible */ }
  }, []);

  const t = useCallback((key, params) => translate(locale, key, params), [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(){
  const ctx = useContext(I18nContext);
  if(!ctx) throw new Error('useI18n debe usarse dentro de <I18nProvider>');
  return ctx;
}
