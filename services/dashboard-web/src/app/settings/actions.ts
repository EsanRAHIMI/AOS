'use server';
/**
 * Owner preferences (D-202).
 *
 * The gateway validates; this only carries. `revalidatePath('/', 'layout')`
 * because a timezone change is not local to this page — every date on every
 * page was rendered with the old one.
 */
import { revalidatePath } from 'next/cache';
import { gateway } from '@/lib/gateway';

export async function savePreferencesAction(
  patch: Record<string, unknown>,
): Promise<{ ok: boolean; error: string }> {
  try {
    await gateway.saveOwnerPreferences(patch);
    revalidatePath('/', 'layout');
    return { ok: true, error: '' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'خطا' };
  }
}
