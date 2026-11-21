# Telegram bot and CORTEX account linking

Feature branch: feat/cortex-telegram-bot-menu-20261121; base: fix/cortex-web-quality-20261120 (current verified website source).

## User flow
1. User signs in on the CORTEX website, Account → Security → Telegram.
2. Clicking «Привязать Telegram» immediately opens the existing bot via a 5-minute deep link generated for that verified session.
3. The user presses Start in the private Telegram chat; the Telegram-authenticated webhook uses the one-time token to atomically link the Telegram ID. The token is removed. No website confirmation required.
4. The bot sends confirmation and the site shows the linked username on the next visit. Revoke the link from Security.
5. Account passwords, OTPs, CORTEX access tokens and payment credentials are never shared with Telegram.

## Security
- Secure random 32-byte base64url link token; only SHA256 hash stored in Supabase.
- Deep-link start payload (link_ + 43 chars) stays below Telegram's 64-character limit.
- Verified Supabase Auth email + currently valid Auth session + same-origin POST required.
- Only private Bot API updates from the Telegram user can finalize a link. Each Telegram ID is unique across CORTEX accounts.
- Webhook transport secret, Stars ledger verification, payment settlement and refund processing are not changed.
- Bot menu activation is independent: set CORTEX_TELEGRAM_BOT_ENABLED=true only after SQL and deployment checks; existing Stars path remains available.

## Activation (not yet performed)
1. Run npm test, npm run lint and npm run build; review preview and GitHub CI.
2. Apply additive SQL migration 20261121160500_cortex_telegram_account_link.sql after RLS/advisor review.
3. Verify Vercel prod source matches the website release branch; retain its rollback ID.
4. Deploy and enable CORTEX_TELEGRAM_BOT_ENABLED=true (no change to Stars enabled state).
5. Optionally use npm run telegram:configure in a secret-safe environment to configure bot menu and description.
6. Test one-time link, repeated Start, invalid/expired links, unlink, linked-account reuse, callbacks and Stars payments/refunds.
7. Do not claim production is working until real account, Telegram and billing smoke tests pass.

Telegram Bot API button styles: primary (blue), success (green), danger (red). Premium custom emoji IDs must be real and the bot needs Telegram-granted permission. Fallback uses regular emojis.
## Welcome artwork
`cortex-web/public/telegram/welcome.jpg` is the approved second artwork, compressed to 400x400 JPEG. `/start` and successful linking send it with an HTML caption; callbacks edit the caption. If unavailable, the bot sends the same content as text. Run `npm run telegram:configure -- --webhook` only from a trusted environment after production verification to enable commands and callback delivery; existing payment events are preserved.
