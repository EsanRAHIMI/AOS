'use client';
import { useState } from 'react';
import { createTaskAction } from '@/app/actions';

export function CreateTaskForm() {
  const [pending, setPending] = useState(false);
  return (
    <form
      action={async (fd) => { setPending(true); await createTaskAction(fd); setPending(false); }}
      style={{ display: 'flex', gap: 10, marginBottom: 18 }}
    >
      <input
        name="goal"
        placeholder="Describe a goal, e.g. 'Create a notifications service'"
        required
        style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel-2)', color: 'var(--text)', fontSize: 14 }}
      />
      <button
        type="submit"
        disabled={pending}
        style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer', opacity: pending ? 0.6 : 1 }}
      >
        {pending ? 'Creating…' : 'Create task'}
      </button>
    </form>
  );
}
