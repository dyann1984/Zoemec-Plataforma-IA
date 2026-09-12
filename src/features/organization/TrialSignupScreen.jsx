import { useState } from 'react';

/* Alta de "Probar ZOEMEC 30 dias" (punto 16 del brief). Reusa el MISMO
   register() (prop `login`, mode='register') que ya usa <Auth/> -- una sola
   cuenta Firebase, un solo flujo de verificacion de correo (VerifyEmailScreen
   ya existente, no se duplica nada de eso aqui). Como requireAuth/requireFeature
   exigen correo verificado para CUALQUIER llamada al servidor (ver
   server/api-lib/_authGuard.mjs), la organizacion no se puede crear en este
   mismo paso -- se guarda la intencion (nombre de empresa/responsable) en
   localStorage y App() la retoma automaticamente la primera vez que esa
   cuenta ya verificada entra con sesion real y todavia no pertenece a
   ninguna organizacion (ver PENDING_ORG_SIGNUP_KEY en src/main.jsx). */
export const PENDING_ORG_SIGNUP_KEY = 'zoemec-pending-org-signup';

export function TrialSignupScreen({ setScreen, login }){
  const [companyName, setCompanyName] = useState('');
  const [responsibleName, setResponsibleName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if(!companyName.trim() || !responsibleName.trim() || !email.trim() || password.length < 6){
      setError('Completa todos los campos. La contrasena debe tener al menos 6 caracteres.');
      return;
    }
    setSubmitting(true);
    try{
      localStorage.setItem(PENDING_ORG_SIGNUP_KEY, JSON.stringify({
        email: email.trim().toLowerCase(), companyName: companyName.trim(), responsibleName: responsibleName.trim()
      }));
    }catch{ /* localStorage no disponible: la organizacion no se autocreara al verificar, pero el registro individual si funciona */ }
    // register() ya se encarga de crear la cuenta, mandar el correo de
    // verificacion, avisar al usuario y navegar a 'login' por su cuenta
    // (mismo camino que <Auth mode="register"/>, nunca se duplica aqui) --
    // solo queda mostrar un error si esta MISMA llamada lo devuelve sin
    // lanzar excepcion (ej. "device-used").
    try{
      const outcome = await login(responsibleName.trim(), email, password, 'register');
      if(outcome?.ok === false){
        setError('No se pudo crear tu cuenta. Revisa los datos e intenta de nuevo.');
        setSubmitting(false);
      }
    }catch(err){
      setError(err?.message || 'No se pudo crear tu cuenta.');
      setSubmitting(false);
    }
  };

  return <div className="org-signup-page">
    <div className="org-signup-card">
      <h1>Prueba empresarial de 30 dias</h1>
      <p>Hasta 10 usuarios. Acceso completo a las principales herramientas. Exportacion PDF y Excel incluida. Sin compromiso.</p>
      <ul className="org-signup-features">
        <li>Crea proyectos y genera APU reales</li>
        <li>APU Inteligente, Confidence Engine y Bid Risk</li>
        <li>Exporta PDF y Excel sin restricciones</li>
        <li>Invita hasta 9 colaboradores mas</li>
      </ul>
      <form onSubmit={submit}>
        <label htmlFor="org-company-name">Nombre de la empresa</label>
        <input id="org-company-name" value={companyName} onChange={e=>setCompanyName(e.target.value)} placeholder="Constructora ejemplo S.A." autoComplete="organization" />

        <label htmlFor="org-responsible-name">Responsable</label>
        <input id="org-responsible-name" value={responsibleName} onChange={e=>setResponsibleName(e.target.value)} placeholder="Nombre y apellido" autoComplete="name" />

        <label htmlFor="org-email">Correo</label>
        <input id="org-email" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="responsable@empresa.com" autoComplete="email" />

        <label htmlFor="org-password">Contrasena</label>
        <input id="org-password" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Minimo 6 caracteres" autoComplete="new-password" />

        {error && <p className="org-signup-error">{error}</p>}
        <button type="submit" disabled={submitting}>{submitting ? 'Creando...' : 'Crear organizacion'}</button>
      </form>
      <p style={{marginTop:16}}><a onClick={()=>setScreen('login')} style={{cursor:'pointer'}}>Ya tengo cuenta, iniciar sesion</a></p>
    </div>
  </div>;
}
