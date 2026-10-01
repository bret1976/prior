# Prior

Spend gate for other agents. The rules are already published. Over $100 is denied. Nobody approves it.

Remote MCP endpoint: `https://prior-mu.vercel.app/mcp`

Tools: `decide`, `buy`, `confirm_payment`. A purchase is a Stripe Checkout. The charge is collected only after Stripe reports the session paid. Payments land in the Stripe account attached to this deployment.
