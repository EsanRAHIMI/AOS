'use server';
/**
 * Put a calendar alert into the conversation (D-197).
 *
 * The announcement was a real utterance the owner heard, and their next
 * sentence is usually about it — "نیم ساعت عقب بنداز", "لینکش رو بده". Living
 * only in React state meant that follow-up reached an assistant with no
 * record of having said anything.
 *
 * Best-effort by design: failing to archive must never stop the reminder from
 * being shown and spoken.
 */
import { gateway } from '@/lib/gateway';

export async function archiveAlertAction(args: {
  text: string; eventId?: string; calendarId?: string; title?: string;
}): Promise<{ ok: boolean; sessionId: string }> {
  try {
    const sessions = await gateway.jarvisSessions();
    const sessionId = sessions?.[0]?.sessionId
      ?? (await gateway.createJarvisSession('جارویس'))?.sessionId
      ?? '';
    if (!sessionId) return { ok: false, sessionId: '' };
    await gateway.jarvisAnnounce(sessionId, {
      trigger: `یادآوری تقویم: ${args.title || 'رویداد'}`,
      text: args.text,
      eventId: args.eventId,
      calendarId: args.calendarId,
    });
    return { ok: true, sessionId };
  } catch {
    return { ok: false, sessionId: '' };
  }
}
