# Growth: Referrals, Tasks & Bookmaker Affiliates

**Premise:** the app already has the plumbing — a referral table, a verified task system, four notification loops, share cards and a leaderboard. None of it compounds, because nothing is attributed and nothing pays enough to matter. This document fixes that.

---

## 1. Where you actually are

| Lever | Exists? | Verdict |
|---|---|---|
| Referral tracking (`referrals` table) | ✅ | Works, but pays **2 credits** — invisible |
| Share cards (`Analyze.tsx`) | ✅ | Beautiful, but shares `window.location.href` with **no `?startapp=ref_…`** — every share is unattributed |
| Task system (`tasks`, `user_tasks`, `claim_task_reward`) | ✅ | Properly verified, but admin-fed and one-off |
| Leaderboard (`routes/leaderboard.ts`) | ✅ | Ranks by **credits**, not accuracy — meaningless |
| Notification loops | ✅ | Daily fixtures, news, live alerts, weekly recap, win-back |
| Public accuracy | ❌ | Columns `win_rate`, `predictions_count` exist and are unused |
| Bookmaker affiliate | ❌ | Nothing |

**Benchmarks to beat** (verified sources):
- Consumer K-factor is typically **0.3–0.7**; ~0.5 is "very strong". Double-sided rewards lift K by 40–60%. ✅
- Median subscription funnel: 5–7% install→trial, 32% trial→paid, **2.0% install→paid by D35**; hard paywall 10.7% vs freemium 2.1%. ✅
- 55.4% of 3-day-trial cancellations happen on **day 0** — instant value beats a trial. ✅
- Sports betting D1/D7/D30 = **31.0% / 14.5% / 4.8%**; sports apps 25.6 / 14.6 / 6.0. D30 fell from 8.1% a year ago — the category's habit is weakening. ✅

---

## 2. Referral programme

### Design

| Element | Decision | Why |
|---|---|---|
| Reward trigger | **Referee's first paid pass** | Telegram multi-accounting makes signup rewards worthless |
| Referrer reward | **30% of the referee's first payment**, paid as credits | Self-funding: you pay from cash you already received |
| Referee reward | **3 bonus analyses on day 1** | Immediate value, no cash out |
| Cap | 10 rewarded referrals / user / month | Stops farms |
| Clawback | Reward reverses if the payment is refunded or charged back within 14 days | Protects margin |
| Attribution | `?startapp=ref_<telegram_id>` in every share link + `start_param` read at launch | Currently missing |

At a ₦3,990 Basic sale, 30% = ₦1,197 of credits. Your cost of goods on those credits at 40 analyses ≈ $1.00, so the discount is honest, not a giveaway.

### Why 30% and not a flat bonus
A flat "50 ETB for a friend" is either too small to matter or too large to sustain. A percentage scales with the value created and never exceeds a known unit cost.

### K-factor model

Assume 3% of new users become payers, 15% of payers refer, average 1.6 successful referrals each:

```
K = (share who refer) × (referrals each) × (referee → payer rate)
  = 0.15 × 1.6 × 0.03
  = 0.007   ← terrible
```

The lever is **not** the reward — it is the *share rate*. A 15% share rate suits a utility; a betting-adjacent product has a natural bragging loop (winning picks). Adding the outcome push (§4.1 of doc 05) and a shareable result card is what moves K, because the user has a reason to share *at the moment it worked*.

Realistic target after those changes: share rate 35%, 1.8 referrals, 6% referee→payer → **K ≈ 0.38**. That is a strong consumer number and cuts blended CAC by roughly a third.

### Implementation

1. `Analyze.tsx:422` — append the referral param:

```ts
const ref = String(user?.telegram_id ?? "");
const link = `${window.location.origin}${window.location.pathname}?startapp=ref_${ref}`;
tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodedMsg}`);
```

2. On launch, read `Telegram.WebApp.initDataUnsafe.start_param`, parse `ref_<id>`, store it in `sessionStorage` until signup completes.
3. On signup, insert into `referrals` with `reward_given = false`.
4. On first successful payment webhook, set `reward_given = true` and credit the referrer — **inside the same transaction** as the pass grant.
5. Add a `reward_amount` that reflects 30% of the payment, not the current default of 50.

> `referrals.reward_amount` already defaults to 50 with `CHECK (>= 0)`, and `REFERRAL_REWARD_CREDITS` defaults to 2. Both need to become computed values.

---

## 3. Tasks — turn a one-off into a habit

Today tasks are admin-created and mostly one-off ("join channel"). That produces a burst then nothing. Add a **recurring, self-serve catalogue**:

| Cadence | Task | Reward | Verified by |
|---|---|---|---|
| Daily | Open the board | 1 credit | Server timestamp on `/api/fixtures` |
| Daily | Review one pick (open detail) | 1 credit | `/api/analysis/:id` view |
| Daily | Set your timezone | 2 credits (once) | profile update |
| Weekly | Share a prediction card | 2 credits | share event + min 1 click |
| Weekly | Complete 3 analyses | 3 credits | `usage_logs` |
| Monthly | Refer a **paying** friend | 30% of their first payment | payment webhook |
| One-off | Complete profile | 2 credits | profile fields |
| One-off | Join the channel | 2 credits | existing verification |

**Do not add:** "watch an ad for credits". Rewarded-video eCPM in comparable lower-ARPU regions is ~$1.19–3.82 per 1,000 impressions ✅, i.e. **~$0.0015 per view** — a tenth of a cent. Use ads to unlock an extra *pick*, never as a reward currency.

**Keep the existing verification.** `claim_task_reward` is the right pattern; extend it with a `task_key` + cadence column rather than trusting the client.

---

## 4. Bookmaker affiliates — yes, but on your terms

### 4.1 What the programmes actually pay

| Brand | Model | Rate | Min payout | Notes |
|---|---|---|---|---|
| **1xBet (1xPartners)** | RevShare / CPA / hybrid | **15–45% RevShare**, CPA negotiated | $30, weekly (Tue) | Negative carryover applies ✅ |
| **Melbet** | CPA / RevShare / Hybrid | up to **40%** quoted | ~$30 weekly ⚠️ | **Telegram explicitly accepted**; Africa desk covers KE, GH, TZ, UG, ET ✅ |
| **Betway Africa** | RevShare tiered + CPA | **25–40%**, CPA $50–100 ⚠️ | €50 e-wallet | Lifetime revenue; 10% rate if no new players in 90 days ⚠️ |
| **Betwinner** | RevShare / CPA | **25–40%** | ~$30 weekly ⚠️ | Lifetime revshare |
| **Bet9ja** | RevShare only | **20%** | ₦1,000 / $500 | 30-day cookie; no CPA ⚠️ |
| **SportPesa** | RevShare tiered | 20–35% | monthly | Programme reported "temporarily unavailable" ⚠️ |

**No Africa CPA rate is published by any of them.** The only figures are third-party: Betwinner "US$10–20 for Africa" vs $40–50 for Turkey/Morocco ⚠️; Betway $50–100 ⚠️. Plan on **US$10–25 CPA for NG/KE traffic** but **negotiate RevShare** — it is better documented and compounds.

### 4.2 Revenue model

10,000 MAU, 8% click an affiliate link, 25% of clickers register, 35% of registrants deposit, NGR per depositor $25/month, 30% revshare:

```
10,000 × 8% = 800 clicks
800 × 25% = 200 registrations
200 × 35% = 70 depositors
70 × $25 × 30% = $525 / month
```

Roughly **half of subscription revenue** at that scale, and it grows as depositors stay. It is worth doing properly.

### 4.3 Compliance — this is where affiliates get you banned

| Market | Rule | What you must do |
|---|---|---|
| **Kenya** | Gambling ads need **BCLB/GRA pre-approval** and KFCB classification; celebrity/influencer endorsement banned; no "quick wealth" messaging; must display "Gambling is addictive! Play responsibly!", 18+, licence number ✅ | Get each creative approved before it runs. No tipster testimonials. |
| **Nigeria** | **ARCON** pre-exposure vetting covers influencer and social creative; 18+, helpline, licence number; "guaranteed", "sure odds", "easy money" fail the code; fines from ₦500k ✅ | Vet every affiliate post. Use Gamble Alert helpline. |
| **UK benchmark (ASA/CAP §16)** | Affiliates are covered as third parties; implying gambling solves financial problems is banned; "guaranteed profit" tipster ads have been suspended ✅ | Apply the same standard globally — it is the safest common denominator. |
| **Ethiopia** | No licensed operators at all ✅ | **No affiliate programme.** Nothing lawful to link to. |
| **Uganda** | Age floor 25; NLGRB rules ✅ | 25+ gate for UG affiliate content. |

**Non-negotiable disclosure:** a permanent line under every affiliate placement — *"We may earn a commission if you sign up through this link. 18+. Gambling is addictive. Play responsibly."* No disclosure rule is explicit in the Kenyan/Nigerian instruments beyond ad approval ❓, but the UK standard plus basic consumer law makes it the safe default.

### 4.4 Product rules for the affiliate surface

1. **Never inside the analysis result.** The moment you recommend a bet and then earn from where it is placed, your analysis is no longer independent. That destroys the only thing you are selling.
2. Put affiliates in a separate **"Where to play"** tab with a clear divider and disclosure.
3. **Only licensed operators**, matched to the user's country. If there is no licensed operator (ET), show nothing.
4. **Never gate the analysis behind a signup** at a bookmaker.
5. Track with `subid = <telegram_id>` so you can reconcile and pay referral bonuses if you choose.
6. Store clicks in a new `affiliate_clicks` table (`telegram_id`, `brand`, `subid`, `created_at`) — you need this to audit payouts.

### 4.5 Deal negotiation script (use this)

> "We run a Telegram Mini App with N monthly active football users in Nigeria and Kenya, 70% aged 18–34, with verified intent — they upload bet slips. We want RevShare with **no negative carryover**, 30-day attribution, weekly payouts, and a dedicated subid parameter. We will not run CPA-only. We can start in Nigeria in two weeks."

Ask for: no negative carryover, 30-day cookie, subid support, weekly payout, and a written compliance guide for KE/NG creative.

---

## 5. The trust loop that pays for all of it

Everything above converts better if the product is *credible*. Two things make it credible and neither exists yet:

1. **Post-match outcome push** — "Your pick won. 8 of your last 12 correct." You already store `user_history(status, resolved_at)`.
2. **Public accuracy page** — settled picks, strike rate, sample size. Replace the credits leaderboard (`routes/leaderboard.ts`) with an accuracy leaderboard (min. 20 settled picks) and fix the dead `users.win_rate` / `predictions_count` columns.

OLBG built a category on exactly this: public, per-pick settlement history instead of screenshots ✅. It also removes your biggest legal exposure — you stop *claiming* accuracy and start *showing* it.

---

## 6. 90-day growth plan

| Weeks | Focus | Success measure |
|---|---|---|
| 1–2 | Referral attribution (`startapp` param), outcome push, accuracy page v1 | 100% of shares attributed |
| 3–4 | Double-sided referral live; 30% reward on first payment; fraud caps | K ≥ 0.15 |
| 5–6 | Recurring task catalogue; replace credits leaderboard | D7 +2 pts |
| 7–8 | Affiliate tab + 1xPartners/Melbet application; disclosure | First affiliate payment |
| 9–10 | Nigeria paid launch funnel: day pass → 7-day → Basic | 3% free→paid |
| 11–12 | Kenya launch; A/B day-pass price; referral iteration | K ≥ 0.3, D30 ≥ 6% |

---

## 7. Metrics to instrument before spending a cedi

| Metric | Definition | Target (90 days) |
|---|---|---|
| D1 / D7 / D30 | App open | 35% / 18% / 8% |
| Free→paid D30 | Any payment / new users | 3–5% |
| K-factor | Invites × referee conversion | 0.4–0.7 |
| Referral fraud rate | Rewards clawed back | <5% |
| Share rate | Sharers / weekly actives | ≥30% |
| Pick resolution rate | Settled / created | >70% |
| Pushes per active user / week | Delivered | 3–5 |
| Affiliate EPC | Revenue / click | >$0.10 |

Add `screen_view`, `share_clicked`, `checkout_opened`, `checkout_completed`, `pass_expired` to `usage_logs`. Without these you cannot tell a pricing problem from a product problem.
