import { randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import { judge, type Policy, type Verdict } from "./engine";

type PolicyRow = {
  id: string;
  name: string;
  max_single_usd: number;
  max_daily_usd: number;
  approval_above_usd: number;
  blocked_categories: string[];
  allowed_vendors: string[];
};

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toPolicy(row: PolicyRow): Policy {
  return {
    id: row.id,
    name: row.name,
    maxSingleUsd: Number(row.max_single_usd),
    maxDailyUsd: Number(row.max_daily_usd),
    approvalAboveUsd: Number(row.approval_above_usd),
    blockedCategories: asList(row.blocked_categories),
    allowedVendors: asList(row.allowed_vendors),
  };
}

export async function publishedPolicy() {
  const sql = await getSql();
  const id = "pol-prior";
  const existing = await sql<PolicyRow>`select id, name, max_single_usd, max_daily_usd, approval_above_usd, blocked_categories, allowed_vendors from policies where id = ${id}`;
  if (!existing[0]) {
    await sql`insert into policies (id, name, max_single_usd, max_daily_usd, approval_above_usd, blocked_categories, allowed_vendors)
      values (${id}, 'Prior', 250, 1000, 100, ${JSON.stringify(["gambling", "gift cards"])}::jsonb, '[]'::jsonb)`;
  }
  const policy = await getPolicy(id);
  if (!policy) throw new Error("Policy failed to publish.");
  return policy;
}

export async function authToken(header: string | null) {
  if (!header) return null;
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const sql = await getSql();
  const rows = await sql<{ role: string }>`select role from latch_keys where token = ${token} limit 1`;
  return rows[0] ?? null;
}

export async function createPolicy(input: Omit<Policy, "id">) {
  const sql = await getSql();
  const id = `pol-${randomBytes(4).toString("hex")}`;
  await sql`insert into policies (id, name, max_single_usd, max_daily_usd, approval_above_usd, blocked_categories, allowed_vendors)
    values (${id}, ${input.name}, ${input.maxSingleUsd}, ${input.maxDailyUsd}, ${input.approvalAboveUsd}, ${JSON.stringify(input.blockedCategories)}::jsonb, ${JSON.stringify(input.allowedVendors)}::jsonb)`;
  return getPolicy(id);
}

export async function listPolicies() {
  const sql = await getSql();
  const rows = await sql<PolicyRow>`select id, name, max_single_usd, max_daily_usd, approval_above_usd, blocked_categories, allowed_vendors from policies order by created_at desc`;
  return rows.map(toPolicy);
}

export async function getPolicy(id: string) {
  const sql = await getSql();
  const rows = await sql<PolicyRow>`select id, name, max_single_usd, max_daily_usd, approval_above_usd, blocked_categories, allowed_vendors from policies where id = ${id}`;
  return rows[0] ? toPolicy(rows[0]) : null;
}

export async function spentToday(policyId: string) {
  const sql = await getSql();
  const rows = await sql<{ total: number }>`select coalesce(sum(amount_usd), 0) as total from decisions where policy_id = ${policyId} and verdict = 'allow' and created_at::date = current_date`;
  return Number(rows[0]?.total ?? 0);
}

export async function decide(input: {
  policyId: string;
  amountUsd: number;
  vendor: string;
  category: string;
  agent: string;
  idempotencyKey?: string;
}) {
  const policy = await getPolicy(input.policyId);
  if (!policy) return { error: "Unknown policy.", status: 404 as const };
  if (!input.agent.trim() || !input.vendor.trim() || !input.category.trim()) {
    return { error: "Agent, vendor, and category are required.", status: 422 as const };
  }
  if (!Number.isInteger(input.amountUsd)) {
    return { error: "Amount must be a whole number of dollars.", status: 422 as const };
  }
  const sql = await getSql();
  const idem = input.idempotencyKey?.trim();
  if (idem) {
    const prior = await sql<{ body: unknown }>`select body from idempotency where key = ${`decide:${idem}`}`;
    if (prior[0]) return prior[0].body as { decision: Awaited<ReturnType<typeof freshDecision>> };
  }
  const decision = await freshDecision(input, policy);
  if (idem) {
    await sql`insert into idempotency (key, status, body) values (${`decide:${idem}`}, 200, ${JSON.stringify({ decision })}::jsonb) on conflict (key) do nothing`;
  }
  return { decision };
}

async function freshDecision(
  input: { policyId: string; amountUsd: number; vendor: string; category: string; agent: string },
  policy: Policy,
) {
  const spent = await spentToday(policy.id);
  const judged = judge({
    policy,
    amountUsd: input.amountUsd,
    vendor: input.vendor,
    category: input.category,
    spentTodayUsd: spent,
  });
  const id = `dec-${randomBytes(4).toString("hex")}`;
  const sql = await getSql();
  await sql`insert into decisions (id, policy_id, agent, vendor, category, amount_usd, verdict, reasons)
    values (${id}, ${policy.id}, ${input.agent}, ${input.vendor}, ${input.category}, ${input.amountUsd}, ${judged.verdict}, ${JSON.stringify(judged.reasons)}::jsonb)`;
  return {
    id,
    policyId: policy.id,
    agent: input.agent,
    vendor: input.vendor,
    category: input.category,
    amountUsd: input.amountUsd,
    spentTodayUsd: spent,
    verdict: judged.verdict as Verdict,
    reasons: judged.reasons,
  };
}

export async function listDecisions(policyId: string) {
  const sql = await getSql();
  return sql<{
    id: string;
    agent: string;
    vendor: string;
    category: string;
    amount_usd: number;
    verdict: string;
    reasons: string[];
    created_at: string;
  }>`select id, agent, vendor, category, amount_usd, verdict, reasons, created_at from decisions where policy_id = ${policyId} order by created_at desc limit 40`;
}
