# CORTEX beta: AI budget, contextual actions, planner latency — 18 Nov 2026

## Live server quota change (explicit user request)
The production Supabase project `jjcqrjztxohnifmziksy`, public.cortex_plans, was updated in place (no schema change). The authoritative function `cortex_ai_usage` was queried after the update and reported guest=15000, free=30000 daily tokens.

| Plan | Price RUB | Previous daily | New daily | Context chars | Advanced daily |
|---|---:|---:|---:|---:|---:|
| guest | 0 | 100000 | 15000 | 8000 | 0 |
| free | 0 | 400000 | 30000 | 16000 | 0 |
| start | 199 | 500000 | 80000 | 28000 | 6000 |
| pro | 399 | 650000 | 180000 | 40000 | 24000 |
| ultra | 799 | 950000 | 350000 | 50000 | 60000 |

- These are **daily** model token limits, not monthly. They do not create OpenRouter capacity; the free key still has provider request rate/daily limits.
- Offline/local Android commands must never invoke or bill the model. Visual AI plans are model calls and count toward the balance.
- The server has separate guest admission policy; a guest quota entry does not override guest AI login requirements. Never bypass the device identity, account login, and global rate limiting checks.
- The checkout remains disabled. Previously issued payments snapshot their limits and should not be silently rewritten; none were returned by the payment count query.
- No change to the monetary funding configuration was made (`funded_micros=8000000` at verification), and no new paid-model access was granted.
- Two rows existed in `cortex_ai_limits`, neither with a custom `daily_tokens` override when inspected.

## Rollback for authorized operators only
The previous table values are captured above. To restore them in a controlled incident, apply the previous `daily_tokens`, `context_chars`, and `advanced_tokens` values via a reviewed migration or SQL update, verify `cortex_ai_usage`, and record the rollback in this document. Do not edit account-level override tables or active payment entitlements as a shortcut.

## Android + Edge code
Branch: `fix/cortex-beta-brain-budget-20261118`, based on `main` `3d8c81ebfe4f35e54988540a214620888bdc3bc3`.

- Preload the launcher app index off the UI thread; execute PackageManager-heavy app commands in a worker.
- Remove the deliberate first-action wait, and perform one 22-second client request for a visual plan instead of retrying a second time. The server already performs tool/schema model fallback.
- Bound server visual planning to a 20-second end-to-end deadline and a 5.5-second first-response deadline per provider candidate. These are *upper bounds*, not promises of <5 seconds.
- Prompt the model for 1–3 steps from a strict allowlist, and validate an exactly named plan tool envelope safely when a free model returned it as message content.
- Resolve safe references like `открой YouTube` → `открой его` in the active owner session for three minutes. Do not resolve this way for payments, deletions, or sending messages. The chat memory sends only safe app-name references.
- Keep the same UI layout, overlay/island and permissions unchanged.

## Release block / smoke checks
Before publishing a signed beta, CI must pass, the actual APK certificate must match the established release signer, and a human should check app launch, island, unlock, flash on/off, messaging and real AI plan execution on an Android phone. A green CI run alone cannot verify accessibility navigation or a live LLM provider. Do not overwrite production Supabase Edge Function with an outdated copy; the live `cortex` v46 files and GitHub main were equal on 18 Nov for six checked server files.

## Live deployment evidence
- The `cortex` function was deployed from the PR using all 11 verified sources as v47; Supabase reported `ACTIVE`, preserved `verify_jwt=false`, and subsequent source comparison returned **11/11 exact matches**.
- The signing workflow prepares `1.0.18-beta.1` (`versionCode=118`) and can publish only from main after an explicit `release(cortex): publish beta 1.0.18-beta.1` commit or a manual workflow dispatch. A PR passing CI is not itself a published or physically verified APK.
