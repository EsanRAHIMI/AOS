'use client';
import { useState } from 'react';
import { createTaskAction } from '@/app/actions';

/**
 * Goal entry box. `variant="command"` renders the large control-room command bar;
 * the default renders a compact inline form. Both post to the same server action,
 * so the backend contract is untouched.
 */
export function CreateTaskForm({ variant = 'inline' }: { variant?: 'inline' | 'command' }) {
  const [pending, setPending] = useState(false);
  const isCommand = variant === 'command';
  return (
    <form
      className={isCommand ? 'command' : 'actions'}
      action={async (fd) => { setPending(true); await createTaskAction(fd); setPending(false); }}
      style={isCommand ? undefined : { marginBottom: 18 }}
    >
      <input
        name="goal"
        placeholder={isCommand ? 'Give the kernel a goal…' : "Describe a goal, e.g. 'Create a notifications service'"}
        required
        style={{ flex: 1 }}
      />
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Creating…' : isCommand ? 'Run' : 'Create task'}
      </button>
    </form>
  );
}
