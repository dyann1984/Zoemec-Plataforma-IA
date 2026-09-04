/* Normativa y Cumplimiento (Parte E del requerimiento de produccion):
   captura MANUAL unicamente (decision explicita del usuario, 2026-09-03 --
   ver AskUserQuestion de la sesion) -- este modulo NUNCA llama a IA ni
   sugiere normativa por su cuenta, solo define la forma del dato y el
   lenguaje seguro con el que se presenta. El sistema jamas afirma
   cumplimiento legal: todo texto de UI/exportacion sobre una norma debe
   usar EXACTAMENTE estas frases (ESTADO_REVISION_LABEL de abajo), nunca
   "cumple"/"aprobado legalmente"/analogas. */

export const ESTADO_REVISION = Object.freeze({
  PENDIENTE: 'PENDIENTE',
  EN_REVISION: 'EN_REVISION',
  VALIDADA_PROFESIONAL: 'VALIDADA_PROFESIONAL',
  DESCARTADA: 'DESCARTADA'
});

export const ESTADO_REVISION_LABEL = Object.freeze({
  [ESTADO_REVISION.PENDIENTE]: 'Pendiente de revisión',
  [ESTADO_REVISION.EN_REVISION]: 'En revisión',
  [ESTADO_REVISION.VALIDADA_PROFESIONAL]: 'Validada por profesional responsable',
  [ESTADO_REVISION.DESCARTADA]: 'Descartada (no aplica)'
});

/* Texto fijo para cuando no hay ninguna norma capturada (Parte G: "Si no
   tiene normativa cargada: mostrar 'Normativa pendiente de revisión'"). */
export const NORMATIVA_VACIA_TEXTO = 'Normativa pendiente de revisión.';

/* Encabezado obligatorio en toda vista/exportacion que muestre normativa:
   dejar explicito que es informativa, nunca un dictamen legal. */
export const NORMATIVA_DISCLAIMER = 'Normativa potencialmente aplicable. Requiere validación profesional. Vigencia por verificar en la fuente consultada.';

export function makeEmptyNormativaRow(){
  return {
    id: '', nombre: '', clave: '', organismoEmisor: '', jurisdiccion: '', version: '',
    fechaPublicacion: '', vigencia: '', fuente: '', articulo: '', requisito: '',
    impactoTecnico: '', impactoEconomico: '',
    requiereMaterial: false, requiereEPP: false, requiereProcedimiento: false,
    requierePrueba: false, requiereDocumentacion: false,
    estadoRevision: ESTADO_REVISION.PENDIENTE, observaciones: ''
  };
}
