function key() {
  const value = process.env.STRIPE_SECRET_KEY?.trim();
  return value || null;
}

export function stripeConfigured() {
  return Boolean(key());
}

type StripeError = { error?: { message?: string } };

async function stripe(path: string, body?: URLSearchParams) {
  const secret = key();
  if (!secret) return { ok: false as const, status: 500, data: { error: { message: "STRIPE_SECRET_KEY is not set." } } };
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${secret}`,
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
  const data = (await res.json()) as StripeError & Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

export async function openCheckout(input: {
  amountUsd: number;
  description: string;
  successUrl: string;
  cancelUrl: string;
}) {
  const cents = Math.round(input.amountUsd * 100);
  if (!Number.isInteger(cents) || cents < 50) {
    return { ok: false as const, error: "Stripe's minimum charge is $0.50." };
  }
  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("success_url", input.successUrl);
  body.set("cancel_url", input.cancelUrl);
  body.set("line_items[0][quantity]", "1");
  body.set("line_items[0][price_data][currency]", "usd");
  body.set("line_items[0][price_data][unit_amount]", String(cents));
  body.set("line_items[0][price_data][product_data][name]", input.description.slice(0, 120));
  const res = await stripe("checkout/sessions", body);
  const url = res.data.url;
  const id = res.data.id;
  if (!res.ok || typeof url !== "string" || typeof id !== "string") {
    return { ok: false as const, error: res.data.error?.message || "Stripe refused the checkout." };
  }
  return { ok: true as const, url, sessionId: id, amountUsd: cents / 100 };
}

export async function paidCheckout(sessionId: string) {
  if (!sessionId.startsWith("cs_")) return { collected: false as const, error: "That is not a Stripe checkout session." };
  const res = await stripe(`checkout/sessions/${encodeURIComponent(sessionId)}`);
  if (!res.ok) return { collected: false as const, error: res.data.error?.message || "Stripe could not read that session." };
  const collected = res.data.payment_status === "paid";
  const amount = res.data.amount_total;
  return {
    collected,
    sessionId,
    amountUsd: typeof amount === "number" ? amount / 100 : null,
    paymentStatus: typeof res.data.payment_status === "string" ? res.data.payment_status : "unknown",
    error: collected ? undefined : "Stripe has not collected this payment.",
  };
}

export async function chargeDeposit(input: {
  amountUsd: number;
  jobId: string;
  venue: string;
  sessionId?: string;
  origin?: string;
}) {
  if (input.sessionId) {
    const paid = await paidCheckout(input.sessionId);
    if (!paid.collected) return { ok: false as const, error: paid.error || "Not collected." };
    return { ok: true as const, sessionId: input.sessionId, amountUsd: paid.amountUsd };
  }
  const origin = input.origin || "https://prior-mu.vercel.app";
  const opened = await openCheckout({
    amountUsd: input.amountUsd,
    description: input.venue,
    successUrl: `${origin}/api/v1/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${origin}/`,
  });
  if (!opened.ok) return opened;
  return {
    ok: false as const,
    error: `Pay ${opened.url}. Nothing is collected until Stripe marks that checkout paid.`,
    checkoutUrl: opened.url,
    sessionId: opened.sessionId,
  };
}
