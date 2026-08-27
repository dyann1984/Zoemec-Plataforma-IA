/* Estado de completitud del concepto (punto 23 del spec del usuario): el
   enum COMPLETO / COMPLETO_CON_SUPUESTOS / REQUIERE_VALIDACION / INCOMPLETO /
   ERROR que el usuario pidio explicitamente. Logica pura (sin React, sin
   Firebase): NO reemplaza los vocabularios que ya existen y de los que
   dependen otros modulos --
     - validateAPU (apuProfessional.js): status GENERADO/CON OBSERVACIONES/
       REQUIERE REVISION + `issues[]` (checks de negocio y numericos)
     - APU_DATA_STATE (apuSchema.js): procedencia de cada renglon
       (VERIFICADO/IMPORTADO/ESTIMADO_IA/ASUMIDO/REQUIERE_VALIDACION)
     - REVISION_STATUS (apuReview.js): flujo de revision humana
   computeConceptStatus es una capa de composicion encima de esos tres --
   "esta partida esta lista para exportarse/aprobarse" -- construida a partir
   de datos que YA se calculan, nunca inventando un cuarto motor paralelo. */
import { APU_DATA_STATE } from './apuSchema.js';
import { isStructurallyEmptyApu } from './apuProfessional.js';

export const CONCEPT_STATUS = Object.freeze({
  COMPLETO: 'COMPLETO',
  COMPLETO_CON_SUPUESTOS: 'COMPLETO_CON_SUPUESTOS',
  REQUIERE_VALIDACION: 'REQUIERE_VALIDACION',
  INCOMPLETO: 'INCOMPLETO',
  ERROR: 'ERROR'
});

export const CONCEPT_STATUS_LABEL = Object.freeze({
  [CONCEPT_STATUS.COMPLETO]: 'COMPLETO',
  [CONCEPT_STATUS.COMPLETO_CON_SUPUESTOS]: 'COMPLETO CON SUPUESTOS',
  [CONCEPT_STATUS.REQUIERE_VALIDACION]: 'REQUIERE VALIDACIÓN',
  [CONCEPT_STATUS.INCOMPLETO]: 'INCOMPLETO',
  [CONCEPT_STATUS.ERROR]: 'ERROR'
});

function allFuenteEstados(apu){
  const rows = [
    ...(Array.isArray(apu.materials) ? apu.materials : []),
    ...(Array.isArray(apu.labor) ? apu.labor : []),
    ...(Array.isArray(apu.equipment) ? apu.equipment : []),
    ...(Array.isArray(apu.consumables) ? apu.consumables : []),
    ...(Array.isArray(apu.seguridad) ? apu.seguridad : [])
  ];
  return rows.map(r => r?.fuente?.estado).filter(Boolean);
}

/* `validation`: el resultado de validateAPU(apu) (apuProfessional.js) --
   se recibe ya calculado en vez de recalcularlo aqui, porque el llamador
   (UI/export) casi siempre ya lo tiene y calcAPUv2 no es gratis en lotes
   grandes. `reconciliation` (opcional): resultado de
   apuReconciliation.js#reconcileAPU, si ya se corrio -- una reconciliacion
   rota siempre es ERROR, sin importar que tan limpios esten los demas
   checks. */
export function computeConceptStatus(apu = {}, validation, reconciliation){
  if(isStructurallyEmptyApu(apu)) return CONCEPT_STATUS.INCOMPLETO;

  const issues = Array.isArray(validation?.issues) ? validation.issues : [];
  // Deliberadamente MAS ESTRICTO que el hasErrors interno de validateAPU
  // (que trata cualquier issue SIN severity declarada como error -- asi
  // arrancó `missing_integration`, una nota informativa de que un renglon de
  // equipo uso el default POR_UNIDAD_OBRA, nunca pensada como bloqueante).
  // Aqui ERROR debe significar "algo esta roto" (spec del usuario), no
  // "hay una nota sin clasificar" -- por eso solo cuenta severity==='error'
  // explicita. Un renglon con integracion no declarada sigue siendo, cuando
  // mucho, COMPLETO_CON_SUPUESTOS.
  const hasErrors = issues.some(issue => issue.severity === 'error');
  if(hasErrors) return CONCEPT_STATUS.ERROR;
  if(reconciliation && reconciliation.ok === false) return CONCEPT_STATUS.ERROR;

  if(!(Number(apu.cantidadObra) > 0)) return CONCEPT_STATUS.INCOMPLETO;

  const estados = allFuenteEstados(apu);
  const needsValidation = estados.includes(APU_DATA_STATE.REQUIERE_VALIDACION)
    || issues.some(issue => issue.code === 'price_without_source' || issue.code === 'stale_price' || issue.code === 'price_without_date');
  if(needsValidation) return CONCEPT_STATUS.REQUIERE_VALIDACION;

  const hasAssumption = estados.some(estado => estado === APU_DATA_STATE.ESTIMADO_IA || estado === APU_DATA_STATE.ASUMIDO);
  if(hasAssumption) return CONCEPT_STATUS.COMPLETO_CON_SUPUESTOS;

  return CONCEPT_STATUS.COMPLETO;
}

export function conceptStatusLabel(status){
  return CONCEPT_STATUS_LABEL[status] || CONCEPT_STATUS_LABEL[CONCEPT_STATUS.REQUIERE_VALIDACION];
}
