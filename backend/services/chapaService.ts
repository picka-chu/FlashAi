import crypto from "crypto";

const CHAPA_API_BASE = (process.env.CHAPA_API_BASE || "https://api.chapa.global").replace(/\/+$/, "");
const CHAPA_MERCHANT_NAME = "Flash AI";
const RATE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_USD_ETB_RATE = 155;
const DEFAULT_RATE_BAND = 5;

export const isChapaEnabled = () => Boolean(String(process.env.CHAPA_SECRET_KEY || "").trim());

const digitsOnly = (value: unknown) => String(value ?? "").replace(/\D/g, "");

// Ethiopian mobile numbers: Ethio Telecom (9XXXXXXXX) and Safaricom (7XXXXXXXX),
// stored by the bot as +2519XXXXXXXX / +2517XXXXXXXX.
export function normalizeEthiopianPhone(value: unknown): string | null {
  let digits = digitsOnly(value);
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("251")) digits = digits.slice(3);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  if (!/^[79]\d{8}$/.test(digits)) return null;
  return `251${digits}`;
}

export const isEthiopianPhone = (value: unknown) => Boolean(normalizeEthiopianPhone(value));

export type ChapaPlanPrice = { usd: number; etb: number; amountCents: number };
export type ChapaPricing = { currency: "ETB"; rate: number; plans: Record<string, ChapaPlanPrice> };

let rateCache: { rate: number; expiresAt: number } | null = null;

async function fetchLiveUsdEtbRate(): Promise<number | null> {
  try {
    const response = await fetch("https://open.er-api.com/v6/latest/USD", {
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return null;
    const data: any = await response.json().catch(() => ({}));
    const rate = Number(data?.rates?.ETB);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

// The rate is banded (rounded to the nearest N birr per USD) and cached, so the
// displayed ETB price only changes when the market rate leaves its band. This
// keeps prices stable for days while still following the current rate.
export async function getUsdEtbRate(): Promise<number> {
  const override = Number(process.env.CHAPA_USD_ETB_RATE || 0);
  if (Number.isFinite(override) && override > 0) return override;

  if (rateCache && rateCache.expiresAt > Date.now()) return rateCache.rate;

  const fallbackEnv = Number(process.env.CHAPA_FALLBACK_USD_ETB_RATE || 0);
  const fallbackRate = Number.isFinite(fallbackEnv) && fallbackEnv > 0 ? fallbackEnv : DEFAULT_USD_ETB_RATE;
  const bandEnv = Number(process.env.CHAPA_USD_ETB_RATE_BAND || 0);
  const band = Number.isFinite(bandEnv) && bandEnv > 0 ? bandEnv : DEFAULT_RATE_BAND;

  const liveRate = await fetchLiveUsdEtbRate();
  const rawRate = liveRate || fallbackRate;
  const effectiveRate = Math.max(1, Math.round(rawRate / band) * band);

  rateCache = { rate: effectiveRate, expiresAt: Date.now() + RATE_CACHE_TTL_MS };
  return effectiveRate;
}

const roundEtbPrice = (amount: number) => Math.max(10, Math.ceil(amount / 10) * 10);

export async function getChapaPricing(usdPrices: Record<string, number>): Promise<ChapaPricing> {
  const rate = await getUsdEtbRate();
  const plans: Record<string, ChapaPlanPrice> = {};
  for (const [planId, usd] of Object.entries(usdPrices)) {
    const normalizedUsd = Number(usd);
    if (!Number.isFinite(normalizedUsd) || normalizedUsd <= 0) continue;
    const etb = roundEtbPrice(normalizedUsd * rate);
    plans[planId] = { usd: normalizedUsd, etb, amountCents: Math.round(etb * 100) };
  }
  return { currency: "ETB", rate, plans };
}

// Chapa merchant references are capped at 20 characters.
export function buildMerchantReference(telegramId: number, planId: string): string {
  const planCode = planId === "monthly_pro" ? "p" : planId === "monthly_basic" ? "b" : "x";
  const idPart = Math.abs(Math.trunc(Number(telegramId) || 0)).toString(36);
  const random = crypto.randomBytes(4).toString("hex");
  return `fa${idPart}${planCode}${random}`.slice(0, 20);
}

export type ChapaVerifyResult = {
  success: boolean;
  status: string;
  amountCents: number | null;
  currency: string;
  merchantReference: string;
  chapaReference: string;
};

export async function verifyChapaTransaction(reference: string): Promise<ChapaVerifyResult> {
  const secret = process.env.CHAPA_SECRET_KEY;
  if (!secret) {
    throw Object.assign(new Error("Chapa is not configured"), { code: "CHAPA_NOT_CONFIGURED" });
  }

  const response = await fetch(
    `${CHAPA_API_BASE}/v2/payments/${encodeURIComponent(reference)}/verify`,
    {
      headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    },
  );
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || `Chapa verification failed (${response.status})`);
  }

  const data = payload?.data || {};
  const amount = Number(data?.amount);
  return {
    success: String(data?.status || "").toUpperCase() === "SUCCESS",
    status: String(data?.status || "").toLowerCase(),
    amountCents: Number.isFinite(amount) ? amount : null,
    currency: String(data?.currency || "").toUpperCase(),
    merchantReference: String(data?.merchant_reference || data?.tx_ref || ""),
    chapaReference: String(data?.chapa_reference || data?.reference || data?.ref_id || ""),
  };
}

export type ChapaCheckoutParams = {
  telegramId: number;
  planId: string;
  planName: string;
  amountCents: number;
  phone: string;
  firstName: string;
  lastName: string;
  merchantReference: string;
};

export async function initializeChapaCheckout(
  params: ChapaCheckoutParams,
): Promise<{ checkoutUrl: string }> {
  const secret = process.env.CHAPA_SECRET_KEY;
  if (!secret) {
    throw Object.assign(new Error("Chapa is not configured"), { code: "CHAPA_NOT_CONFIGURED" });
  }

  const appUrl = (
    process.env.CHAPA_APP_URL ||
    process.env.APP_URL ||
    process.env.LEMONSQUEEZY_REDIRECT_URL ||
    "https://flash-6tuz.onrender.com"
  ).replace(/\/+$/, "");
  const callbackUrl = `${appUrl}/api/payments/chapa-webhook`;
  const returnUrl = process.env.CHAPA_RETURN_URL || appUrl;

  const response = await fetch(`${CHAPA_API_BASE}/v2/payments/hosted`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Idempotency-Key": params.merchantReference,
    },
    body: JSON.stringify({
      amount: params.amountCents,
      currency: "ETB",
      merchant_reference: params.merchantReference,
      customer: {
        first_name: params.firstName || CHAPA_MERCHANT_NAME,
        last_name: params.lastName || "AI",
        phone_number: params.phone,
      },
      callback_url: callbackUrl,
      return_url: returnUrl,
      meta: {
        telegram_id: String(params.telegramId),
        plan_id: params.planId,
        merchant_reference: params.merchantReference,
      },
      customization: {
        title: `${CHAPA_MERCHANT_NAME} — ${params.planName}`,
        description: `${params.planName} subscription (1 month)`,
      },
    }),
    signal: AbortSignal.timeout(15000),
  });

  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || `Chapa checkout failed (${response.status})`);
  }

  const checkoutUrl = String(payload?.data?.checkout_url || "");
  if (!checkoutUrl) throw new Error("Chapa did not return a checkout URL");
  return { checkoutUrl };
}

export function verifyChapaWebhookSignature(
  rawBody: string,
  signature: string | undefined | null,
  secret: string,
): boolean {
  if (!secret || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
