/* Contexto geográfico y económico del APU (bloque "Ubicación y referencia de
   costos"): lógica pura de herencia/edición/detección de cambio para el
   borrador que el usuario ve y edita al crear o editar un APU. Sin
   React/Firebase -- testeable con objetos planos.

   Reutiliza geography.js (buildProjectLocationSnapshot/formatLocationDisplay)
   en vez de duplicar la jerarquía País -> Estado/Provincia -> Región -> Ciudad
   ya existente. */
import { buildProjectLocationSnapshot, formatLocationDisplay, hasAnyLocation } from './geography.js';

const DEFAULT_CURRENCY = 'MXN';

function todayLocaleDate(){
  return new Date().toLocaleDateString('es-MX');
}

/* Borrador inicial del bloque de ubicación:
   - APU que YA tiene una ubicación propia con algun valor real (country/
     state/region/city) -- parte de SU PROPIO snapshot persistido, nunca lo
     reemplaza en silencio por el del proyecto (un APU ya aprobado no debe
     "seguir" al proyecto, regla explícita de apuSchema.js#ubicacionEstructurada).
     Moneda/fechaBase del propio APU tambien se conservan en ese caso.
   - APU nuevo o sin ubicacion propia todavia (ej. makeEmptyAPUv2(), que YA
     trae moneda/fechaBase por defecto pero ubicacionEstructurada vacia):
     hereda del proyecto activo, mismo criterio que ya usan los 3 flujos de
     generación (buildProjectLocationSnapshot) -- el usuario puede
     modificarlo desde aquí ANTES de generar. La señal correcta de "ya tiene
     ubicación propia" es hasAnyLocation sobre ubicacionEstructurada, NUNCA
     la sola presencia de moneda/fechaBase (esos dos SIEMPRE traen un
     default en un APU recien creado, ver apuSchema.js#makeEmptyAPUv2). */
export function resolveInitialLocationDraft({ project, existingApu } = {}){
  const hasOwnLocation = hasAnyLocation(existingApu?.ubicacionEstructurada);
  if(hasOwnLocation){
    const loc = existingApu.ubicacionEstructurada || {};
    return {
      country: loc.country || '', state: loc.state || '', region: loc.region || '', city: loc.city || '',
      moneda: existingApu.moneda || DEFAULT_CURRENCY, fechaBase: existingApu.fechaBase || todayLocaleDate(),
      inheritedFromProject: false
    };
  }
  const snapshot = buildProjectLocationSnapshot(project);
  return {
    country: snapshot.ubicacionEstructurada.country || '',
    state: snapshot.ubicacionEstructurada.state || '',
    region: snapshot.ubicacionEstructurada.region || '',
    city: snapshot.ubicacionEstructurada.city || '',
    moneda: project?.moneda || DEFAULT_CURRENCY,
    fechaBase: todayLocaleDate(),
    inheritedFromProject: true
  };
}

// Campos cuyo cambio invalida los precios YA buscados para la ubicación
// anterior -- nunca se recalculan solos (regla explícita del brief: "si
// cambia la región, NO cambies silenciosamente todos los precios: informa
// al usuario y ofrece recalcular"). fechaBase queda fuera a propósito: es
// informativa para la búsqueda, no identifica una geografía distinta.
export const PRICE_SENSITIVE_FIELDS = Object.freeze(['country', 'state', 'region', 'city', 'moneda']);

export function locationDraftChanged(previous, next){
  if(!previous || !next) return false;
  return PRICE_SENSITIVE_FIELDS.some(field => (previous[field] || '') !== (next[field] || ''));
}

// Convierte el borrador editable a la forma que se persiste en el APU
// (ubicacionEstructurada + ubicacion de texto libre + moneda + fechaBase) --
// único punto que arma este shape para que main.jsx nunca lo construya dos
// veces de forma distinta.
export function buildLocationPatchFromDraft(draft = {}){
  return {
    ubicacionEstructurada: {
      country: draft.country || null,
      state: draft.state || null,
      region: draft.region || null,
      city: draft.city || null
    },
    ubicacion: formatLocationDisplay({ country: draft.country, state: draft.state, region: draft.region, city: draft.city }),
    moneda: draft.moneda || DEFAULT_CURRENCY,
    fechaBase: draft.fechaBase || todayLocaleDate()
  };
}

export function locationDraftHasAnyValue(draft = {}){
  return Boolean((draft.country || '').trim() || (draft.state || '').trim() || (draft.region || '').trim() || (draft.city || '').trim());
}
