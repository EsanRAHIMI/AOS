'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { connectFamilyFinanceAction, disconnectFamilyFinanceAction, selectFamilyFinanceAction } from './actions';

export interface FamilyFinancePanelState {
  vaultConfigured: boolean;
  vaultReason: string;
  connected: boolean;
  accountLabel: string;
  familyId: string;
  familyName: string;
  families: Array<{ id: string; name: string }>;
  lastError: string;
  summary: string;
}

export function FamilyFinanceConnect({ state }: { state: FamilyFinancePanelState }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function connect(form: FormData) {
    setBusy(true);
    setError('');
    const result = await connectFamilyFinanceAction(String(form.get('identifier') ?? ''), String(form.get('password') ?? ''));
    setBusy(false);
    if (!result.ok) setError(result.error);
    else router.refresh();
  }

  async function select(familyId: string) {
    setBusy(true);
    setError('');
    const result = await selectFamilyFinanceAction(familyId);
    setBusy(false);
    if (!result.ok) setError(result.error);
    else router.refresh();
  }

  async function disconnect() {
    setBusy(true);
    const result = await disconnectFamilyFinanceAction();
    setBusy(false);
    if (!result.ok) setError(result.error);
    else router.refresh();
  }

  return (
    <section style={{ margin: '0 0 18px', padding: 16, borderRadius: 16, border: '1px solid rgba(255,255,255,.12)' }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Family Finance</h2>
      {!state.vaultConfigured ? <p style={{ margin: 0, color: '#ffb4b4' }}>{state.vaultReason}</p> : null}
      {state.connected ? (
        <div>
          <p style={{ margin: '0 0 8px' }}>
            وصل به {state.accountLabel || 'حساب'}
            {state.familyName ? ` · ${state.familyName}` : ' · خانوار انتخاب نشده'}
          </p>
          {!state.familyId && state.families.length > 0 ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {state.families.map((f) => (
                <button key={f.id} type="button" className="btn btn-ghost" disabled={busy} onClick={() => select(f.id)}>{f.name}</button>
              ))}
            </div>
          ) : null}
          {state.summary ? <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, lineHeight: 1.6 }}>{state.summary}</pre> : null}
          {state.lastError ? <p style={{ color: '#ffb4b4' }}>{state.lastError}</p> : null}
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={disconnect}>قطع اتصال</button>
        </div>
      ) : (
        <form action={connect}>
          <p style={{ margin: '0 0 8px', fontSize: 13 }}>همان حساب finance.smartcontractsco.com. رمز فقط برای گرفتن نشست استفاده می‌شود و ذخیره نمی‌شود.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input name="identifier" required placeholder="ایمیل یا تلفن" autoComplete="username" style={{ fontSize: 13 }} />
            <input name="password" required type="password" placeholder="رمز" autoComplete="current-password" style={{ fontSize: 13 }} />
            <button className="btn btn-ok" type="submit" disabled={busy || !state.vaultConfigured}>اتصال</button>
          </div>
        </form>
      )}
      {error ? <p style={{ color: '#ffb4b4' }}>{error}</p> : null}
    </section>
  );
}
