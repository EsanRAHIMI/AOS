'use client';
/**
 * Persistent Jarvis Workspace (K2, D-177; mandate §C/§K).
 *
 * The primary owner experience: one persistent conversation surface with a
 * thread switcher, streaming turns on the shared agent loop, live tool/step
 * status, inline approval cards that resume the exact paused run, memory
 * inspection/correction, and honest offline/degraded status. Not a chat box —
 * the sessions and memory persist server-side and survive reloads.
 */
import { useEffect, useState, useCallback } from 'react';
import {
  listSessionsAction, createSessionAction, intelligenceStatusAction, listMemoriesAction,
  correctMemoryAction, pinMemoryAction, deleteMemoryAction,
  onboardingQuestionsAction, submitOnboardingAction, personalStateAction,
  type JarvisSessionView, type OnboardingQuestion,
} from './actions';
import { JarvisConversation } from '@/components/JarvisConversation';
import { dirProps } from '@/lib/rtl';

type IntelStatus = Awaited<ReturnType<typeof intelligenceStatusAction>>;
type Memory = Record<string, unknown>;

function StatusPill({ intel }: { intel: IntelStatus | null }) {
  if (!intel) return <span className="pill" style={{ opacity: 0.6 }}>status…</span>;
  const degraded = intel.degraded;
  const tone = degraded ? '#ffb020' : intel.isLocal ? '#59c2ff' : '#4ade80';
  const label = degraded ? 'Offline / degraded' : intel.isLocal ? `Local model (${intel.models?.standard ?? '?'})` : `${intel.provider} (${intel.models?.standard ?? '?'})`;
  return (
    <span title={degraded ? intel.degradedDetail : `research: ${intel.research?.coverage}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '3px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.05)', border: `1px solid ${tone}55` }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: tone }} />
      {label}{intel.safeMode ? ' · safe mode' : ''}
    </span>
  );
}

export default function JarvisWorkspace() {
  const [sessions, setSessions] = useState<JarvisSessionView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [intel, setIntel] = useState<IntelStatus | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [tab, setTab] = useState<'chat' | 'memory'>('chat');
  // D-178 Product Activation: onboarding when the owner has no personal state yet.
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [questions, setQuestions] = useState<OnboardingQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [onboardingDone, setOnboardingDone] = useState(false);

  const refreshSessions = useCallback(async () => setSessions(await listSessionsAction()), []);
  /* Selecting a session is all this page does now — JarvisConversation loads
   * that session's real history itself, exactly as it does in the dock. */
  const loadSession = useCallback(async (id: string) => { setActiveId(id); }, []);

  useEffect(() => { void refreshSessions(); void intelligenceStatusAction().then(setIntel); }, [refreshSessions]);
  useEffect(() => { if (!activeId && sessions.length) void loadSession(sessions[0].sessionId); }, [sessions, activeId, loadSession]);
  // Offer onboarding on first load when the owner has no personal state yet.
  useEffect(() => {
    void personalStateAction().then((s) => { if (s && s.empty) setOnboardingDone(false); else setOnboardingDone(true); });
  }, []);

  async function startOnboarding() {
    setQuestions(await onboardingQuestionsAction());
    setShowOnboarding(true);
  }
  async function submitOnboarding() {
    setBusy(true);
    const res = await submitOnboardingAction(answers);
    setBusy(false);
    if (res) { setShowOnboarding(false); setOnboardingDone(true); setAnswers({}); await openMemory(); }
  }

  async function newSession() {
    const id = await createSessionAction();
    if (id) { await refreshSessions(); await loadSession(id); }
  }

  async function openMemory() {
    setTab('memory');
    setMemories(await listMemoriesAction());
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16, height: 'calc(100vh - 130px)' }}>
      {/* thread switcher */}
      <aside className="card" style={{ overflowY: 'auto', padding: 12 }}>
        <button className="btn" style={{ width: '100%', marginBottom: 10 }} onClick={newSession}>+ New thread</button>
        {sessions.length === 0 && <p style={{ fontSize: 13, opacity: 0.6 }}>No threads yet.</p>}
        {sessions.map((s) => {
          const title = s.title || 'Untitled';
          return (
          <button key={s.sessionId} onClick={() => { setTab('chat'); void loadSession(s.sessionId); }}
            style={{ display: 'block', width: '100%', padding: '8px 10px', marginBottom: 4, borderRadius: 8, border: '1px solid transparent',
              background: s.sessionId === activeId ? 'rgba(89,194,255,0.12)' : 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'start' }}>
            <div {...dirProps(title)} style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
            <div style={{ fontSize: 11, opacity: 0.55 }} data-no-auto-dir="">{s.turnCount} turns · ${s.totalCostUsd.toFixed(3)}</div>
          </button>
          );
        })}
        <button className="btn ghost" style={{ width: '100%', marginTop: 12 }} onClick={openMemory}>🧠 Memory</button>
      </aside>

      {/* main pane */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" style={{ opacity: tab === 'chat' ? 1 : 0.5 }} onClick={() => setTab('chat')}>Conversation</button>
            <button className="btn ghost" style={{ opacity: tab === 'memory' ? 1 : 0.5 }} onClick={openMemory}>Memory</button>
          </div>
          <StatusPill intel={intel} />
        </header>

        {tab === 'chat' ? (
          <>
            <div className="jstage-chat">
              {showOnboarding === false && !onboardingDone && (
                <div style={{ margin: 'auto', textAlign: 'center', opacity: 0.85, maxWidth: 460 }}>
                  <div style={{ fontSize: 40, marginBottom: 8, opacity: 0.6 }}>◍</div>
                  <p style={{ fontSize: 14, opacity: 0.7 }}>Jarvis remembers your goals, missions and decisions across sessions. Ask in Persian or English — it reads your real stored state and uses governed tools.</p>
                  {!onboardingDone && (
                    <div style={{ marginTop: 16 }}>
                      <button className="btn" onClick={startOnboarding}>راه‌اندازی زمینهٔ شخصی من · Set up my personal context</button>
                      <p style={{ fontSize: 11, opacity: 0.5, marginTop: 6 }}>A few quick questions; your answers become real, editable owner state.</p>
                    </div>
                  )}
                </div>
              )}
              {showOnboarding && (
                <div style={{ margin: 'auto', width: '100%', maxWidth: 560 }}>
                  <h3 style={{ fontSize: 16, marginBottom: 4 }}>راه‌اندازی زمینهٔ شخصی · Personal context setup</h3>
                  <p style={{ fontSize: 12, opacity: 0.6, marginBottom: 14 }}>Answer what you like; blanks are skipped. Nothing is invented.</p>
                  {questions.map((q) => (
                    <div key={q.id} style={{ marginBottom: 10 }}>
                      <label {...dirProps(q.fa)} style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>{q.fa}<span style={{ opacity: 0.5 }}> · {q.en}</span></label>
                      <input value={answers[q.id] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                        style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 10px', color: 'inherit' }} />
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button className="btn" disabled={busy} onClick={submitOnboarding}>ذخیره · Save</button>
                    <button className="btn ghost" disabled={busy} onClick={() => setShowOnboarding(false)}>بعداً · Later</button>
                  </div>
                </div>
              )}
              {/* D-190 — the SAME conversation component the dock uses.
                * This page used to re-implement the transcript, the streaming
                * loop, the approval bar and the composer; two copies of one
                * conversation drifted apart every time either changed. */}
              <JarvisConversation
                key={activeId ?? 'new'}
                variant="page"
                sessionId={activeId}
                onTurnComplete={() => { void refreshSessions(); void intelligenceStatusAction().then(setIntel); }}
                placeholder="در مورد هدف‌ها، تحقیق یا توسعهٔ سیستم بپرسید…"
                emptyHint="هرچه لازم دارید بپرسید — به همهٔ سرویس‌ها، حافظه، مأموریت‌ها، هویت و حلقهٔ زنده دسترسی دارم."
              />
            </div>
          </>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            <p style={{ fontSize: 13, opacity: 0.7, marginBottom: 12 }}>Everything Jarvis remembers about you, with provenance. Correct, pin or delete anything.</p>
            {memories.length === 0 && <p style={{ opacity: 0.6 }}>No memories recorded yet.</p>}
            {memories.map((m) => {
              const id = String(m.memoryId);
              const status = String(m.status);
              const tone = status === 'confirmed' ? '#4ade80' : status === 'inferred' ? '#59c2ff' : '#888';
              return (
                <div key={id} style={{ padding: 12, marginBottom: 8, borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: tone }}>{status} · {String(m.kind)}{m.pinned ? ' · 📌' : ''}</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={async () => { await pinMemoryAction(id, !m.pinned); setMemories(await listMemoriesAction()); }}>{m.pinned ? 'Unpin' : 'Pin'}</button>
                      <button className="btn ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={async () => { const v = prompt('Correct this memory:', String(m.content)); if (v) { await correctMemoryAction(id, v); setMemories(await listMemoriesAction()); } }}>Correct</button>
                      <button className="btn ghost" style={{ fontSize: 11, padding: '2px 8px', color: '#ff6b81' }} onClick={async () => { if (confirm('Delete this memory?')) { await deleteMemoryAction(id); setMemories(await listMemoriesAction()); } }}>Delete</button>
                    </div>
                  </div>
                  <div {...dirProps(String(m.content))} style={{ fontSize: 14 }}>{String(m.content)}</div>
                  {Boolean(m.subject) && <div {...dirProps(String(m.subject))} style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>{String(m.subject)}</div>}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
