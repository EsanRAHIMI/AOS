import { z } from 'zod';
import { AgentToolRegistry, type ToolResult } from '../agentcore/registry.js';
import { familyFinanceStatus, readFamilyFinance } from './family.js';

function def(name: string, purpose: string) {
  return {
    name, version: '1.0.0', purpose, family: 'finance', ownerModule: 'shared/src/finance/family',
    inputFields: {}, outputFields: {}, requiredActorScope: 'user' as const, permission: '',
    riskLevel: 'low' as const, policyCategory: 'read_only' as const, requiresApproval: false,
    ownerOnly: true, timeoutMs: 20000, maxRetries: 1, idempotent: true, sideEffect: 'none' as const,
    evidenceRequired: false, rollbackAvailable: false, outputTrust: 'trusted_internal' as const,
    available: true, unavailableReason: '',
  };
}

export function registerFamilyFinanceTools(registry: AgentToolRegistry): void {
  registry.register({
    definition: def('family_finance_status', 'Whether the owner Family Finance account (finance.smartcontractsco.com) is connected, and which household is selected. Read-only.'),
    inputSchema: z.object({}),
    executor: async (_args, ctx): Promise<ToolResult> => {
      if (!ctx.isOwner) return { ok: false, summary: 'Family Finance فقط برای مالک سیستم در دسترس است.' };
      const status = await familyFinanceStatus();
      if (!status.vaultConfigured) return { ok: false, summary: status.vaultReason };
      if (!status.connected) return { ok: false, summary: 'Family Finance وصل نیست. از صفحهٔ /finance با ایمیل یا تلفن و رمز همان حساب وصل کنید. رمز ذخیره نمی‌شود.' };
      if (!status.familyId) return { ok: true, summary: `وصل است (${status.accountLabel}) ولی خانوار انتخاب نشده. خانوارها: ${status.families.map((f) => `${f.name} (${f.id})`).join(', ') || 'هیچ'}` };
      return { ok: true, summary: `وصل است. حساب ${status.accountLabel}. خانوار ${status.familyName || status.familyId}.`, data: { familyId: status.familyId, familyName: status.familyName } };
    },
  });

  registry.register({
    definition: def('family_finance_read', 'Read the connected Family Finance household for one month: dashboard, transactions, bills, goals, budgets. Never writes.'),
    inputSchema: z.object({ month: z.string().optional().describe('YYYY-MM; defaults to the current UTC month') }),
    executor: async (args, ctx): Promise<ToolResult> => {
      if (!ctx.isOwner) return { ok: false, summary: 'Family Finance فقط برای مالک سیستم در دسترس است.' };
      try {
        const read = await readFamilyFinance({ month: args.month as string | undefined });
        return { ok: true, summary: read.summary, data: { month: read.month, familyId: read.familyId } };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === 'not_connected') return { ok: false, summary: 'Family Finance وصل نیست. از صفحهٔ /finance وصل کنید.' };
        if (message === 'family_not_selected') return { ok: false, summary: 'حساب وصل است ولی خانوار انتخاب نشده. از صفحهٔ /finance یکی را انتخاب کنید.' };
        return { ok: false, summary: message };
      }
    },
  });
}
