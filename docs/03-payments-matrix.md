# Payments — Country Matrix & Architecture

**Read the first section before integrating anything.** It is the constraint that shapes every other decision.

---

## 1. The blocker: Telegram's ToS

Telegram's Bot Platform Developer Terms §6.2 require that digital goods and services sold to users **be executed exclusively through the exchange of Telegram Stars**, and state that a TPA using alternative payment systems "may be made inaccessible from store versions of Telegram or terminate[d]". ✅ ([telegram.org/tos/bot-developers](https://telegram.org/tos/bot-developers), read 26 Nov 2026)

The Stars documentation adds: no crypto, no third-party providers — even if you also operate a website. ✅ ([core.telegram.org/bots/payments-stars](https://core.telegram.org/bots/payments-stars))

**What this means in practice**

| Where the payment happens | Status |
|---|---|
| Stars invoice inside the Mini App | ✅ Compliant, and the only fully-safe rail |
| Card/Chapa opened **inside** the Mini App webview | ❌ ToS violation; enforcement is inconsistent but real |
| A link that opens the **system browser** to your web checkout (`openLink`) | ⚠️ Grey. Outside the Mini App surface, but Telegram can still treat it as circumvention |
| Renewal reminder DM → web checkout | ⚠️ Same grey zone |

**Recommended posture:** Stars is the default and the fallback everywhere. Local rails are offered through an **external web checkout** opened in the system browser, clearly labelled as leaving Telegram. Keep a kill switch (`PAYMENTS_LOCAL_RAILS_ENABLED`) so you can turn local rails off in one deploy if Telegram ever enforces.

Do not put a card form inside the Mini App. That is the version that gets the app removed.

---

## 2. What you already have

From `.env.example` and `backend/server.ts`:

| Integration | Rail | Status |
|---|---|---|
| Chapa | ETB — Telebirr, CBE Birr, Amole, cards | Live webhook |
| Whop | Cards, global, MoR | Live webhook |
| Lemon Squeezy | Cards, global, MoR | Live webhook — **sunset** |
| Telegram Stars | XTR, all markets | Live |
| TON Connect | Crypto, TON only | Live |

**Actions:** remove Lemon Squeezy from the checkout (no new sign-ups; platform shuts 31 Mar 2027 ✅), and stop advertising TON in Ethiopia (negligible reach, adds support load).

---

## 3. Provider matrix

| Provider | Live markets | Local methods | Fee (indicative) | Settlement | Recurring | Gambling/tipster stance | Local entity needed |
|---|---|---|---|---|---|---|---|
| **Chapa** | ET (+ global USD) | Telebirr, CBE Birr, Amole, M-Pesa ET, cards | 2% local / 1% intl ⚠️ | ETB, ET bank only | ❌ | Not published; "illegal act" termination only ❓ | **Yes** |
| **Paystack** | NG, GH, KE, ZA | Cards, transfer, USSD, MoMo | 1.5% + ₦100 (cap ₦2,000) NG ✅ | Local ccy, T+1 | ✅ tokens | **Yes** — runs a betting vertical ✅ | Yes (local co.) |
| **Flutterwave** | NG, GH, KE, ZA, TZ, UG | Cards, MoMo, transfer | 2.0–4.8% by market ✅ | Local ccy | ✅ tokens | Betting = pre-approval; internet gambling prohibited ✅ | Yes |
| **Pesapal** | KE, TZ, UG, RW, ZM, MW | Cards, M-Pesa, Airtel | ~3.5% ⚠️ | Local ccy | Limited | Case-by-case | Yes |
| **M-Pesa Daraja** | KE | STK push, Ratiba | Tariff | KE only | Ratiba ⚠️ | Licensed operators only | Yes (paybill) |
| **Whop** | Global | Cards, crypto | ~3% + processing ⚠️ | USD | ✅ | Gambling prohibited ⚠️ | No (MoR) |
| **Telegram Stars** | All | XTR | ~35% effective ✅ | TON via Fragment, 21-day hold | ❌ | Mandated rail | No |
| **Stripe** | NG/GH/KE/ZA via Paystack network only | Cards | 2.9%+ | Local entity | ✅ | Gambling prohibited | Yes |
| **Lemon Squeezy** | — | — | — | — | — | **Dead: shuts 31 Mar 2027** ✅ | No |

✅ = documented on the provider's own site · ⚠️ = third-party or indicative · ❓ = not published

---

## 4. Per-country decision

### 🇪🇹 Ethiopia — Chapa only
- No Stripe, no PayPal, no Paystack, no Flutterwave. ✅
- Requires an **Ethiopian registered merchant** and an ETB settlement account. A foreign entity cannot onboard. ✅
- KYC: business licence, TIN, MoA, proof of address, owner ID — days to weeks, manual review. ✅
- **No auto-renew.** Telebirr autopay is undocumented ❓. Treat every ETB sale as a 30-day pass.
- **Risk:** the category. Pitch as *sports data subscription*. Have a written answer ready for "is this gambling?" — you sell analysis, you never take a stake, you never hold winnings.
- **Do not** build an Ethiopian bookmaker affiliate funnel. There are no licensed operators. ✅

### 🇳🇬 Nigeria — Paystack primary, OPay fallback
- Cheapest rail (1.5% capped at ₦2,000), T+1, and the only PSP with a public betting vertical. ✅
- Cards, bank transfer, USSD, Visa QR, Apple/Google Pay, OPay/PalmPay wallets. ✅
- Recurring works (card tokenisation), but you are selling passes — use it for reminders, not silent charges.
- Needs a CAC-registered Nigerian entity and NGN corporate account. ✅
- **Best market to launch paid first.**

### 🇰🇪 Kenya — Flutterwave or Pesapal
- M-Pesa is the market: 40m monthly actives, 89% of mobile-money accounts. ✅
- Flutterwave gives M-Pesa + card in one API at 2.9% mobile money / 3.2% local cards. ✅
- M-Pesa STK push is one-time. Ratiba standing orders exist but commercial terms are ❓.
- Regulatory status is fluid: Gambling Control Act 2025 replaced BCLB with the GRA; the 2026 Licensing Regulations were **suspended by the High Court on 20 Jul 2026**; a 20% excise on winnings started 1 Jul 2026. ✅
- **Ad copy must be pre-approved** (BCLB/GRA) and classified. No celebrity endorsement, no "quick wealth" framing, display "Gambling is addictive. Play responsibly." + 18+ + licence number. ✅

### 🇬🇭 Ghana — Paystack or Flutterwave
- MTN MoMo dominant (19.3m users ✅); MoMo-first checkout, cards secondary.
- Needs a Ghanaian company and a Bank of Ghana-licensed PSP. ✅
- Gaming Commission licence required for betting operators; pure analytics usually classed as content — confirm with the PSP before launch ❓.

### 🇹🇿 Tanzania — Flutterwave or Pesapal
- No Stripe, no Paystack. Mobile money everywhere (80.98m subscriptions ✅).
- Local entity + local settlement. Recurring is effectively one-time. ✅
- All advertising needs Gaming Board approval. ✅

### 🇺🇬 Uganda — Flutterwave or Pesapal
- Local entity required; MTN MoMo / Airtel Money.
- **Age floor is 25** since Jul 2026 (not 18) — your age gate must be per-country. ✅
- New master licences frozen since 2019, so operator partnerships are closed. ✅

### 🇿🇦 South Africa — Paystack ZA, Ozow for EFT
- Cards, Instant EFT, Apple/Google Pay. No mobile money. ✅
- Best recurring support in the region (card tokens + DebiCheck). ✅
- Only market that can carry a $5+ tier.

---

## 5. Recommended architecture

```
                       ┌──────────────────────────────┐
   Telegram Mini App → │  Purchase sheet              │
                       │  1. Pay with Telegram Stars  │  ← compliant default
                       │  2. Pay with <local rail>  ↗ │  ← opens system browser
                       └──────────────────────────────┘
                                     │
                    ┌────────────────┴─────────────────┐
                    ▼                                  ▼
        Stars invoice (sendInvoice)        Web checkout (Chapa/Paystack/
        pre_checkout_query → answer        Flutterwave) with signed state
        successful_payment → credit        webhook → verify → credit
                    │                                  │
                    └──────────────┬───────────────────┘
                                   ▼
                    payments table (idempotent by provider ref)
                    → grant pass (plan, days, cap)
                    → notification + receipt
```

**Rules that prevent the classic bugs:**

1. **Idempotency.** You already have `processed_transactions` and `payment_intents`. Every webhook must insert-or-ignore on `(provider, provider_ref)` before granting access.
2. **Verify server-side.** Never trust a client `success` callback. Chapa has a verify endpoint; Paystack/Flutterwave have `/verify/:reference`. Confirm amount **and** currency **and** plan before granting.
3. **Grant by pass, not by month.** `pass_started_at`, `pass_expires_at`, `pass_analyses_cap`, `pass_analyses_used`.
4. **One receipt per payment**, in the user's language, with the expiry date.
5. **Reconcile daily.** Pull the provider's settlement report and diff against `transactions`. Discrepancies are either fraud or lost revenue; both compound.
6. **Refund path.** Stars has `refundStarPayment` (deducted from your balance) ✅; card rails have a dashboard refund and a chargeback window. Publish a refund policy: unused pass, 48 hours, one per user.

---

## 6. Fees and net revenue

On a 499 ETB Basic sale:

| Rail | Gross | Fee | Net | Notes |
|---|---|---|---|---|
| Chapa (Telebirr) | 499 ETB (~$3.09) | ~2% | ~$3.03 | + VAT handling |
| Paystack NG | ₦3,990 (~$2.92) | 1.5% + ₦100 | ~$2.80 | cap helps at scale |
| Flutterwave KE (M-Pesa) | KES 399 (~$3.07) | 2.9% | ~$2.98 | |
| Telegram Stars | 240 ⭐ | ~35% | $3.12 | user pays ~$4.78 |
| Whop | $6.99 | ~3% + processing | ~$6.60 | MoR handles VAT |

Gateway fees are small next to AI cost. Do not optimise the 1.5% before you optimise the 35%.

---

## 7. Launch checklists

### Nigeria (first)
- [ ] CAC entity + NGN corporate account
- [ ] Paystack account, business verification, live keys
- [ ] `PAYSTACK_SECRET_KEY`, webhook URL + signature check
- [ ] Plan IDs mapped to `marketPricing` (₦500 / ₦1,500 / ₦3,990 / ₦7,900)
- [ ] `/terms`, `/privacy`, `/refunds`, `/paysupport` handlers (Telegram requires these)
- [ ] Receipt template + reconciliation job
- [ ] ARCON-compliant creative: 18+, helpline, no guarantees

### Kenya (second)
- [ ] Flutterwave or Pesapal account + KES settlement
- [ ] M-Pesa STK push tested on a real handset
- [ ] Ad pre-approval submitted; compliant copy live
- [ ] Graceful fallback to Stars if STK fails twice

### Ethiopia (keep free, prep paid)
- [ ] Chapa merchant application submitted as "sports data subscription"
- [ ] ETB fixed prices loaded (59 / 199 / 499 / 999)
- [ ] Written compliance answer: "we do not accept stakes, hold winnings, or facilitate bets"
- [ ] Stars enabled as fallback

---

## 8. Fraud and abuse

| Vector | Control |
|---|---|
| Webhook replay | Idempotency key + signature + timestamp window |
| Amount tampering | Server-side price lookup by plan ID, never trust client amount |
| Currency confusion | Verify `currency` matches the market's expected currency |
| Referral farming | Reward on **first paid** pass, not signup; cap per device/user |
| Chargeback abuse (cards) | Grant on `captured`, revoke on `chargeback`; keep a risk list |
| Stars refund abuse | `refundStarPayment` is deducted from balance — require reason, limit frequency |

---

## 9. What to remove

| Remove | Why |
|---|---|
| Lemon Squeezy checkout | No new sign-ups; shuts 31 Mar 2027 ✅ |
| TON in ET / KE / NG checkout | ~0 reach, real support cost, and it is a ToS grey area inside Mini Apps |
| Any card form rendered inside the Mini App | ToS violation risk |
| "Auto-renewing subscription" wording on one-time rails | Refund/chargeback driver |
