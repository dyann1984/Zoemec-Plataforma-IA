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

/* Origen de validacion (P1 autorizado 2026-09-07): eje ORTOGONAL a
   estadoRevision (que describe la etapa del flujo de revision humana --
   pendiente/en revision/validada/descartada). Este campo describe de DONDE
   salio el dato: capturado y confirmado por un profesional (VERIFICADO),
   propuesto como pista de que revisar pero sin confirmar (SUGERIDO_IA), o
   capturado sin ninguna fuente verificable todavia (PENDIENTE_VALIDAR).
   No reemplaza estadoRevision ni cambia sus valores/tests existentes -- se
   agrega como campo nuevo para no romper compatibilidad.
   IMPORTANTE (mismo principio que el resto del modulo): este campo NUNCA
   se asigna solo -- si un renglon no trae "fuente" verificable, el campo
   debe quedar en PENDIENTE_VALIDAR y la UI/exportacion deben mostrar
   REQUIERE_VALIDACION_NORMATIVA_TEXTO, nunca inventar una norma o articulo
   para poder marcarlo VERIFICADO. SUGERIDO_IA queda listo para cuando se
   conecte una sugerencia real de IA (fuera de alcance de esta fase: esta
   version NO agrega ninguna llamada nueva a un modelo de IA aqui, solo la
   clasificacion para cuando exista). */
export const ORIGEN_VALIDACION = Object.freeze({
  VERIFICADO: 'VERIFICADO',
  SUGERIDO_IA: 'SUGERIDO_IA',
  PENDIENTE_VALIDAR: 'PENDIENTE_VALIDAR'
});

export const ORIGEN_VALIDACION_LABEL = Object.freeze({
  [ORIGEN_VALIDACION.VERIFICADO]: 'Verificado',
  [ORIGEN_VALIDACION.SUGERIDO_IA]: 'Sugerido por IA',
  [ORIGEN_VALIDACION.PENDIENTE_VALIDAR]: 'Pendiente de validar'
});

export const REQUIERE_VALIDACION_NORMATIVA_TEXTO = 'Requiere validación normativa.';

/* Un renglon "sin fuente verificable" nunca debe presentarse como
   VERIFICADO -- esta funcion es la unica que UI/exportacion deben usar
   para decidir si mostrar el texto de la norma o el aviso de
   REQUIERE_VALIDACION_NORMATIVA_TEXTO en su lugar. */
export function tieneFuenteVerificable(row){
  return Boolean(String(row?.fuente || '').trim());
}

export function makeEmptyNormativaRow(){
  return {
    id: '', nombre: '', clave: '', organismoEmisor: '', jurisdiccion: '', version: '',
    fechaPublicacion: '', vigencia: '', fuente: '', articulo: '', requisito: '',
    impactoTecnico: '', impactoEconomico: '',
    // P1 autorizado 2026-09-07: pais/estado/municipio decompuestos (antes
    // solo existia "jurisdiccion" como texto libre -- se conserva para no
    // romper registros existentes) + tipo de obra/especialidad + descripcion
    // propia distinta de "requisito".
    pais: '', estadoGeografico: '', municipio: '', tipoObra: '', especialidad: '',
    descripcion: '', origenValidacion: ORIGEN_VALIDACION.PENDIENTE_VALIDAR,
    requiereMaterial: false, requiereEPP: false, requiereProcedimiento: false,
    requierePrueba: false, requiereDocumentacion: false,
    estadoRevision: ESTADO_REVISION.PENDIENTE, observaciones: ''
  };
}
