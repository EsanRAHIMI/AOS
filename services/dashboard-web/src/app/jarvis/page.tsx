/**
 * Legacy `/jarvis` URL — permanently redirect to the product root.
 * Bookmarks and old links keep working.
 */
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function JarvisRedirectPage() {
  redirect('/');
}
