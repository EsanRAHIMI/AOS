'use client';
import { Suspense, useActionState } from 'react';
import { useSearchParams } from 'next/navigation';
import { loginAction, type LoginState } from './actions';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const next = params.get('next') ?? '/';
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});

  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div className="card" style={{ width: '100%', maxWidth: 380 }}>
        <div className="brand" style={{ padding: '0 0 6px' }}>
          <span className="logo" />
          <span>FACTORY<small>autonomous-os control room</small></span>
        </div>
        <h1 className="h1" style={{ fontSize: 22, margin: '14px 0 4px' }}>Sign in</h1>
        <p className="sub" style={{ marginBottom: 18 }}>Authenticate to access the control room.</p>

        <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input type="hidden" name="next" value={next} />
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="label">Email</span>
            <input name="email" type="email" autoComplete="username" required placeholder="you@company.com" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="label">Password</span>
            <input name="password" type="password" autoComplete="current-password" required placeholder="••••••••" />
          </label>
          {state.error && (
            <div className="badge err" role="alert" style={{ justifyContent: 'center', padding: '8px 12px' }}>{state.error}</div>
          )}
          <button className="btn btn-primary" type="submit" disabled={pending} style={{ width: '100%', marginTop: 4 }}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
