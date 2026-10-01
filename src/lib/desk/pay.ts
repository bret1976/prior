export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.trim());
}

export async function chargeDeposit(input: { amountUsd: number; jobId: string; venue: string }) {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    return { ok: false as const, error: "Card capture is not configured. Set STRIPE_SECRET_KEY. Nothing was booked." };
  }
  const body = new URLSearchParams();
  body.set("amount", String(input.amountUsd * 100));
  body.set("currency", "usd");
  body.set("confirm", "false");
  body.set("description", `Latch deposit ${input.venue}`);
  body.set("metadata[job_id]", input.jobId);
  body.set("automatic_payment_methods[enabled]", "true");
  const res = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as { id?: string; error?: { message?: string } };
  if (!res.ok || !data.id) {
    return { ok: false as const, error: data.error?.message || "Stripe refused the deposit." };
  }
  return { ok: false as const, error: `Deposit intent ${data.id} is open and unconfirmed. Inventory stays until the card succeeds.` };
}
