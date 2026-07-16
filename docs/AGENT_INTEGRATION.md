# Agent integration

This guide is for developers making an autonomous client discover, evaluate, and pay Loopfare-protected resources.

## Discovery surfaces

| Surface | Purpose |
| --- | --- |
| `/skill.md` | Compact machine-readable seller and buyer instructions. |
| `/api` | Runtime version, network, public URL, demo state, and endpoint map. |
| `/docs` | Human-readable documentation center. |
| `/docs/<page>.md` | Raw Markdown manuals suitable for retrieval and indexing. |
| `/.well-known` | Not implemented in the current beta; do not assume it exists. |

An agent should fetch `/api` before taking a payment action and verify the advertised network matches its policy.

## Recommended buyer flow

1. Receive or choose the full protected HTTPS URL.
2. Check that the hostname is on the agent's allowlist.
3. Make the intended request without a payment header.
4. Require HTTP 402 and parse the x402 v2 `PAYMENT-REQUIRED` header.
5. Reject unsupported schemes, networks, assets, recipients, or amounts.
6. Compare the amount with a per-call limit and the remaining daily budget.
7. Present a human approval boundary when policy requires it.
8. Create the exact payment payload with a restricted wallet.
9. Retry the same method, URL, headers, and body with `PAYMENT-SIGNATURE`.
10. Require an acceptable HTTP response and `PAYMENT-RESPONSE`.
11. Record the request ID, quoted amount, settlement metadata, and tool result.

## Use the Loopfare CLI from an agent

The CLI is useful when the agent can execute a constrained subprocess and consume JSON:

```bash
loopfare --json call https://loopfare.example/p/weather/v1/forecast
```

Before enabling calls:

```bash
loopfare wallet create --json
loopfare budget set --daily 2 --json
loopfare config --json
```

Give the agent permission to invoke a narrow command wrapper, not unrestricted access to the config file or private key. Keep `--no-budget`, `wallet import`, `wallet create --show-private-key`, and configuration-changing seller commands outside the routine tool surface.

## Direct x402 client integration

Loopfare uses x402 v2 and the exact EVM scheme. A compatible client must preserve the original request during the paid retry. Use maintained x402 libraries rather than constructing signatures manually.

Policy checks should bind at least:

- scheme is `exact`;
- network is explicitly allowed;
- asset is the official USDC address for that network;
- amount is at or below the task maximum;
- pay-to address is expected for the selected service;
- resource URL and HTTP method are unchanged; and
- the payment has not expired.

## Headers for compatible budgets

The Loopfare CLI can add:

```text
X-Loopfare-Wallet: 0xBuyerAddress
X-Loopfare-Budget-Token: lb_secret
```

These headers activate the server-side cooperative budget. Do not send them to unrelated hosts. Loopfare removes them before forwarding to the seller origin.

The wallet header is a hint and is not cryptographically derived from the x402 signer by the current server. Treat the local signing policy and wallet balance as the primary limit.

## Safe tool schema

A high-level agent tool should expose constrained inputs:

```json
{
  "name": "call_paid_weather_api",
  "description": "Buy one weather response for at most $0.01 on Base Sepolia",
  "inputSchema": {
    "type": "object",
    "properties": {
      "city": { "type": "string", "maxLength": 100 }
    },
    "required": ["city"],
    "additionalProperties": false
  }
}
```

The host application—not the model—should construct the final allowlisted URL and enforce the price, network, method, timeout, and response-size policy.

## Response handling

Treat these outcomes differently:

| Outcome | Agent behavior |
| --- | --- |
| 200–399 with `PAYMENT-RESPONSE` | Record settlement and use the resource according to its content type. |
| 402 without signature | Parse requirements, apply policy, and optionally retry once. |
| 402 after signature | Do not loop; surface facilitator, budget, or settlement failure. |
| 403 `invalid_budget_token` | Stop and request operator configuration. |
| 404 `route_not_found` | Treat the tool route as stale. |
| 429 | Respect `Retry-After`; do not pay while rate-limited. |
| 502 or 504 | Retry only if the operation is safe and policy allows; settlement should have been cancelled. |
| 5xx | Stop repeated payments and alert the operator. |

## Idempotency

Loopfare does not add a universal idempotency key. For state-changing origin operations:

- use an origin-supported idempotency header;
- generate the key outside the retry loop;
- preserve it on the paid retry; and
- confirm the origin's replay semantics before autonomous use.

Do not automatically repeat a settled state-changing request merely because the client failed to parse its response.

## Prompt-injection boundary

Paid API responses are untrusted tool output. Do not let response text modify wallet policy, reveal secrets, expand host allowlists, or authorize follow-up payments. Validate structured data against a schema and keep payment decisions in deterministic code.

## Observability

Store the following without secrets:

- task or run identifier;
- URL template, not sensitive query values;
- method and response status;
- Loopfare `X-Request-Id`;
- quoted and settled amount;
- network, asset, and recipient;
- settlement transaction hash when available; and
- whether human approval was used.

Never log the private key, seller API key, budget token, or full payment signature.

## Seller automation

Seller agents can use `loopfare --json` management commands with a scoped secret environment. Require explicit approval before creating, updating, disabling, or deleting a paid route, rotating an API key, or changing a receiving wallet through future interfaces.

The seller key currently grants the entire account's management authority. Use a dedicated automation account until scoped API tokens are implemented.

