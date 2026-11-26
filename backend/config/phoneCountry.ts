/**
 * Phone-number → country detection.
 *
 * Telegram gives us a phone number only when the user shares their contact
 * card, and it arrives in one of several shapes:
 *   +251912345678 · 00251912345678 · 251912345678 · 0912345678
 *
 * The first three are unambiguous. The last is a national trunk number and is
 * only resolvable when we already know the country (a local "07…" exists in
 * Ethiopia, Kenya, Tanzania, Uganda and South Africa alike). We therefore
 * require a `hint` before trusting a trunk-format number.
 */

export interface PhoneCountry {
  /** ISO 3166-1 alpha-2, upper case. */
  iso: string;
  /** ITU calling code without the plus, e.g. "251". */
  callingCode: string;
  /** Best-effort E.164 string, e.g. "+251912345678". */
  e164: string;
}

/**
 * Calling codes. Longest-prefix match wins, so "+1" never shadows "+1…"
 * three-digit codes such as +212 (Morocco) or +234 (Nigeria).
 */
const CALLING_CODE_TABLE: Array<[string, string]> = [
  // Target markets
  ["251", "ET"], ["254", "KE"], ["234", "NG"], ["233", "GH"],
  ["255", "TZ"], ["256", "UG"], ["27", "ZA"],
  // Rest of Africa
  ["20", "EG"], ["212", "MA"], ["213", "DZ"], ["216", "TN"], ["218", "LY"],
  ["221", "SN"], ["222", "MR"], ["223", "ML"], ["224", "GN"], ["225", "CI"],
  ["226", "BF"], ["227", "NE"], ["228", "TG"], ["229", "BJ"], ["230", "MU"],
  ["231", "LR"], ["232", "SL"], ["235", "TD"], ["236", "CF"], ["237", "CM"],
  ["238", "CV"], ["239", "ST"], ["240", "GQ"], ["241", "GA"], ["242", "CG"],
  ["243", "CD"], ["244", "AO"], ["245", "GW"], ["248", "SC"], ["249", "SD"],
  ["250", "RW"], ["252", "SO"], ["253", "DJ"], ["257", "BI"], ["258", "MZ"],
  ["260", "ZM"], ["261", "MG"], ["262", "RE"], ["263", "ZW"], ["264", "NA"],
  ["265", "MW"], ["266", "LS"], ["267", "BW"], ["268", "SZ"], ["269", "KM"],
  ["290", "SH"], ["291", "ER"],
  // Middle East & Asia
  ["971", "AE"], ["966", "SA"], ["974", "QA"], ["973", "BH"], ["968", "OM"],
  ["962", "JO"], ["961", "LB"], ["964", "IQ"], ["963", "SY"], ["967", "YE"],
  ["970", "PS"], ["972", "IL"], ["880", "BD"], ["977", "NP"], ["94", "LK"],
  ["95", "MM"], ["98", "IR"], ["90", "TR"], ["91", "IN"], ["92", "PK"],
  ["60", "MY"], ["61", "AU"], ["62", "ID"], ["63", "PH"], ["64", "NZ"],
  ["65", "SG"], ["66", "TH"], ["81", "JP"], ["82", "KR"], ["84", "VN"],
  ["86", "CN"],
  // Europe & Americas
  ["1", "US"], ["7", "RU"], ["30", "GR"], ["31", "NL"], ["32", "BE"],
  ["33", "FR"], ["34", "ES"], ["36", "HU"], ["39", "IT"], ["40", "RO"],
  ["41", "CH"], ["43", "AT"], ["44", "GB"], ["45", "DK"], ["46", "SE"],
  ["47", "NO"], ["48", "PL"], ["49", "DE"], ["51", "PE"], ["52", "MX"],
  ["53", "CU"], ["54", "AR"], ["55", "BR"], ["56", "CL"], ["57", "CO"],
  ["58", "VE"],
];

/** Sorted longest-first so "251" is tested before "25". */
const CALLING_CODES = [...CALLING_CODE_TABLE].sort((a, b) => b[0].length - a[0].length);

const CODE_BY_ISO = new Map(CALLING_CODE_TABLE.map(([code, iso]) => [iso, code]));

/** Countries where a leading-0 trunk number is a normal thing to send us. */
const TRUNK_COUNTRIES = new Set(["ET", "KE", "NG", "GH", "TZ", "UG", "ZA"]);

export function digitsOnly(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * Detect the country behind a phone number.
 *
 * @param raw   Any of the shapes listed at the top of this file.
 * @param hint  A country we already trust (e.g. the user's saved preference).
 *              Required to resolve national trunk numbers such as "0912…".
 */
export function detectCountryFromPhone(raw: unknown, hint?: string | null): PhoneCountry | null {
  const original = String(raw ?? "").trim();
  if (!original) return null;

  let digits = digitsOnly(original);
  if (!digits) return null;

  // 00-prefixed international dialling.
  if (digits.startsWith("00")) digits = digits.slice(2);
  // Guard against absurd input (telephone numbers are <= 15 digits in E.164).
  if (digits.length > 15) return null;

  const looksInternational = original.startsWith("+") || original.startsWith("00");

  // National trunk format ("0912345678"): only resolvable with a hint.
  if (!looksInternational && digits.startsWith("0")) {
    const hinted = String(hint || "").trim().toUpperCase();
    const callingCode = CODE_BY_ISO.get(hinted);
    if (!callingCode || !TRUNK_COUNTRIES.has(hinted)) return null;
    const national = digits.replace(/^0+/, "");
    if (national.length < 7) return null;
    return { iso: hinted, callingCode, e164: `+${callingCode}${national}` };
  }

  for (const [callingCode, iso] of CALLING_CODES) {
    if (!digits.startsWith(callingCode)) continue;
    const national = digits.slice(callingCode.length);
    // A country code plus almost nothing is not a phone number.
    if (national.length < 6) continue;
    return { iso, callingCode, e164: `+${callingCode}${national}` };
  }

  // Bare national number with no plus and no leading zero - try the hint.
  const hinted = String(hint || "").trim().toUpperCase();
  const hintedCode = CODE_BY_ISO.get(hinted);
  if (hintedCode && digits.length >= 7) {
    return { iso: hinted, callingCode: hintedCode, e164: `+${hintedCode}${digits}` };
  }

  return null;
}

/** Last-resort boolean used by the Chapa eligibility check. */
export function isPhoneFrom(raw: unknown, iso: string): boolean {
  return detectCountryFromPhone(raw)?.iso === iso;
}
