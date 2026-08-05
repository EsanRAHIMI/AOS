'use server';
/**
 * Jarvis Board — live source feed (CIN-2c).
 *
 * ONE server action assembles the whole board graph from REAL gateway
 * endpoints. Every source is independent and fail-soft: an endpoint that is
 * unreachable adds its name to `degraded` and contributes no card, rather than
 * faking one. Cards therefore always mean "this is what the kernel actually
 * knows right now".
 *
 * Scope assignment here is the DEFAULT (per the orbital law: personal close,
 * public far). The client applies role presets and owner overrides on top —
 * see boardProfile.
 *
 * Adding a source = add one mapper below. Nothing else in the board changes.
 */
import { gateway } from '@/lib/gateway';
import {
  recencyActivity,
  type BoardCard, type BoardGraph, type BoardLink,
} from './boardModel';

const ACCENT = {
  loop: [155, 123, 255] as [number, number, number],
  missions: [110, 240, 190] as [number, number, number],
  proactive: [255, 110, 140] as [number, number, number],
  cin: [255, 196, 90] as [number, number, number],
  memory: [110, 168, 255] as [number, number, number],
  research: [90, 220, 255] as [number, number, number],
  services: [180, 196, 226] as [number, number, number],
  profile: [255, 214, 140] as [number, number, number],
  finance: [126, 231, 168] as [number, number, number],
  business: [128, 214, 255] as [number, number, number],
  documents: [200, 176, 255] as [number, number, number],
  relations: [255, 168, 196] as [number, number, number],
};

function n(v: unknown): number { return typeof v === 'number' && Number.isFinite(v) ? v : 0; }
function s(v: unknown): string { return typeof v === 'string' ? v : ''; }

export async function loadBoardGraphAction(): Promise<BoardGraph> {
  const [loopCycles, loopInbox, cinEntities, cinChain, memories, research, services, universe, meCtx] =
    await Promise.all([
      gateway.loopCycles(12).catch(() => null),
      gateway.loopInbox().catch(() => null),
      gateway.cinEntities().catch(() => null),
      gateway.cinLedgerVerify().catch(() => null),
      gateway.jarvisMemories().catch(() => null),
      gateway.research().catch(() => null),
      gateway.services().catch(() => null),
      gateway.universeDetail().catch(() => null),
      gateway.meContext().catch(() => null),
    ]);

  const cards: BoardCard[] = [];
  const links: BoardLink[] = [];
  const degraded: string[] = [];
  const add = (c: BoardCard) => { cards.push(c); };
  const link = (from: string, to: string, kind: BoardLink['kind'], strength: number, flow: number, label?: string) => {
    links.push({ from, to, kind, strength, flow, label });
  };

  /* ------------------------------ the self ------------------------------- */
  // The singularity itself is a card so the owner's identity is a first-class
  // node every axon can attach to (it renders at world origin, behind the
  // black hole, and is never draggable).
  add({
    id: 'self', sourceId: 'profile', scope: 'self',
    title: meCtx?.actor.displayName || 'من',
    subtitle: meCtx?.tenant?.name ? `${meCtx.tenant.name} · ${meCtx.activeScope}` : 'هستهٔ شخصی',
    metrics: [
      { k: 'goals', v: String(n(meCtx?.activeGoals)) },
      { k: 'consents', v: String(n(meCtx?.activeConsents)) },
      { k: 'mode', v: meCtx?.safeMode ? 'SAFE' : 'LIVE', heat: meCtx?.safeMode ? 0.8 : 0.1 },
    ],
    activity: 1, updatedAt: new Date().toISOString(), href: '/me',
    accent: ACCENT.profile,
  });
  if (!meCtx) degraded.push('me/context');

  /* --------------------------- personal domains -------------------------- */
  // universeDetail carries the owner's real personal rooms: finance, life,
  // health, ventures, growth, documents-ish systems. These are the innermost
  // rings by definition — they are the most "mine".
  if (universe) {
    const fin = universe.finance;
    add({
      id: 'finance', sourceId: 'finance', scope: 'personal',
      title: 'مالی', subtitle: 'درآمد، تعهدات و جریان نقدی',
      metrics: fin?.aggregate?.hasAmounts
        ? [
          { k: 'in', v: String(n(fin.aggregate.monthlyIn)) },
          { k: 'out', v: String(n(fin.aggregate.monthlyOut)) },
          { k: 'net', v: String(n(fin.aggregate.net)), heat: n(fin.aggregate.net) < 0 ? 0.9 : 0.2 },
        ]
        : [{ k: 'items', v: String(fin?.items?.length ?? 0) }],
      activity: Math.min(1, (fin?.items?.length ?? 0) / 8),
      updatedAt: universe.generatedAt ?? null, href: '/finance', accent: ACCENT.finance,
      emptyHint: 'هنوز رکورد مالی ثبت نشده — از /finance اضافه کنید',
    });
    link('finance', 'self', 'data', 0.9, Math.min(1, (fin?.items?.length ?? 0) / 10), 'cash-flow');

    const ventures = universe.ventures?.projects ?? [];
    add({
      id: 'business', sourceId: 'business', scope: 'work',
      title: 'کسب‌وکار و پروژه‌ها', subtitle: 'ونچرها و پروژه‌های فعال',
      metrics: [{ k: 'projects', v: String(ventures.length) }],
      activity: Math.min(1, ventures.length / 6),
      updatedAt: universe.generatedAt ?? null, href: '/ventures', accent: ACCENT.business,
      emptyHint: 'پروژه‌ای ثبت نشده',
    });
    link('business', 'self', 'data', 0.8, Math.min(1, ventures.length / 8), 'ventures');
    link('business', 'finance', 'data', 0.6, Math.min(1, ventures.length / 10), 'revenue');

    const daily = universe.daily;
    const lifeItems = universe.life?.items ?? [];
    add({
      id: 'documents', sourceId: 'documents', scope: 'personal',
      title: 'اسناد و زندگی', subtitle: 'مدارک، رویه‌ها و رکوردهای شخصی',
      metrics: [
        { k: 'records', v: String(lifeItems.length) },
        { k: 'pending', v: String(n(daily?.pendingApprovals)), heat: n(daily?.pendingApprovals) > 0 ? 0.7 : 0 },
      ],
      activity: Math.min(1, lifeItems.length / 6),
      updatedAt: universe.generatedAt ?? null, href: '/life', accent: ACCENT.documents,
      emptyHint: 'سندی ثبت نشده',
    });
    link('documents', 'self', 'data', 0.7, 0.15, 'records');
  } else {
    degraded.push('me/universe');
  }

  /* ------------------------------ missions ------------------------------- */
  // Missions ride on the universe "growth" goals + reality next-actions; the
  // authoritative mission tree is exposed through the loop's own view today.
  if (universe) {
    const goals = universe.growth?.goals ?? [];
    const opportunities = universe.opportunities?.ranked ?? [];
    add({
      id: 'missions', sourceId: 'missions', scope: 'work',
      title: 'مأموریت‌ها و اهداف', subtitle: 'سلسله‌مراتب هدف → مأموریت → اقدام',
      metrics: [
        { k: 'goals', v: String(goals.length) },
        { k: 'opps', v: String(opportunities.length) },
      ],
      activity: Math.min(1, (goals.length + opportunities.length) / 10),
      updatedAt: universe.generatedAt ?? null, href: '/me/goals', accent: ACCENT.missions,
      emptyHint: 'هدفی ثبت نشده',
    });
    link('missions', 'self', 'control', 0.9, 0.25, 'intent');
    link('business', 'missions', 'derives', 0.6, 0.2);
  }

  /* ----------------------------- living loop ----------------------------- */
  const cycles = loopCycles?.cycles ?? [];
  const events = loopInbox?.events ?? [];
  if (loopCycles || loopInbox) {
    const running = cycles.filter((c) => s(c.status) === 'running' || s(c.status) === 'awaiting_approval').length;
    const newest = s(cycles[0]?.createdAt);
    add({
      id: 'loop', sourceId: 'loop', scope: 'org',
      title: 'حلقهٔ زندهٔ خودمختار', subtitle: cycles[0] ? `${s(cycles[0].triggerSummary)} · ${s(cycles[0].status)}` : 'در انتظار رویداد',
      metrics: [
        { k: 'cycles', v: String(cycles.length) },
        { k: 'running', v: String(running), heat: running > 0 ? 0.9 : 0 },
        { k: 'p50', v: loopInbox?.latency?.p50 != null ? `${loopInbox.latency.p50}ms` : '—' },
      ],
      activity: Math.max(recencyActivity(newest, 5 * 60_000), running > 0 ? 0.85 : 0),
      updatedAt: newest || null, href: '/loop', accent: ACCENT.loop,
      emptyHint: 'حلقه بی‌کار است — این یعنی سالم، نه خراب',
    });
    // The loop is the spine: it reads missions/memory and writes trust+memory.
    link('loop', 'missions', 'control', 0.9, Math.min(1, running / 2 + 0.15), 'acts on');
    link('loop', 'memory', 'data', 0.8, recencyActivity(newest, 8 * 60_000), 'writes');
    link('loop', 'cin', 'trust', 0.85, recencyActivity(newest, 8 * 60_000), 'anchors');
    link('proactive', 'loop', 'alert', 0.9, Math.min(1, events.length / 6), 'feeds');
  } else {
    degraded.push('loop');
  }

  /* -------------------------- proactive / heartbeat ---------------------- */
  if (loopInbox) {
    const pending = events.filter((e) => s(e.status) === 'pending' || s(e.status) === 'processing').length;
    const dead = events.filter((e) => s(e.status) === 'dead').length;
    const newest = s(events[0]?.receivedAt);
    add({
      id: 'proactive', sourceId: 'proactive', scope: 'work',
      title: 'ضربان و رویدادهای پیشگیرانه', subtitle: dead > 0 ? `${dead} رویداد در صف مرده` : 'پایش پیوسته',
      metrics: [
        { k: 'open', v: String(pending), heat: pending > 0 ? 0.75 : 0 },
        { k: 'dead', v: String(dead), heat: dead > 0 ? 1 : 0 },
        { k: 'total', v: String(events.length) },
      ],
      activity: Math.max(recencyActivity(newest, 6 * 60_000), pending > 0 ? 0.7 : 0.08),
      updatedAt: newest || null, href: '/loop', accent: ACCENT.proactive,
      emptyHint: 'چیزی نیاز به توجه شما ندارد',
    });
    link('proactive', 'self', 'alert', 0.7, pending > 0 ? 0.8 : 0.05, 'notifies');
  }

  /* --------------------------------- CIN --------------------------------- */
  if (cinEntities || cinChain) {
    const entities = cinEntities?.entities ?? [];
    add({
      id: 'cin', sourceId: 'cin', scope: 'org',
      title: 'شبکهٔ هوش جمعی', subtitle: cinChain?.ok ? `زنجیره سالم · ${cinChain.length} رکورد` : 'زنجیره نیاز به بررسی دارد',
      metrics: [
        { k: 'entities', v: String(entities.length) },
        { k: 'chain', v: cinChain?.ok ? 'OK' : 'BROKEN', heat: cinChain?.ok ? 0.1 : 1 },
        { k: 'seq', v: cinChain?.length != null ? String(cinChain.length) : '—' },
      ],
      activity: cinChain?.ok === false ? 1 : Math.min(0.6, entities.length / 12),
      updatedAt: s(entities[0]?.updatedAt) || null, href: '/cin', accent: ACCENT.cin,
      emptyHint: 'موجودیتی ثبت نشده — scripts/cin-genesis-seed.mjs',
    });
    link('cin', 'self', 'trust', 0.95, 0.2, 'identity');
    link('cin', 'relations', 'trust', 0.7, 0.15, 'claims');
    // Counterparties: every non-self entity is a relation on the network ring.
    const others = entities.filter((e) => s(e.entityType) !== 'person' || s(e.name) !== (meCtx?.actor.displayName ?? ''));
    add({
      id: 'relations', sourceId: 'relations', scope: 'network',
      title: 'طرف‌ها و روابط', subtitle: 'سازمان‌ها، ایجنت‌ها و نهادهای متصل',
      metrics: [{ k: 'nodes', v: String(others.length) }],
      activity: Math.min(0.5, others.length / 14),
      updatedAt: null, href: '/cin/entities', accent: ACCENT.relations,
      emptyHint: 'هنوز طرف مقابلی ثبت نشده',
    });
  } else {
    degraded.push('cin');
  }

  /* -------------------------------- memory ------------------------------- */
  if (memories) {
    const newest = s((memories[0] as Record<string, unknown> | undefined)?.createdAt);
    add({
      id: 'memory', sourceId: 'memory', scope: 'org',
      title: 'حافظه', subtitle: 'واقعیت‌ها، ترجیحات و درس‌ها',
      metrics: [{ k: 'records', v: String(memories.length) }],
      activity: recencyActivity(newest, 30 * 60_000),
      updatedAt: newest || null, href: '/', accent: ACCENT.memory,
      emptyHint: 'حافظه خالی است',
    });
    link('memory', 'self', 'data', 0.85, 0.25, 'knows');
  } else {
    degraded.push('memory');
  }

  /* ------------------------------- research ------------------------------ */
  if (research) {
    add({
      id: 'research', sourceId: 'research', scope: 'world',
      title: 'تحقیق و جهان بیرون', subtitle: 'منابع واقعی و گزارش‌های مستند',
      metrics: [{ k: 'reports', v: String(research.length) }],
      activity: Math.min(0.6, research.length / 8),
      updatedAt: null, href: '/research', accent: ACCENT.research,
      emptyHint: 'گزارشی ثبت نشده',
    });
    link('research', 'memory', 'derives', 0.6, Math.min(0.5, research.length / 10), 'grounds');
    link('research', 'missions', 'derives', 0.4, 0.1);
  } else {
    degraded.push('research');
  }

  /* ------------------------------- services ------------------------------ */
  if (services) {
    const kernel = universe?.systems?.kernel;
    const incidents = n(kernel?.openIncidents);
    add({
      id: 'services', sourceId: 'services', scope: 'network',
      title: 'سرویس‌ها و زیرساخت', subtitle: kernel?.activeOperation ? `عملیات فعال: ${kernel.activeOperation}` : 'سلامت و در دسترس بودن',
      metrics: [
        { k: 'registered', v: String(services.length) },
        { k: 'incidents', v: String(incidents), heat: incidents > 0 ? 0.9 : 0 },
      ],
      activity: incidents > 0 ? 0.8 : Math.min(0.4, services.length / 20),
      updatedAt: null, href: '/services', accent: ACCENT.services,
      emptyHint: 'سرویسی ثبت نشده',
    });
    link('services', 'loop', 'data', 0.5, 0.12, 'health');
  } else {
    degraded.push('services');
  }

  // Drop links whose endpoints did not materialise (a degraded source must not
  // leave a dangling axon).
  const ids = new Set(cards.map((c) => c.id));
  const cleanLinks = links.filter((l) => ids.has(l.from) && ids.has(l.to));

  return { cards, links: cleanLinks, degraded, generatedAt: new Date().toISOString() };
}
