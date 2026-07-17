# Release notes

Loopfare follows semantic versioning for application releases. During the `0.x` beta, minor releases may include API or operational changes that require explicit upgrade review.

## 0.2.5 — hosted paid demo

- Enable the public `$0.001` Base Sepolia USDC demo with an operator-controlled receiving wallet.
- Pin x402 resource metadata to the configured public HTTPS URL instead of the reverse proxy's internal request scheme.
- Apply the same canonical resource URL handling to seller-created paid proxy routes, including query strings.
- Update hosted-beta documentation now that real demo payments are available.

## 0.2.4 — portable CLI installation

- Make `npx --yes @loopfare/cli@latest doctor` the primary zero-install diagnostic path.
- Document npm `EACCES` recovery through a Node version manager or user-owned npm prefix, without `sudo`.
- Update the npm package README, website quickstart, FAQ, manuals, CLI reference, and troubleshooting guide with consistent installation guidance.
- Clarify that the supported x402 exact flow does not normally require a separate buyer gas balance.

## 0.2.3 — trusted npm release

- Publish `@loopfare/cli` through npm Trusted Publishing with GitHub Actions OIDC provenance.
- Correct the release job's local tarball path so npm publishes the verified artifact instead of treating it as a Git package spec.

## 0.2.2 — public install and release hardening

- Replace source-install instructions with the public npm install and no-install `npx` paths.
- Keep repository, application, CLI, package metadata, tests, and public references on one release version.
- Preserve the source-link workflow only for contributors developing the CLI locally.
- Split release verification from publishing so dependency scripts never receive OIDC authority, pin third-party actions, require the tag commit on `main`, and package the license.

## 0.2.1 — public CLI readiness

- Default fresh CLI installs to the hosted Base Sepolia service while preserving explicit local and self-hosted configuration.
- Add `loopfare doctor` for runtime, service, wallet, budget, and file-permission diagnostics without exposing secrets.
- Add clean-home CLI smoke tests and npm package validation to the required CI gate.
- Prepare `@loopfare/cli` metadata and packaged files for public npm distribution.
- Add a no-funds source-install quickstart, package README, and public issue templates.
- Correct wallet environment-key and request content-type documentation.

## 0.2.0 — production-operated testnet beta

### Product

- Added the Railway-inspired Loopfare product website.
- Added a hosted documentation center with HTML and raw Markdown representations.
- Added seller, buyer, CLI, API, error, agent, architecture, security, self-hosting, operations, troubleshooting, support, and contributor manuals.
- Expanded the CLI with route update/delete, project delete confirmation, key rotation, safe wallet output, budget management, and JSON automation.

### Payments

- Upgraded the public contract to x402 v2 header names and CAIP-2 networks.
- Restricted the bundled client to official USDC on Base and Base Sepolia.
- Corrected settlement ordering so the seller origin must succeed before settlement.
- Preserved `PAYMENT-RESPONSE` on the protected origin response.
- Record facilitator transaction identifiers when supplied.
- Record successful real demo settlements.

### Buyer safety

- Require a configured budget for real CLI payments unless `--no-budget` is explicit.
- Reserve local spend atomically before signing and reconcile it after settlement.
- Reserve compatible server budget spend transactionally before origin forwarding and refund it on failure.
- Clear wallet-specific budget state when creating or importing another wallet.
- Derive the effective address from environment-provided private keys.
- Respect an explicit user `Content-Type` on paid calls.

### Seller and proxy security

- Hash seller API keys and remove legacy plaintext values during migration.
- Scope global payment history to the authenticated seller.
- Add origin URL normalization, public DNS checks, private-range blocking, and socket-time DNS-rebinding protection.
- Disable redirect following and strip credentials, cookies, payment headers, budget hints, hop-by-hop headers, and origin cookies.
- Add request-body, response-size, timeout, CORS, security-header, and rate-limit controls.
- Map origin connection and timeout failures to stable 502 and 504 JSON errors.

### Operations

- Compile TypeScript before production start instead of executing source with `tsx`.
- Standardize on Node.js 22.
- Add readiness checks, graceful shutdown, SQLite WAL and busy timeout, a persistent Railway volume, and structured logs.
- Add CI, tests, dependency auditing, a production runbook, security policy, and MIT license.

### Compatibility

- Existing SQLite databases are migrated forward in place.
- Existing plaintext seller API keys continue to authenticate after their stored value is replaced by a digest.
- Production refuses `LOOPFARE_DEV_MODE=true`.
- Base mainnet refuses the public x402.org test facilitator.
- Paid proxy responses no longer pass `Set-Cookie` or `Set-Cookie2`.
- Proxy requests and responses are now size-limited.

### Upgrade procedure

1. Back up the SQLite database and verify the backup.
2. Run `npm ci`, `npm run check`, and `npm audit --omit=dev`.
3. Confirm Node.js 22 and the documented environment variables.
4. Deploy one replica with the volume mounted at `/data`.
5. Wait for `/health/ready` before sending traffic.
6. Smoke-test the website, documentation, authentication, one unpaid 402 challenge, and a low-value testnet settlement.
7. Review logs for migration, facilitator, origin, or settlement errors.

## 0.1.0 — initial MVP

- Added the Hono API, SQLite schema, dynamic paid routes, x402 integration, basic seller management, buyer wallet CLI, and local development payment mode.

Version 0.1 should not be used for public production traffic because it lacks the isolation, secret handling, proxy controls, tests, and operations behavior introduced in 0.2.
