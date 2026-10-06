import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkCheckoutRate,
  checkDecideRate,
  checkoutAmountError,
  cleanDescription,
  decideFieldError,
  hit,
  resetGuardForTests,
  validSessionId,
} from "./guard.ts";

test("checkout per-IP limit blocks the 11th session in an hour, other IPs unaffected", () => {
  resetGuardForTests();
  const now = 1_000_000;
  for (let i = 0; i < 10; i++) assert.equal(checkCheckoutRate("1.1.1.1", now + i).blocked, false);
  const blocked = checkCheckoutRate("1.1.1.1", now + 11);
  assert.equal(blocked.blocked, true);
  if (blocked.blocked) {
    assert.equal(blocked.status, 429);
    assert.ok(blocked.retryAfterSec > 0);
  }
  assert.equal(checkCheckoutRate("2.2.2.2", now + 12).blocked, false);
  // window slides
  assert.equal(checkCheckoutRate("1.1.1.1", now + 60 * 60 * 1000 + 1).blocked, false);
});

test("decide limit is per minute", () => {
  resetGuardForTests();
  const now = 5_000_000;
  for (let i = 0; i < 120; i++) assert.equal(checkDecideRate("9.9.9.9", now).blocked, false);
  assert.equal(checkDecideRate("9.9.9.9", now).blocked, true);
  assert.equal(checkDecideRate("9.9.9.9", now + 61_000).blocked, false);
});

test("amount cap defaults to $100 and normal $1 passes", () => {
  assert.equal(checkoutAmountError(1), null);
  assert.equal(checkoutAmountError(100), null);
  assert.match(checkoutAmountError(5000) ?? "", /capped at \$100/);
});

test("description cleaning keeps plain names and drops links/emails/phones", () => {
  assert.equal(cleanDescription("Prior"), "Prior");
  assert.equal(cleanDescription(undefined), "Prior");
  assert.equal(cleanDescription("  Prior\n\tmonthly  "), "Prior monthly");
  assert.equal(cleanDescription("Refund at https://evil.example"), "Prior");
  assert.equal(cleanDescription("Pay support@evil.com"), "Prior");
  assert.equal(cleanDescription("Call +1 (702) 555-0100 now"), "Prior");
  assert.equal(cleanDescription("verify-account.xyz"), "Prior");
  assert.equal(cleanDescription("Prior order 2026-10-05"), "Prior order 2026-10-05");
  assert.equal(cleanDescription("x".repeat(300)).length, 120);
});

test("session ids must look like Stripe checkout ids", () => {
  assert.equal(validSessionId("cs_test_a1B2c3D4e5F6g7H8"), true);
  assert.equal(validSessionId("cs_live_a1B2c3D4e5F6g7H8"), true);
  assert.equal(validSessionId("cs_../../v1/customers"), false);
  assert.equal(validSessionId("pi_123"), false);
  assert.equal(validSessionId("cs_test_"), false);
});

test("decide field caps", () => {
  assert.equal(decideFieldError({ agent: "a", vendor: "cloud-host", category: "software" }), null);
  assert.match(decideFieldError({ agent: "a".repeat(121), vendor: "v", category: "c" }) ?? "", /Agent/);
  assert.match(decideFieldError({ agent: "a", vendor: "v", category: "c", idempotencyKey: "k".repeat(201) }) ?? "", /idempotencyKey/);
});

test("limit 0 disables a bucket", () => {
  resetGuardForTests();
  for (let i = 0; i < 50; i++) assert.equal(hit("x", 0, 1000).allowed, true);
});
