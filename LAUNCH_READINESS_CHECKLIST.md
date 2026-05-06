# FlashAI Launch Readiness Checklist

## Scope
This checklist is designed to validate production readiness across:
- Registration & authentication
- Match fetching and analysis
- Credits and subscription lifecycle
- Referral, support, reporting
- Legal content delivery
- Security and abuse resistance

## 1) Registration & Auth (Telegram)
- [ ] New user opens mini app and account is created.
- [ ] User without phone is blocked from premium flows and prompted to signup.
- [ ] Contact sharing persists and `/api/auth/me` returns phone on next launch.
- [ ] Invalid/expired `X-TG-Init-Data` is rejected (401) for protected endpoints.
- [ ] Session restore after app restart keeps signed-in user context.

## 2) Matches & Analysis
- [ ] Matches list loads under normal network.
- [ ] Search by team name returns expected fixture.
- [ ] `/api/analyze` returns success under healthy model conditions.
- [ ] Transient model errors return expected statuses: 429/503/504.
- [ ] Client retries once on 429/503/504 and avoids infinite retry loops.
- [ ] Live analysis route enforces paid-plan access.

## 3) Credits
- [ ] Credits deduct exactly once per successful analysis.
- [ ] Failed analysis does not deduct credits.
- [ ] Concurrent requests do not allow negative credits or double-spend.
- [ ] Daily credit reset runs once per user/day.
- [ ] Reset logic preserves bonus/rollover behavior as intended.

## 4) Subscriptions
- [ ] Plan purchase success upgrades plan and quota.
- [ ] Payment failure leaves plan unchanged.
- [ ] Expired subscriptions downgrade user plan correctly.
- [ ] Feature gates reflect current plan immediately after change.
- [ ] Webhook replay/idempotency is enforced.

## 5) Wallet Connectivity
- [ ] TonConnect wallet remains connected after app restart.
- [ ] Wallet session is disconnected when ownership mismatch is detected.
- [ ] UI reflects connected/disconnected state correctly.

## 6) Referral
- [ ] Referral links are generated per user.
- [ ] First-time referred signup is attributed once.
- [ ] Duplicate/self-referral abuse is prevented.
- [ ] Referral credits are granted and auditable.

## 7) Support / Report Issue
- [ ] FAQ content loads.
- [ ] Chat support route responds and logs.
- [ ] Report issue form validates required fields.
- [ ] Submitted report is persisted and retrievable by admins.

## 8) Terms & Policies
- [ ] Terms endpoint returns content.
- [ ] UI gracefully handles terms endpoint failure.
- [ ] Version/date of legal text is visible.

## 9) Security
- [ ] Rate limits trigger for abuse patterns.
- [ ] Sensitive endpoints require auth.
- [ ] Server secrets are not exposed to client bundles.
- [ ] Webhook signatures are verified.
- [ ] Input validation blocks malformed payloads.

## 10) Performance & Reliability
- [ ] P95 latency targets set for key endpoints.
- [ ] Error budget & alerting configured.
- [ ] Logs include request IDs and key context.
- [ ] Health checks and restart policy configured.

## Release Gate
Do not launch until all critical checks pass:
- Auth & registration
- Credit deduction integrity
- Subscription lifecycle (including expiry)
- Security checks (auth + webhook signature + rate limits)
- Analysis stability under transient failures
