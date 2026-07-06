#!/usr/bin/env node
/**
 * Phase AC+ smoke — Command Universe contract.
 * Drives the REAL buildUniverseZones / aggregateFinance / latestHealthByMetric
 * with fixed inputs; proves 9-zone completeness, honest statuses, finance math
 * and zero invented data. Run after build:shared.
 */
import {
  buildUniverseZones, aggregateFinance, latestHealthByMetric,
  PersonalHealthStateSchema, PersonalLifeItemSchema, PersonalFinanceItemSchema,
  INGESTION_KINDS, nextConnectorFor,
} from '../shared/dist/index.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};
const now = new Date().toISOString();
const stamp = { scope: 'user', tenantId: 't', userId: 'user_esan', projectId: null, caseId: null, visibility: 'private', createdBy: 'user_esan', updatedBy: null, source: 'user', confidence: 1, freshness: now, recordKind: 'fact', createdAt: now, updatedAt: now };

console.log('Phase AC+ — command universe smoke\n');

const emptyInput = {
  graph: { profile: null, goals: [], projects: [], assets: [], systems: [], risks: [], opportunities: [], incomeStreams: [], pendingApprovals: 0, activeConsents: [] },
  healthStates: [], lifeItems: [], financeItems: [], learningTracks: [], nextActions: [], latestBriefing: null,
  kernel: { services: 19, openIncidents: 0, pendingApprovals: 0, safeMode: false, activeOperation: null, activeRuntimeGoal: null, recentEvents: ['kernel event'] },
  connectors: [],
};

console.log('— Zone completeness & honesty (empty world) —');
const emptyZones = buildUniverseZones(emptyInput);
check('Exactly 9 zones, all ids present', emptyZones.length === 9 && ['health', 'daily', 'life', 'finance', 'ventures', 'growth', 'opportunities', 'systems', 'presence'].every((id) => emptyZones.some((z) => z.zoneId === id)));
check('Empty world: personal zones are setup_needed/not_configured, NEVER live', emptyZones.filter((z) => z.zoneId !== 'systems').every((z) => z.status === 'setup_needed' || z.status === 'not_configured'));
check('Kernel zone is live even in an empty personal world', emptyZones.find((z) => z.zoneId === 'systems').status === 'live');
check('Every zone has setupHint + jarvisCommand + href + metrics', emptyZones.every((z) => z.setupHint.length > 10 && z.jarvisCommand.length > 5 && z.href.startsWith('/') && z.metrics.length >= 1));
check('Setup hints are actionable (mention ingest or consent), not vague', emptyZones.filter((z) => z.status !== 'live').every((z) => /ingest|consent|goals|Operations/i.test(z.setupHint)));
check('Presence honestly not_configured without connectors', emptyZones.find((z) => z.zoneId === 'presence').status === 'not_configured' && /consent/i.test(emptyZones.find((z) => z.zoneId === 'presence').setupHint));
check('Finance empty state promises amounts are never invented', /never invented/i.test(emptyZones.find((z) => z.zoneId === 'finance').headline));

console.log('— Finance aggregation (real math, no invention) —');
const fin = [
  PersonalFinanceItemSchema.parse({ ...stamp, financeItemId: 'f1', title: 'Consulting', itemType: 'income', amount: 4000, currency: 'EUR', cadence: 'monthly' }),
  PersonalFinanceItemSchema.parse({ ...stamp, financeItemId: 'f2', title: 'Rent', itemType: 'bill', amount: 1200, currency: 'EUR', cadence: 'monthly', dueDate: '2026-08-01' }),
  PersonalFinanceItemSchema.parse({ ...stamp, financeItemId: 'f3', title: 'Car installment', itemType: 'installment', amount: 300, currency: 'EUR', cadence: 'monthly', dueDate: '2026-07-15' }),
  PersonalFinanceItemSchema.parse({ ...stamp, financeItemId: 'f4', title: 'Server costs', itemType: 'expense', amount: 1200, currency: 'EUR', cadence: 'yearly' }),
];
const agg = aggregateFinance(fin);
check('Monthly normalization: 4000 in; 1200+300+100 out; net 2400', agg.monthlyIn === 4000 && agg.monthlyOut === 1600 && agg.net === 2400);
check('Obligations counted (bill+installment)', agg.obligations === 2);
check('Upcoming sorted by dueDate', agg.upcoming[0].financeItemId === 'f3');
check('Items without amounts do not fake totals', aggregateFinance([PersonalFinanceItemSchema.parse({ ...stamp, financeItemId: 'f5', title: 'Unknown bill', itemType: 'bill' })]).hasAmounts === false);

console.log('— Health map contract —');
const h1 = PersonalHealthStateSchema.parse({ ...stamp, healthStateId: 'h1', metric: 'energy', level: 7 });
const h2old = PersonalHealthStateSchema.parse({ ...stamp, healthStateId: 'h2', metric: 'energy', level: 3, createdAt: '2026-01-01T00:00:00.000Z' });
const h3 = PersonalHealthStateSchema.parse({ ...stamp, healthStateId: 'h3', metric: 'sleep', level: 4, concern: true });
check('latestHealthByMetric keeps newest per metric', latestHealthByMetric([h2old, h1, h3]).get('energy').level === 7);
const richZones = buildUniverseZones({ ...emptyInput, healthStates: [h1, h3], financeItems: fin, lifeItems: [PersonalLifeItemSchema.parse({ ...stamp, lifeItemId: 'l1', title: 'Family visit', domain: 'family', itemType: 'event', importance: 'high' })] });
check('Health zone: concern ⇒ attention status', richZones.find((z) => z.zoneId === 'health').status === 'attention');
check('Finance zone live with net in headline', richZones.find((z) => z.zoneId === 'finance').status === 'live' && /net 2400/.test(richZones.find((z) => z.zoneId === 'finance').headline));
check('Life zone: high-importance ⇒ attention', richZones.find((z) => z.zoneId === 'life').status === 'attention');
check('Determinism: same input ⇒ same zones', JSON.stringify(buildUniverseZones(emptyInput)) === JSON.stringify(buildUniverseZones(emptyInput)));

console.log('— New ingestion kinds —');
check('health_state / life_item / finance_item are ingestible kinds', ['health_state', 'life_item', 'finance_item'].every((k) => INGESTION_KINDS.includes(k)));
check('Connector guidance honest for new kinds', /not_configured/.test(nextConnectorFor('health_state')) && /not_configured/.test(nextConnectorFor('finance_item')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
