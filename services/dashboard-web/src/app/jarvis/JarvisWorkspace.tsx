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
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  listSessionsAction, createSessionAction, getSessionAction, sendTurnAction,
  decideApprovalAction, intelligenceStatusAction, listMemoriesAction,
  correctMemoryAction, pinMemoryAction, deleteMemoryAction,
  type JarvisSessionView, type JarvisTurnView,
} from './actions';

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
  const [turns, setTurns] = useState<JarvisTurnView[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Array<{ kind: string; summary: string; toolName: string; ok: boolean }>>([]);
  const [pending, setPending] = useState<{ approvalId: string; runId: string; toolName: string } | null>(null);
  const [intel, setIntel] = useState<IntelStatus | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [tab, setTab] = useState<'chat' | 'memory'>('chat');
  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshSessions = useCallback(async () => setSessions(await listSessionsAction()), []);
  const loadSession = useCallback(async (id: string) => {
    setActiveId(id);
    const { turns: t } = await getSessionAction(id);
    setTurns(t);
    const last = t[t.length - 1];
    setPending(last?.pendingApprovalId && last.runId ? { approvalId: last.pendingApprovalId, runId: last.runId, toolName: '' } : null);
  }, []);

  useEffect(() => { void refreshSessions(); void intelligenceStatusAction().then(setIntel); }, [refreshSessions]);
  useEffect(() => { if (!activeId && sessions.length) void loadSession(sessions[0].sessionId); }, [sessions, activeId, loadSession]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [turns, steps]);

  async function newSession() {
    const id = await createSessionAction();
    if (id) { await refreshSessions(); await loadSession(id); }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    let sessionId = activeId;
    if (!sessionId) { sessionId = await createSessionAction(); if (!sessionId) return; await refreshSessions(); setActiveId(sessionId); }
    setInput(''); setBusy(true); setSteps([]);
    // optimistic user turn
    setTurns((prev) => [...prev, { turnId: 'tmp', userText: text, replyText: '', status: 'running', reasoningMode: '', provider: '', costUsd: 0, pendingApprovalId: null, runId: null, createdAt: new Date().toISOString() }]);
    try {
      // Stream steps via SSE for live progress; fall back to the JSON result.
      const res = await fetch(`/api/jarvis-stream?sessionId=${encodeURIComponent(sessionId)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
      });
      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const chunks = buf.split('\n\n'); buf = chunks.pop() ?? '';
          for (const c of chunks) {
            const ev = /event: (.+)/.exec(c)?.[1]; const dm = /data: (.+)/.exec(c);
            if (!ev || !dm) continue;
            const data = JSON.parse(dm[1]);
            if (ev === 'loop.step') setSteps((s) => [...s, { kind: data.kind, summary: data.summary, toolName: data.toolName, ok: data.ok }]);
            if (ev === 'turn.final') {
              if (data.pendingApprovalId && data.runId) setPending({ approvalId: data.pendingApprovalId, runId: data.runId, toolName: '' });
            }
          }
        }
      } else {
        await sendTurnAction(sessionId, text);
      }
    } catch { /* fall through to reload */ }
    await loadSession(sessionId);
    await refreshSessions();
    void intelligenceStatusAction().then(setIntel);
    setBusy(false); setSteps([]);
  }

  async function decide(action: 'approve' | 'reject') {
    if (!pending) return;
    setBusy(true);
    await decideApprovalAction(pending.approvalId, pending.runId, action);
    setPending(null);
    if (activeId) await loadSession(activeId);
    setBusy(false);
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
        {sessions.map((s) => (
          <button key={s.sessionId} onClick={() => { setTab('chat'); void loadSession(s.sessionId); }}
            style={{ display: 'block', width: '100%', textAlign: 'right', padding: '8px 10px', marginBottom: 4, borderRadius: 8, border: '1px solid transparent',
              background: s.sessionId === activeId ? 'rgba(89,194,255,0.12)' : 'transparent', color: 'inherit', cursor: 'pointer' }}>
            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title || 'Untitled'}</div>
            <div style={{ fontSize: 11, opacity: 0.55 }}>{s.turnCount} turns · ${s.totalCostUsd.toFixed(3)}</div>
          </button>
        ))}
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
            <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {turns.length === 0 && (
                <div style={{ margin: 'auto', textAlign: 'center', opacity: 0.6, maxWidth: 420 }}>
                  <div style={{ fontSize: 40, marginBottom: 8 }}>◍</div>
                  <p style={{ fontSize: 14 }}>Jarvis remembers your goals, missions and decisions across sessions. Ask in Persian or English — it reads your real stored state and uses governed tools.</p>
                </div>
              )}
              {turns.map((t, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ alignSelf: 'flex-end', maxWidth: '80%', background: 'rgba(89,194,255,0.14)', padding: '9px 13px', borderRadius: 14, borderTopRightRadius: 4, whiteSpace: 'pre-wrap' }}>{t.userText}</div>
                  {(t.replyText || t.status === 'completed') && (
                    <div style={{ alignSelf: 'flex-start', maxWidth: '85%', background: 'rgba(255,255,255,0.045)', padding: '10px 14px', borderRadius: 14, borderTopLeftRadius: 4, whiteSpace: 'pre-wrap' }}>
                      {t.replyText}
                      <div style={{ marginTop: 6, fontSize: 11, opacity: 0.5, display: 'flex', gap: 10 }}>
                        {t.reasoningMode === 'none' ? <span>⚠︎ degraded (no model)</span> : <span>{t.provider || 'model'}</span>}
                        {t.costUsd > 0 && <span>${t.costUsd.toFixed(4)}</span>}
                        {t.status === 'waiting_approval' && <span style={{ color: '#ffb020' }}>awaiting approval</span>}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {busy && steps.map((s, i) => (
                <div key={`step-${i}`} style={{ alignSelf: 'flex-start', fontSize: 12, opacity: 0.7, display: 'flex', gap: 8, alignItems: 'center', padding: '2px 8px' }}>
                  <span style={{ color: s.ok ? '#4ade80' : '#ff6b81' }}>{s.kind === 'tool_execution' ? '⚙' : s.kind === 'approval_pause' ? '⏸' : '◆'}</span>
                  <span>{s.toolName ? `${s.toolName}: ` : ''}{s.summary}</span>
                </div>
              ))}
              {busy && steps.length === 0 && <div style={{ alignSelf: 'flex-start', fontSize: 12, opacity: 0.6 }}>Jarvis is thinking…</div>}
            </div>

            {pending && (
              <div style={{ margin: '0 16px 12px', padding: 14, borderRadius: 12, background: 'rgba(255,176,32,0.08)', border: '1px solid rgba(255,176,32,0.35)' }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>⏸ Approval required</div>
                <p style={{ fontSize: 13, opacity: 0.85, marginBottom: 10 }}>Jarvis paused a sensitive action and needs your decision. The exact run will resume from where it stopped.</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" disabled={busy} onClick={() => decide('approve')}>Approve & resume</button>
                  <button className="btn ghost" disabled={busy} onClick={() => decide('reject')}>Reject</button>
                </div>
              </div>
            )}

            <div style={{ padding: 12, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 8 }}>
              <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                placeholder="در مورد هدف‌ها، تحقیق یا توسعهٔ سیستم بپرس…  /  Ask about goals, research or self-development…"
                style={{ flex: 1, resize: 'none', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 12px', color: 'inherit', fontFamily: 'inherit' }} />
              <button className="btn" disabled={busy || !input.trim()} onClick={send}>{busy ? '…' : 'Send'}</button>
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
                  <div style={{ fontSize: 14 }}>{String(m.content)}</div>
                  {Boolean(m.subject) && <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>{String(m.subject)}</div>}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
