# Frequently asked questions

## Product

### What problem does Loopfare solve?

It lets an API seller charge per HTTP request without issuing buyer accounts, API keys, subscriptions, or prepaid credits. A compatible client learns the price from an HTTP 402 response and pays with USDC.

### Is Loopfare a payment processor or custodian?

No. The seller configures the receiving address, the buyer controls the signing wallet, and the facilitator handles verification and settlement. Loopfare does not hold private keys or pooled customer balances.

### Can I put an existing API behind Loopfare?

Yes. Create a project and one or more routes pointing to the existing HTTP or HTTPS origin. The origin must be publicly routable in production and must not require credentials that Loopfare strips.

### Does the seller need to modify the origin?

Usually no. The origin should understand the original request method, path, query, body, and safe headers. It can use `X-Forwarded-By: loopfare` and `X-Loopfare-Request-Id` for tracing.

## Networks and payments

### Is the hosted service on mainnet?

No. It advertises Base Sepolia, CAIP-2 `eip155:84532`, and uses the x402.org test facilitator. This is an end-to-end beta with test assets.

### What asset does the CLI pay?

Only official USDC on Base Sepolia or Base. Requirements for other assets or networks are rejected.

### When is the seller origin called?

After the payment is verified. The payment settles only if the origin returns a status below 400. Origin errors cancel settlement and compatible budget reservations are refunded.

### Does a redirect from the origin work?

Loopfare does not follow it. The redirect response is returned as the protected response if its status is below 400, and normal x402 settlement rules apply. Prefer returning the final content directly.

### Why might a self-hosted paid demo be unavailable?

The operator has not configured `DEMO_PAY_TO`. A disabled deployment returns HTTP 503 rather than advertising a zero address. The public hosted beta has a configured Base Sepolia receiving wallet and advertises a real x402 payment requirement.

## Accounts and keys

### Can buyers call an endpoint without a Loopfare account?

Yes. Buyers need a compatible x402 client and a funded wallet, not a seller account.

### Can Loopfare recover a lost seller API key?

Not during the beta. Store the one-time key in a password manager or secret manager. If you still have the key, `loopfare rotate-key` replaces it immediately.

### Does signup verify email ownership?

No. Public beta signup validates address syntax and rate-limits requests but does not send verification email. Do not treat the email field as a verified identity claim.

### Where does the CLI store secrets?

In `~/.loopfare/config.json`, inside a mode `0700` directory with a mode `0600` file. Environment variables can override the seller or wallet key for automation.

### How do I install and test the CLI?

Install Node.js 22 or newer, then run `npx --yes @loopfare/cli@latest doctor` for a no-install check. It defaults to the hosted Base Sepolia service and does not create an account or spend assets. For repeated use, run `npm install --global @loopfare/cli@latest`. If npm reports `EACCES`, do not use `sudo`; follow the [user-owned prefix instructions](./TROUBLESHOOTING.md#npm-global-install-fails-with-eacces).

### Can I test a complete payment without faucet assets?

Yes, locally. Start the development server from the repository and call its demo with `loopfare call http://localhost:4021/demo/v1/fortune --dev`. Production rejects this development-payment mechanism. The hosted demo is also available for a real `$0.001` Base Sepolia USDC payment when the buyer wallet has testnet funds.

## Pricing and budgets

### What prices are accepted?

From `$0.000001` through `$10,000`, with at most six decimal places.

### Is a Loopfare budget a hard wallet limit?

No. It is a cooperative application safety rail. The server reservation is atomic for compatible requests, but the wallet can still sign other transactions, a third-party server can ignore Loopfare headers, and the client-supplied wallet hint is not proof of the signer.

### What happens when I create or import a different wallet?

The CLI clears the previous wallet's budget token, daily limit, and spend counter so they cannot be accidentally reused. Configure a new budget for the new address.

## Proxy and security

### Why can I not protect localhost or a private IP?

Production blocks those targets to prevent server-side request forgery into internal networks and metadata services. Set `ALLOW_PRIVATE_ORIGINS=true` only for a local development process you control.

### Which request headers reach the seller?

Most application headers do. Authorization, cookies, payment signatures, budget headers, proxy credentials, host/content-length, and hop-by-hop headers are removed. Review the complete list in the API reference.

### Can the seller origin set a cookie on the Loopfare domain?

No. `Set-Cookie` and `Set-Cookie2` are stripped from proxied responses.

### What are the size and time limits?

Defaults are a 1 MiB request body, 10 MiB proxy response, and 30-second origin timeout. Operators may lower them with environment variables.

## Hosting and scale

### Why does the Railway service use one replica?

SQLite is stored on one mounted volume. Multiple application replicas would not safely share that local database or the in-memory rate limiter.

### Can Loopfare scale beyond one replica?

Yes, after replacing SQLite with shared durable storage and moving rate limits and reservations to shared transactional infrastructure.

### Where are the manuals?

Use `/docs` on the hosted service. Each page also has a Markdown representation for agents and offline reading.
