import { Placeholder } from '@/components/Placeholder';
export default function Page() {
  return (
    <Placeholder
      title="Memory"
      sub="Task history, decisions, patterns and reusable skills extracted by the memory-agent."
      phase="Phase 2"
      note="Memory extraction runs after task completion. This view will read summaries from the memory-agent via the gateway."
    />
  );
}
