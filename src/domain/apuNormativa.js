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

/* Origen/estado de validacion (P1 autorizado 2026-09-07, reglas del mensaje
   de la sesion): eje ORTOGONAL a estadoRevision (que describe la etapa del
   flujo de revision humana -- pendiente/en revision/validada/descartada).
   Este campo describe DE DONDE salio la certeza del dato: capturado y
   confirmado por un profesional con fuente real (VERIFICADO), propuesto
   como pista de que revisar pero sin confirmar (SUGERIDO_POR_IA), o
   capturado sin ninguna fuente verificable todavia (PENDIENTE_VALIDAR).
   Regla explicita de la sesion: "La IA NO puede marcar algo como
   VERIFICADO. Para VERIFICADO debe existir como minimo una fuente/
   referencia validada." -- por eso normalizeEstadoValidacion() de abajo es
   la UNICA forma correcta de fijar este campo: si se pide VERIFICADO sin
   fuente, se degrada a PENDIENTE_VALIDAR en vez de confiar en el valor
   pedido a ciegas (nunca "la IA decide en silencio", ver tambien regla 8
   del mensaje: sugerencia por revisar != incumplimiento confirmado). */
export const ESTADO_VALIDACION = Object.freeze({
  VERIFICADO: 'VERIFICADO',
  SUGERIDO_POR_IA: 'SUGERIDO_POR_IA',
  PENDIENTE_VALIDAR: 'PENDIENTE_VALIDAR'
});

export const ESTADO_VALIDACION_LABEL = Object.freeze({
  [ESTADO_VALIDACION.VERIFICADO]: 'Verificado',
  [ESTADO_VALIDACION.SUGERIDO_POR_IA]: 'Sugerido por IA',
  [ESTADO_VALIDACION.PENDIENTE_VALIDAR]: 'Pendiente de validar'
});

export const REQUIERE_VALIDACION_NORMATIVA_TEXTO = 'Requiere validación normativa.';

/* Un renglon "sin fuente verificable" nunca debe presentarse como
   VERIFICADO -- esta funcion es la unica que UI/exportacion/calculo deben
   usar para decidir si mostrar el texto de la norma o el aviso de
   REQUIERE_VALIDACION_NORMATIVA_TEXTO en su lugar. */
export function tieneFuenteVerificable(row){
  return Boolean(String(row?.fuente || '').trim());
}

/* Enforcement real (no solo sugerencia de UI, regla 7 del mensaje de la
   sesion): nadie -- ni un formulario, ni una futura sugerencia de IA --
   puede fijar estadoValidacion=VERIFICADO sin una fuente ya presente en el
   propio renglon. Toda escritura de estadoValidacion (UI, importacion,
   futura sugerencia) DEBE pasar por aqui en vez de asignar el campo
   directo. Nunca lanza -- degrada en silencio hacia el estado seguro,
   igual que toSafeNonNegativeNumber degrada un numero invalido a 0. */
export function normalizeEstadoValidacion(row){
  const solicitado = row?.estadoValidacion;
  if(solicitado === ESTADO_VALIDACION.VERIFICADO && !tieneFuenteVerificable(row)){
    return ESTADO_VALIDACION.PENDIENTE_VALIDAR;
  }
  if(Object.values(ESTADO_VALIDACION).includes(solicitado)) return solicitado;
  return ESTADO_VALIDACION.PENDIENTE_VALIDAR;
}

export function makeEmptyNormativaRow(){
  return {
    id: '', nombre: '', clave: '', organismoEmisor: '', jurisdiccion: '', version: '',
    fechaPublicacion: '', vigencia: '', fuente: '', articulo: '', requisito: '',
    impactoTecnico: '', impactoEconomico: '',
    // P1 autorizado 2026-09-07: pais/estado/municipio/tipo de obra/
    // especialidad/descripcion propia (nombre/clave/articulo/version/
    // fechaPublicacion YA CUBRIAN norma/articuloApartado/versionFecha del
    // pedido original -- se documenta aqui en vez de duplicar el campo con
    // otro nombre, ver commit). estadoGeografico (no "estado" a secas) para
    // no chocar con estadoRevision/estadoValidacion, que ya usan ese
    // prefijo con otro significado.
    pais: '', estadoGeografico: '', municipio: '', tipoObra: '', especialidad: '',
    descripcion: '', estadoValidacion: ESTADO_VALIDACION.PENDIENTE_VALIDAR,
    requiereMaterial: false, requiereEPP: false, requiereProcedimiento: false,
    requierePrueba: false, requiereDocumentacion: false,
    estadoRevision: ESTADO_REVISION.PENDIENTE, observaciones: ''
  };
}
