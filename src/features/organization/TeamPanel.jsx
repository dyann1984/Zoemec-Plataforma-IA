import { useEffect, useState } from 'react';
import { listOrganizationMembers, inviteMember, disableOrganizationMember, buildInviteLink } from '../../services/organizationApi.js';
import { MAX_ORG_MEMBERS, ORG_ROLE, isOrgManagerRole } from '../../domain/organization.js';

/* Panel de Equipo (puntos 4/10 del brief): roster + invitar (company_manager,
   el responsable de la empresa -- NO admin de ZOEMEC) + deshabilitar miembro
   (company_manager). El servidor (_route-organizations.mjs) es la autoridad
   real de todo esto -- aqui solo se oculta la UI de responsable para un
   colaborador, nunca se depende de eso como control de acceso.
   isOrgManagerRole acepta el valor nuevo Y el legado 'org_admin' (empresas
   creadas antes del renombrado de roles). */
export function TeamPanel({ organizationId, membership }){
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState(ORG_ROLE.COLLABORATOR);
  const [inviteLink, setInviteLink] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const isCompanyManager = isOrgManagerRole(membership?.role);

  const load = async () => {
    setLoading(true);
    try{
      const { members: list } = await listOrganizationMembers();
      setMembers(list);
    }catch(err){
      window.zoemecNotify?.(err.message || 'No se pudo cargar el equipo.', 'error');
    }finally{
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const activeCount = members.filter(m => m.status === 'active').length;

  const submitInvite = async (e) => {
    e.preventDefault();
    setError('');
    if(!inviteEmail.trim()){ setError('Escribe un correo valido.'); return; }
    setBusy(true);
    try{
      const res = await inviteMember({ email: inviteEmail.trim(), role: inviteRole });
      setInviteLink(buildInviteLink({ organizationId, invitationId: res.invitation.id, token: res.token }));
      setInviteEmail('');
      window.zoemecNotify?.('Invitacion generada. Copia el link y comparte lo con tu colaborador.', 'info');
    }catch(err){
      setError(err.message || 'No se pudo generar la invitacion.');
    }finally{
      setBusy(false);
    }
  };

  const disable = async (uid) => {
    if(!window.confirm('Deshabilitar a este usuario? Perdera acceso a la empresa de inmediato.')) return;
    try{
      await disableOrganizationMember(uid);
      await load();
    }catch(err){
      window.zoemecNotify?.(err.message || 'No se pudo deshabilitar al usuario.', 'error');
    }
  };

  return <div className="team-panel">
    <div className="team-panel-header">
      <h2>Equipo de la empresa</h2>
      <span className="team-panel-count">{activeCount}/{MAX_ORG_MEMBERS} usuarios activos</span>
    </div>

    {loading ? <p>Cargando...</p> : <table>
      <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th>{isCompanyManager && <th></th>}</tr></thead>
      <tbody>
        {members.map(m => <tr key={m.uid}>
          <td>{m.displayName || '—'}</td>
          <td>{m.email}</td>
          <td className={isOrgManagerRole(m.role) ? 'role-admin' : ''}>{isOrgManagerRole(m.role) ? 'Responsable' : 'Colaborador'}</td>
          <td className={m.status === 'disabled' ? 'status-disabled' : ''}>{m.status === 'disabled' ? 'Deshabilitado' : 'Activo'}</td>
          {isCompanyManager && <td>
            {m.uid !== membership.uid && m.status === 'active' && <button className="soft" onClick={()=>disable(m.uid)}>Deshabilitar</button>}
          </td>}
        </tr>)}
      </tbody>
    </table>}

    {isCompanyManager && <>
      <h3 style={{marginTop:28}}>Invitar usuario</h3>
      {activeCount >= MAX_ORG_MEMBERS
        ? <p>Ya alcanzaste el maximo de {MAX_ORG_MEMBERS} usuarios de la prueba empresarial.</p>
        : <form onSubmit={submitInvite}>
          <label htmlFor="invite-email">Correo</label>
          <input id="invite-email" type="email" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="colaborador@empresa.com" />
          <label htmlFor="invite-role">Rol</label>
          <select id="invite-role" value={inviteRole} onChange={e=>setInviteRole(e.target.value)}>
            <option value={ORG_ROLE.COLLABORATOR}>Colaborador</option>
            <option value={ORG_ROLE.MANAGER}>Responsable</option>
          </select>
          {error && <p className="org-signup-error">{error}</p>}
          <button type="submit" disabled={busy} style={{marginTop:14}}>{busy ? 'Generando...' : 'Generar invitacion'}</button>
        </form>}
      {inviteLink && <div className="invite-link-box">
        Comparte este link con tu colaborador (valido 7 dias, un solo uso):<br/>{inviteLink}
      </div>}
    </>}
  </div>;
}
