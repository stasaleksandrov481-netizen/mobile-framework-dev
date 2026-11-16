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
