# Habit, Retention & Responsible Design Audit

**Product:** Flash AI — AI football analysis / bet-slip review in Telegram
**Audited:** 25 Nov 2026 · code at commit `e452023`
**Scope:** what currently creates return visits, how strong it is, what to add, and where the ethical/legal lines are.

---

## 1. Verdict in one paragraph

Flash AI today is **good at re-engagement and weak at compulsion**. You have four scheduled push loops (daily fixtures, news digest, live goal alerts, win-back) and a daily credit reset — that is more trigger surface than most apps at this stage. But there is **no streak, no visible progress, no social proof, and no investment that compounds**. The result is a product people use *when they already intend to bet*, not one they open out of habit. On the Hook Model it scores **2.6 / 5**. That is actually the right place to be for a betting-adjacent product ethically — but it is below the category leaders and it caps your conversion.

---

## 2. What exists in the code

| Mechanic | Where | Status | Assessment |
|---|---|---|---|
| Daily credit reset | `creditResetScheduler.ts`, `syncUserCredits` | Live | Creates loss aversion, but the user sees "credits", not progress |
| 1 free analysis/day | `PLAN_CONFIG.free` | Live | Strong acquisition hook, weak conversion pressure |
| Daily fixture digest | `engagementScheduler.runDailyFixtures` | Live | Best re-entry trigger you have |
| ESPN news digest | `runNewsDigest` | Live | Habit-forming but low intent |
| Live goal/full-time alerts | `runLiveAlerts` + `match_alert_subscriptions` | Live | Highest-intent trigger; under-marketed |
| Weekly recap | `runWeeklyRecap` | Live | Good, but doesn't show accuracy |
| Win-back / upgrade campaigns | `runMarketing` | Live | Working, capped |
| Quiet hours 22:00–08:00 | `notification_preferences` | Live | ✅ Genuinely good restraint — keep |
| Dedupe on delivery | `notification_deliveries` | Live | ✅ Prevents double-send |
| Streaks | — | **Missing** | Biggest single retention gap |
| Post-match outcome alert | `user_history.status`, `resolved_at` | Data exists, not pushed | Biggest single *trust* gap |
| Proof-of-wins / accuracy page | `History.tsx` (private only) | Private | Public record is the category's strongest mechanic (OLBG) |
| Leaderboard | `routes/leaderboard.ts` | Live | ❌ Ranks by **credits**, not by accuracy — meaningless |
| Share cards | `Analyze.tsx` `buildPredictionCardBlob` | Live | ✅ Strong asset, ❌ no referral attribution |
| Referral | `referrer_id` + 2 credits | Live | Too weak to move the needle |
| Tasks | `tasks`, `user_tasks`, `claim_task_reward` | Live | Good verification, admin-only supply |
| Public win rate | `users.win_rate`, `predictions_count` | Columns exist, **unused** | Free credibility, not shipped |

---

## 3. Hook Model score

| Stage | Score | Why |
|---|---|---|
| External trigger | **4/5** | 4 scheduled loops + live alerts + admin broadcasts |
| Internal trigger | **2/5** | Nothing pulls a user in on a non-match day; no emotional cue owned |
| Action (ease) | **3/5** | Mini App is fast, but contact-share gate and match picking add friction |
| Variable reward | **3/5** | Each analysis differs, but rewards are informational, never social or status |
| Investment | **2/5** | History is stored but never compounds into rank, streak, or reputation |
| Social | **1/5** | Leaderboard ranks credits; no follows, no challenges, no sharing loop |
| **Total** | **2.6/5** | Good plumbing, no flywheel |

---

## 4. The five highest-leverage additions

Ordered by (retention lift × implementation cost). All are non-manipulative.

### 4.1 Post-match outcome push — do this first
You already store `user_history(status, resolved_at)` and have a scheduler. Nothing tells the user "your pick won". Closing the loop is what turns a tool into a relationship.

- Trigger: 10 min after full-time for fixtures in `user_history`
- Copy: result + running 30-day accuracy for that user
- Guardrail: one push per match, never a "you lost, buy more credits" follow-up
- Expected effect: highest of any change here; also makes your accuracy claim credible

### 4.2 Public accuracy profile (proof, not promises)
Replace the credits leaderboard with an **accuracy leaderboard** using `user_history` (min. 20 settled picks), and give each user a shareable `/accuracy` card.

- Removes the weakest legal exposure ("guaranteed wins") and replaces it with audited data
- OLBG built its entire brand on exactly this
- Also fixes the dead `users.win_rate` / `predictions_count` columns

### 4.3 Streak on *engagement*, not on betting
A "match-day streak" (opened the board / reviewed a pick) is safe. A streak on *amount staked* is not, and you should never build it.

- 3 / 7 / 14 / 30-day milestones → credits, never cash
- Streak freeze earned by referrals (Duolingo-style) — sources credit this with ~10% long-term retention lift
- Do **not** send "your streak is about to break" after 21:00

### 4.4 Referral loop inside the share card
`Analyze.tsx` shares `window.location.href` with no `?startapp=` parameter — every shared card currently loses the attribution.

- Append `?startapp=ref_<telegram_id>` to share links and card QR
- Double-sided reward, paid **on first payment**, not on signup (multi-account farming is trivial in Telegram)
- Budget: 10–20% of a bookmaker CPA (see `04-growth-and-affiliates.md`)

### 4.5 Tasks with a supply engine
The task system works and is verified properly — it's just admin-fed. Add recurring, self-serve tasks:

- Daily: open the board (1 credit), review one pick (1)
- Weekly: share a card (2), refer a payer (10)
- One-off: complete profile, set timezone, join channel (existing)

---

## 5. What NOT to build

| Tempting mechanic | Why not |
|---|---|
| Stake-based streaks / "bet more to keep your streak" | Direct loss-chasing incentive; banned ad framing in KE/NG |
| "You lost — top up and recover" push | Textbook harm; also the exact copy regulators cite |
| Countdown timers on odds | False urgency, and odds move anyway |
| Fake social proof ("Ahmed just won 50,000 ETB") | Unverifiable, and ARCON/BCLB treat it as misleading |
| Ad-watch rewards as cash-equivalent | Rewarded video eCPM in comparable regions is ~$1.5 → one view is worth ~$0.0015. Use ads to unlock an extra pick, never as a payout |
| Referral rewards on signup only | Telegram multi-accounting will drain the budget in days |

---

## 6. Ethical and legal guardrails (non-negotiable)

1. **18+ gate** at first open, stored server-side, not just a checkbox in the client.
2. **Responsible-gambling line** in every marketing asset: "Gambling is addictive. Play responsibly." + a local helpline.
3. **No outcome guarantees.** Current support copy already says "high-confidence"; keep "guaranteed", "sure odds", "easy money" out of all copy — these fail Kenya's BCLB guidelines (May 2025) and Nigeria's ARCON code (unified code from 1 Apr 2026).
4. **Kenya:** gambling ads need BCLB pre-approval and KFCB classification, no celebrity/influencer endorsement, licence number displayed.
5. **Nigeria:** ARCON pre-exposure vetting covers influencer and social creative; fines from ₦500k.
6. **Quiet hours** already default 22:00–08:00 — keep, and never override for "streak" or "win-back".
7. **Self-exclusion**: a `/pause` command that mutes all marketing for 30/90 days without deleting the account.
8. **Spend cap**: optional monthly cap on top-ups, surfaced in Profile.
9. **No dark-pattern cancellation**: cancellation must be ≤2 taps, same as purchase.

---

## 7. Metrics to instrument before launch

| Metric | Definition | Target (first 90 days) |
|---|---|---|
| D1 / D7 / D30 | App open | 35% / 18% / 8% (above sports-betting benchmark of 31/14.5/4.8) |
| Free→paid (D30) | Any payment / new users | 3–5% (hard paywall benchmark is 10.7%, freemium 2.1%) |
| Pick resolution rate | Settled picks / created picks | >70% (below this, your accuracy page is hollow) |
| Pushes per active user / week | Delivered notifications | 3–5 (more = mute risk) |
| K-factor | Invites × conversion | 0.4–0.7 |
| Referral fraud rate | Rewards clawed back | <5% |
| Power-user COGS | Top-decile AI cost / revenue | <35% |

---

## 8. Bottom line

Do **not** try to make this app more addictive in the casino sense. Make it **more useful and more credible** — outcome pushes, public accuracy, streaks on engagement, and an attributed share loop. That combination lifts D30 without crossing the line that gets a betting-adjacent product banned in Kenya or Nigeria.
