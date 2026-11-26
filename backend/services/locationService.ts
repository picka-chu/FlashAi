/**
 * Decides which market a request belongs to.
 *
 * Trust order (highest first):
 *   1. `override`   - the user explicitly picked a country in the UI.
 *   2. `phone`      - the number from their Telegram contact card.
 *   3. `ipCountry`  - CF-IPCountry / x-vercel-ip-country.
 *   4. `languageCode` - a weak signal, only used where unambiguous.
 *   5. GLOBAL
 *
 * IP is deliberately ranked below the phone: VPNs are common, and a user's
 * payment rail should follow the wallet they actually hold.
 */

import { MARKETS, parseCountry, type CountryCode } from "../config/marketPricing.js";
import { detectCountryFromPhone } from "../config/phoneCountry.js";

export type CountrySource = "override" | "phone" | "ip" | "language" | "default";

export interface ResolvedCountry {
  country: CountryCode;
  source: CountrySource;
  /** ISO country from the phone number, even when it is not a target market. */
  phoneIso?: string;
}

/**
 * Language is a poor proxy for country, so only map languages that are
 * effectively unambiguous inside our footprint.
 */
const LANGUAGE_COUNTRY: Record<string, CountryCode> = {
  am: "ET",
  sw: "TZ",
  yo: "NG",
  ig: "NG",
  ha: "NG",
  ak: "GH",
  tw: "GH",
  ee: "GH",
  zu: "ZA",
  af: "ZA",
  xh: "ZA",
  lg: "UG",
  ny: "UG",
};

function isoToMarket(iso: string): CountryCode {
  return parseCountry(iso) ?? "GLOBAL";
}

export function resolveCountry(input: {
  override?: string | null;
  phone?: string | null;
  ipCountry?: string | null;
  languageCode?: string | null;
  hint?: string | null;
}): ResolvedCountry {
  const override = parseCountry(input.override);
  if (override) return { country: override, source: "override" };

  const phone = detectCountryFromPhone(input.phone, input.hint);
  if (phone) {
    return { country: isoToMarket(phone.iso), source: "phone", phoneIso: phone.iso };
  }

  const ip = parseCountry(input.ipCountry);
  if (ip) return { country: ip, source: "ip" };

  const language = String(input.languageCode || "").toLowerCase().split("-")[0];
  const byLanguage = LANGUAGE_COUNTRY[language];
  if (byLanguage) return { country: byLanguage, source: "language" };

  return { country: "GLOBAL", source: "default" };
}

/** Read a country hint from proxy headers (Cloudflare, Vercel, or a custom one). */
export function countryFromHeaders(headers: {
  get(name: string): string | undefined;
}): string | null {
  return (
    headers.get("cf-ipcountry") ||
    headers.get("x-vercel-ip-country") ||
    headers.get("x-country-code") ||
    null
  );
}

export interface MarketSummary {
  country: CountryCode;
  name: string;
  currency: string;
  monetisationStatus: string;
  wallets: string[];
  source: CountrySource;
}

export function summariseCountry(resolved: ResolvedCountry): MarketSummary {
  const market = MARKETS[resolved.country];
  return {
    country: market.code,
    name: market.name,
    currency: market.currency,
    monetisationStatus: market.monetisationStatus,
    wallets: market.wallets,
    source: resolved.source,
  };
}

/** Countries the user can switch to explicitly. */
export const SELECTABLE_COUNTRIES = Object.values(MARKETS)
  .filter((market) => market.code !== "GLOBAL")
  .map((market) => ({ code: market.code, name: market.name, currency: market.currency }));
