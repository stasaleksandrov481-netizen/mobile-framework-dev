# Direct Telegram Stars checkout

Deploy migration `20261121172000_cortex_stars_bot_checkout.sql` before the web release. The signed private Telegram update provides the payer ID; SQL finds the linked account and verified email, reuses the existing order/funding/rate limits and pins the payer. The final `https://t.me/...` invoice link opens Telegram's native Stars payment sheet. No CORTEX payment page is necessary after initial linking. Precheckout checks current linking/payer, the existing settlement verifies Telegram ledger and grants entitlements atomically. No production payments are created by tests.

Before activation: test SQL on staging, run focused Node tests and Next build, verify actual Telegram invoice behavior with test Stars. Vercel free deployment quota may postpone release.
