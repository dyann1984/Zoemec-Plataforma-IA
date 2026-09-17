/* Jerarquia Pais -> Estado/Provincia -> Region/Zona -> Ciudad (Fase 2: APU
   regionalizados por ubicacion; Contexto geografico y economico del APU).
   Logica pura, sin Firebase ni React -- solo datos y funciones de formato/
   normalizacion, testeable con objetos planos.

   Mexico queda completamente estructurado (32 estados reales) porque es el
   unico pais que el resto de la plataforma ya asume: el prompt de busqueda
   de precios (server/api-lib/_priceIntelligenceCore.mjs) busca "en Mexico"
   hardcodeado, la moneda por defecto es MXN, las fuentes de referencia
   (CONASAMI, Home Depot Mexico, CMIC/CNIC) son mexicanas. OTHER_COUNTRY
   (codigo 'OTRO') es la valvula de escape: la jerarquia Pais->Estado->Ciudad
   existe para cualquier pais, pero solo Mexico trae estados reales en un
   selector -- otro pais captura el estado como texto libre. Ciudad SIEMPRE
   es texto libre (no existe ni se construye aqui una base de datos de
   ciudades, fuera de alcance de esta fase).

   QA de la ronda "Contexto geografico" (hallazgo real: un proyecto de
   Tecamac mostraba "Tecamac, Zona Metropolitana, Mexico, Mexico" --
   ambiguo): el ESTADO se guardaba como el mismo string 'México' que ya usa
   el PAIS como nombre ('México'), asi que formatLocationDisplay unia los
   dos labels identicos. Fix real: cada estado de Mexico ahora tiene una
   forma CANONICA para maquina (`code`, abreviatura INEGI de 3 letras,
   ESTABLE, nunca cambia con capitalizacion/acentos/renombres de UI) y una
   ETIQUETA clara para UI/exportaciones (`name`) -- el estado que
   coloquialmente se dice "México" se guarda con code 'MEX' y se MUESTRA
   como "Estado de México", igual que "Ciudad de México" (code 'CMX') ya
   se mostraba disambiguado del pais. findState()/stateLabel() resuelven
   tanto el `code` nuevo como el nombre plano legado (datos ya guardados
   antes de este fix, incluido el "México" ambiguo) -- ningun dato viejo
   se pierde ni queda irreconocible. */

export const MEXICO_CODE = 'MX';
export const OTHER_COUNTRY_CODE = 'OTRO';

// Codigos INEGI de 3 letras (estables, no cambian con acentos/capitalizacion
// ni con el texto que UI decida mostrar) + nombre completo para UI/exports.
// 'MEX' (Estado de México) y 'CMX' (Ciudad de México) quedan explicitamente
// disambiguados del nombre del pais -- nunca "México" a secas para el
// estado.
const MEXICO_STATES = Object.freeze([
  { code: 'AGU', name: 'Aguascalientes' },
  { code: 'BCN', name: 'Baja California' },
  { code: 'BCS', name: 'Baja California Sur' },
  { code: 'CAM', name: 'Campeche' },
  { code: 'CHP', name: 'Chiapas' },
  { code: 'CHH', name: 'Chihuahua' },
  { code: 'CMX', name: 'Ciudad de México' },
  { code: 'COA', name: 'Coahuila' },
  { code: 'COL', name: 'Colima' },
  { code: 'DUR', name: 'Durango' },
  { code: 'GUA', name: 'Guanajuato' },
  { code: 'GRO', name: 'Guerrero' },
  { code: 'HID', name: 'Hidalgo' },
  { code: 'JAL', name: 'Jalisco' },
  { code: 'MEX', name: 'Estado de México' },
  { code: 'MIC', name: 'Michoacán' },
  { code: 'MOR', name: 'Morelos' },
  { code: 'NAY', name: 'Nayarit' },
  { code: 'NLE', name: 'Nuevo León' },
  { code: 'OAX', name: 'Oaxaca' },
  { code: 'PUE', name: 'Puebla' },
  { code: 'QUE', name: 'Querétaro' },
  { code: 'ROO', name: 'Quintana Roo' },
  { code: 'SLP', name: 'San Luis Potosí' },
  { code: 'SIN', name: 'Sinaloa' },
  { code: 'SON', name: 'Sonora' },
  { code: 'TAB', name: 'Tabasco' },
  { code: 'TAM', name: 'Tamaulipas' },
  { code: 'TLA', name: 'Tlaxcala' },
  { code: 'VER', name: 'Veracruz' },
  { code: 'YUC', name: 'Yucatán' },
  { code: 'ZAC', name: 'Zacatecas' },
]);

// Nombres legados (guardados como texto plano ANTES de este fix, ej. el
// "México" ambiguo para Estado de México, o el nombre completo tal cual
// aparecia en el <select> viejo) -- se resuelven al code correcto para que
// ningun dato ya persistido en Firestore quede huerfano. Mapa explicito,
// nunca una heuristica de similitud de texto.
const LEGACY_STATE_NAME_TO_CODE = Object.freeze({
  'México': 'MEX', // ambiguo con el pais -- la causa raiz real de este fix
});

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

// Resuelve un valor de estado GUARDADO (code canonico nuevo, ej. 'MEX', O
// nombre legado guardado antes de este fix, ej. 'México'/'Nuevo León') a su
// forma {code, name} completa. Pais sin estados estructurados (states:null,
// "Otro país") o code desconocido: el estado es texto libre, se regresa tal
// cual en ambos campos -- nunca se inventa un code para un dato que nunca
// fue estructurado. Nunca lanza con datos ausentes.
export function findState(countryCode, stateValue) {
  const value = clean(stateValue);
  if (!value) return null;
  const states = listStatesForCountry(countryCode);
  if (!states) return { code: value, name: value };
  const byCode = states.find(s => s.code === value);
  if (byCode) return byCode;
  const byName = states.find(s => s.name === value);
  if (byName) return byName;
  const legacyCode = LEGACY_STATE_NAME_TO_CODE[value];
  if (legacyCode) return states.find(s => s.code === legacyCode) || { code: legacyCode, name: value };
  return { code: value, name: value };
}

// Etiqueta legible del estado (para UI/exports) a partir del valor
// guardado (code o nombre legado) -- nunca el code crudo mostrado al
// usuario.
export function stateLabel(countryCode, stateValue) {
  return findState(countryCode, stateValue)?.name || '';
}

function clean(value) {
  const v = String(value ?? '').trim();
  return v || null;
}

// Texto legible para UI/exports/prompt: "Ciudad, Region/Zona, Estado, Pais"
// (omite lo que falte, nunca deja comas huerfanas). `region` es el nivel
// OPCIONAL entre Ciudad y Estado (ej. "Zona Metropolitana") -- ver ADR en
// buildProjectLocationSnapshot sobre por que nunca se usa como un nivel
// nuevo de COBERTURA DE PRECIOS, solo como contexto de busqueda/display.
// `state` puede venir como code canonico o nombre legado -- SIEMPRE se
// resuelve a su nombre completo aqui (nunca se imprime un code crudo como
// "MEX" en UI/exportaciones, ni el "México" ambiguo con el pais).
export function formatLocationDisplay({ country, state, city, region } = {}) {
  const countryName = country ? (findCountry(country)?.name || clean(country)) : null;
  const stateName = state ? (stateLabel(country, state) || clean(state)) : null;
  const parts = [clean(city), clean(region), stateName, countryName].filter(Boolean);
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
// sin acentos, sin espacios de sobra. `state` se resuelve PRIMERO a su code
// canonico (nunca al nombre) -- asi "MEX" y el "México" legado ambiguo
// producen el MISMO fingerprint, sin fragmentar el cache de precios ya
// guardado por el nombre viejo. Nunca lanza con datos ausentes -- un campo
// faltante simplemente queda '' (mismo criterio que el resto del
// fingerprint en priceSearchCache.js, que nunca exige todos los campos).
export function buildLocationFingerprintKey({ country, state, city, region } = {}) {
  const resolvedState = state ? (findState(country, state)?.code || state) : state;
  return {
    country: normalizeKeyPart(country),
    state: normalizeKeyPart(resolvedState),
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
// sigue funcionando exactamente igual que antes de esta fase. `state` se
// conserva TAL CUAL esta guardado en el proyecto (code nuevo o nombre
// legado) -- formatLocationDisplay ya sabe resolver ambos a su nombre
// completo para el texto libre `ubicacion`.
export function buildProjectLocationSnapshot(project) {
  const ubicacionEstructurada = {
    country: project?.locationCountry || null,
    state: project?.locationState || null,
    city: project?.locationCity || null,
  };
  // `region` solo se agrega al snapshot cuando el proyecto de verdad la
  // declara -- omitir la clave (en vez de dejarla en null) preserva la
  // forma exacta de ubicacionEstructurada para proyectos sin region, que
  // es lo que consumidores existentes (ej. deepEqual en
  // catalogoPresupuestoPipeline.e2e.test.mjs) ya esperaban antes de que
  // Region/Zona existiera.
  if (project?.locationRegion) ubicacionEstructurada.region = project.locationRegion;
  const ubicacion = formatLocationDisplay(ubicacionEstructurada) || project?.ubicacion || '';
  return { ubicacion, ubicacionEstructurada };
}
