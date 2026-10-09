import { gateway } from '@/lib/gateway';
import { DomainRoom, type DomainRoomItem } from '@/components/domains/DomainRoom';
import { DEEPER_LINKS } from '@/lib/domainRoomLinks';
import { FinanceFlow } from '@/components/domains/FinanceFlow';
import { EmptyState } from '@/components/ui';
import { FamilyFinanceConnect, type FamilyFinancePanelState } from './FamilyFinanceConnect';
import { FamilyFinanceBoard } from './FamilyFinanceBoard';

/** Phase AF.5 — dedicated Money & Commitments room. Was `/me/opportunities`
 *  — the most clearly mismatched zone link identified in
 *  docs/living-command-universe-vision.md §A.4. */
export const dynamic = 'force-dynamic';

export default async function FinanceDomainPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const month = (await searchParams).month;
  const [data, status, snapshot] = await Promise.all([
    gateway.universeDetail(),
    gateway.familyFinanceStatus(),
    gateway.familyFinanceSnapshot(/^\d{4}-\d{2}$/.test(month ?? '') ? month : undefined),
  ]);
  const panel: FamilyFinancePanelState = {
    vaultConfigured: status?.vaultConfigured ?? false,
    vaultReason: status?.vaultReason || 'وضعیت اتصال در دسترس نیست.',
    connected: status?.connected ?? false,
    accountLabel: status?.accountLabel ?? '',
    familyId: status?.familyId ?? '',
    familyName: status?.familyName ?? '',
    families: status?.families ?? [],
    lastError: status?.lastError ?? '',
  };
  const zone = data?.zones.find((z) => z.zoneId === 'finance');
  if (!data || !zone) {
    return (
      <>
        <FamilyFinanceConnect state={panel} />
        {snapshot ? <FamilyFinanceBoard snapshot={snapshot} /> : panel.connected && panel.familyId ? <p className="badge warn">دفتر این ماه از Family Finance خوانده نشد.</p> : null}
        <EmptyState icon="·" title="Command Universe data unavailable" hint="Sign in and try again." />
      </>
    );
  }

  const items: DomainRoomItem[] = data.finance.items.map((f) => ({
    label: String(f.title ?? ''),
    detail: `${String(f.itemType ?? '')}${typeof f.amount === 'number' ? ` · ${f.amount}${String(f.currency ?? '')}` : ''} · ${String(f.cadence ?? '')}${f.dueDate ? ` · due ${String(f.dueDate)}` : ''} · ${String(f.status ?? '')}`,
    tone: f.status !== 'active' ? 'neutral' : ['installment', 'obligation', 'bill'].includes(String(f.itemType)) ? 'warn' : (f.itemType === 'income' || f.itemType === 'sale') ? 'ok' : 'neutral',
    timestamp: typeof f.createdAt === 'string' ? f.createdAt : null,
  }));

  return (
    <>
    <FamilyFinanceConnect state={panel} />
    {snapshot ? <FamilyFinanceBoard snapshot={snapshot} /> : panel.connected && panel.familyId ? <p className="badge warn">دفتر این ماه از Family Finance خوانده نشد.</p> : null}
    <DomainRoom
      zone={zone}
      visual={<FinanceFlow zone={zone} />}
      items={items}
      itemsLabel={`All financial items — monthly net ${data.finance.aggregate.hasAmounts ? data.finance.aggregate.net : 'not tracked'}`}
      deeperLinks={DEEPER_LINKS.finance}
      itemsEmptyHint="Ingest kind=finance_item (itemType income|expense|bill|installment|obligation|investment, amount, cadence, dueDate). Amounts are never invented."
    />
    </>
  );
}
