export type Kind = "restaurant" | "hotel";

export type Slot = {
  id: string;
  label: string;
  partyMax: number;
  left: number;
};

export type Venue = {
  id: string;
  name: string;
  kind: Kind;
  neighborhood: string;
  cuisine: string;
  priceUsd: number;
  outdoor: boolean;
  dress: string;
  depositUsd: number;
  cancelHours: number;
  noise: "quiet" | "lively";
  note: string;
  slots: Slot[];
};

export type SearchInput = {
  principal: string;
  agent: string;
  party: number;
  when: string;
  neighborhood: string;
  cuisine: string;
  outdoor: boolean | null;
  capUsd: number;
  kind: Kind;
};

export type Fit = {
  venueId: string;
  slotId: string;
  name: string;
  neighborhood: string;
  cuisine: string;
  slotLabel: string;
  priceUsd: number;
  spendUsd: number;
  depositUsd: number;
  outdoor: boolean;
  noise: Venue["noise"];
  cancelHours: number;
  dress: string;
  note: string;
  ok: boolean;
  reasons: string[];
};

export type JobStatus = "searched" | "held" | "confirmed" | "cancelled";

export type Event = { at: string; type: string; detail: string };

export type Receipt = {
  id: string;
  principal: string;
  venue: string;
  slot: string;
  party: number;
  spendUsd: number;
  depositUsd: number;
  cancelByHours: number;
  approver: string;
};

export type Job = {
  id: string;
  status: JobStatus;
  principal: string;
  agent: string;
  capUsd: number;
  request: SearchInput;
  shortlist: Fit[];
  hold: { venueId: string; slotId: string; expiresAt: string } | null;
  receipt: Receipt | null;
  events: Event[];
};

export function spendFor(venue: Venue, party: number) {
  if (venue.kind === "hotel") return venue.priceUsd;
  return venue.priceUsd * party;
}

export function matchSlot(venue: Venue, when: string, party: number) {
  const want = when.trim();
  const open = venue.slots.filter((s) => s.left > 0 && s.partyMax >= party);
  const exact = open.find((s) => s.label === want);
  return exact ?? open[0] ?? null;
}

export function evaluate(venues: Venue[], input: SearchInput): Fit[] {
  const fits: Fit[] = [];
  const hood = input.neighborhood.trim().toLowerCase();
  const cuisine = input.cuisine.trim().toLowerCase();

  for (const venue of venues) {
    if (venue.kind !== input.kind) continue;
    const reasons: string[] = [];
    if (hood && !venue.neighborhood.toLowerCase().includes(hood) && hood !== "any") {
      reasons.push(`Neighborhood is ${venue.neighborhood}, not ${input.neighborhood}.`);
    }
    if (cuisine && !venue.cuisine.toLowerCase().includes(cuisine) && cuisine !== "any") {
      reasons.push(`Kitchen is ${venue.cuisine}, not ${input.cuisine}.`);
    }
    if (input.outdoor === true && !venue.outdoor) reasons.push("No outdoor seating.");
    if (input.outdoor === false && venue.outdoor) reasons.push("Only the terrace is open tonight.");

    const slot = matchSlot(venue, input.when, input.party);
    if (!slot) reasons.push(`No table left for ${input.party} at ${input.when}.`);

    const spend = spendFor(venue, input.party);
    const totalAsk = spend;
    if (totalAsk > input.capUsd) {
      reasons.push(`Spend $${totalAsk} is over the $${input.capUsd} cap.`);
    }
    if (venue.depositUsd > input.capUsd) {
      reasons.push(`Deposit $${venue.depositUsd} exceeds the cap.`);
    }

    fits.push({
      venueId: venue.id,
      slotId: slot?.id ?? "",
      name: venue.name,
      neighborhood: venue.neighborhood,
      cuisine: venue.cuisine,
      slotLabel: slot?.label ?? "—",
      priceUsd: venue.priceUsd,
      spendUsd: spend,
      depositUsd: venue.depositUsd,
      outdoor: venue.outdoor,
      noise: venue.noise,
      cancelHours: venue.cancelHours,
      dress: venue.dress,
      note: venue.note,
      ok: reasons.length === 0 && !!slot,
      reasons,
    });
  }

  return fits.sort((a, b) => Number(b.ok) - Number(a.ok) || a.spendUsd - b.spendUsd);
}

export function seedVenues(): Venue[] {
  return [
    {
      id: "copper-finch",
      name: "Copper Finch",
      kind: "restaurant",
      neighborhood: "Downtown",
      cuisine: "Italian",
      priceUsd: 72,
      outdoor: true,
      dress: "Smart casual",
      depositUsd: 40,
      cancelHours: 4,
      noise: "lively",
      note: "Patio holds four. Kitchen closes the pass at 10.",
      slots: [
        { id: "cf-1830", label: "18:30", partyMax: 4, left: 1 },
        { id: "cf-1930", label: "19:30", partyMax: 6, left: 2 },
        { id: "cf-2100", label: "21:00", partyMax: 4, left: 1 },
      ],
    },
    {
      id: "low-salt",
      name: "Low Salt",
      kind: "restaurant",
      neighborhood: "Downtown",
      cuisine: "Japanese",
      priceUsd: 68,
      outdoor: false,
      dress: "Casual",
      depositUsd: 0,
      cancelHours: 2,
      noise: "quiet",
      note: "Counter or booth. No terrace.",
      slots: [
        { id: "ls-1900", label: "19:00", partyMax: 4, left: 1 },
        { id: "ls-1930", label: "19:30", partyMax: 2, left: 2 },
        { id: "ls-2030", label: "20:30", partyMax: 6, left: 1 },
      ],
    },
    {
      id: "marrow",
      name: "Marrow Room",
      kind: "restaurant",
      neighborhood: "Summerlin",
      cuisine: "Steak",
      priceUsd: 110,
      outdoor: false,
      dress: "Jacket preferred",
      depositUsd: 80,
      cancelHours: 24,
      noise: "quiet",
      note: "Tasting counter is a separate ticket.",
      slots: [
        { id: "mr-1800", label: "18:00", partyMax: 4, left: 1 },
        { id: "mr-1930", label: "19:30", partyMax: 8, left: 1 },
      ],
    },
    {
      id: "glass-orchard",
      name: "Glass Orchard",
      kind: "restaurant",
      neighborhood: "Strip",
      cuisine: "Seafood",
      priceUsd: 84,
      outdoor: true,
      dress: "Smart",
      depositUsd: 50,
      cancelHours: 6,
      noise: "lively",
      note: "Terrace faces the fountain court.",
      slots: [
        { id: "go-1900", label: "19:00", partyMax: 6, left: 1 },
        { id: "go-1930", label: "19:30", partyMax: 4, left: 1 },
        { id: "go-2130", label: "21:30", partyMax: 4, left: 2 },
      ],
    },
    {
      id: "lantern",
      name: "Night Market Lantern",
      kind: "restaurant",
      neighborhood: "Chinatown",
      cuisine: "Chinese",
      priceUsd: 42,
      outdoor: true,
      dress: "Casual",
      depositUsd: 0,
      cancelHours: 1,
      noise: "lively",
      note: "Shared outdoor tables after 8.",
      slots: [
        { id: "nl-1800", label: "18:00", partyMax: 8, left: 3 },
        { id: "nl-1930", label: "19:30", partyMax: 6, left: 2 },
        { id: "nl-2100", label: "21:00", partyMax: 6, left: 2 },
      ],
    },
    {
      id: "hold-suite",
      name: "The Hold Suite",
      kind: "hotel",
      neighborhood: "Strip",
      cuisine: "Room",
      priceUsd: 220,
      outdoor: false,
      dress: "—",
      depositUsd: 100,
      cancelHours: 24,
      noise: "quiet",
      note: "King, city side. Deposit is the only charge at booking.",
      slots: [
        { id: "hs-1", label: "tonight", partyMax: 2, left: 3 },
        { id: "hs-2", label: "19:30", partyMax: 2, left: 1 },
      ],
    },
    {
      id: "palm-court",
      name: "Palm Court Rooms",
      kind: "hotel",
      neighborhood: "Downtown",
      cuisine: "Room",
      priceUsd: 160,
      outdoor: true,
      dress: "—",
      depositUsd: 60,
      cancelHours: 12,
      noise: "lively",
      note: "Courtyard double. Late check-in until midnight.",
      slots: [
        { id: "pc-1", label: "tonight", partyMax: 3, left: 4 },
        { id: "pc-2", label: "19:30", partyMax: 2, left: 2 },
      ],
    },
  ];
}
