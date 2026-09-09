/* Guard minimo y compartido (QA-remediacion BUG-04, 2026-09-09): avisa de
   trabajo real sin guardar en el editor de APU antes de abandonarlo --
   beforeunload (ya presente en ProfessionalApuEditor.jsx) solo cubre cierre
   de pestana/recarga, nunca la navegacion INTERNA de React (cambiar de
   modulo por el menu, "Limpiar", o "Abrir" otro APU guardado), que no
   dispara ningun evento del navegador.

   Deliberadamente un objeto mutable compartido en vez de Context/Redux: el
   unico consumidor real (main.jsx, en los pocos puntos donde se abandona el
   APU en curso) solo necesita leer un booleano sincronicamente antes de
   decidir si continua -- introducir un proveedor de contexto nuevo para esto
   seria mas cambio del necesario (evitar refactor general). */
export const unsavedApuWork = { current: false, label: '' };

export function confirmLeaveIfUnsavedApuWork(){
  if(!unsavedApuWork.current) return true;
  return window.confirm(
    `Tienes un APU${unsavedApuWork.label ? ` ("${unsavedApuWork.label}")` : ''} con cambios sin guardar en el servidor. Si continúas ahora se pueden perder. ¿Salir de todas formas?`
  );
}
