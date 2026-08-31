// Validacion del formulario "Alta de proyecto" (Projects, main.jsx). Antes,
// un Cliente vacio dejaba "Crear y comenzar" sin hacer nada visible: el unico
// aviso era un alert() -- convertido globalmente en un toast que se
// autodesaparece (ver NoticeHost) -- facil de perder. Esta funcion pura
// calcula QUE falta (nunca decide como mostrarlo ni toca el estado de React),
// para poder probarla sin renderizar el formulario.
export function validateProjectDraft(draft) {
  const errors = {};
  if (!String(draft?.name ?? '').trim()) errors.name = 'El nombre del proyecto es obligatorio.';
  if (!String(draft?.client ?? '').trim()) errors.client = 'El cliente es obligatorio.';
  return errors;
}
