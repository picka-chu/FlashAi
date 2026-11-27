import assert from "node:assert/strict";
import test from "node:test";
import {
  collectRecommendedProductionEnv,
  collectRequiredProductionEnv,
  validateProductionEnv,
} from "./envValidation.js";

function clearCriticalEnv() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.APP_URL;
  delete process.env.RENDER_EXTERNAL_URL;
  delete process.env.ADMIN_TELEGRAM_ID;
  delete process.env.ADMIN_ID;
  delete process.env.TELEGRAM_ADMIN_ID;
  delete process.env.ADMIN_USER_ID;
  delete process.env.BSD_API_KEY;
  delete process.env.BSD_FOOTBALL_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  delete process.env.GEMINI_PREDICTION_KEY_1;
  delete process.env.GEMINI_API_KEY_1;
}

test("collectRequiredProductionEnv reports missing critical vars", () => {
  clearCriticalEnv();
  const missing = collectRequiredProductionEnv();
  assert.ok(missing.includes("SUPABASE_URL"));
  assert.ok(missing.includes("SUPABASE_SERVICE_ROLE_KEY"));
  assert.ok(missing.includes("TELEGRAM_BOT_TOKEN"));
});

test("collectRequiredProductionEnv accepts configured critical vars", () => {
  clearCriticalEnv();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
  process.env.TELEGRAM_BOT_TOKEN = "123:token";
  assert.deepEqual(collectRequiredProductionEnv(), []);
});

test("validateProductionEnv throws in strict mode when required vars missing", () => {
  clearCriticalEnv();
  assert.throws(() => validateProductionEnv({ strict: true }), /CRITICAL/);
});

test("validateProductionEnv does not throw in non-strict mode", () => {
  clearCriticalEnv();
  const result = validateProductionEnv({ strict: false });
  assert.equal(result.ok, false);
  assert.ok(result.missing.length >= 3);
});

test("recommended warnings surface when optional launch vars are absent", () => {
  clearCriticalEnv();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
  process.env.TELEGRAM_BOT_TOKEN = "123:token";
  const warnings = collectRecommendedProductionEnv();
  assert.ok(warnings.some((w) => w.startsWith("APP_URL")));
  assert.ok(warnings.some((w) => w.startsWith("ADMIN_TELEGRAM_ID")));
  assert.ok(warnings.some((w) => w.startsWith("BSD_API_KEY")));
  assert.ok(warnings.some((w) => w.startsWith("GEMINI")));
});
