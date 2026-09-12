import { useEffect, useRef } from 'react';
import { ORG_STATUS, daysRemaining, resolveOrgStatus, trialWarningLevel, TRIAL_EXPIRED_MESSAGE } from '../../domain/organization.js';

/* Banner discreto de "periodo de evaluacion empresarial" (punto 9 del brief):
   nunca se muestra si el usuario no pertenece a una organizacion (usuarios
   individuales no ven nada nuevo). Un solo aviso adicional por carga de
   sesion cuando quedan 7/3/1 dias -- no insiste en cada render. */
export function TrialBanner({ organization }){
  const warnedRef = useRef(null);
  const status = resolveOrgStatus(organization);
  const days = daysRemaining(organization);

  useEffect(() => {
    if(status !== ORG_STATUS.ACTIVE_TRIAL) return;
    const level = trialWarningLevel(days);
    if(!level) return;
    const key = `${organization?.id || ''}:${level}`;
    if(warnedRef.current === key) return;
    warnedRef.current = key;
    const msg = level === 1
      ? 'Tu periodo de evaluacion de ZOEMEC termina manana.'
      : `Quedan ${level} dias de tu periodo de evaluacion empresarial de ZOEMEC.`;
    window.zoemecNotify?.(msg, level === 1 ? 'error' : 'info');
  }, [status, days, organization?.id]);

  if(!organization || !status) return null;

  if(status === ORG_STATUS.TRIAL_EXPIRED){
    return <div className="trial-banner trial-banner-expired" role="status">{TRIAL_EXPIRED_MESSAGE}</div>;
  }
  if(status !== ORG_STATUS.ACTIVE_TRIAL) return null;

  const label = days === 1 ? '1 dia restante' : `${days} dias restantes`;
  return <div className="trial-banner" role="status">
    Periodo de evaluacion empresarial — {label}
  </div>;
}
