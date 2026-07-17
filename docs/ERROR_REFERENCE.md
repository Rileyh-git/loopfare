# Loopfare error reference

This reference covers Loopfare `0.2.4`. Always record the response status, body, and `X-Request-Id`. Payment-protocol errors can also carry `PAYMENT-REQUIRED` or `PAYMENT-RESPONSE`.

## Body formats

Loopfare currently has three error representations.

### Stable JSON code

```json
{
  "error": "rate_limited",
  "message": "Too many requests"
}
```

The `message` field is omitted in a small number of responses.

### Validation JSON

```json
{
  "error": "validation_error",
  "issues": [
    {
      "code": "invalid_string",
      "validation": "email",
      "path": ["email"],
      "message": "Invalid email"
    }
  ]
}
```

The `issues` array follows Zod v3. Do not use its wording as a durable machine contract; use `error` and `path`.

### HTTP exception JSON

Authorization, ownership, and parameter checks use a status-derived code and include the request ID:

```json
{
  "error": "unauthorized",
  "message": "Invalid API key",
  "requestId": "a4a5800b-b20e-4f87-90bd-845e9618c42e"
}
```

### x402 protocol response

The x402 middleware places the authoritative payment challenge in a base64-encoded `PAYMENT-REQUIRED` response header. The body is commonly `{}` for an API client and may be HTML for a web browser. Payment/facilitator errors may use protocol-defined JSON or `{ "error": "facilitator message" }`.

## JSON error codes

| Code | HTTP | Endpoints | Meaning | Corrective action |
| --- | ---: | --- | --- | --- |
| `account_exists` | 409 | `POST /v1/auth/signup` | That normalized email already has an account. | Use the existing API key or contact the operator for assisted rotation/recovery. |
| `bad_request` | 400 | Route management, payment history | An origin check or query parameter check failed. | Correct the request using `message`. |
| `budget_exceeded` | 402 | `/p/:projectSlug/*` | Recorded spend plus this route price exceeds the wallet's UTC daily limit. | Raise the budget with the same token, wait for the UTC day boundary, or do not make the call. |
| `demo_not_configured` | 503 | `GET /demo/v1/fortune` | The deployment has no nonzero demo receiving wallet and dev mode is off. | Use a seller paid route or wait for the operator to configure the demo. |
| `doc_not_found` | 404 | `/docs/:slug`, `/docs/:slug.md` | No registered public document uses that slug. | Use a link from `/docs` or the sitemap. |
| `forbidden` | 403 | Buyer budget create/read | The token cannot access that wallet budget. | Use the token that created the budget. |
| `bad_gateway` | 502 | Paid proxy | The seller origin could not be reached or exceeded the response limit. | Retry only when safe; the seller should check origin health and response size. |
| `gateway_timeout` | 504 | Paid proxy | The seller origin exceeded the configured request timeout. | Retry only when the upstream operation is safe and idempotent. |
| `internal_error` | 500 | Any | Unexpected unhandled failure. | Retry only when safe, then report the request ID. Production hides internal details. |
| `invalid_budget_token` | 403 | `/p/:projectSlug/*` | The wallet record is absent or the supplied token does not match. | Use the token that created the wallet budget or create a budget first. |
| `invalid_json` | 400 | JSON endpoints | The request body could not be parsed as JSON. | Send syntactically valid JSON with `Content-Type: application/json`. |
| `not_found` | 404 | Unknown path | No application endpoint matched. | Check the path and API version. |
| `origin_unavailable` | 502 | `/p/:projectSlug/*` | The configured origin failed the current public-address safety check. | The seller must update DNS or route origin configuration. |
| `payload_too_large` | 413 | `/v1/*`, `/p/*` | The management or paid-proxy request body exceeds the deployment limit. | Reduce the body size. |
| `payment_required` | 402 | Local dev demo; fallback paid proxy | A payment or local dev authorization is required. | Follow `howToPay` in local dev, or use the x402 challenge/header in a real environment. |
| `rate_limited` | 429 | `/v1/*`, `/p/*` | The in-memory per-client request window is exhausted. | Wait for `Retry-After` or `RateLimit-Reset`. |
| `route_not_found` | 404 | `/p/:projectSlug` and `/p/:projectSlug/*` | No enabled route in that project matched the request method and normalized path. | Check project slug, method, route pattern, and enabled state. |
| `signup_disabled` | 503 | `POST /v1/auth/signup` | The operator has closed new registrations. | Retry only after signup is reopened. |
| `slug_taken` | 409 | `POST /v1/projects` | A project already uses that slug globally. | Choose another slug. |
| `unauthorized` | 401 | Seller and buyer-budget endpoints | A required Bearer API key or budget token is missing, malformed, or invalid. | Supply the appropriate secret; seller keys and budget tokens are not interchangeable. |
| `validation_error` | 400 | JSON endpoints | One or more fields failed schema validation. | Correct each entry in `issues`. |
| `wallet_required` | 400 | `/p/:projectSlug/*` | `X-Loopfare-Budget-Token` was sent without `X-Loopfare-Wallet`. | Send both budget headers, or neither. |

## Status-derived errors

| Code | Message | HTTP | Cause |
| --- | --- | ---: | --- |
| `unauthorized` | `Missing Bearer API key` | 401 | Seller endpoint called without a nonempty `Authorization: Bearer ...` value |
| `unauthorized` | `Invalid API key` | 401 | Seller Bearer token hash did not match an account |
| `unauthorized` | `Missing or invalid budget token` | 401 | Budget token missing or outside the 24–200 character limit |
| `forbidden` | `Invalid budget token` | 403 | Budget record is absent or owned by another token |
| `not_found` | `Project not found` | 404 | Project missing or not owned by the authenticated seller |
| `not_found` | `Route not found` | 404 | Route missing or not in the owned parent project |
| `bad_request` | `limit must be an integer from 1 to 100` | 400 | Invalid payment-history `limit` query |
| `bad_request` | Origin safety explanation | 400 | Route create/update origin is syntactically unsafe, resolves privately, or cannot be accepted |

Origin-safety text can include:

- `Origin URL is too long`
- `Origin URL is invalid`
- `Origin URL must use http or https`
- `Origin URL cannot contain credentials`
- `Origin URL cannot contain a query string or fragment`
- `Origin hostname is not allowed`
- `Origin hostname did not resolve`
- `Origin must resolve only to public IP addresses`

DNS resolver errors can also be surfaced during route creation or update.

## x402 and facilitator errors

### Payment challenge

An HTTP `402` with `PAYMENT-REQUIRED` is a protocol response, not an operational failure. Decode it with an x402 v2 client, select a supported `exact` EVM requirement, sign, and retry with `PAYMENT-SIGNATURE`.

### Invalid or rejected payment

The x402 middleware can return `402` with a new or explanatory payment declaration when a signature is missing, malformed, invalid, expired, already used, or otherwise rejected. The header is authoritative; do not branch only on the response body.

### Allowance prerequisite

The x402 middleware may return `412` when its payment requirement reports `permit2_allowance_required`. Follow the decoded requirement using a compatible client.

### Facilitator failure

Facilitator initialization, verification, or settlement failure is returned as `502`, normally:

```json
{
  "error": "FACILITATOR_MESSAGE"
}
```

Do not blindly retry a settlement error. First use the x402 settlement response, facilitator state, and wallet state to determine whether value moved.

## Retry guidance

| Status | Default retry guidance |
| ---: | --- |
| `400`, `401`, `403`, `404`, `409`, `412`, `413` | Do not retry unchanged. Fix the request, credentials, route, allowance, or body. |
| `402` x402 challenge | Retry once with a newly created valid `PAYMENT-SIGNATURE`. |
| `402 budget_exceeded` | Do not retry until the limit changes or a new UTC day begins. |
| `429` | Retry after the advertised delay, with jitter. |
| `500`, `502`, `503`, `504` | Retry only if the operation is safe and idempotent; use exponential backoff and preserve the request ID. For payment operations, reconcile settlement first. |

## Reporting an incident

Provide:

- UTC timestamp;
- request method and path, with secrets removed;
- HTTP status and response body;
- `X-Request-Id`;
- network and CAIP-2 ID from `GET /api`;
- whether `PAYMENT-REQUIRED` or `PAYMENT-RESPONSE` was present;
- facilitator or wallet transaction evidence, if applicable.

Never include a seller API key, budget token, wallet private key, or raw payment signature in a report.
