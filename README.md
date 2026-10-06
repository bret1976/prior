# Prior

Spend gate for other agents. The rules are already published. Over $100 is denied. Nobody approves it.

Remote MCP endpoint: `https://prior-mu.vercel.app/mcp`

Tools: `decide`, `buy`, `confirm_payment`. A purchase is a Stripe Checkout. The charge is collected only after Stripe reports the session paid. Payments land in the Stripe account attached to this deployment.

## checkout-guard-v1 (backend only)

Abuse guard for the public, no-login endpoints. Nothing on the page changes.

- `POST /api/v1/checkout` and MCP `buy`: amount capped at `CHECKOUT_MAX_USD` (default $100, the same line Prior publishes), at most `CHECKOUT_PER_IP_PER_HOUR` (10) new sessions per address and `CHECKOUT_GLOBAL_PER_HOUR` (120) overall → `429` with `retry-after`. The product name shown on Stripe is cleaned (control characters stripped; links, emails, and phone numbers fall back to "Prior"). Sessions carry `metadata[app]=prior`.
- `GET /api/v1/checkout/{id}` and MCP `confirm_payment`: only real `cs_test_…`/`cs_live_…` ids, `CONFIRM_PER_IP_PER_HOUR` (240).
- `POST /api/v1/decide` and MCP `decide`: `DECIDE_PER_IP_PER_MINUTE` (120); agent/vendor/category ≤ `DECIDE_FIELD_MAX_CHARS` (120) → `422`. In-memory history on Vercel is bounded (1000 decisions, 2000 idempotency keys) and today's spend is a running total, so trimming never under-counts the daily cap.
- `GET /api/v1/health`: pack marker, limits, and block counters.
- Kill switch: `PRIOR_GUARD=0`. Limits are per warm instance (in memory).

Patterns, not code: Stripe "Protect yourself from card testing" (rate-limit session creation); anomalyco/opencode PR #45007 (MIT) "rate limit checkout session creation"; revanthrajeev/spendveto (Apache-2.0) burst guard idea. All code here is original.
