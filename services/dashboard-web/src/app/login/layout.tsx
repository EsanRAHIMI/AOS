import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';

/** Already signed in — skip the login form (verified in Node, not Edge). */
export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session) redirect('/');
  return children;
}
