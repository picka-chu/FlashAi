import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryRateLimiter } from "./rateLimit.js";

test("allows traffic under the configured max", () => {
  const limiter = new InMemoryRateLimiter(60_000, 3, 60_000);
  assert.equal(limiter.isRateLimited("user:1"), false);
  assert.equal(limiter.isRateLimited("user:1"), false);
  assert.equal(limiter.isRateLimited("user:1"), false);
});

test("blocks the request that exceeds max in the window", () => {
  const limiter = new InMemoryRateLimiter(60_000, 2, 60_000);
  assert.equal(limiter.isRateLimited("ip:a"), false);
  assert.equal(limiter.isRateLimited("ip:a"), false);
  assert.equal(limiter.isRateLimited("ip:a"), true);
});

test("isolates identifiers from each other", () => {
  const limiter = new InMemoryRateLimiter(60_000, 1, 60_000);
  assert.equal(limiter.isRateLimited("a"), false);
  assert.equal(limiter.isRateLimited("a"), true);
  assert.equal(limiter.isRateLimited("b"), false);
});
