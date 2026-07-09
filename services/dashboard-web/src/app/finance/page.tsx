import { gateway } from '@/lib/gateway';
import { DomainRoom, type DomainRoomItem } from '@/components/domains/DomainRoom';
import { DEEPER_LINKS } from '@/lib/domainRoomLinks';
import { FinanceFlow } from '@/components/domains/FinanceFlow';
import { EmptyState } from '@/components/ui';

/** Phase AF.5 — dedicated Money & Commitments room. Was `/me/opportunities`
 *  — the most clearly mismatched zone link identified in
 *  docs/living-command-universe-vision.md §A.4. */
export const dynamic = 'force-dynamic';

export default async function FinanceDomainPage() {
  const data = await gateway.universeDetail();
  const zone = data?.zones.find((z) => z.zoneId === 'finance');
  if (!data || !zone) return <EmptyState icon="·" title="Command Universe data unavailable" hint="Sign in and try again." />;

  const items: DomainRoomItem[] = data.finance.items.map((f) => ({
    label: String(f.title ?? ''),
    detail: `${String(f.itemType ?? '')}${typeof f.amount === 'number' ? ` · ${f.amount}${String(f.currency ?? '')}` : ''} · ${String(f.cadence ?? '')}${f.dueDate ? ` · due ${String(f.dueDate)}` : ''} · ${String(f.status ?? '')}`,
    tone: f.status !== 'active' ? 'neutral' : ['installment', 'obligation', 'bill'].includes(String(f.itemType)) ? 'warn' : (f.itemType === 'income' || f.itemType === 'sale') ? 'ok' : 'neutral',
    timestamp: typeof f.createdAt === 'string' ? f.createdAt : null,
  }));

  return (
    <DomainRoom
      zone={zone}
      visual={<FinanceFlow zone={zone} />}
      items={items}
      itemsLabel={`All financial items — monthly net ${data.finance.aggregate.hasAmounts ? data.finance.aggregate.net : 'not tracked'}`}
      deeperLinks={DEEPER_LINKS.finance}
      itemsEmptyHint="Ingest kind=finance_item (itemType income|expense|bill|installment|obligation|investment, amount, cadence, dueDate). Amounts are never invented."
    />
  );
}
