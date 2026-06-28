'use client';
import { useState } from 'react';
import { createOperationAction } from '@/app/actions';

const OP_TYPES: Array<[string, string, string]> = [
  ['health_check_only', 'Health check only', 'low'],
  ['new_app', 'Create new app', 'medium'],
  ['existing_app_update', 'Update existing app', 'high'],
  ['existing_app_repair', 'Repair existing app', 'high'],
  ['existing_app_restart', 'Restart existing app', 'high'],
  ['existing_app_env_update', 'Update env vars', 'high'],
];

const QUICK: Array<[string, string]> = [
  ['Health-check the gateway-api service', 'health_check_only'],
  ['Activate a validated service on production', 'new_app'],
  ['Repair a failed service', 'existing_app_repair'],
];

const riskTone = (r: string) => (r === 'high' ? 'err' : r === 'medium' ? 'warn' : 'ok');

/** Mission-control command panel: starts a real, safety-gated operation plan. */
export function OperationCommand() {
  const [goal, setGoal] = useState('');
  const [opType, setOpType] = useState('health_check_only');
  const [pending, setPending] = useState(false);
  const risk = OP_TYPES.find((o) => o[0] === opType)?.[2] ?? 'low';

  return (
    <form
      action={async (fd) => { setPending(true); await createOperationAction(fd); setPending(false); setGoal(''); }}
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <input name="goal" value={goal} onChange={(e) => setGoal(e.target.value)} required placeholder="What do you want the kernel to do? e.g. “Health-check the gateway-api service”" style={{ width: '100%', fontSize: 15, padding: '13px 15px' }} />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="m" style={{ fontSize: 12.5 }}>Operation type</label>
        <select name="operationType" value={opType} onChange={(e) => setOpType(e.target.value)} style={{ flex: 1, minWidth: 200 }}>
          {OP_TYPES.map(([v, label, r]) => <option key={v} value={v}>{label} — {r} risk</option>)}
        </select>
        <span className={`badge ${riskTone(risk)}`}>{risk} risk</span>
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? 'Starting…' : 'Start operation'}</button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span className="m" style={{ fontSize: 12 }}>Quick start:</span>
        {QUICK.map(([g, t]) => (
          <button key={g} type="button" className="chip" style={{ cursor: 'pointer' }} onClick={() => { setGoal(g); setOpType(t); }}>{g}</button>
        ))}
      </div>
    </form>
  );
}
