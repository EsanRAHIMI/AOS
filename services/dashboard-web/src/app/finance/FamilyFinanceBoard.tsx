import Link from 'next/link';
import type { FamilyFinanceSnapshot } from '@/lib/familyFinanceSnapshot';

const MINOR_EXPONENT: Record<string, number> = {
  AED: 2, USD: 2, EUR: 2, GBP: 2, SAR: 2, QAR: 2, OMR: 3, BHD: 3, KWD: 3,
  IRR: 0, INR: 2, PKR: 2, TRY: 2, CHF: 2, JPY: 0, CNY: 2, CAD: 2, AUD: 2,
};

const TYPE_FA: Record<string, string> = { income: 'درآمد', expense: 'هزینه', transfer: 'انتقال' };
const ALLOC_FA: Record<string, string> = { shared: 'مشترک', personal: 'شخصی' };
const STATUS_FA: Record<string, string> = {
  open: 'باز', paid: 'پرداخت‌شده', skipped: 'رد شده', active: 'فعال', reached: 'رسیده',
  cancelled: 'لغو', posted: 'ثبت‌شده', reversed: 'برگشت', completed: 'تمام‌شده',
};

function money(minor: number, currency: string): string {
  if (!currency) return '';
  const exp = MINOR_EXPONENT[currency] ?? 2;
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(minor));
  if (exp === 0) return `${sign}${abs.toLocaleString('en-US')} ${currency}`;
  const scale = 10 ** exp;
  const whole = Math.floor(abs / scale).toLocaleString('en-US');
  const frac = String(abs % scale).padStart(exp, '0');
  return `${sign}${whole}.${frac} ${currency}`;
}

function Money({ minor, currency }: { minor: number; currency: string }) {
  return <span dir="ltr">{money(minor, currency)}</span>;
}

function Ltr({ children }: { children: string }) {
  return <span dir="ltr">{children}</span>;
}

function labelOf(map: Record<string, string>, value: string): string {
  return map[value] || value;
}

function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, mon - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthTitle(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return month;
  return new Intl.DateTimeFormat('fa-IR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function Meter({ percent, over }: { percent: number; over?: boolean }) {
  const width = Math.max(0, Math.min(percent, 100));
  return (
    <div className={`ff-meter${over ? ' over' : ''}`} aria-hidden>
      <span style={{ width: `${width}%` }} />
    </div>
  );
}

function Empty() {
  return <p className="m" style={{ margin: 0 }}>موردی نیست.</p>;
}

export function FamilyFinanceBoard({ snapshot }: { snapshot: FamilyFinanceSnapshot }) {
  const cash = snapshot.cash;
  const currency = cash.currency || snapshot.currency;
  const prev = shiftMonth(snapshot.month, -1);
  const next = shiftMonth(snapshot.month, 1);
  const metrics = [
    ['درآمد', cash.incomeMinor],
    ['هزینه', cash.expenseMinor],
    ['مشترک', cash.sharedExpenseMinor],
    ['شخصی', cash.personalExpenseMinor],
    ['انتقال', cash.transferMinor],
    ['خالص', cash.netCashFlowMinor],
  ] as const;

  return (
    <section className="ff-board" dir="rtl">
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <div className="label">Family Finance</div>
          <h2 style={{ margin: '4px 0 0', fontSize: 18 }}>{snapshot.familyName || 'خانوار'} · {monthTitle(snapshot.month)}</h2>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link className="btn btn-ghost" href={`/finance?month=${prev}`}>ماه قبل</Link>
          <Link className="btn btn-ghost" href={`/finance?month=${next}`}>ماه بعد</Link>
        </div>
      </div>

      {snapshot.warnings.length > 0 ? (
        <p className="badge warn" style={{ margin: 0 }}>بخشی از داده‌ها نرسید: {snapshot.warnings.join(' · ')}</p>
      ) : null}

      <div className="grid cols-3">
        {metrics.map(([label, minor]) => (
          <div className="card metric" key={label}>
            <span className="label">{label}</span>
            <span className="stat" style={{ fontSize: 22 }}><Money minor={minor} currency={currency} /></span>
          </div>
        ))}
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>هزینه به تفکیک دسته</h3>
          {snapshot.categories.length === 0 ? <Empty /> : snapshot.categories.map((row) => (
            <div key={row.slug} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <span>{row.name}</span>
              <Money minor={row.spentMinor} currency={row.currency || currency} />
            </div>
          ))}
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>تسویه</h3>
          {snapshot.settlement.length === 0 ? <Empty /> : (
            <table>
              <thead>
                <tr><th>عضو</th><th>پرداخت</th><th>سهم</th><th>مانده</th></tr>
              </thead>
              <tbody>
                {snapshot.settlement.map((row) => (
                  <tr key={`${row.name}-${row.removed ? 'removed' : 'active'}`}>
                    <td>{row.name}{row.removed ? <span className="m"> · حذف‌شده</span> : null}</td>
                    <td><Money minor={row.paidMinor} currency={row.currency} /></td>
                    <td><Money minor={row.shareMinor} currency={row.currency} /></td>
                    <td>
                      <Money minor={row.balanceMinor} currency={row.currency} />
                      <div className="m">{row.balanceMinor > 0 ? 'بستانکار' : row.balanceMinor < 0 ? 'بدهکار' : 'تسویه'}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {snapshot.transfers.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              {snapshot.transfers.map((row) => (
                <p key={`${row.from}-${row.to}-${row.amountMinor}`} style={{ margin: '6px 0' }}>
                  {row.from} به {row.to} بدهکار است: <Money minor={row.amountMinor} currency={row.currency} />
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>قبض‌ها</h3>
          {snapshot.bills.length === 0 ? <Empty /> : snapshot.bills.map((row) => (
            <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div>{row.title}</div>
                <div className="m">{row.dueOn ? <Ltr>{row.dueOn}</Ltr> : 'بدون سررسید'} · {labelOf(ALLOC_FA, row.allocation)}{row.category ? ` · ${row.category}` : ''}</div>
              </div>
              <div style={{ textAlign: 'end' }}>
                <div><Money minor={row.amountMinor} currency={row.currency} /></div>
                <span className={`badge ${row.overdue ? 'err' : row.status === 'paid' ? 'ok' : ''}`}>{row.overdue ? 'عقب‌افتاده' : labelOf(STATUS_FA, row.status)}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>اقساط</h3>
          {snapshot.plans.length === 0 ? <Empty /> : snapshot.plans.map((row) => (
            <div key={row.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <strong>{row.title}</strong>
                <span className={`badge ${row.overdueCount ? 'err' : ''}`}>{labelOf(STATUS_FA, row.status)}{row.overdueCount ? ` · ${row.overdueCount} عقب‌افتاده` : ''}</span>
              </div>
              <p className="m" style={{ margin: '4px 0' }}>
                مانده <Money minor={row.remainingMinor} currency={row.currency} /> از <Money minor={row.totalMinor} currency={row.currency} /> · {row.openCount} قسط باز از {row.installmentCount}
                {row.nextDueOn ? <> · بعدی <Ltr>{row.nextDueOn}</Ltr> (<Money minor={row.nextAmountMinor} currency={row.currency} />)</> : null}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>بودجه</h3>
          {snapshot.budgets.length === 0 ? <Empty /> : snapshot.budgets.map((row) => (
            <div key={row.id} style={{ padding: '8px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span>{row.label === 'household' ? 'خانوار' : row.label}</span>
                <span>{row.exceeded ? 'از سقف گذشته' : `${row.percentUsed}%`}</span>
              </div>
              <Meter percent={row.percentUsed} over={row.exceeded} />
              <p className="m" style={{ margin: '4px 0 0' }}><Money minor={row.spentMinor} currency={row.currency} /> از <Money minor={row.amountMinor} currency={row.currency} /> · مانده <Money minor={row.remainingMinor} currency={row.currency} /></p>
            </div>
          ))}
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>هدف‌ها</h3>
          {snapshot.goals.length === 0 ? <Empty /> : snapshot.goals.map((row) => (
            <div key={row.id} style={{ padding: '8px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span>{row.name}</span>
                <span>{row.percentComplete}% · {labelOf(STATUS_FA, row.status)}</span>
              </div>
              <Meter percent={row.percentComplete} />
              <p className="m" style={{ margin: '4px 0 0' }}><Money minor={row.currentMinor} currency={row.currency} /> از <Money minor={row.targetMinor} currency={row.currency} />{row.targetOn ? <> · تا <Ltr>{row.targetOn}</Ltr></> : null}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <h3 style={{ marginTop: 0 }}>تراکنش‌ها ({snapshot.transactions.length.toLocaleString('fa-IR')})</h3>
        {snapshot.transactions.length === 0 ? <Empty /> : (
          <table>
            <thead>
              <tr><th>تاریخ</th><th>عنوان</th><th>نوع</th><th>دسته</th><th>تخصیص</th><th>پرداخت‌کننده</th><th>مبلغ</th></tr>
            </thead>
            <tbody>
              {snapshot.transactions.map((row) => (
                <tr key={row.id}>
                  <td><Ltr>{row.occurredOn}</Ltr></td>
                  <td>{row.title}{row.reversal ? <span className="m"> · برگشت</span> : null}</td>
                  <td>{labelOf(TYPE_FA, row.type)}</td>
                  <td>{row.category}</td>
                  <td>{labelOf(ALLOC_FA, row.allocation)}</td>
                  <td>{row.payer}</td>
                  <td><Money minor={row.amountMinor} currency={row.currency} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
