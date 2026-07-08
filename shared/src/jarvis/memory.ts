/**
 * Phase AE — Jarvis Memory Ingestion.
 *
 * Phase AD persisted every Jarvis turn (intent, mode, reply) but never
 * extracted anything durable FROM it. This module turns raw turn text into
 * structured, typed memory facts (project, priority, decision, blocker,
 * preference) so the daily brain packet (`./daily-brain.js`) has real
 * material to rank instead of only kernel/personal collections.
 *
 * Same discipline as the rest of Jarvis: LLM-assisted with a deterministic
 * bilingual (EN/FA) fallback, schema-validated either way, and the caller
 * (gateway) owns persistence — this module only extracts.
 */
import { z } from 'zod';
import { IsoDate } from '../schemas/common.js';
import { genId, nowIso } from '../utils/index.js';
import type { LlmRouter } from '../llm/index.js';
import { promptFor } from '../llm/prompts.js';

export const JarvisMemoryFactKind = z.enum(['project', 'priority', 'decision', 'blocker', 'preference', 'fact']);
export type JarvisMemoryFactKind = z.infer<typeof JarvisMemoryFactKind>;

// Structural duplicate of JarvisLanguage — kept local on purpose (see file
// header: this module must not import from ./index.js to stay cycle-free).
const MemoryFactLanguage = z.enum(['fa', 'en', 'other']);

export const JarvisMemoryFactSchema = z.object({
  factId: z.string(),
  turnId: z.string().nullable().default(null),
  actorId: z.string(),
  scope: z.enum(['global', 'user']),
  kind: JarvisMemoryFactKind,
  content: z.string().min(1),
  source: z.enum(['turn_extraction_fallback', 'turn_extraction_llm']),
  confidence: z.number().min(0).max(1),
  /** Phase AE.1 — how much this fact should dominate ranking against generic
   *  system-health noise. Deterministic by kind (never LLM-supplied): a
   *  stated priority/decision must always outrank a routine health warning. */
  importance: z.number().min(0).max(1).default(0.5),
  language: MemoryFactLanguage.default('other'),
  /** Phase AE.1 — supersession flag. Currently always true on write; the
   *  ACTUAL supersession mechanism is recency (see `pickActivePriorityFact`),
   *  which needs no extra write. Reserved for a future explicit "forget X". */
  active: z.boolean().default(true),
  createdAt: IsoDate,
});
export type JarvisMemoryFact = z.infer<typeof JarvisMemoryFactSchema>;

/** Deterministic importance-by-kind — a stated priority or decision must
 *  always outrank a routine blocker, and both must outrank a passive
 *  preference/project/fact note. */
const IMPORTANCE_BY_KIND: Record<JarvisMemoryFactKind, number> = {
  priority: 0.95, decision: 0.9, blocker: 0.85, project: 0.6, preference: 0.55, fact: 0.5,
};

const ExtractedFactSchema = z.object({
  kind: JarvisMemoryFactKind,
  content: z.string().min(1).max(220),
  confidence: z.number().min(0).max(1).default(0.6),
});
const ExtractionResultSchema = z.object({ facts: z.array(ExtractedFactSchema).max(6).default([]) });
type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

interface FactPattern { kind: JarvisMemoryFactKind; en: RegExp; fa: RegExp }

/** Ordered bilingual heuristics — a message can match more than one (a
 *  sentence can name a project AND state a decision). Deliberately
 *  conservative: only fires on clear phrasing, never guesses. */
const FACT_PATTERNS: FactPattern[] = [
  { kind: 'decision', en: /\bi(?:'ve|'d| have)? decided\b|\bwe(’|')?ll go with\b|\blet'?s go with\b|\bgoing with\b/i, fa: /تصمیم گرفتم|تصمیم گرفتیم|قرار شد/ },
  { kind: 'blocker', en: /\bblocked by\b|\bstuck on\b|\bwaiting on\b|\bcan'?t proceed until\b|\bcan'?t move forward\b/i, fa: /گیر کردم|منتظر.*هستم|مسدود شده|نمی‌تونم ادامه بدم/ },
  // Phase AE.1 — broadened after a real conversation showed the narrow
  // "اولویت من اینه" phrasing missed the natural "اولویت من الان ... است" /
  // "یادت باشه ..." forms the owner actually uses. "remember that" / "یادت
  // باشه" are intentionally included here per explicit spec (item 1): the
  // owner's most common way to state a priority is to ask Jarvis to remember it.
  { kind: 'priority', en: /\b(top |my )?priority is\b|\bmost important (thing|task) is\b|\bfocus on\b|\bremember that\b|\bmy focus is\b/i, fa: /یادت باشه|اولویت( من)?( الان)?|تمرکز(م| من)?( الان)?|مهم‌ترین کار/ },
  { kind: 'project', en: /\bi'?m working on\b|\bmy project is\b|\bcurrently building\b/i, fa: /دارم روی .* کار می‌کنم|پروژه‌ام/ },
  { kind: 'preference', en: /\bi (always |usually )?prefer\b|\bi (always|usually) like\b/i, fa: /ترجیح می‌دم|همیشه دوست دارم/ },
];

/** Deterministic bilingual fallback — returns at most one fact per matched
 *  pattern kind, each quoting the actual sentence (never invented). */
export function extractMemoryFactsFallback(text: string): ExtractionResult {
  const facts: ExtractionResult['facts'] = [];
  const sentences = text.split(/(?<=[.!؟?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const source = sentences.length ? sentences : [text];
  for (const p of FACT_PATTERNS) {
    const hit = source.find((s) => p.en.test(s) || p.fa.test(s));
    if (hit) facts.push({ kind: p.kind, content: hit.slice(0, 220), confidence: 0.55 });
  }
  return { facts };
}

/** LLM-assisted extraction, schema-validated, deterministic fallback as the
 *  safety net. Conservative by instruction: empty array is a valid, honest
 *  result — most turns don't contain a durable fact. */
export async function extractMemoryFacts(router: LlmRouter, text: string, opts: { taskId?: string | null; forceFallback?: boolean } = {}): Promise<{ result: ExtractionResult; usedFallback: boolean }> {
  const p = promptFor('gateway-api:jarvis_memory_extraction');
  const { data, trace } = await router.generateStructured(ExtractionResultSchema, {
    agentId: 'gateway-api',
    taskType: 'jarvis_memory_extraction',
    system: p.system,
    prompt: `Extract durable memory facts from this message, if any. Kinds: ${JarvisMemoryFactKind.options.join(', ')}. Only extract what is EXPLICITLY stated — never infer or invent. Empty list is fine.\nMessage: """${text}"""\nRespond as JSON: {"facts":[{"kind":"...","content":"...","confidence":0..1}]}`,
    taskId: opts.taskId ?? null,
    fallback: () => extractMemoryFactsFallback(text),
    fast: true,
    promptVersion: p.version,
    forceFallback: opts.forceFallback,
  });
  return { result: data, usedFallback: trace ? (trace as { usedFallback?: boolean }).usedFallback === true : true };
}

/** Build persistable fact records from an extraction result — pure.
 *  `language` is the language of the SOURCE message (the caller already
 *  knows this from intent classification — never re-detected here). */
export function buildMemoryFacts(args: { turnId: string | null; actorId: string; scope: 'global' | 'user'; result: ExtractionResult; usedLlm: boolean; language?: 'fa' | 'en' | 'other' }): JarvisMemoryFact[] {
  const now = nowIso();
  return args.result.facts.map((f) => JarvisMemoryFactSchema.parse({
    factId: genId('jfact'), turnId: args.turnId, actorId: args.actorId, scope: args.scope,
    kind: f.kind, content: f.content, confidence: f.confidence,
    importance: IMPORTANCE_BY_KIND[f.kind] ?? 0.5,
    language: args.language ?? 'other',
    active: true,
    source: args.usedLlm ? 'turn_extraction_llm' : 'turn_extraction_fallback',
    createdAt: now,
  }));
}

/** Phase AE.1 — the single most recent, active priority/decision fact for an
 *  actor. Recency IS the supersession mechanism: `facts` is expected sorted
 *  newest-first (the gateway always queries `.sort({ createdAt: -1 })`), so a
 *  freshly-stated priority naturally wins over an older one with no extra
 *  write needed to "deactivate" the old record. A 'priority'-kind fact is
 *  preferred over a same-or-older 'decision'-kind fact when both exist. */
export function pickActivePriorityFact(facts: JarvisMemoryFact[]): JarvisMemoryFact | null {
  const relevant = facts.filter((f) => f.active !== false && (f.kind === 'priority' || f.kind === 'decision'));
  if (!relevant.length) return null;
  const sorted = [...relevant].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return sorted.find((f) => f.kind === 'priority') ?? sorted[0] ?? null;
}
