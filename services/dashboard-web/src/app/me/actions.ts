'use server';
/** Phase AB — Personal Command Center server actions (scope enforced by the gateway). */
import { revalidatePath } from 'next/cache';
import { gateway } from '@/lib/gateway';

export async function decideActionAction(id: string, decision: 'accept' | 'reject' | 'complete'): Promise<void> {
  await gateway.decideNextAction(id, decision);
  revalidatePath('/me');
  revalidatePath('/daily'); // Phase AF.5 — the dedicated Today & Priorities room shows the same records.
}

export async function runReviewAction(type: 'daily' | 'weekly'): Promise<void> {
  await gateway.realityReview(type);
  revalidatePath(type === 'daily' ? '/me/briefing' : '/me/strategy');
  revalidatePath('/me');
}

export async function saveProfileAction(formData: FormData): Promise<void> {
  const displayName = String(formData.get('displayName') ?? '').trim();
  const timezone = String(formData.get('timezone') ?? '').trim();
  const locale = String(formData.get('locale') ?? '').trim();
  if (!displayName && !timezone && !locale) return;
  await gateway.updateMeProfile({
    displayName: displayName || undefined,
    timezone: timezone || undefined,
    locale: locale || undefined,
  });
  revalidatePath('/me');
  revalidatePath('/me/reality');
}

export async function createPersonalGoalAction(formData: FormData): Promise<void> {
  const title = String(formData.get('title') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const horizon = String(formData.get('horizon') ?? '').trim();
  const priority = String(formData.get('priority') ?? '').trim();
  if (!title) return;
  await gateway.createGoal({
    title,
    description: description || undefined,
    horizon: horizon || undefined,
    priority: priority || undefined,
  });
  revalidatePath('/me');
  revalidatePath('/me/goals');
}

export async function grantConnectorConsentAction(formData: FormData): Promise<void> {
  const connectorType = String(formData.get('connectorType') ?? '').trim();
  if (!connectorType) return;
  await gateway.createConsent(connectorType, ['read']);
  revalidatePath('/me');
  revalidatePath('/settings/consents');
}

export async function ingestRealityFactAction(formData: FormData): Promise<void> {
  const kind = String(formData.get('kind') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  if (!kind || !title) return;
  await gateway.realityIngest({
    kind,
    source: 'manual_me_form',
    confidence: 1,
    data: { title, description },
  });
  revalidatePath('/me');
  revalidatePath('/me/reality');
}

/**
 * Phase AF.3 — the Domain Canvas's "Add data" controls need per-kind
 * structured fields (health level, finance amount/cadence, life
 * domain/dueDate, etc.), not just title/description. Rather than a
 * duplicate ingestion path, this reads only the documented optional field
 * names `POST /v1/me/reality/ingest` already accepts per kind (see
 * shared/src/personal/index.ts's ingest handler) and forwards through the
 * same real `gateway.realityIngest()` used above. Unknown/blank fields are
 * simply omitted — nothing invented, nothing silently coerced past what the
 * backend already validates.
 */
const NUMERIC_FIELDS = new Set(['level', 'amount']);
const OPTIONAL_FIELDS = ['description', 'metric', 'level', 'note', 'concern', 'domain', 'itemType', 'dueDate', 'importance', 'amount', 'currency', 'cadence', 'incomePotential', 'tags', 'targetSkill', 'severity', 'mitigation', 'streamType', 'monthlyEstimate', 'systemType', 'assetType'];

export async function ingestDomainDataAction(formData: FormData): Promise<void> {
  const kind = String(formData.get('kind') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  if (!kind || !title) return;
  const data: Record<string, unknown> = { title };
  for (const field of OPTIONAL_FIELDS) {
    const raw = formData.get(field);
    if (raw === null) continue;
    const str = String(raw).trim();
    if (!str) continue;
    if (field === 'concern') { data[field] = str === 'true' || str === 'on'; continue; }
    if (NUMERIC_FIELDS.has(field)) { const n = Number(str); if (!Number.isNaN(n)) data[field] = n; continue; }
    if (field === 'tags') { data[field] = str.split(',').map((t) => t.trim()).filter(Boolean); continue; }
    data[field] = str;
  }
  await gateway.realityIngest({ kind, source: 'domain_canvas_add_data', confidence: 1, data });
  revalidatePath('/');
  revalidatePath('/me');
  revalidatePath('/me/reality');
  // Phase AF.5 — a domain action can now be submitted from inside a
  // dedicated room, not just the homepage card, so every room that could
  // plausibly show this kind's records needs revalidating too. Cheap and
  // correct beats guessing which single room the ingest kind maps to.
  revalidatePath('/health');
  revalidatePath('/life');
  revalidatePath('/finance');
  revalidatePath('/ventures');
  revalidatePath('/growth');
}

export async function decideOpportunityAction(id: string, decision: 'accept' | 'reject' | 'follow_up'): Promise<void> {
  await gateway.decideOpportunity(id, decision);
  revalidatePath('/');
  revalidatePath('/me/opportunities');
  revalidatePath('/opportunities'); // Phase AF.5 — the dedicated Opportunity Radar room.
}
