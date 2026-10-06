// checkout-guard-v1 — backend-only abuse guard for Prior's public endpoints.
//
// Why: POST /api/v1/checkout and the MCP `buy` tool open real Stripe Checkout
// sessions on this deployment's Stripe account with no login. Without limits a
// bot can mint unlimited sessions, for any amount, with any product name, which
// is the classic setup for card testing and for phishing-looking checkout pages
// under our merchant name. `decide` also kept unbounded in-memory history on
// Vercel and summed it on every call.
//
// Patterns (original code, no third-party source vendored):
// - Per-IP sliding-window limit on Checkout Session creation — Stripe docs
//   "Protect yourself from card testing"; anomalyco/opencode PR #45007 (MIT)
//   "rate limit checkout session creation".
// - Burst limit on spend decisions — revanthrajeev/spendveto (Apache-2.0)
//   burst-freeze idea, implemented here as a plain 429.
//
// Everything is in-process memory (per warm Vercel instance). It is a speed
// bump, not a wall, and it never blocks Stripe's own Radar/CAPTCHA protections.
// Kill switch: PRIOR_GUARD=0.

export const GUARD_VERSION = "checkout-guard-v1";

function envNum(name: string, fallback: number) {
  const raw = typeof process !== "undefined" ? process.env[name] : undefined;
  const n = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function guardEnabled() {
  const raw = typeof process !== "undefined" ? process.env.PRIOR_GUARD : undefined;
  return !(raw && ["0", "false", "off", "no"].includes(raw.trim().toLowerCase()));
}

export function guardLimits() {
  return {
    checkoutMaxUsd: envNum("CHECKOUT_MAX_USD", 100),
    checkoutPerIpPerHour: envNum("CHECKOUT_PER_IP_PER_HOUR", 10),
    checkoutGlobalPerHour: envNum("CHECKOUT_GLOBAL_PER_HOUR", 120),
    confirmPerIpPerHour: envNum("CONFIRM_PER_IP_PER_HOUR", 240),
    decidePerIpPerMinute: envNum("DECIDE_PER_IP_PER_MINUTE", 120),
    fieldMaxChars: envNum("DECIDE_FIELD_MAX_CHARS", 120),
    idempotencyKeyMaxChars: 200,
  };
}

// ---------------------------------------------------------------- rate limit

type Window = { hits: number[] };
const buckets = new Map<string, Window>();
const MAX_BUCKETS = 5000;
const counters = { checkoutBlocked: 0, confirmBlocked: 0, decideBlocked: 0, amountBlocked: 0, descriptionCleaned: 0 };

/** Sliding window: true if allowed (and records the hit), false if over limit. */
export function hit(key: string, limit: number, windowMs: number, now = Date.now()) {
  if (limit <= 0) return { allowed: true, retryAfterSec: 0 };
  let w = buckets.get(key);
  if (!w) {
    if (buckets.size >= MAX_BUCKETS) {
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    }
    w = { hits: [] };
    buckets.set(key, w);
  }
  const cutoff = now - windowMs;
  while (w.hits.length && w.hits[0] <= cutoff) w.hits.shift();
  if (w.hits.length >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((w.hits[0] + windowMs - now) / 1000));
    return { allowed: false, retryAfterSec };
  }
  w.hits.push(now);
  return { allowed: true, retryAfterSec: 0 };
}

export function resetGuardForTests() {
  buckets.clear();
  for (const k of Object.keys(counters) as (keyof typeof counters)[]) counters[k] = 0;
}

export function clientIp(request: Request) {
  const h = request.headers;
  const real = h.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (fwd) return fwd;
  return "unknown";
}

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

export type GuardBlock = { blocked: true; status: 429; error: string; retryAfterSec: number };
export type GuardPass = { blocked: false };

function block(retryAfterSec: number, what: string): GuardBlock {
  const mins = Math.max(1, Math.ceil(retryAfterSec / 60));
  return {
    blocked: true,
    status: 429,
    error: `Too many ${what} from this address. Try again in ${mins} min.`,
    retryAfterSec,
  };
}

export function checkCheckoutRate(ip: string, now = Date.now()): GuardBlock | GuardPass {
  if (!guardEnabled()) return { blocked: false };
  const l = guardLimits();
  const perIp = hit(`co:ip:${ip}`, l.checkoutPerIpPerHour, HOUR, now);
  if (!perIp.allowed) {
    counters.checkoutBlocked++;
    return block(perIp.retryAfterSec, "checkouts");
  }
  const global = hit("co:global", l.checkoutGlobalPerHour, HOUR, now);
  if (!global.allowed) {
    counters.checkoutBlocked++;
    return { ...block(global.retryAfterSec, "checkouts"), error: "Checkout is busy. Try again shortly." };
  }
  return { blocked: false };
}

export function checkConfirmRate(ip: string, now = Date.now()): GuardBlock | GuardPass {
  if (!guardEnabled()) return { blocked: false };
  const r = hit(`cf:ip:${ip}`, guardLimits().confirmPerIpPerHour, HOUR, now);
  if (!r.allowed) {
    counters.confirmBlocked++;
    return block(r.retryAfterSec, "payment checks");
  }
  return { blocked: false };
}

export function checkDecideRate(ip: string, now = Date.now()): GuardBlock | GuardPass {
  if (!guardEnabled()) return { blocked: false };
  const r = hit(`dc:ip:${ip}`, guardLimits().decidePerIpPerMinute, MINUTE, now);
  if (!r.allowed) {
    counters.decideBlocked++;
    return block(r.retryAfterSec, "decisions");
  }
  return { blocked: false };
}

// ---------------------------------------------------------------- validation

/** Amount cap for a new checkout. Returns an error string or null. */
export function checkoutAmountError(amountUsd: number) {
  if (!guardEnabled()) return null;
  const max = guardLimits().checkoutMaxUsd;
  if (max > 0 && Number.isFinite(amountUsd) && amountUsd > max) {
    counters.amountBlocked++;
    return `Checkout is capped at $${max}.`;
  }
  return null;
}

const URLISH = /(https?:\/\/|www\.|[a-z0-9-]+\.(com|net|org|io|app|co|xyz|ru|top|info|biz|link|me)\b)/i;
const EMAILISH = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONEISH = /(\+?\d[\d\s().-]{8,}\d)/;

/**
 * Product name shown on the Stripe Checkout page. Strip control characters and
 * collapse whitespace; if it carries a link, email, or phone number (a phishing
 * shape) fall back to the plain product name.
 */
export function cleanDescription(input: unknown, fallback = "Prior") {
  const raw = typeof input === "string" ? input : "";
  if (!guardEnabled()) return raw || fallback;
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  const phone = text.match(PHONEISH)?.[0];
  const phoneLike = Boolean(phone && phone.replace(/\D/g, "").length >= 10);
  if (URLISH.test(text) || EMAILISH.test(text) || phoneLike) {
    counters.descriptionCleaned++;
    return fallback;
  }
  if (text !== raw) counters.descriptionCleaned++;
  return text.slice(0, 120);
}

const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{8,250}$/;
export function validSessionId(id: string) {
  if (!guardEnabled()) return id.startsWith("cs_");
  return SESSION_ID.test(id);
}

/** Field-length check for decide. Returns an error string or null. */
export function decideFieldError(input: { agent: string; vendor: string; category: string; idempotencyKey?: string }) {
  if (!guardEnabled()) return null;
  const l = guardLimits();
  for (const [name, value] of [
    ["Agent", input.agent],
    ["Vendor", input.vendor],
    ["Category", input.category],
  ] as const) {
    if (value.length > l.fieldMaxChars) return `${name} must be ${l.fieldMaxChars} characters or fewer.`;
  }
  if (input.idempotencyKey && input.idempotencyKey.length > l.idempotencyKeyMaxChars) {
    return `idempotencyKey must be ${l.idempotencyKeyMaxChars} characters or fewer.`;
  }
  return null;
}

export function guardSummary() {
  return {
    version: GUARD_VERSION,
    enabled: guardEnabled(),
    limits: guardLimits(),
    counters: { ...counters },
    scope: "per warm instance (in-memory)",
  };
}
