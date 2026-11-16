/**
 * Lightweight origin probe for a future active/passive deployment.
 *
 * Intentionally does not query Redis, Supabase, or the AI provider: failures
 * of those shared services must not trigger a hosting-provider failover.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response("ok", {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Robots-Tag": "noindex",
    },
  });
}
