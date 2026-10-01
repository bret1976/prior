import { createFileRoute } from "@tanstack/react-router";
import { openCheckout, paidCheckout } from "@/lib/desk/pay";
import { decide } from "@/lib/prior/store";

const PROTOCOL = "2025-06-18";

const tools = [
  {
    name: "decide",
    description: "Allow or deny a spend before money moves. Over $100 is denied. Nobody is asked to approve it.",
    inputSchema: {
      type: "object",
      properties: {
        amountUsd: { type: "integer", description: "Whole dollars." },
        vendor: { type: "string" },
        category: { type: "string" },
        agent: { type: "string" },
        idempotencyKey: { type: "string" },
      },
      required: ["amountUsd", "vendor", "category", "agent"],
    },
  },
  {
    name: "buy",
    description: "Open a Stripe Checkout for Prior. Money is collected only after the returned URL is paid.",
    inputSchema: {
      type: "object",
      properties: {
        amountUsd: { type: "number", description: "Dollars. Defaults to 1. Minimum 0.50." },
        description: { type: "string" },
      },
    },
  },
  {
    name: "confirm_payment",
    description: "Ask Stripe whether a checkout session has been paid.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" } },
      required: ["sessionId"],
    },
  },
];

function rpc(id: unknown, result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
  });
}

function fail(id: unknown, code: number, message: string) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    status: 200,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "POST, OPTIONS",
            "access-control-allow-headers": "content-type, mcp-protocol-version, mcp-session-id",
          },
        }),
      POST: async ({ request }) => {
        const origin = request.headers.get("origin");
        if (origin && !origin.startsWith("https://") && !origin.startsWith("http://localhost")) {
          return new Response("Forbidden", { status: 403 });
        }
        let message: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
        try {
          message = (await request.json()) as typeof message;
        } catch {
          return fail(null, -32700, "Parse error");
        }
        const id = message.id ?? null;
        const method = message.method ?? "";
        if (id === null && method.startsWith("notifications/")) return new Response(null, { status: 202 });
        if (method === "initialize") {
          return rpc(id, {
            protocolVersion: PROTOCOL,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "prior", version: "1.0.0" },
          });
        }
        if (method === "ping") return rpc(id, {});
        if (method === "tools/list") return rpc(id, { tools });
        if (method === "tools/call") {
          const params = message.params ?? {};
          const name = typeof params.name === "string" ? params.name : "";
          const args = (params.arguments ?? {}) as Record<string, unknown>;
          const text = await callTool(name, args, new URL(request.url).origin);
          return rpc(id, { content: [{ type: "text", text }], isError: text.startsWith("Error:") });
        }
        return fail(id, -32601, `Unknown method ${method}`);
      },
    },
  },
});

async function callTool(name: string, args: Record<string, unknown>, origin: string) {
  if (name === "decide") {
    const amount = typeof args.amountUsd === "number" ? args.amountUsd : Number(args.amountUsd);
    const result = await decide({
      policyId: "pol-prior",
      amountUsd: amount,
      vendor: typeof args.vendor === "string" ? args.vendor : "",
      category: typeof args.category === "string" ? args.category : "",
      agent: typeof args.agent === "string" ? args.agent : "agent",
      idempotencyKey: typeof args.idempotencyKey === "string" ? args.idempotencyKey : undefined,
    });
    return JSON.stringify(result);
  }
  if (name === "buy") {
    const amount = typeof args.amountUsd === "number" ? args.amountUsd : Number(args.amountUsd);
    const opened = await openCheckout({
      amountUsd: Number.isFinite(amount) && amount > 0 ? amount : 1,
      description: typeof args.description === "string" ? args.description : "Prior",
      successUrl: `${origin}/api/v1/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/`,
    });
    return JSON.stringify(opened);
  }
  if (name === "confirm_payment") {
    const sessionId = typeof args.sessionId === "string" ? args.sessionId : "";
    return JSON.stringify(await paidCheckout(sessionId));
  }
  return "Error: Unknown tool.";
}
