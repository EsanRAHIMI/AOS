import Link from 'next/link';
import { PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="card" style={{ marginBottom: 14 }}>
    <div className="label" style={{ marginBottom: 8 }}>{title}</div>
    <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{children}</div>
  </div>
);

export default function StartOverviewPage() {
  return (
    <>
      <PageHeader title="How the kernel works" subtitle="A plain-language guide to what this system is and how to operate it safely." crumbs={[['/start', 'Start'], ['/start/overview', 'How it works']]} />

      <Section title="What it is">
        An autonomous operating-system kernel: a set of independent services (a gateway, an orchestrator, and specialist
        agents for architecture, building, devops, monitoring, repair, research, review, QA and reporting). You give it a
        goal in plain language; it decides which agents to involve and coordinates them.
      </Section>

      <Section title="How a task flows">
        You create a task → the <b>orchestrator</b> picks the right pipeline → specialist <b>agents</b> do real work →
        each meaningful outcome produces <b>evidence</b> → sensitive steps pause for your <b>approval</b> → you get a
        result and a report. You can watch it live on the task page.
      </Section>

      <Section title="Safe vs. approval-gated actions">
        Reading, monitoring, researching and reporting are safe and run freely. Anything that changes production —
        deploying, repairing, governance/scoring/policy changes, irreversible actions — is <b>gated by approval</b> and
        by your role. You are always in control.
      </Section>

      <Section title="Evidence">
        The kernel never claims success without proof. Validations, research, reviews, QA, activations, repairs, security
        checks and learning all write <b>evidence records</b> you can browse in the <Link href="/evidence/explorer">Evidence explorer</Link>.
      </Section>

      <Section title="AI reasoning (real or fallback)">
        When provider keys are configured the kernel reasons with a real LLM; otherwise it uses a deterministic fallback.
        Either way the mode is shown, every call is schema-validated, and cost is tracked. See <Link href="/llm">Real Intelligence</Link>.
      </Section>

      <Section title="Learning & governance">
        The kernel learns from its own history (reliability, patterns, recommendations) and can improve how it decides —
        but only under approval, versioning and audit. See <Link href="/learning">Learning</Link> and <Link href="/governance">Governance</Link>.
      </Section>

      <Section title="Safe mode">
        Safe mode is an emergency kill-switch: when on, the kernel refuses all mutation/deploy/repair/governance actions
        and runs read/monitor/report only, with a banner across the app. Owners toggle it in <Link href="/security/safe-mode">Safe Mode</Link>.
      </Section>

      <div className="actions">
        <Link href="/start/actions" className="btn btn-primary">Next: run a real task</Link>
        <Link href="/start/system-map" className="btn btn-ghost">See the system map</Link>
      </div>
    </>
  );
}
