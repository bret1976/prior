import { randomBytes, randomUUID } from "node:crypto";
import { getSql, type Sql } from "@/lib/db";
import { evaluate, type Fit, type Job, type Receipt, type SearchInput, type Slot, type Venue } from "./engine";
import { chargeDeposit } from "./pay";

type VenueRow = {
  id: string;
  name: string;
  kind: Venue["kind"];
  neighborhood: string;
  cuisine: string;
  price_usd: number;
  outdoor: boolean;
  dress: string;
  deposit_usd: number;
  cancel_hours: number;
  noise: Venue["noise"];
  note: string;
};

type SlotRow = { id: string; venue_id: string; label: string; party_max: number; left_count: number };

type JobRow = {
  id: string;
  status: Job["status"];
  principal: string;
  agent: string;
  cap_usd: number;
  request: SearchInput;
  shortlist: Fit[];
  hold: Job["hold"];
  receipt: Receipt | null;
};

async function db() {
  return getSql();
}

export async function ensureAdmin() {
  const sql = await db();
  const existing = await sql<{ token: string }>`select token from latch_keys where role = 'admin' order by created_at limit 1`;
  if (existing[0]) return existing[0].token;
  const token = `latch_${randomBytes(24).toString("hex")}`;
  await sql`insert into latch_keys (id, label, token, role) values (${randomUUID()}, 'operator', ${token}, 'admin')`;
  return token;
}

export async function authToken(header: string | null) {
  if (!header) return null;
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const sql = await db();
  const rows = await sql<{ role: string }>`select role from latch_keys where token = ${token} limit 1`;
  return rows[0] ?? null;
}

async function venuesWithSlots(sql: Sql): Promise<Venue[]> {
  const venues = await sql<VenueRow>`select id, name, kind, neighborhood, cuisine, price_usd, outdoor, dress, deposit_usd, cancel_hours, noise, note from venues order by name`;
  const slots = await sql<SlotRow>`select id, venue_id, label, party_max, left_count from slots`;
  return venues.map((v) => ({
    id: v.id,
    name: v.name,
    kind: v.kind,
    neighborhood: v.neighborhood,
    cuisine: v.cuisine,
    priceUsd: Number(v.price_usd),
    outdoor: Boolean(v.outdoor),
    dress: v.dress,
    depositUsd: Number(v.deposit_usd),
    cancelHours: Number(v.cancel_hours),
    noise: v.noise,
    note: v.note,
    slots: slots
      .filter((s) => s.venue_id === v.id)
      .map((s) => ({ id: s.id, label: s.label, partyMax: Number(s.party_max), left: Number(s.left_count) })),
  }));
}

export async function listVenues() {
  return venuesWithSlots(await db());
}

async function push(sql: Sql, jobId: string, type: string, detail: string) {
  await sql`insert into job_events (id, job_id, type, detail) values (${randomUUID()}, ${jobId}, ${type}, ${detail})`;
}

async function loadJob(sql: Sql, id: string): Promise<Job | null> {
  const rows = await sql<JobRow>`select id, status, principal, agent, cap_usd, request, shortlist, hold, receipt from jobs where id = ${id}`;
  const row = rows[0];
  if (!row) return null;
  const events = await sql<{ at: string; type: string; detail: string }>`select at, type, detail from job_events where job_id = ${id} order by at`;
  return {
    id: row.id,
    status: row.status,
    principal: row.principal,
    agent: row.agent,
    capUsd: Number(row.cap_usd),
    request: row.request,
    shortlist: row.shortlist,
    hold: row.hold,
    receipt: row.receipt,
    events: events.map((e) => ({ at: String(e.at), type: e.type, detail: e.detail })),
  };
}

export async function getJob(id: string) {
  return loadJob(await db(), id);
}

export async function listJobs() {
  const sql = await db();
  const rows = await sql<{ id: string }>`select id from jobs order by created_at desc limit 50`;
  const jobs: Job[] = [];
  for (const row of rows) {
    const job = await loadJob(sql, row.id);
    if (job) jobs.push(job);
  }
  return jobs;
}

export async function addVenue(input: Omit<Venue, "slots"> & { slots: Slot[] }) {
  const sql = await db();
  const id = input.id || randomUUID();
  await sql`insert into venues (id, name, kind, neighborhood, cuisine, price_usd, outdoor, dress, deposit_usd, cancel_hours, noise, note)
    values (${id}, ${input.name}, ${input.kind}, ${input.neighborhood}, ${input.cuisine}, ${input.priceUsd}, ${input.outdoor}, ${input.dress}, ${input.depositUsd}, ${input.cancelHours}, ${input.noise}, ${input.note})`;
  for (const slot of input.slots) {
    await sql`insert into slots (id, venue_id, label, party_max, left_count) values (${slot.id || randomUUID()}, ${id}, ${slot.label}, ${slot.partyMax}, ${slot.left})`;
  }
  return (await venuesWithSlots(sql)).find((v) => v.id === id) ?? null;
}

export async function search(input: SearchInput) {
  const sql = await db();
  const venues = await venuesWithSlots(sql);
  const shortlist = evaluate(venues, input);
  const id = `job-${randomBytes(4).toString("hex")}`;
  await sql`insert into jobs (id, status, principal, agent, cap_usd, request, shortlist, hold, receipt)
    values (${id}, 'searched', ${input.principal}, ${input.agent}, ${input.capUsd}, ${JSON.stringify(input)}::jsonb, ${JSON.stringify(shortlist)}::jsonb, null, null)`;
  const ok = shortlist.filter((f) => f.ok).length;
  await push(sql, id, "search", `${ok} venue${ok === 1 ? "" : "s"} fit. ${shortlist.length - ok} blocked. Floor has ${venues.length} venues.`);
  return loadJob(sql, id);
}

async function expire(sql: Sql, job: Job) {
  if (job.status === "held" && job.hold && Date.now() > Date.parse(job.hold.expiresAt)) {
    await sql`update jobs set status = 'searched', hold = null where id = ${job.id}`;
    await push(sql, job.id, "expire", "Hold expired. Inventory was never taken.");
    job.status = "searched";
    job.hold = null;
  }
}

export async function hold(jobId: string, venueId: string, slotId: string) {
  const sql = await db();
  const job = await loadJob(sql, jobId);
  if (!job) return { error: "Unknown job.", status: 404 as const };
  await expire(sql, job);
  if (job.status === "confirmed" || job.status === "cancelled") return { error: "Job is closed.", status: 409 as const };
  const fit = job.shortlist.find((f) => f.venueId === venueId && f.ok);
  if (!fit) return { error: "That venue is not a clean fit.", status: 422 as const };
  const useSlot = slotId || fit.slotId;
  const slots = await sql<SlotRow>`select id, left_count, party_max, label from slots where id = ${useSlot} and venue_id = ${venueId}`;
  const slot = slots[0];
  if (!slot || Number(slot.left_count) < 1 || Number(slot.party_max) < job.request.party) {
    return { error: "Slot is gone.", status: 409 as const };
  }
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const hold = { venueId, slotId: useSlot, expiresAt };
  await sql`update jobs set status = 'held', hold = ${JSON.stringify(hold)}::jsonb where id = ${jobId}`;
  await push(sql, jobId, "hold", `Held ${fit.name} at ${slot.label} until ${expiresAt}. Deposit $${fit.depositUsd} is not charged yet.`);
  return { job: await loadJob(sql, jobId) };
}

export async function approve(jobId: string, approver: string) {
  const sql = await db();
  const job = await loadJob(sql, jobId);
  if (!job) return { error: "Unknown job.", status: 404 as const };
  await expire(sql, job);
  if (!job.hold || job.status !== "held") return { error: "No live hold.", status: 409 as const };
  if (!approver.trim()) return { error: "Name the approver.", status: 422 as const };
  const fit = job.shortlist.find((f) => f.venueId === job.hold?.venueId && f.ok);
  if (!fit) return { error: "Hold no longer fits policy.", status: 422 as const };
  if (fit.depositUsd > job.capUsd || fit.spendUsd > job.capUsd) return { error: "Cap blocks this charge.", status: 422 as const };
  const charge = await chargeDeposit({ amountUsd: fit.depositUsd, jobId, venue: fit.name });
  if (!charge.ok) {
    return {
      error: charge.error,
      status: 402 as const,
      checkoutUrl: "checkoutUrl" in charge ? charge.checkoutUrl : undefined,
      sessionId: "sessionId" in charge ? charge.sessionId : undefined,
    };
  }
  const slots = await sql<{ label: string }>`select label from slots where id = ${job.hold.slotId}`;
  await sql`update slots set left_count = left_count - 1 where id = ${job.hold.slotId} and left_count > 0`;
  const receipt = {
    id: charge.sessionId,
    principal: job.principal,
    venue: fit.name,
    slot: slots[0]?.label ?? job.hold.slotId,
    party: job.request.party,
    spendUsd: fit.spendUsd,
    depositUsd: charge.amountUsd ?? fit.depositUsd,
    cancelByHours: fit.cancelHours,
    approver,
  };
  await sql`update jobs set status = 'confirmed', hold = null, receipt = ${JSON.stringify(receipt)}::jsonb where id = ${jobId}`;
  await push(sql, jobId, "charge", `Stripe collected $${receipt.depositUsd} for ${fit.name}.`);
  return { job: await loadJob(sql, jobId) };
}

export async function changeJob(jobId: string, slotId: string) {
  const sql = await db();
  const job = await loadJob(sql, jobId);
  if (!job?.receipt || job.status !== "confirmed") return { error: "Only a paid booking can move.", status: 409 as const };
  const venue = (await venuesWithSlots(sql)).find((v) => v.name === job.receipt?.venue);
  const next = venue?.slots.find((s) => s.id === slotId);
  if (!venue || !next || next.left < 1) return { error: "That slot is not open.", status: 409 as const };
  const prev = venue.slots.find((s) => s.label === job.receipt?.slot);
  if (prev) await sql`update slots set left_count = left_count + 1 where id = ${prev.id}`;
  await sql`update slots set left_count = left_count - 1 where id = ${next.id} and left_count > 0`;
  const receipt = { ...job.receipt, slot: next.label };
  await sql`update jobs set receipt = ${JSON.stringify(receipt)}::jsonb where id = ${jobId}`;
  await push(sql, jobId, "change", `Moved to ${next.label}.`);
  return { job: await loadJob(sql, jobId) };
}

export async function cancelJob(jobId: string) {
  const sql = await db();
  const job = await loadJob(sql, jobId);
  if (!job) return { error: "Unknown job.", status: 404 as const };
  if (job.status === "cancelled") return { job };
  if (job.status === "confirmed" && job.receipt) {
    const venue = (await venuesWithSlots(sql)).find((v) => v.name === job.receipt?.venue);
    const slot = venue?.slots.find((s) => s.label === job.receipt?.slot);
    if (slot) await sql`update slots set left_count = left_count + 1 where id = ${slot.id}`;
    await push(sql, jobId, "cancel", `Cancelled ${job.receipt.venue}.`);
  } else {
    await push(sql, jobId, "cancel", "Released. Nothing was charged.");
  }
  await sql`update jobs set status = 'cancelled', hold = null where id = ${jobId}`;
  return { job: await loadJob(sql, jobId) };
}

export async function remember(key: string, status: number, body: unknown) {
  const sql = await db();
  const hit = await sql<{ status: number; body: unknown }>`select status, body from idempotency where key = ${key}`;
  if (hit[0]) return { hit: true as const, status: Number(hit[0].status), body: hit[0].body };
  return { hit: false as const };
}

export async function saveIdem(key: string, status: number, body: unknown) {
  const sql = await db();
  await sql`insert into idempotency (key, status, body) values (${key}, ${status}, ${JSON.stringify(body)}::jsonb) on conflict (key) do nothing`;
}
