# CORTEX: security gate before public preregistration

Status: 2026-11-16. The deployment is deliberately protected by Vercel Authentication. **Do not remove it solely because CI is green.**

## Already verified

- The homepage, preregistration page and legal pages can be served as static assets; the plan catalog revalidates every five minutes. This limits unnecessary function/DB load.
- Response headers set CSP, frame denial, no MIME sniffing and HSTS. Outgoing browser connections are restricted to the configured Supabase project instead of every `*.supabase.co` host.
- `/api/*` and `/auth/*` responses are marked `no-store` and `noindex`.
- Untrusted Supabase Auth errors map to safe user messages rather than being rendered verbatim.
- The registration UI separates agreement acceptance, account-data consent and optional launch mail. New acceptances are recorded with database time and an immutable document version by an authenticated RPC (requires migration `cortex_registration_consent_audit`).
- Public registration UI is fail-closed unless `CORTEX_ENABLE_REGISTRATION=true`, `CORTEX_RF_DATA_COMPLIANCE_VERIFIED=true` and both co-operators' full details (server-only `CORTEX_LEGAL_OPERATOR_A_*` and `CORTEX_LEGAL_OPERATOR_B_*`) are complete. The second co-operator is the sole merchant of paid services. Names and INNs are never committed to the public repository. This does **not** disable direct Supabase Auth signups; the Auth-side gate and CAPTCHA must also be configured before opening.
- On 2026-11-17 the owner explicitly requested public signup before RF data compliance could be verified. A separately auditable, reversible exception requires **both** `CORTEX_ENABLE_REGISTRATION=true` and `CORTEX_PUBLIC_SIGNUP_EXCEPTION=true`, without changing `CORTEX_RF_DATA_COMPLIANCE_VERIFIED`. This is a risk acceptance, **not legal compliance**, and does not remove the checklist below. Remove the exception when the required infrastructure and documents are ready.
- The notification endpoint requires `CRON_SECRET`, an explicit release flag and a valid HTTPS APK URL before sending. SMTP credentials and the Supabase service-role key remain server-only.
- Supabase admin privilege escalation functions inspected on 2026-11-16 require a verified account, MFA AAL2, an owner role or a single-use hashed invitation as appropriate. `SECURITY DEFINER` advisories alone do not demonstrate a bypass.
- Vercel Firewall has an exploit-path deny rule and per-IP status polling limit. Vercel platform DDoS mitigation is active independent of these rules.

## Must pass before removing Vercel Authentication

- [ ] Confirm the legal operator details, processing purposes, retention periods, age/minor consent handling, verified deletion and support procedures. Check the separate legal checklist. Resolve personal-data localization for Russian registrants; publishing documents alone is not sufficient.
- [ ] Configure and confirm working mail DNS (MX, SPF, DKIM and ideally DMARC); test inbox deliverability with real Gmail, Mail.ru and Yandex recipients. Ensure the SMTP provider explicitly supports the intended registration-email volume.
- [ ] Verify the configured Supabase Auth rate limits and per-recipient email interval against expected traffic and real mail delivery. Do not increase them without anti-bot controls.
- [ ] Enable Supabase Auth leaked-password protection where the plan supports it. Review MFA requirements for real administrators and remove inactive invitations.
- [ ] Add server-validated Supabase Auth CAPTCHA (e.g. Turnstile) **before** increasing public signup throughput. Enabling CAPTCHA at Supabase without passing `captchaToken` from web/mobile clients will break signup, recovery and OTP flows. Test every supported client first.
- [ ] Review Vercel Firewall attack logs in production before changing SQLi/XSS/RCE managed rule actions from `log` to mitigation. Cloudflare DNS-only CNAME means Cloudflare WAF does not currently see site requests; do not switch proxying blindly.
- [ ] Run the production smoke suite: password registration, confirmation code, resend limit, login, existing email privacy, auth callback, bonus quota and consent opt-in. Verify database RLS with two real test users (each must be unable to read/update the other's records).
- [ ] Test from real mobile networks in Russia and from a second location. Check Supabase, Vercel, Upstash and SMTP quotas/usage; set billing alerts and kill switches for expensive AI calls.
- [ ] Validate backup restore, log redaction, token/secret rotation and an incident-response contact. Use separate preview/prod service credentials; store credentials only in platform secret managers.
- [ ] Start with a controlled registration rollout and monitor 429, 5xx, mail bounce, DB connection saturation and malicious traffic. Increase traffic only while all critical dependencies remain healthy.

## Command-line checks (local, no production traffic)

From `cortex-web`: `npm ci`, `npm run lint`, `npm run build`, `node --test scripts/hardening.test.mjs`.

From the repository root: `node qa/run-local-load.mjs` starts the built production server in an isolated local process and runs HTTP-only load checks. It is **not** a production capacity guarantee, a DDoS test or a substitute for realistic, pre-approved staging-load tests against authentication and storage.
