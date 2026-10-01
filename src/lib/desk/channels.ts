import { randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";

type SlotIn = { label: string; partyMax: number; left: number };

type Incoming = {
  source: "opentable" | "resy";
  externalId: string;
  name: string;
  neighborhood: string;
  cuisine: string;
  priceUsd: number;
  slots: SlotIn[];
};

async function upsert(rows: Incoming[]) {
  const sql = await getSql();
  let written = 0;
  for (const row of rows) {
    const existing = await sql<{ id: string }>`select id from venues where source = ${row.source} and external_id = ${row.externalId} limit 1`;
    const id = existing[0]?.id ?? randomUUID();
    if (existing[0]) {
      await sql`update venues set name = ${row.name}, neighborhood = ${row.neighborhood}, cuisine = ${row.cuisine}, price_usd = ${row.priceUsd} where id = ${id}`;
      await sql`delete from slots where venue_id = ${id}`;
    } else {
      await sql`insert into venues (id, name, kind, neighborhood, cuisine, price_usd, outdoor, dress, deposit_usd, cancel_hours, noise, note, source, external_id)
        values (${id}, ${row.name}, 'restaurant', ${row.neighborhood}, ${row.cuisine}, ${row.priceUsd}, false, '—', 0, 2, 'lively', ${"Synced from " + row.source}, ${row.source}, ${row.externalId})`;
    }
    for (const slot of row.slots) {
      await sql`insert into slots (id, venue_id, label, party_max, left_count) values (${randomUUID()}, ${id}, ${slot.label}, ${slot.partyMax}, ${slot.left})`;
    }
    written += 1;
  }
  return written;
}

export async function syncOpenTable(input: { party: number; date: string; latitude: number; longitude: number }) {
  const token = process.env.OPENTABLE_TOKEN?.trim();
  const base = process.env.OPENTABLE_API_BASE?.trim();
  if (!token || !base) {
    return { error: "Set OPENTABLE_TOKEN and OPENTABLE_API_BASE. OpenTable has no public signup, so no tables were invented.", status: 503 as const };
  }
  const url = new URL("/availability", base.endsWith("/") ? base : `${base}/`);
  url.searchParams.set("party_size", String(input.party));
  url.searchParams.set("date", input.date);
  url.searchParams.set("latitude", String(input.latitude));
  url.searchParams.set("longitude", String(input.longitude));
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
  const data = (await res.json().catch(() => null)) as { restaurants?: Record<string, unknown>[] } | null;
  if (!res.ok || !data) return { error: `OpenTable returned ${res.status}.`, status: 502 as const };
  const rows: Incoming[] = [];
  for (const restaurant of data.restaurants ?? []) {
    const id = String(restaurant.id ?? "");
    const name = String(restaurant.name ?? "");
    if (!id || !name) continue;
    const times = Array.isArray(restaurant.times) ? restaurant.times : [];
    const slots = times
      .map((time) => String(time))
      .filter(Boolean)
      .map((label) => ({ label, partyMax: input.party, left: 1 }));
    if (slots.length === 0) continue;
    rows.push({
      source: "opentable",
      externalId: id,
      name,
      neighborhood: String(restaurant.neighborhood ?? "Las Vegas"),
      cuisine: String(restaurant.cuisine ?? "Unspecified"),
      priceUsd: Number(restaurant.priceUsd ?? 0) || 0,
      slots,
    });
  }
  return { imported: await upsert(rows) };
}

export async function syncResy(input: { party: number; date: string; latitude: number; longitude: number }) {
  const apiKey = process.env.RESY_API_KEY?.trim();
  const auth = process.env.RESY_AUTH_TOKEN?.trim();
  if (!apiKey || !auth) {
    return { error: "Set RESY_API_KEY and RESY_AUTH_TOKEN from your own Resy partner or account. No tables were invented.", status: 503 as const };
  }
  const url = new URL("https://api.resy.com/4/find");
  url.searchParams.set("lat", String(input.latitude));
  url.searchParams.set("long", String(input.longitude));
  url.searchParams.set("day", input.date);
  url.searchParams.set("party_size", String(input.party));
  const res = await fetch(url, {
    headers: {
      authorization: `ResyAPI api_key="${apiKey}"`,
      "x-resy-auth-token": auth,
      "x-resy-universal-auth": auth,
      origin: "https://resy.com",
      accept: "application/json",
    },
  });
  const data = (await res.json().catch(() => null)) as {
    results?: { venues?: { venue?: { id?: { resy?: number }; name?: string; location?: { neighborhood?: string }; type?: string }; slots?: { date?: { start?: string } }[] }[] };
  } | null;
  if (!res.ok || !data) return { error: `Resy returned ${res.status}.`, status: 502 as const };
  const rows: Incoming[] = [];
  for (const hit of data.results?.venues ?? []) {
    const id = String(hit.venue?.id?.resy ?? "");
    const name = hit.venue?.name ?? "";
    if (!id || !name) continue;
    const slots = (hit.slots ?? [])
      .map((slot) => (slot.date?.start ? slot.date.start.slice(11, 16) : ""))
      .filter(Boolean)
      .map((label) => ({ label, partyMax: input.party, left: 1 }));
    if (slots.length === 0) continue;
    rows.push({
      source: "resy",
      externalId: id,
      name,
      neighborhood: hit.venue?.location?.neighborhood || "Las Vegas",
      cuisine: hit.venue?.type || "Unspecified",
      priceUsd: 0,
      slots,
    });
  }
  return { imported: await upsert(rows) };
}
