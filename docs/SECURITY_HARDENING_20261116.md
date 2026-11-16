# CORTEX security: enforced controls and remaining risks

Audit date: 2026-11-16. This is a deployment checklist, not a claim of immunity to attacks.

## Paths and trust boundaries

1. `cortexapp.ru` uses Vercel. Its WAF protects the website and Vercel endpoints, not the direct Android-to-Supabase API.
2. Android talks directly to the `cortex` Supabase Edge Function over HTTPS. The Edge Function validates bearer tokens, checks account/guest limits in PostgreSQL, and holds provider credentials server-side.
3. The web registration form calls Supabase Auth directly. Vercel WAF does not rate-limit those sign-up/OTP/password requests.
4. Billing accepts a server-to-server bearer secret, re-verifies provider transaction details, and records changes through database RPCs. Refunds require a current authenticated administrative session with MFA.
5. Android WebView content is local, isolated from arbitrary network pages, and optional updates require a valid RSA signature and archive digest.

## Implemented controls

- Vercel default automatic L3/L4/L7 DDoS mitigation and enabled custom firewall. Exploit-scan paths are denied; `/api/status` has a 120 requests/IP/minute cap.
- Vercel Bot Protection and AI Bots currently **log** detections; they do not yet block or challenge traffic. Tune against real traffic before changing actions.
- Central PostgreSQL atomic request and spend budgets; a global guest budget survives rotations of install IDs and client-provided IP headers.
- Input bounds for chat, support, auth, and speech; uploads from users never choose the OpenRouter model or provider key.
- JSON media-type checks prevent simple browser form submissions to state-changing gateway routes.
- Native client has bounded parallel requests, bounded pending queue, bounded JSON and SSE responses, and cancellation when the UI is closed.
- GitHub CodeQL security scans, automated dependency-update proposals and Android / server-side security regression tests.
- Cold-start readiness probes now coalesce concurrent calls, and a valid environment provider-key fallback is cached even when the Vault RPC fails. These prevent extra database calls during bursts.

## Reproducible safe load test

Run `node qa/load-cortex.mjs http://127.0.0.1:3101` against a locally started production build of `cortex-web` (`npm run build`, then `npm run start -- --port 3101`). The script refuses non-loopback hosts and only sends GET requests to `/api/healthz` and `/api/status`.

- 2026-11-16, local optimized Next.js build, Redis intentionally unconfigured: **3,500 / 3,500 HTTP 200**, in six bursts at 10, 50 and 100 concurrent connections; `/api/healthz` p95 81.9 ms at concurrency 100; `/api/status` p95 72.8 ms at concurrency 100.
- Synthetic Supabase gateway test: 240 simultaneous `status` requests with one installation ID yielded 30 success / 210 rate-limit responses; 60 simultaneous AI checks yielded 12 success / 48 rate-limit responses, without contacting a paid provider.
- These figures measure a local process and mocked backend, **not** production DDoS resilience, number of sustainable users, Supabase capacity, or Vercel billing limits. Production load testing requires a staging deployment, provider coordination, and explicit cost caps.

## Required before public beta

1. **Protect Supabase Auth directly.** Create a Cloudflare Turnstile widget for `cortexapp.ru`, configure the matching secret under Supabase Auth CAPTCHA settings, and pass fresh `captchaToken` from the registration form to sign-up, OTP and password-recovery requests. Enable only after an end-to-end test. Do not put the Turnstile secret in a `NEXT_PUBLIC_` variable.
2. **Review Supabase Auth settings.** Enable leaked-password checks if available on the project's plan; configure email / OTP / password rate limits and test false positives. Require MFA for staff.
3. **Inspect security advisories.** `RLS enabled without policy` is intentional for service-role-only tables and must not be fixed with broad `authenticated` policies. Review the five authenticated callable `SECURITY DEFINER` admin RPCs; their MFA and owner checks are required for the current admin console.
4. **Observe WAF first.** Check logs for false-positive bot and AI-crawler matches before changing from `log` to `challenge` or `deny`. Do not challenge the native Android API without a compatible non-browser verification method.
5. **Enable infrastructure alerts.** Track Supabase database connections and statement latency, Edge Function 4xx/5xx, Vercel firewall/5xx, OpenRouter spend, billing-webhook failures and email OTP spikes. Set provider-side budget caps independently of application checks.
6. **Control secret lifecycle.** Rotate service-role, payment and provider secrets after any leak, update them as deployment environment variables and redeploy. Never save private keys in the repository or Android APK.
7. **Red-team before open beta.** Test broken object authorization, auth/OTP enumeration, payment replay, unauthenticated RPC execution, privileged session revocation, Android WebView origin isolation and prompt-injection routes using staging accounts.

## Failover guardrails

- Cloudflare currently manages DNS only. A failover requires a separately deployed and tested backup origin and authoritative health checks.
- No failover on HTTP 429, 401 or 403. These statuses are deliberate controls, not a Vercel outage.
- Use multiple failed health checks, a cool-down, and a gradual failback. Never flip DNS between providers on each failed request.
- Shared Supabase/Redis/OpenRouter outages will affect both frontends. Switching frontend providers cannot repair those shared dependencies.
