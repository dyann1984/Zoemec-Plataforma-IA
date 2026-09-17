/* Jerarquia Pais -> Estado/Provincia -> Ciudad (Fase 2: APU regionalizados
   por ubicacion). Logica pura, sin Firebase ni React -- solo datos y
   funciones de formato/normalizacion, testeable con objetos planos.

   Mexico queda completamente estructurado (32 estados reales) porque es el
   unico pais que el resto de la plataforma ya asume: el prompt de busqueda
   de precios (server/api-lib/_priceIntelligenceCore.mjs) busca "en Mexico"
   hardcodeado, la moneda por defecto es MXN, las fuentes de referencia
   (CONASAMI, Home Depot Mexico, CMIC/CNIC) son mexicanas. OTHER_COUNTRY
   (codigo 'OTRO') es la valvula de escape: la jerarquia Pais->Estado->Ciudad
   existe para cualquier pais, pero solo Mexico trae estados reales en un
   selector -- otro pais captura el estado como texto libre. Ciudad SIEMPRE
   es texto libre (no existe ni se construye aqui una base de datos de
   ciudades, fuera de alcance de esta fase). */

export const MEXICO_CODE = 'MX';
export const OTHER_COUNTRY_CODE = 'OTRO';

const MEXICO_STATES = Object.freeze([
  'Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche',
  'Chiapas', 'Chihuahua', 'Ciudad de México', 'Coahuila', 'Colima', 'Durango',
  'Guanajuato', 'Guerrero', 'Hidalgo', 'Jalisco', 'México', 'Michoacán',
  'Morelos', 'Nayarit', 'Nuevo León', 'Oaxaca', 'Puebla', 'Querétaro',
  'Quintana Roo', 'San Luis Potosí', 'Sinaloa', 'Sonora', 'Tabasco',
  'Tamaulipas', 'Tlaxcala', 'Veracruz', 'Yucatán', 'Zacatecas',
]);

// Un pais con `states: null` captura el estado/provincia como texto libre
// en vez de un <select> -- misma UI, distinta fuente de opciones.
export const COUNTRIES = Object.freeze([
  { code: MEXICO_CODE, name: 'México', states: MEXICO_STATES },
  { code: OTHER_COUNTRY_CODE, name: 'Otro país', states: null },
]);

export function listCountries() {
  return COUNTRIES;
}

// Nombre del nivel administrativo bajo el pais, adaptado por pais cuando se
// conoce (regla explicita del brief de Contexto geografico del APU: "no
// hardcodees exclusivamente Estado de Mexico"). Deliberadamente una tabla
// chica y explicita, nunca una heuristica adivinada -- un pais ausente de
// esta tabla cae al generico "Estado / Provincia / Departamento", que sigue
// siendo honesto (no afirma un nombre administrativo que no se verifico).
const ADMIN_DIVISION_LABEL_BY_COUNTRY = Object.freeze({
  es: { [MEXICO_CODE]: 'Estado' },
  en: { [MEXICO_CODE]: 'State' },
});
const DEFAULT_ADMIN_DIVISION_LABEL = Object.freeze({
  es: 'Estado / Provincia / Departamento',
  en: 'State / Province / Department',
});

// `locale` es opcional (default 'es', compatibilidad hacia atras) -- esta
// tabla es deliberadamente chica y explicita en las dos rondas de texto que
// ya soporta el resto de la plataforma (ES/EN, ver src/i18n/translations.js),
// nunca una traduccion automatica.
export function adminDivisionLabel(countryCode, locale = 'es') {
  const lang = locale === 'en' ? 'en' : 'es';
  return ADMIN_DIVISION_LABEL_BY_COUNTRY[lang][countryCode] || DEFAULT_ADMIN_DIVISION_LABEL[lang];
}

// Monedas soportadas hoy por el resto de la plataforma (formato de dinero,
// prompt de busqueda de precios) -- lista chica y explicita a proposito:
// agregar una moneda aqui sin que el resto de la plataforma la soporte de
// verdad (Intl.NumberFormat, prompt de Price Intelligence) seria decorativo.
export const CURRENCIES = Object.freeze([
  { code: 'MXN', name: 'Peso mexicano' },
  { code: 'USD', name: 'Dólar estadounidense' },
]);

export function listCurrencies() {
  return CURRENCIES;
}

export function findCountry(code) {
  return COUNTRIES.find(c => c.code === code) || null;
}

export function listStatesForCountry(countryCode) {
  const country = findCountry(countryCode);
  return country?.states || null;
}

export function isStructuredCountry(countryCode) {
  return Boolean(findCountry(countryCode)?.states);
}

function clean(value) {
  const v = String(value ?? '').trim();
  return v || null;
}

// Texto legible para UI/exports/prompt: "Ciudad, Region/Zona, Estado, Pais"
// (omite lo que falte, nunca deja comas huerfanas). `region` es el nivel
// OPCIONAL entre Ciudad y Estado (ej. "Zona Metropolitana") -- ver
// ADR en el bloque de abajo (buildProjectLocationSnapshot) sobre por que
// nunca se usa como un nivel nuevo de COBERTURA DE PRECIOS, solo como
// contexto de busqueda/display.
export function formatLocationDisplay({ country, state, city, region } = {}) {
  const countryName = country ? (findCountry(country)?.name || clean(country)) : null;
  const parts = [clean(city), clean(region), clean(state), countryName].filter(Boolean);
  return parts.join(', ');
}

function normalizeKeyPart(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // quita acentos: "León" -> "leon"
}

// Clave normalizada para el fingerprint de cache de precios (Fase 2): minusculas,
// sin acentos, sin espacios de sobra. Nunca lanza con datos ausentes -- un
// campo faltante simplemente queda '' (mismo criterio que el resto del
// fingerprint en priceSearchCache.js, que nunca exige todos los campos).
export function buildLocationFingerprintKey({ country, state, city, region } = {}) {
  return {
    country: normalizeKeyPart(country),
    state: normalizeKeyPart(state),
    city: normalizeKeyPart(city),
    region: normalizeKeyPart(region),
  };
}

export function hasAnyLocation({ country, state, city, region } = {}) {
  return Boolean(clean(country) || clean(state) || clean(city) || clean(region));
}

// Snapshot de ubicacion para un APU en el momento en que se genera -- NUNCA
// un enlace vivo al proyecto (si el proyecto cambia de ciudad/estado/pais
// despues, un APU ya generado no debe cambiar; ver apuSchema.js#ubicacionEstructurada).
// Los TRES flujos de generacion (individual y los dos de lote, main.jsx)
// deben llamar a esta MISMA funcion en vez de construir el snapshot cada
// uno por su cuenta -- es justo la divergencia que causaba que solo el flujo
// individual guardara ubicacionEstructurada y el texto libre `ubicacion`
// correcto, mientras los dos flujos de lote los dejaban sin llenar.
// Proyecto legacy sin campos estructurados (`location=null`): cae al texto
// libre `project.ubicacion` tal cual, con ubicacionEstructurada en null --
// sigue funcionando exactamente igual que antes de esta fase.
export function buildProjectLocationSnapshot(project) {
  const ubicacionEstructurada = {
    country: project?.locationCountry || null,
    state: project?.locationState || null,
    city: project?.locationCity || null,
    region: project?.locationRegion || null,
  };
  const ubicacion = formatLocationDisplay(ubicacionEstructurada) || project?.ubicacion || '';
  return { ubicacion, ubicacionEstructurada };
}
