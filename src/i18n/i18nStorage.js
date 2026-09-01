/* Logica pura de idioma, separada de I18nContext.jsx a proposito: ese
   archivo tiene JSX y node --test no lo puede parsear -- ver el mismo
   comentario en src/theme/themeStorage.js. translations.js ya era JS
   plano y se puede importar tal cual. */
import { translations } from './translations.js';

export const STORAGE_KEY = 'zoemec-locale';

export function readInitialLocale(){
  try{
    const stored = localStorage.getItem(STORAGE_KEY);
    if(stored === 'es' || stored === 'en') return stored;
  }catch{ /* localStorage no disponible */ }
  return 'es';
}

export function getByPath(obj, path){
  return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

/* Interpolacion {param} minima -- necesaria para strings dinamicos reales
   del interior ("{count} proyectos en cartera", "Ultima confianza {pct}%")
   sin caer en condicionales de idioma sueltos en main.jsx (la regla
   explicita era: todo pasa por t(), nunca if(locale==='en')). No es
   pluralizacion ni formato de numeros/fechas -- solo reemplazo de texto. */
function interpolate(str, params){
  if(!params || typeof str !== 'string') return str;
  return str.replace(/\{(\w+)\}/g, (match, key) => (params[key] !== undefined ? params[key] : match));
}

/* Respaldo: si falta la clave en el idioma activo, intenta espanol antes
   de exponer la clave cruda -- nunca debe verse "hero.eyebrow" en pantalla. */
export function translate(locale, key, params){
  const value = getByPath(translations[locale], key);
  if(value !== undefined) return interpolate(value, params);
  const fallback = getByPath(translations.es, key);
  return interpolate(fallback !== undefined ? fallback : key, params);
}
