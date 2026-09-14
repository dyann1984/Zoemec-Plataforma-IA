/* Construction DNA (Fase F, Project Vault). Snapshot ESTRUCTURADO del
   proyecto, derivado -- nunca capturado a mano como una ficha duplicada
   (regla explicita del pedido: "no quiero otra ficha manual duplicada").
   Cada campo hoja se envuelve con `field(value, origin)`: `origin` declara
   de donde salio ese dato, nunca se oculta la procedencia:
     DETECTED       -- se encontro evidencia textual/estructural real (ej.
                        un concepto cuya descripcion contiene "losa").
     DERIVED         -- se calculo/agrego a partir de otros datos reales
                        (ej. suma de m² de conceptos de un capitulo, o el
                        resultado de un motor ya existente como Confidence).
     USER_PROVIDED   -- lo capturo una persona directamente (reservado para
                        una futura edicion manual del DNA, no construida en
                        esta fase -- ver deriveConstructionDna).
     USER_CONFIRMED  -- una persona confirmo un valor DETECTED/DERIVED tal
                        cual (reservado, mismo motivo).
     IMPORTED        -- vino de una fuente externa importada (reservado).
   Un campo SIN datos reales queda `{ value: null, origin: null }` -- NUNCA
   se fabrica un valor para evitar un hueco visual (regla explicita: "no
   inventar datos faltantes"). */

export const DNA_ORIGIN = Object.freeze({
  DETECTED: 'DETECTED',
  DERIVED: 'DERIVED',
  USER_PROVIDED: 'USER_PROVIDED',
  USER_CONFIRMED: 'USER_CONFIRMED',
  IMPORTED: 'IMPORTED'
});

export function field(value, origin = null, extra = {}){
  const isEmpty = value == null || (Array.isArray(value) && value.length === 0);
  return { value: isEmpty ? null : value, origin: isEmpty ? null : origin, ...extra };
}

const EMPTY_FIELD = Object.freeze({ value: null, origin: null });

export function makeEmptyConstructionDna({ id = null, projectId = null } = {}){
  return {
    id, projectId,
    geometria: {
      superficieConstruida: EMPTY_FIELD, niveles: EMPTY_FIELD, areasPrincipales: EMPTY_FIELD,
      muros: EMPTY_FIELD, losas: EMPTY_FIELD, elementosEstructurales: EMPTY_FIELD
    },
    sistemaConstructivo: {
      cimentacion: EMPTY_FIELD, estructura: EMPTY_FIELD, muros: EMPTY_FIELD,
      cubiertas: EMPTY_FIELD, acabados: EMPTY_FIELD
    },
    instalaciones: {
      electrica: EMPTY_FIELD, hidraulica: EMPTY_FIELD, sanitaria: EMPTY_FIELD, especiales: EMPTY_FIELD
    },
    recursos: {
      materialesPrincipales: EMPTY_FIELD, manoDeObra: EMPTY_FIELD, maquinariaEquipo: EMPTY_FIELD
    },
    costos: {
      familiasPrincipales: EMPTY_FIELD, costosRegionales: EMPTY_FIELD, nivelConfianza: EMPTY_FIELD
    }
  };
}

export function validateConstructionDna(dna){
  const errors = [];
  if(!dna || typeof dna !== 'object') errors.push('El Construction DNA no tiene una forma valida.');
  if(!dna?.projectId) errors.push('El Construction DNA debe pertenecer a un proyecto.');
  return { valid: errors.length === 0, errors };
}
