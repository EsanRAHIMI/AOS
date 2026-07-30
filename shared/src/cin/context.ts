/**
 * Owner identity context for agents (D-188).
 *
 * The bug this fixes: `assembleTurnContext` gave Jarvis memory, missions, the
 * transcript and system status — and nothing about WHO THE OWNER IS. So an
 * owner whose CIN entity held their full name, national id, passport number,
 * birth date, nationality and military status could ask "what do you know
 * about me?" and be told, correctly from the model's point of view, that no
 * personal data was recorded. The data existed; the assistant was never handed
 * it, and had no signal that it should go looking.
 *
 * Two rules shape what this returns:
 *
 *  - **Names of facts, not all their values.** A national id, passport number,
 *    IBAN or medical note does not belong in the prompt of every single turn —
 *    that is a copy of the owner's identity leaving to a model provider on each
 *    message, for no benefit. Those are listed as recorded-and-available, and
 *    the agent fetches the actual value with `cin_entity_get` on the rare turn
 *    that needs it. Context says WHAT IS KNOWN AND WHERE; tools fetch specifics.
 *  - **Deadlines are always included in full.** An expiring passport or permit
 *    is the single most actionable thing in the whole profile, and it is not
 *    sensitive in the way an id number is.
 */
import { listEntities, getEntity } from './entities.js';
import { listDocuments } from './documents.js';

/**
 * Field keys whose VALUE stays out of the prompt. Deliberately a denylist of
 * identifiers and health data rather than an allowlist: a new profile field
 * should become visible to the assistant by default (that is the point of the
 * whole feature), and only the genuinely dangerous categories are held back.
 */
const SENSITIVE_FIELDS = new Set([
  'national_id', 'passport_no', 'id_card_number', 'residence_permit_no',
  'iban', 'account', 'account_number', 'swift_bic', 'crypto_wallet', 'tax_id',
  'card_number', 'insurance_no', 'credential_id', 'member_no',
  'allergies', 'chronic_conditions', 'medications', 'blood_type',
  'immigration_case_no', 'reference_no', 'registry_no',
]);

/** Sections held back wholesale — their mere field names are informative enough. */
const SENSITIVE_SECTIONS = new Set(['financial', 'health_ref']);

export interface OwnerIdentityContext {
  /** Empty string when there is no owner entity yet — callers omit the block. */
  text: string;
  entityId: string | null;
  /** Present so callers can log/measure what the assistant was actually told. */
  sectionCount: number;
  documentCount: number;
}

function summariseSection(name: string, data: Record<string, unknown>): string {
  const parts: string[] = [];
  const withheld: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === null || v === undefined || v === '') continue;
    if (SENSITIVE_FIELDS.has(k) || SENSITIVE_SECTIONS.has(name)) { withheld.push(k); continue; }
    const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
    parts.push(`${k}=${val.length > 80 ? `${val.slice(0, 80)}…` : val}`);
  }
  const recorded = withheld.length ? ` [recorded, fetch with cin_entity_get if needed: ${withheld.join(', ')}]` : '';
  return `- ${name}: ${parts.join('; ') || '(no open fields)'}${recorded}`;
}

/**
 * Build the identity block for a turn. Never throws: an unseeded CIN graph
 * must degrade to "no identity recorded", not break the conversation.
 */
export async function buildOwnerIdentityContext(
  opts: { entityId?: string; maxDocuments?: number } = {},
): Promise<OwnerIdentityContext> {
  const empty: OwnerIdentityContext = { text: '', entityId: null, sectionCount: 0, documentCount: 0 };
  try {
    let entity = opts.entityId ? await getEntity(opts.entityId, { includePrivate: true }) : null;
    if (!entity) {
      const people = await listEntities({ entityType: 'person' });
      const owner = people.find((e) => e.tags?.includes('owner') || e.tags?.includes('founder')) ?? people[0];
      if (!owner) return empty;
      entity = await getEntity(owner.entityId, { includePrivate: true });
    }
    if (!entity) return empty;

    const sections = Object.entries(entity.sections ?? {});
    const lines = [
      `OWNER IDENTITY (from the CIN entity graph — this IS recorded data about the person you are talking to):`,
      `- entityId: ${entity.entityId} (use cin_entity_get for any value not shown here)`,
      `- name: ${entity.displayName || entity.name}${entity.status !== 'active' ? ` [status: ${entity.status}]` : ''}`,
    ];

    if (sections.length === 0) {
      lines.push('- profile sections: none filled yet.');
    } else {
      lines.push(`- profile sections on file (${sections.length}):`);
      for (const [name, sec] of sections) lines.push(`  ${summariseSection(name, sec.data ?? {})}`);
    }

    const docs = await listDocuments({ ownerEntityId: entity.entityId });
    const live = docs.filter((d) => d.status !== 'archived').slice(0, opts.maxDocuments ?? 25);
    if (live.length === 0) {
      lines.push('- documents: none registered.');
    } else {
      lines.push(`- documents (${live.length}) — expiry is actionable, treat it as such:`);
      for (const d of live) {
        const when = d.expiresAt ? ` expires ${d.expiresAt.slice(0, 10)}` : ' no expiry';
        lines.push(`  - ${d.title} [${d.docType}]${when} (${d.status})`);
      }
    }

    return {
      text: lines.join('\n'),
      entityId: entity.entityId,
      sectionCount: sections.length,
      documentCount: live.length,
    };
  } catch {
    // The graph may not be seeded, or Mongo may be mid-failover. An assistant
    // that loses its identity block should still answer the question in front
    // of it.
    return empty;
  }
}
