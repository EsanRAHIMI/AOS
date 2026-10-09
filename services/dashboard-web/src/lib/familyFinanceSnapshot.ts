/** Read model returned by GET /v1/finance/family/snapshot. Amounts stay in minor units. */
export interface FamilyFinanceSnapshot {
  month: string;
  familyId: string;
  familyName: string;
  accountLabel: string;
  currency: string;
  cash: {
    currency: string;
    incomeMinor: number;
    expenseMinor: number;
    sharedExpenseMinor: number;
    personalExpenseMinor: number;
    transferMinor: number;
    netCashFlowMinor: number;
  };
  categories: Array<{ slug: string; name: string; spentMinor: number; currency: string }>;
  bills: Array<{ id: string; title: string; category: string; allocation: string; amountMinor: number; currency: string; dueOn: string; status: string; overdue: boolean }>;
  plans: Array<{ id: string; title: string; status: string; currency: string; totalMinor: number; paidMinor: number; remainingMinor: number; installmentCount: number; openCount: number; overdueCount: number; nextDueOn: string; nextAmountMinor: number }>;
  budgets: Array<{ id: string; label: string; currency: string; amountMinor: number; spentMinor: number; remainingMinor: number; percentUsed: number; exceeded: boolean }>;
  goals: Array<{ id: string; name: string; currency: string; currentMinor: number; targetMinor: number; remainingMinor: number; percentComplete: number; status: string; targetOn: string }>;
  settlement: Array<{ name: string; paidMinor: number; shareMinor: number; balanceMinor: number; currency: string; removed: boolean }>;
  transfers: Array<{ from: string; to: string; amountMinor: number; currency: string }>;
  transactions: Array<{ id: string; type: string; title: string; category: string; allocation: string; payer: string; amountMinor: number; currency: string; occurredOn: string; status: string; reversal: boolean }>;
  warnings: string[];
  summary: string;
}
