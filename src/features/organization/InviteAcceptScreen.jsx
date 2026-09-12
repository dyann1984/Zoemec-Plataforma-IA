import { useState } from 'react';
import { acceptInvitation } from '../../services/organizationApi.js';

/* Pantalla para "?invite=token&org=orgId&inv=invitationId" (punto 10 del
   brief). Autosuficiente como VerifyEmailScreen.jsx -- nunca redirige a
   <Auth/> (eso perderia los parametros de la invitacion del `screen` normal
   de App()): si no hay sesion, ofrece un mini login/register propio que
   reusa el MISMO prop `login` de siempre, y solo despues llama a
   acceptInvitation(). */
export function InviteAcceptScreen({ organizationId, invitationId, token, user, login, onAccepted, onGoToApp }){
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [acceptState, setAcceptState] = useState('idle'); // idle | accepting | done | error
  const [acceptError, setAcceptError] = useState('');

  const submitAuth = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthBusy(true);
    try{
      const outcome = await login(name || email, email, password, mode);
      if(outcome?.ok === false && outcome.status === 'unverified'){
        setAuthError('Verifica tu correo (revisa tu bandeja de entrada) y vuelve a abrir este mismo link de invitacion.');
      }else if(outcome?.ok === false){
        setAuthError('No se pudo continuar. Revisa tus datos.');
      }
    }catch(err){
      setAuthError(err?.message || 'No se pudo continuar.');
    }finally{
      setAuthBusy(false);
    }
  };

  const accept = async () => {
    setAcceptState('accepting');
    setAcceptError('');
    try{
      await acceptInvitation({ organizationId, invitationId, token });
      setAcceptState('done');
      onAccepted?.();
    }catch(err){
      setAcceptState('error');
      setAcceptError(err?.message || 'No se pudo aceptar la invitacion.');
    }
  };

  return <div className="invite-accept-page">
    <div className="invite-accept-card">
      <h1>Invitacion a ZOEMEC</h1>

      {!user && <>
        <p>Inicia sesion o crea tu cuenta con el MISMO correo al que te invitaron para unirte al equipo.</p>
        <form onSubmit={submitAuth}>
          {mode === 'register' && <>
            <label htmlFor="inv-name">Nombre</label>
            <input id="inv-name" value={name} onChange={e=>setName(e.target.value)} />
          </>}
          <label htmlFor="inv-email">Correo</label>
          <input id="inv-email" type="email" value={email} onChange={e=>setEmail(e.target.value)} />
          <label htmlFor="inv-password">Contrasena</label>
          <input id="inv-password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
          {authError && <p className="invite-accept-error">{authError}</p>}
          <button className="primary" type="submit" disabled={authBusy}>{authBusy ? 'Un momento...' : (mode === 'login' ? 'Iniciar sesion' : 'Crear cuenta')}</button>
        </form>
        <p style={{marginTop:14}}>
          {mode === 'login'
            ? <a onClick={()=>setMode('register')} style={{cursor:'pointer'}}>No tengo cuenta, crear una</a>
            : <a onClick={()=>setMode('login')} style={{cursor:'pointer'}}>Ya tengo cuenta, iniciar sesion</a>}
        </p>
      </>}

      {user && acceptState !== 'done' && <>
        <p>Sesion iniciada como <b>{user.email}</b>. Acepta la invitacion para unirte a tu equipo en ZOEMEC.</p>
        {acceptError && <p className="invite-accept-error">{acceptError}</p>}
        <button className="primary" onClick={accept} disabled={acceptState === 'accepting'}>{acceptState === 'accepting' ? 'Uniendote...' : 'Aceptar invitacion'}</button>
      </>}

      {acceptState === 'done' && <>
        <p>Listo. Ya formas parte del equipo.</p>
        <button className="primary" onClick={onGoToApp}>Entrar a ZOEMEC</button>
      </>}
    </div>
  </div>;
}
