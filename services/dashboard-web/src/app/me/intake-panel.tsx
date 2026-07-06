'use client';

import {
  createPersonalGoalAction,
  grantConnectorConsentAction,
  ingestRealityFactAction,
  saveProfileAction,
} from './actions';

function summonJarvis(command: string): void {
  window.dispatchEvent(new CustomEvent('aos:jarvis', { detail: { command } }));
}

export function IntakePanel() {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="label" style={{ marginBottom: 10 }}>
        Personal Intake (real data, no fake assumptions)
      </div>
      <p className="m" style={{ fontSize: 12.5, marginTop: 0 }}>
        Complete these four inputs and Jarvis recommendations become specific and usable.
      </p>

      <div className="grid cols-2" style={{ gap: 14 }}>
        <form action={saveProfileAction} className="glass" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
          <b style={{ fontSize: 12.5 }}>1) Identity</b>
          <input name="displayName" placeholder="Display name (e.g. Esan)" style={{ fontSize: 13 }} />
          <div style={{ display: 'flex', gap: 6 }}>
            <input name="timezone" placeholder="Timezone (e.g. Asia/Tehran)" style={{ fontSize: 13, flex: 1 }} />
            <input name="locale" placeholder="Locale (e.g. en-US)" style={{ fontSize: 13, flex: 1 }} />
          </div>
          <button type="submit" className="btn btn-primary">Save identity</button>
        </form>

        <form action={createPersonalGoalAction} className="glass" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
          <b style={{ fontSize: 12.5 }}>2) One active goal</b>
          <input name="title" placeholder="Goal title (required)" style={{ fontSize: 13 }} required />
          <input name="description" placeholder="Goal detail (optional)" style={{ fontSize: 13 }} />
          <div style={{ display: 'flex', gap: 6 }}>
            <select name="horizon" defaultValue="week" style={{ fontSize: 13, flex: 1 }}>
              <option value="day">day</option>
              <option value="week">week</option>
              <option value="month">month</option>
              <option value="quarter">quarter</option>
              <option value="year">year</option>
              <option value="life">life</option>
            </select>
            <select name="priority" defaultValue="normal" style={{ fontSize: 13, flex: 1 }}>
              <option value="low">low</option>
              <option value="normal">normal</option>
              <option value="high">high</option>
            </select>
          </div>
          <button type="submit" className="btn btn-primary">Add goal</button>
        </form>

        <form action={grantConnectorConsentAction} className="glass" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
          <b style={{ fontSize: 12.5 }}>3) Read-only consent</b>
          <select name="connectorType" defaultValue="calendar" style={{ fontSize: 13 }}>
            <option value="calendar">calendar</option>
            <option value="email">email</option>
            <option value="tasks">tasks</option>
          </select>
          <p className="m" style={{ fontSize: 11.5, margin: 0 }}>
            Consent only enables scoped read mode.
          </p>
          <button type="submit" className="btn btn-primary">Grant consent</button>
        </form>

        <form action={ingestRealityFactAction} className="glass" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
          <b style={{ fontSize: 12.5 }}>4) One reality fact</b>
          <select name="kind" defaultValue="income_idea" style={{ fontSize: 13 }}>
            <option value="income_idea">income idea</option>
            <option value="risk">risk</option>
            <option value="learning_track">learning track</option>
            <option value="life_item">life item</option>
            <option value="finance_item">finance item</option>
          </select>
          <input name="title" placeholder="Title (required)" style={{ fontSize: 13 }} required />
          <input name="description" placeholder="Description (optional)" style={{ fontSize: 13 }} />
          <button type="submit" className="btn btn-primary">Add fact</button>
        </form>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        <button type="button" className="chip" onClick={() => summonJarvis('build my personal reality baseline and show missing data gaps')}>Jarvis: baseline</button>
        <button type="button" className="chip" onClick={() => summonJarvis('rank my next best actions based on my current data')}>Jarvis: next actions</button>
        <button type="button" className="chip" onClick={() => summonJarvis('run a full daily briefing for my personal scope')}>Jarvis: daily briefing</button>
      </div>
    </div>
  );
}

