import { createFileRoute } from "@tanstack/react-router";
import { judge } from "@/lib/prior/engine";
import { decide, listDecisions, publishedPolicy, spentToday } from "@/lib/prior/store";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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
      GET: async ({ params }) => dispatch("GET", params._splat ?? "", null),
      POST: async ({ request, params }) => dispatch("POST", params._splat ?? "", await readBody(request)),
    },
  },
});

async function dispatch(method: string, splat: string, body: Record<string, unknown> | null) {
  const parts = splat.split("/").filter(Boolean);
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
      priceUsd: 0,
      charge: "none",
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
