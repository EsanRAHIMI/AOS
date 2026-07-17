/**
 * /jarvis — the persistent Jarvis command workspace (K2, D-177).
 * The primary owner surface: threads, streaming turns on the shared agent
 * loop, inline approvals, memory. See docs/jarvis-spec.md.
 */
import { PageHeader } from '@/components/ui';
import JarvisWorkspace from './JarvisWorkspace';

export const dynamic = 'force-dynamic';

export default function JarvisPage() {
  return (
    <>
      <PageHeader title="Jarvis" subtitle="Your persistent command intelligence. Speaks Persian and English, remembers across sessions, acts through governed tools, and pauses for your approval on anything sensitive." />
      <JarvisWorkspace />
    </>
  );
}
