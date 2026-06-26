import { gateway } from '@/lib/gateway';
export const dynamic = 'force-dynamic';

export default async function RbacPage() {
  const data = await gateway.rbac();
  const roles = (data?.roles ?? []) as Array<Record<string, unknown>>;
  const users = (data?.users ?? []) as Array<Record<string, unknown>>;
  return (
    <>
      <h1 className="h1">Role-Based Access Control</h1>
      <p className="sub">Roles gate human actions. Approvals check permission; denials are audit-logged.</p>
      <div className="grid cols-2">
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Roles</div>
          <table><tbody>
            {roles.map((r, i) => (<tr key={i}><td><b>{String(r.roleId)}</b></td><td className="m">{Array.isArray(r.permissions) ? (r.permissions as string[]).join(', ') || 'none' : '—'}</td></tr>))}
          </tbody></table>
        </div>
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Users</div>
          <table><tbody>
            {users.map((u, i) => (<tr key={i}><td>{String(u.name)}</td><td><span className="badge">{String(u.role)}</span></td></tr>))}
          </tbody></table>
        </div>
      </div>
    </>
  );
}
