/**
 * Jarvis Board — personalisation (CIN-2c).
 *
 * The board is not one fixed dashboard: what deserves an orbit depends on who
 * is looking. A founder wants ventures and finance close in; an engineer wants
 * the loop and services; an analyst wants research and the world shell. So the
 * board ships ROLE PRESETS (which sources are visible, and on which ring) and
 * lets the owner override anything — visibility, ring, and hand-placed
 * position — with overrides always winning over the preset.
 *
 * Persistence: `localStorage` today (instant, per-device, zero backend risk).
 * `PROFILE_STORAGE_KEY` is versioned and the shape is a plain JSON object, so
 * moving this to `PATCH /v1/me/profile { preferences.jarvisBoard }` later is a
 * drop-in change behind `loadBoardProfile` / `saveBoardProfile` — no consumer
 * of this module needs to know where the bytes live.
 */
import type { BoardGroup, BoardScope, BoardSourceId } from './boardModel';
import type { PlacementOverrides } from './boardLayout';

export type BoardRole = 'founder' | 'operator' | 'engineer' | 'analyst' | 'custom';

export interface BoardProfile {
  version: 1;
  role: BoardRole;
  /** Sources the owner switched off entirely. */
  hiddenSources: BoardSourceId[];
  /** Individual cards switched off (id → true). */
  hiddenCards: Record<string, true>;
  /** Ring reassignment per source — the owner's own sense of "how personal". */
  scopeOverrides: Partial<Record<BoardSourceId, BoardScope>>;
  /** ORBIT reassignment per source (D-183.9) — which track a family rides. */
  orbitOverrides: Partial<Record<BoardSourceId, BoardGroup>>;
  /** Hand-placed cards; these never move again. */
  placements: PlacementOverrides;
  /** Cards the owner pinned to always stay expanded. */
  pinned: Record<string, true>;
}

export const PROFILE_STORAGE_KEY = 'aos.jarvis.board.profile.v1';

export const DEFAULT_PROFILE: BoardProfile = {
  version: 1,
  role: 'founder',
  hiddenSources: [],
  hiddenCards: {},
  scopeOverrides: {},
  orbitOverrides: {},
  placements: {},
  pinned: {},
};

/** Which sources each role cares about, and where they sit by default.
 *  `null` = hidden for that role (still switchable on by the owner). */
export const ROLE_PRESETS: Record<Exclude<BoardRole, 'custom'>, Partial<Record<BoardSourceId, BoardScope | null>>> = {
  founder: {
    profile: 'personal', finance: 'personal', documents: 'personal',
    business: 'work', missions: 'work', proactive: 'work',
    loop: 'org', memory: 'org', cin: 'org',
    relations: 'network', services: 'network',
    research: 'world',
  },
  operator: {
    profile: 'personal', documents: 'personal', finance: 'personal',
    proactive: 'work', missions: 'work', loop: 'work',
    services: 'org', cin: 'org', memory: 'org',
    relations: 'network', business: 'network',
    research: 'world',
  },
  engineer: {
    profile: 'personal', documents: 'personal', finance: null,
    loop: 'work', services: 'work', missions: 'work',
    memory: 'org', cin: 'org', proactive: 'org',
    relations: 'network', business: 'network',
    research: 'world',
  },
  analyst: {
    profile: 'personal', documents: 'personal', finance: 'personal',
    memory: 'work', research: 'work', missions: 'work',
    cin: 'org', business: 'org', loop: 'org',
    relations: 'network', proactive: 'network',
    services: 'world',
  },
};

export const ROLE_LABEL_FA: Record<BoardRole, string> = {
  founder: 'بنیان‌گذار',
  operator: 'اپراتور',
  engineer: 'مهندس',
  analyst: 'تحلیل‌گر',
  custom: 'سفارشی',
};

/** Resolve a card's ring: explicit owner override → role preset → source default. */
export function resolveScope(
  profile: BoardProfile,
  sourceId: BoardSourceId,
  fallback: BoardScope,
): BoardScope {
  const own = profile.scopeOverrides[sourceId];
  if (own) return own;
  if (profile.role !== 'custom') {
    const preset = ROLE_PRESETS[profile.role][sourceId];
    if (preset) return preset;
  }
  return fallback;
}

/** Which orbit a card rides: owner override → the card/source default. */
export function resolveOrbit(
  profile: BoardProfile,
  sourceId: BoardSourceId,
  fallback: BoardGroup,
): BoardGroup {
  return profile.orbitOverrides[sourceId] ?? fallback;
}

export function isSourceVisible(profile: BoardProfile, sourceId: BoardSourceId): boolean {
  if (profile.hiddenSources.includes(sourceId)) return false;
  if (profile.role !== 'custom') {
    const preset = ROLE_PRESETS[profile.role][sourceId];
    // `null` means the preset hides it; `undefined` means the preset has no
    // opinion (show it) — an explicit distinction, not an accident.
    if (preset === null && !profile.scopeOverrides[sourceId]) return false;
  }
  return true;
}

export function loadBoardProfile(): BoardProfile {
  if (typeof window === 'undefined') return DEFAULT_PROFILE;
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return DEFAULT_PROFILE;
    const parsed = JSON.parse(raw) as Partial<BoardProfile>;
    if (parsed.version !== 1) return DEFAULT_PROFILE;
    return {
      ...DEFAULT_PROFILE,
      ...parsed,
      hiddenSources: parsed.hiddenSources ?? [],
      hiddenCards: parsed.hiddenCards ?? {},
      scopeOverrides: parsed.scopeOverrides ?? {},
      orbitOverrides: parsed.orbitOverrides ?? {},
      placements: parsed.placements ?? {},
      pinned: parsed.pinned ?? {},
    };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function saveBoardProfile(profile: BoardProfile): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    /* private mode / quota — the board still works, it just won't remember */
  }
}
