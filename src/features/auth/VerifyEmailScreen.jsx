import { useEffect, useState } from 'react';
import { applyActionCode, sendEmailVerification } from 'firebase/auth';
import { auth, emailActionCodeSettings } from '../../firebase.js';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { firebaseMessage } from '../../services/errorMessages.js';

/* Pantalla ZOEMEC para el enlace de verificacion de correo (?mode=verifyEmail
   &oobCode=...), en vez de dejar al usuario en la pagina generica de
   Firebase. Se monta ANTES que cualquier otra pantalla (ver App() en
   src/main.jsx) apenas se detectan esos parametros en la URL -- no depende
   de sesion activa: applyActionCode() valida el oobCode por si mismo, el
   usuario puede llegar aqui desde el correo en cualquier dispositivo,
   incluso sin haber iniciado sesion ahi. */

const PHASE = Object.freeze({
  CHECKING: 'checking',
  SUCCESS: 'success',
  INVALID: 'invalid', // oobCode nunca existio / formato invalido
  EXPIRED: 'expired', // expiro o ya fue usado (auth/invalid-action-code, auth/expired-action-code)
});

export function VerifyEmailScreen({ oobCode, onGoToLogin, onGoToApp }){
  const { t: tr } = useI18n();
  const [phase, setPhase] = useState(PHASE.CHECKING);
  const [resendState, setResendState] = useState(null); // null | 'sending' | 'sent' | 'failed' | 'needsLogin'
  const [confirmState, setConfirmState] = useState(null); // null | 'checking' | 'yes' | 'no' | 'needsLogin'

  useEffect(() => {
    if(!oobCode){ setPhase(PHASE.INVALID); return; }
    let alive = true;
    (async () => {
      try{
        await applyActionCode(auth, oobCode);
        if(alive) setPhase(PHASE.SUCCESS);
      }catch(err){
        if(!alive) return;
        const code = String(err?.code || '');
        setPhase(code.includes('invalid-action-code') || code.includes('expired-action-code') ? PHASE.EXPIRED : PHASE.INVALID);
      }
    })();
    return () => { alive = false; };
  }, [oobCode]);

  const resend = async () => {
    if(!auth.currentUser){ setResendState('needsLogin'); return; }
    setResendState('sending');
    try{
      await sendEmailVerification(auth.currentUser, emailActionCodeSettings);
      setResendState('sent');
    }catch{
      setResendState('failed');
    }
  };

  const confirmAlreadyVerified = async () => {
    if(!auth.currentUser){ setConfirmState('needsLogin'); return; }
    setConfirmState('checking');
    try{
      await auth.currentUser.reload();
      setConfirmState(auth.currentUser.emailVerified ? 'yes' : 'no');
    }catch{
      setConfirmState('no');
    }
  };

  return <div className="auth-page verify-email-page">
    <div className="auth-card">
      {phase === PHASE.CHECKING && <>
        <h1>{tr('auth.verify.checkingTitle')}</h1>
        <p>{tr('auth.verify.checkingDesc')}</p>
      </>}

      {phase === PHASE.SUCCESS && <>
        <h1>{tr('auth.verify.successTitle')}</h1>
        <p>{tr('auth.verify.successDesc')}</p>
        <button onClick={onGoToApp || onGoToLogin}>{onGoToApp ? tr('auth.verify.goToAppBtn') : tr('auth.verify.loginBtn')}</button>
      </>}

      {(phase === PHASE.EXPIRED || phase === PHASE.INVALID) && <>
        <h1>{tr('auth.verify.expiredTitle')}</h1>
        <p>{phase === PHASE.EXPIRED ? tr('auth.verify.expiredDesc') : tr('auth.verify.invalidDesc')}</p>

        <div className="verify-actions">
          <button onClick={resend} disabled={resendState==='sending'}>{tr('auth.verify.resendBtn')}</button>
          {resendState === 'sent' && <p className="verify-note ok">{tr('auth.verify.resendSent')}</p>}
          {resendState === 'failed' && <p className="verify-note error">{tr('auth.verify.resendFailed')}</p>}
          {resendState === 'needsLogin' && <p className="verify-note">{tr('auth.verify.resendNeedsLogin')}</p>}

          <button className="soft" onClick={confirmAlreadyVerified} disabled={confirmState==='checking'}>{tr('auth.verify.alreadyVerifiedBtn')}</button>
          {confirmState === 'yes' && <p className="verify-note ok">{tr('auth.verify.alreadyVerifiedYes')}</p>}
          {confirmState === 'no' && <p className="verify-note error">{tr('auth.verify.alreadyVerifiedNo')}</p>}
          {confirmState === 'needsLogin' && <p className="verify-note">{tr('auth.verify.alreadyVerifiedNeedsLogin')}</p>}

          <button className="soft" onClick={onGoToLogin}>{tr('auth.verify.loginBtn')}</button>
        </div>
      </>}
    </div>
  </div>;
}
