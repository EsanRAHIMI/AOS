import { PageHeader } from '@/components/ui';
import { TemplateCard } from '@/components/TemplateCard';
import { TEMPLATES_BY_CATEGORY } from '@/lib/templates';

export const dynamic = 'force-dynamic';

export default function StartActionsPage() {
  const groups = TEMPLATES_BY_CATEGORY();
  return (
    <>
      <PageHeader title="Run a real task" subtitle="Each template maps to an actually-implemented pipeline and creates a real task — there is no demo or simulation mode." crumbs={[['/start', 'Start'], ['/start/actions', 'Run a task']]} />
      {Object.entries(groups).map(([cat, list]) => (
        <div key={cat} style={{ marginBottom: 18 }}>
          <div className="label" style={{ marginBottom: 10 }}>{cat}</div>
          <div className="card-grid">
            {list.map((t) => <TemplateCard key={t.id} t={t} />)}
          </div>
        </div>
      ))}
    </>
  );
}
