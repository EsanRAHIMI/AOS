'use server';

import { revalidatePath } from 'next/cache';
import { gateway } from '@/lib/gateway';

export async function connectFamilyFinanceAction(identifier: string, password: string): Promise<{ ok: boolean; error: string; familyId: string; families: Array<{ id: string; name: string }> }> {
  try {
    const result = await gateway.familyFinanceConnect(identifier, password);
    revalidatePath('/finance');
    return { ok: true, error: '', familyId: result.familyId, families: result.families };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'اتصال ناموفق بود', familyId: '', families: [] };
  }
}

export async function selectFamilyFinanceAction(familyId: string): Promise<{ ok: boolean; error: string }> {
  try {
    await gateway.familyFinanceSelect(familyId);
    revalidatePath('/finance');
    return { ok: true, error: '' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'انتخاب خانوار ناموفق بود' };
  }
}

export async function disconnectFamilyFinanceAction(): Promise<{ ok: boolean; error: string }> {
  try {
    await gateway.familyFinanceDisconnect();
    revalidatePath('/finance');
    return { ok: true, error: '' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'قطع اتصال ناموفق بود' };
  }
}
