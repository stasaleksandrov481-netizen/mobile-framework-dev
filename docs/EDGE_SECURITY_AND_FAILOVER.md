# CORTEX: edge security and active/passive failover

## Current topology (16 November 2026)

- `cortexapp.ru` resolves through Cloudflare DNS **without proxying** to Vercel.
- Vercel's network-layer and HTTP DDoS protection is the primary edge defense.
- The Android application calls Supabase Edge Functions at `*.supabase.co` directly.
- Supabase owns authentication and durable AI quotas; Upstash is an optional cache.
- No independent Cloudflare-hosted copy of the web app currently exists.

Do not orange-cloud the Vercel CNAME merely to add a second DDoS provider. Vercel
advises against a second reverse proxy because of client IP/fingerprint loss,
certificate validation, double caching, and extra hops. If moving to a fully
Cloudflare-fronted architecture, plan and test that migration explicitly.

## Vercel Firewall rules

Configuration is managed at the Vercel project level, not the Cloudflare DNS zone.

- Automatic Vercel DDoS mitigation stays **enabled**.
- Deny common vulnerability scanner paths (`/.git`, `/.env`, `/.svn`,
  `/wp-admin`, `/xmlrpc.php`, `/phpmyadmin`, `/vendor/phpunit`).
- Rate-limit `GET /api/status` and other HTTP methods on the same route to
  120 requests per IP per 60 seconds; exceeders get HTTP 429.
- Observe bot and AI crawler detections in **log** mode first. Once verified
  against 24–48 hours of traffic, choose challenge for hostile automation and
  deny for unwanted AI crawlers. Do not challenge the native Android API.

All of these edge rules protect the Vercel website only, **not** Supabase's
direct Android endpoint. For API abuse, retain backend authorization, atomic
quotas, input size caps, and provider spend limits even when edge filters exist.

## Future independent backup

An actual active/passive deployment requires a separate, tested Cloudflare
Worker or other origin that serves the **entire required web experience**.
Serving a maintenance page or forwarding all requests to Vercel is not a
functional fallback. Both origins must agree on session identity, callback
URLs, payment configuration, migrations, and release version. Shared Supabase
and OpenRouter outages will affect both origins; treat these separately.

Run a Cloudflare-origin smoke test and a reversible manual cutover before
installing automated traffic steering. Use a real health check and availability
monitor (e.g. the Cloudflare Load Balancing product, if its price/limits are
approved for the account). Route health check requests to `/api/healthz`: this
route deliberately does not query shared Supabase or Redis, so their failures
cannot trigger pointless web-host swaps.

### Switching policy

1. Check the primary origin continuously from multiple locations.
2. Fail over only after **consecutive** connection failures or 5xx responses
   from the primary origin. Do not trigger failover on a single timeout.
3. Never switch on HTTP **429**, 401, 403, a billing error, or a product-level
   quota error. This would bypass throttling and worsen cost and abuse.
4. Hold a minimum dwell/cooldown period before any further switch. Fail back
   only after a sustained healthy interval plus a warm-up smoke test.
5. Alert on failover, record the reason, and maintain a manual override.
6. Test DNS/TLS, cache headers, login callbacks, email, and edge rule parity
   on both origins before directing production traffic to the backup.

Do not implement an unconditional Vercel ↔ Cloudflare cycle: without
hysteresis it oscillates during partial failures, doubles operational load,
and can create loops if both sides depend on the same failed backend.

## Recovery / incident checklist

- **Vercel 429:** inspect WAF request logs, confirm genuine vs automated
  traffic, tune the matching limiter; do not bypass it through failover.
- **Vercel 5xx:** check deployment/runtime status and origin health; if the
  independent backup is healthy, evaluate a controlled switch.
- **Supabase unavailable:** return bounded 503 with retry guidance, keep the
  marketing site available. Do not rotate DNS for a shared database failure.
- **OpenRouter limits:** keep per-account and provider budgets authoritative;
  route to an approved model if available, or fail closed without incurring
  unexpected spend.
- **Upstash unavailable:** optional catalog caching already has a timeout,
  circuit breaker and local fallback; avoid making Redis the only quota store.

## Sources

- https://vercel.com/kb/guide/vercel-waf-vs-cloudflare-waf
- https://vercel.com/docs/vercel-firewall/ddos-mitigation
- https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules
- https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting
- https://developers.cloudflare.com/load-balancing/
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
