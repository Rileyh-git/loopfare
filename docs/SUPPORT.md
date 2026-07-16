# Support

Loopfare is an open-source Base Sepolia beta. Community support is available through the GitHub repository; no paid support plan or contractual response time is offered yet.

## Product questions

Before opening an issue:

1. Read the [quickstart](./QUICKSTART.md) and [core concepts](./CONCEPTS.md).
2. Check [troubleshooting](./TROUBLESHOOTING.md) for the status or error code.
3. Search existing GitHub issues for the same behavior.
4. Confirm the behavior against the current `main` branch or linked beta release.

Open a public issue at `https://github.com/Rileyh-git/loopfare/issues` for reproducible, non-sensitive bugs and documentation gaps.

## What to include

- Loopfare version and commit SHA
- Hosted beta, self-hosted Railway, or local development
- Node.js version
- Base or Base Sepolia network
- Command or request with every secret redacted
- HTTP status, safe JSON body, and `X-Request-Id`
- Expected behavior and actual behavior
- Minimal reproduction steps

Replace private keys, API keys, budget tokens, signatures, emails, wallet balances, and sensitive query/body data with clear placeholders.

## Security reports

Do not open a public issue for a vulnerability or suspected secret exposure. Follow the private reporting process in the repository `SECURITY.md`. If a secret is exposed, rotate or abandon it immediately before waiting for a response.

## Payment and wallet incidents

Loopfare does not custody funds and cannot reverse an onchain transaction. For an exposed buyer key:

1. Stop the agent and affected automation.
2. Move remaining assets to a new wallet.
3. Replace the local wallet configuration.
4. Configure a new budget for the new address.
5. Review transaction history and logs.

For a disputed seller response, preserve the request ID, `PAYMENT-RESPONSE`, transaction hash, quoted requirement, response status, and timestamp. The public beta does not yet publish a contractual refund process; sellers receiving funds are responsible for their own commercial and refund terms.

## Service status

- Liveness: `/health/live`
- Readiness: `/health/ready`
- Runtime metadata: `/api`
- Railway deployment state: the project dashboard owned by the operator

The website footer checks application health, but it is not a historical status page or availability guarantee.

## Documentation corrections

Open an issue with:

- the page title and URL;
- the incorrect or missing detail;
- the relevant current behavior or source location; and
- a suggested correction when possible.

Every hosted page has a raw `.md` representation suitable for quoting a short section in an issue.
