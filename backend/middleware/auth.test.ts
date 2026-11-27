import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import {
  getTelegramUserFromInitData,
  getVerifiedTelegramUser,
  validateTelegramInitData,
} from "./auth.js";

const BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";

function buildInitData(params: Record<string, string>, botToken: string): string {
  const pairs = Object.entries(params)
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const search = new URLSearchParams({ ...Object.fromEntries(pairs), hash });
  return search.toString();
}

test("validateTelegramInitData accepts a fresh signed payload", () => {
  const authDate = String(Math.floor(Date.now() / 1000));
  const user = JSON.stringify({ id: 42, first_name: "Test" });
  const initData = buildInitData({ auth_date: authDate, user, query_id: "AA" }, BOT_TOKEN);
  assert.equal(validateTelegramInitData(initData, BOT_TOKEN), true);
});

test("validateTelegramInitData rejects tampered hash", () => {
  const authDate = String(Math.floor(Date.now() / 1000));
  const user = JSON.stringify({ id: 42, first_name: "Test" });
  const initData = buildInitData({ auth_date: authDate, user }, BOT_TOKEN);
  const tampered = initData.replace(/hash=[0-9a-f]+/, "hash=deadbeef");
  assert.equal(validateTelegramInitData(tampered, BOT_TOKEN), false);
});

test("validateTelegramInitData rejects missing bot token", () => {
  const authDate = String(Math.floor(Date.now() / 1000));
  const initData = buildInitData({ auth_date: authDate, user: "{}" }, BOT_TOKEN);
  assert.equal(validateTelegramInitData(initData, ""), false);
});

test("validateTelegramInitData rejects stale auth_date", () => {
  const stale = String(Math.floor(Date.now() / 1000) - 48 * 60 * 60);
  const user = JSON.stringify({ id: 7, first_name: "Old" });
  const initData = buildInitData({ auth_date: stale, user }, BOT_TOKEN);
  assert.equal(validateTelegramInitData(initData, BOT_TOKEN), false);
});

test("getVerifiedTelegramUser returns user only when signature is valid", () => {
  const authDate = String(Math.floor(Date.now() / 1000));
  const user = JSON.stringify({ id: 99, first_name: "Valid" });
  const initData = buildInitData({ auth_date: authDate, user }, BOT_TOKEN);
  const verified = getVerifiedTelegramUser(initData, BOT_TOKEN);
  assert.ok(verified);
  assert.equal(verified.id, 99);
  assert.equal(getVerifiedTelegramUser(initData + "x", BOT_TOKEN), null);
});

test("getTelegramUserFromInitData does not trust unsigned input by itself", () => {
  // Parser only; callers must validate first.
  const raw = `user=${encodeURIComponent(JSON.stringify({ id: 1 }))}&auth_date=1&hash=nope`;
  const parsed = getTelegramUserFromInitData(raw);
  assert.equal(parsed?.id, 1);
});
