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
