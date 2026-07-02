/**
 * Phase 19.5 — UtteranceGate: the single command gate for the voice operator.
 *
 * Every candidate utterance — browser STT final, realtime transcript, typed text —
 * must pass through ONE gate instance before it may reach `/v1/voice/message`.
 * Pure and dependency-free (injectable clock) so it is unit-testable in node.
 *
 * Enforced rules:
 *  - final-only: interim transcripts are display-only, never commands
 *  - minCommandChars: empty/short fragments are ignored
 *  - dedupe: an identical normalized command within dedupeWindowMs is dropped
 *  - single in-flight lock: while a command is thinking/executing/speaking,
 *    new commands are rejected (no queueing) — interrupt or wait
 *  - echo suppression: while the assistant speaks (+ echoGuardMs after), any
 *    "user" utterance is treated as the system hearing itself and dropped
 *  - assistant dedupe: identical assistant replies within the window are
 *    suppressed instead of appended/spoken repeatedly
 */

export interface GateConfig {
  finalOnly: boolean;
  minCommandChars: number;
  dedupeWindowMs: number;
  /** Silence to wait after a final chunk before submitting (debounce, used by callers). */
  silenceMs: number;
  /** Grace period after assistant audio ends during which input is still treated as echo. */
  echoGuardMs: number;
}

export const DEFAULT_GATE_CONFIG: GateConfig = {
  finalOnly: true,
  minCommandChars: 4,
  dedupeWindowMs: 5000,
  silenceMs: 800,
  echoGuardMs: 400,
};

export type GateRejection = 'empty' | 'interim' | 'echo' | 'busy' | 'too_short' | 'duplicate';

export interface GateVerdict {
  accept: boolean;
  reason?: GateRejection;
  normalized: string;
}

/** Lowercase, strip punctuation, collapse whitespace — the dedupe identity. */
export function normalizeUtterance(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

export class UtteranceGate {
  private cfg: GateConfig;
  private now: () => number;
  private lastNorm = '';
  private lastSubmittedAt = 0;
  private inFlight = false;
  private speakingNow = false;
  private speakingEndedAt = 0;
  private lastAssistantNorm = '';
  private lastAssistantAt = 0;

  constructor(cfg?: Partial<GateConfig>, now: () => number = () => Date.now()) {
    this.cfg = { ...DEFAULT_GATE_CONFIG, ...cfg };
    this.now = now;
  }

  get busy(): boolean { return this.inFlight; }
  get speaking(): boolean { return this.speakingNow; }
  get config(): GateConfig { return this.cfg; }

  /** Decide whether a candidate utterance may become a command. Does not mutate state.
   *  Echo suppression only applies to voice input — typing while the assistant
   *  speaks is a legitimate command (and implies the user wants to move on). */
  evaluate(text: string, final: boolean, opts: { voice?: boolean } = { voice: true }): GateVerdict {
    const normalized = normalizeUtterance(text);
    if (!normalized) return { accept: false, reason: 'empty', normalized };
    if (this.cfg.finalOnly && !final) return { accept: false, reason: 'interim', normalized };
    if ((opts.voice ?? true) && (this.speakingNow || this.now() - this.speakingEndedAt < this.cfg.echoGuardMs)) {
      return { accept: false, reason: 'echo', normalized };
    }
    if (this.inFlight) return { accept: false, reason: 'busy', normalized };
    if (normalized.length < this.cfg.minCommandChars) return { accept: false, reason: 'too_short', normalized };
    if (normalized === this.lastNorm && this.now() - this.lastSubmittedAt < this.cfg.dedupeWindowMs) {
      return { accept: false, reason: 'duplicate', normalized };
    }
    return { accept: true, normalized };
  }

  /** Call when the command is actually sent — locks the gate and arms dedupe. */
  markSubmitted(text: string): void {
    this.lastNorm = normalizeUtterance(text);
    this.lastSubmittedAt = this.now();
    this.inFlight = true;
  }

  /** Call when the command has fully completed (reply shown/spoken, or failed). */
  markHandled(): void { this.inFlight = false; }

  /** Track assistant audio lifecycle for echo suppression. */
  markSpeaking(on: boolean): void {
    if (this.speakingNow && !on) this.speakingEndedAt = this.now();
    this.speakingNow = on;
  }

  /** True if this assistant reply should be shown/spoken; false if a duplicate. */
  acceptAssistant(text: string): boolean {
    const norm = normalizeUtterance(text);
    if (!norm) return false;
    if (norm === this.lastAssistantNorm && this.now() - this.lastAssistantAt < this.cfg.dedupeWindowMs) return false;
    this.lastAssistantNorm = norm;
    this.lastAssistantAt = this.now();
    return true;
  }

  /** Interrupt / session end: clear locks so the next command starts clean. */
  reset(): void {
    this.inFlight = false;
    this.speakingNow = false;
    this.speakingEndedAt = 0;
  }
}
