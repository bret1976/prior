import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/")({ component: Home });

type Policy = {
  maxSingleUsd: number;
  maxDailyUsd: number;
  approvalAboveUsd: number;
  blockedCategories: string[];
};

type Sample = { amountUsd: number; vendor: string; category: string; verdict: string; reasons: string[] };

type Decision = {
  id: string;
  agent: string;
  vendor: string;
  category: string;
  amount_usd: number;
  verdict: string;
  reasons: string[] | string;
};

type Board = {
  spentTodayUsd: number;
  policy: Policy;
  samples: Sample[];
  request: { agent: string; vendor: string; category: string; amountUsd: number };
};

function reasonsOf(value: Decision["reasons"]) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [String(value)];
  } catch {
    return [String(value)];
  }
}

function Home() {
  const [board, setBoard] = useState<Board | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([fetch("/api/v1/manifest").then((r) => r.json()), fetch("/api/v1/decisions").then((r) => r.json())])
      .then(([manifest, log]: [Board, { decisions: Decision[] }]) => {
        setBoard(manifest);
        setDecisions(log.decisions);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6">
      <p className="text-sm font-medium tracking-widest text-accent uppercase">Prior</p>
      <h1 className="font-display text-4xl leading-none">Already on. Other agents call it.</h1>
      <p className="mt-3 max-w-xl text-muted">
        You do not set this up. The rules are published. An agent sends a vendor, a category, and an amount to POST /api/v1/decide. Prior answers allow or deny. Nothing is charged, and nothing waits on you.
      </p>
      {error ? (
        <p className="mt-4 text-sm text-bad" role="alert">
          {error}
        </p>
      ) : null}
      {board ? (
        <>
          <section className="mt-6 rounded-2xl bg-surface p-4">
            <h2 className="font-display text-2xl">Published rules</h2>
            <p className="mt-2 text-sm text-muted">
              ${board.policy.maxSingleUsd} max one charge · ${board.policy.maxDailyUsd} max today · denied above $
              {board.policy.approvalAboveUsd} · blocked: {board.policy.blockedCategories.join(", ")} · spent today $
              {board.spentTodayUsd}
            </p>
          </section>
          <section className="mt-4 rounded-2xl bg-surface p-4">
            <h2 className="font-display text-2xl">What an agent gets</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {board.samples.map((sample) => (
                <li key={`${sample.category}-${sample.amountUsd}`} className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
                  <span className="text-fg">{sample.verdict}</span>
                  <span className="text-muted">
                    {" "}
                    · ${sample.amountUsd} · {sample.vendor} · {sample.category}
                  </span>
                  <span className="mt-1 block text-muted">{sample.reasons.join(" ")}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="mt-4 rounded-2xl bg-surface p-4">
            <h2 className="font-display text-2xl">How another agent calls it</h2>
            <pre className="mt-3 overflow-x-auto rounded-xl bg-surface-2 p-3 text-sm text-muted">{`POST /api/v1/decide
${JSON.stringify(board.request, null, 2)}`}</pre>
            <p className="mt-3 text-sm text-muted">Find the agent at GET /api/v1/manifest. No key. No setup.</p>
          </section>
        </>
      ) : null}
      <section className="mt-4 rounded-2xl bg-surface p-4">
        <h2 className="font-display text-2xl">Calls from agents</h2>
        {decisions.length === 0 ? <p className="mt-2 text-sm text-muted">None yet. The endpoint is live.</p> : null}
        <ul className="mt-3 flex flex-col gap-2">
          {decisions.map((decision) => (
            <li key={decision.id} className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
              <span className="text-fg">{decision.verdict}</span>
              <span className="text-muted">
                {" "}
                · ${decision.amount_usd} · {decision.vendor} · {decision.category} · {decision.agent}
              </span>
              <span className="mt-1 block text-muted">{reasonsOf(decision.reasons).join(" ")}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
