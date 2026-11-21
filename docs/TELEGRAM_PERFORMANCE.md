# Telegram bot latency and navigation

One storefront entry; old /pay and cortex:pay aliases resolve to plans. No public menu calls the separate checkout screen. Existing /paysupport remains available. Reconfigure bot commands after release.

Public navigation uses the existing Upstash Redis REST client: one atomic Lua sliding-window admission per chat, deduplication for 180 seconds, and 30 accepted public operations/minute. Redis stores no purchase, session, token or entitlement values; chat keys use HMAC with the webhook secret. A Redis error opens a 30-second local circuit and falls back to the existing SQL gate. Personal account, link, payment and unknown requests retain the durable database claim and authorization. The public catalogue already shares the site's validated Redis+Supabase cache. Public screens avoid account lookup; callback acknowledgement overlaps data reads. Actual latency must be measured after release.

Release together with PR #127 and its SQL checkout migration after tests/build; do not roll out unverified payment changes.
