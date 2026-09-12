/* P0: texto discreto "Guardando..."/"Guardado automáticamente"/error, junto
   al formulario que realmente se esta autoguardando -- el CloudBadge global
   de la topbar (main.jsx) ya escucha el mismo evento 'zoemec-cloud' para su
   propio indicador general, pero el brief pide feedback visible EN la
   pantalla donde el usuario esta escribiendo, no solo en una esquina que
   podria no asociar con este formulario especifico.

   Estados (DRAFT/SAVING/SAVED/ERROR del brief): 'idle' (nunca escribio
   nada = DRAFT implicito, no se muestra texto), 'saving' (SAVING), 'ok'
   (SAVED), 'error' (ERROR). Escucha el MISMO evento que ya dispara
   saveCloud (src/cloud.js) -- no crea un canal de estado nuevo. */
import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext.jsx';

export function AutosaveIndicator(){
  const { t: tr } = useI18n();
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    const onCloud = (e) => setStatus(e.detail?.status || 'ok');
    window.addEventListener('zoemec-cloud', onCloud);
    return () => window.removeEventListener('zoemec-cloud', onCloud);
  }, []);

  if(status === 'idle') return null;
  const label = status === 'saving' ? tr('common.autosaveSaving')
    : status === 'error' ? tr('common.autosaveError')
    : tr('common.autosaveSaved');
  return <span className={'autosave-indicator autosave-' + status} style={{ fontSize: '.72rem', opacity: 0.75 }}>{label}</span>;
}
