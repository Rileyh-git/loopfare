# Contributing to Loopfare

Thank you for helping improve Loopfare. Contributions to code, tests, security, documentation, examples, operations, accessibility, and protocol interoperability are welcome.

By contributing, you agree that your contribution is licensed under the repository's [MIT License](../LICENSE).

## Before you start

- Search existing issues and pull requests before beginning a large change.
- Open an issue for a behavior change, new protocol/network, schema redesign, or new dependency so maintainers can agree on scope.
- Do not open a public issue for a vulnerability. Follow [SECURITY.md](../SECURITY.md).
- Keep discussions respectful, specific, and focused on the work. The project does not yet include a separate code-of-conduct file.

Small fixes with clear intent can go directly to a pull request.

## Development prerequisites

- Node.js 22 or newer.
- npm with workspace support.
- Git.
- A writable temporary directory for SQLite tests.
- Optional: a Base Sepolia wallet and test USDC for end-to-end x402 testing.

Clone and install exactly from the lockfile:

```bash
git clone https://github.com/Rileyh-git/loopfare.git
cd loopfare
npm ci
```

## Local configuration

```bash
cp .env.example .env
npm run dev
```

The sample file enables local-only development payments and private origins. This permits a local origin such as `http://localhost:3000` and a synthetic `LOOPFARE-DEV-PAYMENT` header. Never copy those settings to production.

For an isolated development database, use a path outside any real deployment data:

```env
NODE_ENV=development
DATABASE_PATH=./data/loopfare-dev.db
PUBLIC_URL=http://localhost:4021
LOOPFARE_DEV_MODE=true
ALLOW_PRIVATE_ORIGINS=true
LOOPFARE_NETWORK=base-sepolia
```

Do not commit `.env`, `data/`, CLI configuration, wallet keys, seller API keys, budget tokens, payment signatures, or Railway link metadata containing sensitive state.

## Useful commands

```bash
npm run dev                         # watch the API source
npm run typecheck                   # typecheck API and CLI
npm test                            # API integration/security tests
npm run build                       # compile both workspaces
npm run check                       # typecheck, build, API/CLI tests, package dry run
npm audit --omit=dev                # production dependency audit
npm run cli -- --help               # run CLI source in development
npm run cli -- --json config        # inspect redacted local CLI state
```

Run `npm run check` before every pull request. Use `npm ci`, not `npm install`, when validating the committed dependency graph.

## Project conventions

### TypeScript and modules

- Use strict TypeScript and preserve native ESM.
- Include `.js` in relative imports; TypeScript emits files that Node resolves at runtime.
- Prefer small, explicit functions and validate input at the boundary.
- Avoid `any` in product code. Tests may use narrow convenience casts when the response shape is deliberately dynamic.
- Preserve structured JSON logging and stable error codes.
- Do not log credentials, private keys, payment signatures, authorization headers, bodies, or unredacted CLI configuration.

There is no standalone formatter/linter configuration today. Follow the existing two-space indentation, trailing commas, semicolons, and repository style. Keep formatting-only changes separate from behavior changes.

### Public API

- Treat existing status codes, JSON error codes, response fields, and headers as compatibility surface.
- Authenticate before revealing tenant-specific resource existence.
- Apply account ownership checks to every seller resource read and mutation.
- Put bounded Zod validation on all untrusted JSON and query input.
- Update public manuals and examples when behavior changes.
- Add an integration test for every new endpoint and each authorization failure mode.

### Reverse proxy

Proxy changes are security-sensitive. Maintain these invariants:

- payment completes before the origin is called;
- stored origins are validated at creation/update and immediately before use;
- the actual DNS answer is checked at the connection boundary;
- private, loopback, link-local, metadata, multicast, documentation, and reserved addresses fail closed in public mode;
- client authorization, cookies, payment material, budget tokens, host, and hop-by-hop headers are not forwarded;
- redirects are not silently followed;
- failures never fall back to an unpaid origin request.

Add tests for IPv4, IPv6, mapped addresses, mixed DNS results, redirects, headers, timeout, body limits, route precedence, and error mapping when changing this area.

### Payment code

- Keep CAIP-2 network identifiers explicit.
- Keep the buyer CLI asset allowlist restricted to official USDC addresses on supported Base networks unless a reviewed change expands it.
- Treat facilitator output as security-sensitive input.
- Never accept the local development payment header in production.
- Record settlement only after the x402 middleware has reported success.
- Test a real low-value Sepolia payment for changes that affect signing, requirements, verification, or settlement.

Do not enable mainnet as part of an unrelated change. Mainnet requires the gate in [SELF_HOSTING.md](./SELF_HOSTING.md).

### Database and migrations

The database opens and migrates during module import. Tests must set `DATABASE_PATH` before importing the application.

For schema changes:

1. Make the migration forward-only and idempotent.
2. Prefer additive columns/tables/indexes.
3. Preserve compatibility with the previous release when a safe application rollback is expected.
4. Use a transaction for multi-step data transformations.
5. Test both a new database and a fixture representing the previous schema.
6. Document backup, rollback, and any irreversible data effect.
7. Never edit or delete a user's database file in a test or migration.

SQLite remains a single-replica design. Do not introduce shared-file multi-host operation.

### CLI

- Every command should support deterministic top-level `--json` output.
- Hide secrets by default; require an explicit flag to print a private key.
- Write through `saveConfig` so directory/file modes are enforced.
- Provide useful nonzero exits without dumping secret-bearing objects.
- Treat local spend state as a safety rail and be explicit about concurrency limitations.

### Documentation

Public docs must distinguish current behavior from proposed behavior, and testnet from mainnet. Keep commands copyable, use portable Markdown, define destructive steps clearly, and link to primary protocol/platform sources when behavior is provider-specific.

When adding or changing an environment variable, update:

- `.env.example`;
- `packages/api/src/config.ts` validation;
- `docs/SELF_HOSTING.md` reference table;
- `docs/OPERATIONS_MANUAL.md` if it affects operation or incidents;
- relevant security and architecture sections.

## Testing

The API test suite uses Node's test runner through `tsx`, a temporary SQLite directory, and Hono's in-process request interface. It does not require a listening port or facilitator for development-payment tests. The CLI suite runs the compiled executable with isolated temporary home directories, verifies secret-safe wallet output and POSIX file modes, tests the hosted default, and injects a fake fetch implementation into `doctor`; it does not write test accounts or budgets to the hosted service.

Tests should be independent of execution order. The current signup rate limiter is process-local, so use direct database setup when a test does not specifically exercise signup.

At minimum, changes should cover:

- successful behavior;
- malformed and boundary input;
- missing/invalid authentication;
- cross-account access attempts;
- error response status/code;
- relevant persistence after a new app/database lifecycle;
- security header or header-stripping behavior where applicable.

For manual local proxy testing, run a separate disposable origin and use a development payment:

```bash
loopfare call http://localhost:4021/p/PROJECT_SLUG/path --dev --json
```

Only enable `ALLOW_PRIVATE_ORIGINS=true` on that isolated developer machine.

## Pull request process

1. Branch from the current default branch with a descriptive name.
2. Keep the change focused and include tests and documentation in the same pull request.
3. Run the complete local gate.
4. Review the diff for secrets, generated database files, unrelated formatting, and lockfile drift.
5. Describe the user impact, security impact, test evidence, migration/rollback plan, and documentation changes.
6. Mark protocol, proxy, authentication, database, wallet, or mainnet changes clearly for security review.
7. Address review comments with additional commits or a clearly explained update.

A useful pull request description includes:

```text
What changed:
Why:
Compatibility impact:
Security/privacy impact:
Database migration and rollback:
Tests performed:
Manual x402 test network/transaction (if applicable):
Documentation updated:
```

Maintainers may require a clean rebase and a passing automated check before merge. Do not rewrite another contributor's public branch without agreement.

## Dependency changes

- Explain why a new runtime dependency is necessary.
- Prefer maintained, typed, narrowly scoped packages.
- Inspect package provenance, license, transitive changes, and install scripts.
- Commit the exact `package-lock.json` result.
- Run the production audit and complete test/build gates.
- For x402 packages, review migration notes and test wire compatibility rather than relying only on types.

## Release process

`@loopfare/api` remains private. `@loopfare/cli` is public on npm. Pushing a tag matching `v<packages/cli.version>` runs `.github/workflows/publish.yml`, revalidates the repository, and publishes the CLI through npm Trusted Publishing with provenance.

For a release candidate:

1. Choose the semantic version and update root, API, CLI, lockfile, CLI version output, public API version output, and user-visible version references together.
2. Update public documentation and release notes for behavior, security, schema, or operations changes.
3. Run `npm ci`, `npm run check`, and `npm audit --omit=dev` from a clean checkout.
4. Perform a clean production build on Node.js 22.
5. Test upgrade from the previous database schema and application rollback against the migrated database.
6. For payment changes, complete an approved Base Sepolia end-to-end test.
7. Create and verify a production volume backup.
8. Deploy the reviewed commit, run the verification checklist, and observe it.
9. After the release is accepted, push the exact matching `vX.Y.Z` tag, verify the publish workflow succeeds, and confirm the npm package version and provenance.

Mainnet releases require the additional mainnet gate and independent security review.

## Reporting problems

For ordinary bugs, include:

- version/commit and Node.js version;
- operating system or hosting platform;
- network (`base-sepolia` or `base`);
- command or endpoint and redacted request ID;
- expected and actual behavior;
- minimal reproduction;
- redacted logs.

Never attach `.env`, `~/.loopfare/config.json`, wallet keys, seller keys, budget tokens, signatures, or raw platform variable exports.

## Common development problems

| Problem | Fix |
| --- | --- |
| Native `better-sqlite3` install/build fails | Use supported Node.js 22, reinstall from a clean `node_modules`, and ensure platform build tools are available. |
| App reads the wrong database | Set `DATABASE_PATH` before importing/starting the API; remove stale shell overrides. |
| Production-mode test refuses to start | Keep `LOOPFARE_DEV_MODE=false`, or use `NODE_ENV=test` for an isolated automated test. |
| Local origin is rejected | Use an isolated dev environment with `ALLOW_PRIVATE_ORIGINS=true`; never change the public default. |
| CLI cannot authenticate | Check redacted `loopfare config`, API URL, and key rotation; avoid printing the full key. |
| ESM module cannot be found after build | Use `.js` on relative TypeScript imports and confirm the file is included in `tsconfig`. |
| Tests use the real database | Set a unique temporary `DATABASE_PATH` before dynamic imports and clean it in test teardown. |
| End-to-end payment stays 402 | Verify Sepolia network, official USDC, wallet funding, facilitator availability, and payment headers. |

## Maintainer review priorities

Review in this order:

1. Can payment be bypassed or falsely recorded?
2. Can one account read or mutate another account's data?
3. Can a seller origin reach protected infrastructure or affect the shared domain?
4. Can a secret be logged, returned, committed, or stored recoverably?
5. Can a migration corrupt data or make rollback impossible?
6. Can a budget or amount be misinterpreted across units, assets, networks, or concurrency?
7. Does the operational documentation accurately describe the new failure mode?

That order reflects Loopfare's core trust boundaries: payment integrity, tenant isolation, proxy safety, secret handling, and recoverability.
