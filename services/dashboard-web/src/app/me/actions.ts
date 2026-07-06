'use server';
/** Phase AB — Personal Command Center server actions (scope enforced by the gateway). */
import { revalidatePath } from 'next/cache';
import { gateway } from '@/lib/gateway';

export async function decideActionAction(id: string, decision: 'accept' | 'reject' | 'complete'): Promise<void> {
  await gateway.decideNextAction(id, decision);
  revalidatePath('/me');
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
