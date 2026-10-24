import crypto from "crypto";

/**
 * Maximum accepted age of Telegram WebApp initData. Telegram recommends
 * rejecting stale data; we default to 24 hours and allow override via env.
 */
const DEFAULT_MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;

function getMaxInitDataAgeSeconds(): number {
  const raw = Number(process.env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return DEFAULT_MAX_INIT_DATA_AGE_SECONDS;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Validates Telegram WebApp initData using the official HMAC scheme and
 * enforces a maximum age to prevent replay attacks.
 */
export function validateTelegramInitData(initData: string, botToken: string): boolean {
  if (!initData || !botToken) return false;

  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get("hash");
    if (!hash) return false;

    // Reject stale/replayed initData.
    const authDateRaw = urlParams.get("auth_date");
    const authDate = Number(authDateRaw);
    if (!authDateRaw || !Number.isFinite(authDate) || authDate <= 0) return false;
    const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
    if (ageSeconds > getMaxInitDataAgeSeconds() || ageSeconds < -300) return false;

    urlParams.delete("hash");

    const dataCheckString = Array.from(urlParams.entries())
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join("\n");

    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();

    const calculatedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    return safeEqual(calculatedHash, hash);
  } catch (err) {
    console.error("InitData validation error:", err);
    return false;
  }
}

/**
 * Parses the Telegram user payload. The caller MUST have validated the
 * initData with validateTelegramInitData before trusting this result.
 */
export function getTelegramUserFromInitData(initData: string): any {
  try {
    const params = new URLSearchParams(initData);
    const userStr = params.get("user");
    return userStr ? JSON.parse(userStr) : null;
  } catch {
    return null;
  }
}

/**
 * Convenience helper: validate initData and return the Telegram user in one
 * call, or null when the payload is invalid.
 */
export function getVerifiedTelegramUser(initData: string | null | undefined, botToken: string): any | null {
  if (!initData) return null;
  if (!validateTelegramInitData(initData, botToken)) return null;
  const user = getTelegramUserFromInitData(initData);
  if (!user || typeof user.id !== "number") return null;
  return user;
}
