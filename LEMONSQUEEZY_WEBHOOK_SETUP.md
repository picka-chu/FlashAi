# Lemon Squeezy Webhook Setup (Flash AI)

This guide shows how to configure Lemon Squeezy payments end-to-end for this app.

## 1) Required environment variables

Set these in your deployment environment (Vercel/Render/etc):

```bash
LEMONSQUEEZY_API_KEY=your_api_key
LEMONSQUEEZY_STORE_ID=your_store_id
LEMONSQUEEZY_VARIANT_MONTHLY_BASIC=your_basic_variant_id
LEMONSQUEEZY_VARIANT_MONTHLY_PRO=your_pro_variant_id
LEMONSQUEEZY_WEBHOOK_SECRET=your_signing_secret
LEMONSQUEEZY_REDIRECT_URL=https://your-domain.com/?tab=profile
APP_URL=https://your-domain.com
```

## 2) Configure webhook in Lemon Squeezy dashboard

1. Open your Lemon Squeezy dashboard.
2. Go to **Settings → Webhooks**.
3. Add endpoint URL:
   - `https://your-domain.com/api/payments/lemonsqueezy-webhook`
4. Copy the **signing secret** and store it as `LEMONSQUEEZY_WEBHOOK_SECRET`.
5. Subscribe to at least these events:
   - `order_created`
   - `order_paid`
   - `subscription_payment_success`

## 3) Why this backend flow is production-safe

The backend implementation now:

- verifies webhook signatures using the **raw request body**;
- compares signatures with timing-safe equality checks;
- uses an idempotency guard (existing transaction lookup) to avoid duplicate credit grants;
- applies plan credits only after validated events;
- writes payment records to `transactions`.

## 4) Professional checkout UX recommendations

For best user experience in Telegram Mini Apps:

- keep checkout CTA text clear ("Continue to secure checkout");
- include one-line trust text near methods ("Encrypted payment processing");
- return users to profile/subscriptions after successful checkout via `LEMONSQUEEZY_REDIRECT_URL`;
- keep Stars / TON / Card options grouped in a single payment page (already implemented in `Profile.tsx`).

## 5) Quick verification checklist

- [ ] Open app profile → subscription → choose plan → bank card.
- [ ] Confirm checkout URL is created from `/api/payments/create-lemonsqueezy-checkout`.
- [ ] Complete a test payment in Lemon Squeezy.
- [ ] Confirm webhook returns `{ received: true }`.
- [ ] Confirm user plan/credits update in DB.
- [ ] Confirm one transaction row only (idempotency).

