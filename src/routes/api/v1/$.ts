import { createFileRoute } from "@tanstack/react-router";
import { openCheckout, paidCheckout, stripeConfigured } from "@/lib/desk/pay";
import { judge } from "@/lib/prior/engine";
import {
  GUARD_VERSION,
  checkCheckoutRate,
  checkConfirmRate,
  checkDecideRate,
  checkoutAmountError,
  cleanDescription,
  clientIp,
  guardSummary,
} from "@/lib/prior/guard";
import { decide, listDecisions, publishedPolicy, spentToday } from "@/lib/prior/store";

function json(body: unknown, status = 200, extra?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(extra ?? {}) },
  });
}

function tooMany(block: { error: string; retryAfterSec: number }) {
  return json({ error: block.error }, 429, { "retry-after": String(block.retryAfterSec) });
}

async function readBody(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function num(value: unknown, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export const Route = createFileRoute("/api/v1/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => dispatch("GET", params._splat ?? "", null, request),
      POST: async ({ request, params }) => dispatch("POST", params._splat ?? "", await readBody(request), request),
    },
  },
});

async function dispatch(method: string, splat: string, body: Record<string, unknown> | null, request: Request) {
  const parts = splat.split("/").filter(Boolean);
  const origin = new URL(request.url).origin;
  const ip = clientIp(request);

  // checkout-guard-v1: additive health endpoint (was 404 before).
  if (method === "GET" && parts[0] === "health" && parts.length === 1) {
    return json({ ok: true, app: "prior", packs: { checkout_guard: GUARD_VERSION }, stripeConfigured: stripeConfigured(), guard: guardSummary() });
  }

  if (method === "GET" && parts[0] === "checkout" && parts[1]) {
    const limited = checkConfirmRate(ip);
    if (limited.blocked) return tooMany(limited);
  }

  if (method === "GET" && parts[0] === "checkout" && parts[1] === "return") {
    const sessionId = new URL(request.url).searchParams.get("session_id") ?? "";
    const paid = await paidCheckout(sessionId);
    return json(paid, paid.collected ? 200 : 402);
  }

  if (method === "GET" && parts[0] === "checkout" && parts[1]) {
    const paid = await paidCheckout(parts[1]);
    return json(paid, paid.collected ? 200 : 402);
  }

  if (method === "POST" && parts[0] === "checkout" && body) {
    const amountUsd = num(body.amountUsd, 1);
    const overCap = checkoutAmountError(amountUsd);
    if (overCap) return json({ error: overCap }, 402);
    const limited = checkCheckoutRate(ip);
    if (limited.blocked) return tooMany(limited);
    const opened = await openCheckout({
      amountUsd,
      description: cleanDescription(body.description, "Prior"),
      successUrl: `${origin}/api/v1/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/`,
      metadata: { app: "prior", source: "api", guard: GUARD_VERSION },
    });
    if (!opened.ok) return json({ error: opened.error }, 402);
    return json({
      collected: false,
      sessionId: opened.sessionId,
      url: opened.url,
      amountUsd: opened.amountUsd,
      confirm: `/api/v1/checkout/${opened.sessionId}`,
    });
  }

  const policy = await publishedPolicy();

  if (method === "GET" && (parts[0] === "manifest" || parts[0] === "agent")) {
    const spent = await spentToday(policy.id);
    const samples = [
      { amountUsd: 40, vendor: "cloud-host", category: "software" },
      { amountUsd: 40, vendor: "corner-shop", category: "gift cards" },
      { amountUsd: 180, vendor: "cloud-host", category: "software" },
    ].map((sample) => ({ ...sample, ...judge({ policy, ...sample, spentTodayUsd: spent }) }));
    return json({
      name: "Prior",
      description: "A spend gate other agents call before money moves. The rules are already published. Over the line is denied. Nobody is asked to approve it.",
      find: "/api/v1/manifest",
      use: "POST /api/v1/decide",
      buy: "POST /api/v1/checkout",
      confirm: "GET /api/v1/checkout/{sessionId}",
      priceUsd: 1,
      charge: "Checkout. Money is collected only after Stripe reports the session paid.",
      policy,
      spentTodayUsd: spent,
      samples,
      request: { agent: "your-agent-id", vendor: "cloud-host", category: "software", amountUsd: 40 },
    });
  }

  if (method === "GET" && parts[0] === "decisions") {
    return json({ decisions: await listDecisions(policy.id) });
  }

  if (method === "POST" && parts[0] === "decide" && body) {
    const limited = checkDecideRate(ip);
    if (limited.blocked) return tooMany(limited);
    const result = await decide({
      policyId: policy.id,
      amountUsd: num(body.amountUsd, 0),
      vendor: str(body.vendor),
      category: str(body.category),
      agent: str(body.agent, "agent"),
      idempotencyKey: str(body.idempotencyKey),
    });
    if ("error" in result) return json({ error: result.error }, result.status);
    return json(result);
  }

  return json({ error: "Not found." }, 404);
}
