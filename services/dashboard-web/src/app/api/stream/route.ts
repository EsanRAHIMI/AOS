import 'server-only';

/**
 * Server-side SSE proxy. The browser subscribes to same-origin /api/stream;
 * this handler connects to the event-bus stream with the internal token and
 * pipes events through. Secrets stay on the server.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const bus = process.env.EVENT_BUS_URL ?? 'http://localhost:4111';
  const token = process.env.FACTORY_INTERNAL_TOKEN ?? '';

  try {
    const upstream = await fetch(`${bus}/events/stream`, {
      headers: { 'x-factory-internal-token': token },
    });
    if (!upstream.ok || !upstream.body) {
      return new Response('event: error\ndata: {"message":"event bus unreachable"}\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      });
    }
    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch {
    return new Response('event: error\ndata: {"message":"event bus unreachable"}\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  }
}
