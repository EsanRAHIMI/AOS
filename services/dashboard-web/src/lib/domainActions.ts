/**
 * Phase AF.3 — the real, per-domain action manifest. Every entry here maps
 * to an already-real backend path: `add_data` posts through the existing
 * scope-enforced `POST /v1/me/reality/ingest` (via `ingestDomainDataAction`),
 * `create_task` posts through the existing RBAC-gated `POST /v1/tasks` (via
 * `createTaskAction`, unchanged), `open_link` points at a real existing
 * page. Nothing here invents a new mutation type or a new approval tier —
 * add_data/create_task are exactly the "no owner-approval, scope-enforced"
 * class of action ingestion and task creation already were before this
 * phase. Pure data, no React — importable by the smoke test so "every
 * domain has at least one real suggested action" is a checkable fact.
 */
import type { ZoneId } from './domainCanvas';

export type ActionFieldType = 'text' | 'number' | 'select' | 'date' | 'checkbox';
export interface ActionField {
  name: string;
  label: string;
  type: ActionFieldType;
  options?: string[];
  placeholder?: string;
  defaultValue?: string;
}

export interface AddDataAction {
  kind: 'add_data';
  id: string;
  label: string;
  /** One of shared/src/personal's real IngestionKind values. */
  ingestKind: string;
  fields: ActionField[];
}
export interface CreateTaskDomainAction {
  kind: 'create_task';
  id: string;
  label: string;
  /** Pre-filled, user-editable goal text — posted through the real,
   *  unchanged `createTaskAction` (POST /v1/tasks → orchestrator). */
  goalTemplate: string;
}
export interface OpenLinkDomainAction {
  kind: 'open_link';
  id: string;
  label: string;
  href: string;
}
export type DomainAction = AddDataAction | CreateTaskDomainAction | OpenLinkDomainAction;

const TITLE_FIELD: ActionField = { name: 'title', label: 'Title', type: 'text', placeholder: 'What is this?' };

export const DOMAIN_ACTIONS: Record<ZoneId, DomainAction[]> = {
  health: [
    {
      kind: 'add_data', id: 'add-health-state', label: '+ Log health state', ingestKind: 'health_state',
      fields: [
        { name: 'metric', label: 'Metric', type: 'select', options: ['wellbeing', 'energy', 'sleep', 'stress', 'weight', 'activity', 'nutrition', 'symptom', 'habit'] },
        { name: 'level', label: 'Level (0-10)', type: 'number', placeholder: '0-10' },
        { name: 'note', label: 'Note', type: 'text' },
        { name: 'concern', label: 'Flag as a concern', type: 'checkbox' },
      ],
    },
  ],
  daily: [
    // Today & Priorities has no add-data path of its own — priorities are
    // derived from goals/risks/opportunities elsewhere. Its real action is
    // per-item accept/reject/complete, wired directly in PriorityStack.tsx.
  ],
  life: [
    {
      kind: 'add_data', id: 'add-life-item', label: '+ Add responsibility / item', ingestKind: 'life_item',
      fields: [
        TITLE_FIELD,
        { name: 'domain', label: 'Domain', type: 'select', options: ['family', 'home', 'relationship', 'household', 'personal'] },
        { name: 'itemType', label: 'Type', type: 'select', options: ['responsibility', 'concern', 'event', 'task', 'note'] },
        { name: 'dueDate', label: 'Due date', type: 'date' },
        { name: 'importance', label: 'Importance', type: 'select', options: ['low', 'normal', 'high'] },
      ],
    },
  ],
  finance: [
    {
      kind: 'add_data', id: 'add-finance-item', label: '+ Add income / expense / obligation', ingestKind: 'finance_item',
      fields: [
        TITLE_FIELD,
        { name: 'itemType', label: 'Type', type: 'select', options: ['income', 'expense', 'bill', 'installment', 'obligation', 'investment', 'purchase', 'sale'] },
        { name: 'amount', label: 'Amount', type: 'number', placeholder: 'e.g. 1200' },
        { name: 'currency', label: 'Currency', type: 'text', defaultValue: 'USD' },
        { name: 'cadence', label: 'Cadence', type: 'select', options: ['once', 'weekly', 'monthly', 'quarterly', 'yearly'] },
        { name: 'dueDate', label: 'Due date', type: 'date' },
      ],
    },
  ],
  ventures: [
    {
      kind: 'add_data', id: 'add-project', label: '+ Add project', ingestKind: 'project',
      fields: [
        TITLE_FIELD,
        { name: 'incomePotential', label: 'Income potential', type: 'select', options: ['none', 'low', 'medium', 'high', 'unknown'] },
        { name: 'tags', label: 'Tags (comma-separated)', type: 'text' },
      ],
    },
    {
      // PersonalProject has no blocker field — a blocker is honestly
      // recorded as a real risk record instead of inventing a new schema
      // field, same discipline as the rest of this phase.
      kind: 'add_data', id: 'add-venture-blocker', label: '+ Report blocker', ingestKind: 'risk',
      fields: [
        TITLE_FIELD,
        { name: 'severity', label: 'Severity', type: 'select', options: ['low', 'medium', 'high', 'critical'] },
        { name: 'mitigation', label: 'Mitigation / next step', type: 'text' },
      ],
    },
    {
      kind: 'create_task', id: 'venture-next-action', label: 'Create next action', goalTemplate: 'Next action for venture: ',
    },
  ],
  growth: [
    {
      kind: 'add_data', id: 'add-learning-track', label: '+ Add learning goal', ingestKind: 'learning_track',
      fields: [
        TITLE_FIELD,
        { name: 'targetSkill', label: 'Target skill', type: 'text' },
        { name: 'tags', label: 'Tags (comma-separated)', type: 'text' },
      ],
    },
  ],
  opportunities: [
    // No manual ingestion kind exists for opportunities — they are
    // AOS-derived (buildPersonalGraph), never hand-entered. The real action
    // here is per-item accept/reject/follow-up, wired directly in
    // OpportunityRadar.tsx via the new opportunity decision endpoint.
  ],
  systems: [
    { kind: 'open_link', id: 'inspect-systems', label: 'Inspect services', href: '/operations' },
    { kind: 'create_task', id: 'systems-repair-task', label: 'Create repair task', goalTemplate: 'Investigate and repair: ' },
  ],
  presence: [
    { kind: 'open_link', id: 'configure-presence', label: 'Connect / configure channel', href: '/settings/connectors' },
  ],
};

export function actionsFor(zoneId: string): DomainAction[] {
  return (DOMAIN_ACTIONS as Record<string, DomainAction[]>)[zoneId] ?? [];
}
