/**
 * Client for the country-aware pricing + payment-method APIs.
 *
 * Prices arrive already fixed in the user's local currency; the client never
 * converts from USD. If the catalog is disabled server-side (`enabled: false`)
 * the caller keeps rendering its existing plan cards, so switching prices on is
 * a single backend env var rather than a frontend deploy.
 */

export interface PlanOfferDto {
  id: string;
  name: string;
  /** Minor units of `currency` (santim, kobo, cents). */
  priceMinor: number;
  currency: string;
  interval: "free" | "day" | "week" | "month";
  durationDays: number;
  dailyAnalyses: number;
  monthlyAnalysesCap: number;
  maxBetSlipImages: number;
  picksUnlocked: number;
  features: string[];
  recurring: boolean;
  badge?: "popular" | "best_value";
  /** Telegram Stars price, already netted for Telegram's ~35% cut. */
  stars: number;
  /** Display-only USD approximation for the global card / TON rails. */
  usd: number;
}

export interface PaymentMethodDto {
  id: string;
  label: string;
  provider: string;
  supportsRecurring: boolean;
  priority: number;
  foreignEntityFriendly: boolean;
  notes?: string;
  available: boolean;
}

export interface PricingPayload {
  country: string;
  currency: string;
  enabled: boolean;
  taxNote: string;
  monetisationStatus: "open" | "restricted" | "grey";
  renewalCopy: string;
  offers: PlanOfferDto[];
  paymentMethods: PaymentMethodDto[];
  minorUnit: number;
  localizedCopy: Record<string, string>;
}

export interface LocationPayload {
  country: string;
  name: string;
  currency: string;
  monetisationStatus: string;
  wallets: string[];
  source: "override" | "phone" | "ip" | "language" | "default";
  phoneIso: string | null;
  selectable: Array<{ code: string; name: string; currency: string }>;
}

export interface PaymentMethodsPayload {
  country: string;
  currency: string;
  source: string;
  methods: PaymentMethodDto[];
  default: string;
  card: string | null;
  stars: boolean;
  ton: boolean;
  chapa: boolean;
}

const authHeaders = (initData?: string): Record<string, string> =>
  initData ? { "X-TG-Init-Data": initData } : {};

async function getJson<T>(url: string, initData?: string): Promise<T | null> {
  try {
    const response = await fetch(url, { headers: authHeaders(initData) });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export const fetchPricing = (initData?: string) =>
  getJson<PricingPayload>("/api/pricing", initData);

export const fetchLocation = (initData?: string) =>
  getJson<LocationPayload>("/api/location", initData);

export const fetchPaymentMethods = (initData?: string) =>
  getJson<PaymentMethodsPayload>("/api/payments/methods", initData);

/** Persist an explicit country choice (wins over phone and geo detection). */
export async function setUserCountry(
  country: string,
  initData?: string,
): Promise<boolean> {
  try {
    const response = await fetch("/api/location", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(initData) },
      body: JSON.stringify({ country }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Render a minor-unit amount in the user's currency.
 * Whole amounts drop the decimals ("ETB 499", not "ETB 499.00").
 */
export function formatMoney(priceMinor: number, currency: string): string {
  const amount = Number(priceMinor || 0) / 100;
  const whole = Number.isInteger(amount);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString()} ${currency}`;
  }
}

export function periodLabel(offer: Pick<PlanOfferDto, "interval" | "durationDays">): string {
  if (offer.interval === "free") return "forever";
  if (offer.durationDays === 1) return "1 day";
  if (!offer.durationDays) return offer.interval === "month" ? "30 days" : offer.interval === "week" ? "7 days" : "one pass";
  return `${offer.durationDays} days`;
}
