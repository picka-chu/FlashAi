/**
 * Production environment validation for Flash AI (private SaaS).
 *
 * Development remains permissive so local work is not blocked.
 * Production fails fast when critical secrets are missing or look like placeholders.
 */

const PLACEHOLDER_RE =
  /^(YOUR_|CHANGE_ME|TODO|xxx|placeholder|null|undefined)/i;

function isBlankOrPlaceholder(value: string | undefined | null): boolean {
  const v = String(value ?? "").trim();
  if (!v) return true;
  if (PLACEHOLDER_RE.test(v)) return true;
  if (v === "YOUR_SUPABASE_URL" || v === "YOUR_SUPABASE_SERVICE_ROLE_KEY") return true;
  return false;
}

function firstEnv(...names: string[]): string {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

export type EnvValidationResult = {
  ok: boolean;
  missing: string[];
  warnings: string[];
};

/**
 * Required for any process that authenticates Telegram users or serves the API.
 */
export function collectRequiredProductionEnv(): string[] {
  const missing: string[] = [];

  if (isBlankOrPlaceholder(process.env.SUPABASE_URL)) {
    missing.push("SUPABASE_URL");
  }

  const serviceRole = firstEnv(
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_ROLE",
    "SUPABASE_SERVICE_KEY",
  );
  if (isBlankOrPlaceholder(serviceRole)) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }

  if (isBlankOrPlaceholder(process.env.TELEGRAM_BOT_TOKEN)) {
    missing.push("TELEGRAM_BOT_TOKEN");
  }

  return missing;
}

/**
 * Optional but recommended for a real public launch. Missing values warn only.
 */
export function collectRecommendedProductionEnv(): string[] {
  const warnings: string[] = [];

  if (isBlankOrPlaceholder(process.env.APP_URL) && isBlankOrPlaceholder(process.env.RENDER_EXTERNAL_URL)) {
    warnings.push("APP_URL (or RENDER_EXTERNAL_URL)");
  }

  if (isBlankOrPlaceholder(process.env.ADMIN_TELEGRAM_ID) &&
      isBlankOrPlaceholder(process.env.ADMIN_ID) &&
      isBlankOrPlaceholder(process.env.TELEGRAM_ADMIN_ID) &&
      isBlankOrPlaceholder(process.env.ADMIN_USER_ID)) {
    warnings.push("ADMIN_TELEGRAM_ID");
  }

  const hasFootballKey =
    !isBlankOrPlaceholder(process.env.BSD_API_KEY) ||
    !isBlankOrPlaceholder(process.env.BSD_FOOTBALL_API_KEY);
  if (!hasFootballKey) {
    warnings.push("BSD_API_KEY (or BSD_FOOTBALL_API_KEY)");
  }

  const hasGemini =
    !isBlankOrPlaceholder(process.env.GEMINI_API_KEY) ||
    !isBlankOrPlaceholder(process.env.GOOGLE_AI_API_KEY) ||
    !isBlankOrPlaceholder(process.env.GEMINI_PREDICTION_KEY_1) ||
    !isBlankOrPlaceholder(process.env.GEMINI_API_KEY_1);
  if (!hasGemini) {
    warnings.push("GEMINI_API_KEY (or GEMINI_PREDICTION_KEY_1 / GEMINI_API_KEY_1)");
  }

  return warnings;
}

export function validateProductionEnv(options?: {
  /** When true, throw if required vars are missing. Defaults to NODE_ENV === "production". */
  strict?: boolean;
}): EnvValidationResult {
  const strict =
    options?.strict ??
    String(process.env.NODE_ENV || "").toLowerCase() === "production";

  const missing = collectRequiredProductionEnv();
  const warnings = collectRecommendedProductionEnv();

  for (const w of warnings) {
    console.warn(`[env] Recommended production variable not set: ${w}`);
  }

  if (missing.length > 0) {
    const message =
      `CRITICAL: Missing required environment variables: ${missing.join(", ")}. ` +
      "Set them in the host environment (never commit secrets). " +
      "See .env.example and PRODUCTION_CHECKLIST.md.";
    if (strict) {
      throw new Error(message);
    }
    console.error(`[env] ${message}`);
  }

  return {
    ok: missing.length === 0,
    missing,
    warnings,
  };
}
