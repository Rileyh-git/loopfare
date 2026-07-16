# Loopfare CLI reference

This is the complete command reference for Loopfare CLI 0.2.1. The CLI combines seller administration with a local x402 buyer wallet.

## Install from the repository

The CLI package contains public npm metadata but is not published to npm yet. Install from the public Loopfare repository:

```bash
npm ci
npm run build -w @loopfare/cli
npm link -w @loopfare/cli
loopfare --version
loopfare doctor
```

Node.js 22 or later is required.

## Syntax and global options

```text
loopfare [global options] <command> [command options]
```

| Option | Meaning |
| --- | --- |
| `-V`, `--version` | Print the CLI version and exit. |
| `--json` | Print machine-readable, pretty-printed JSON. Place it before the command. |
| `-h`, `--help` | Print top-level help. |
| `help [command]` | Print help for a command group or command. |

Every command and command group also accepts `-h, --help`. The `projects`, `routes`, `wallet`, and `budget` groups accept `help [command]` for their children.

Examples:

```bash
loopfare --help
loopfare projects --help
loopfare help protect
loopfare --json projects list
```

Most non-JSON successful output is also JSON-formatted today. Scripts should still pass `--json`, because it guarantees structured error output as the interface evolves.

## Configuration and environment

The default configuration file is:

```text
~/.loopfare/config.json
```

The CLI creates `~/.loopfare` with mode `0700` and the file with mode `0600` whenever it saves configuration.

Stored fields include the API URL, seller API key, optional email label, buyer private key/address, daily budget, secret budget token, and local UTC-day spend. Do not commit or share the file.

Environment precedence:

| Environment variable | Overrides |
| --- | --- |
| `LOOPFARE_API_URL` | Stored `apiUrl`; default is `https://api-production-dd0a0.up.railway.app`. |
| `LOOPFARE_API_KEY` | Stored seller `apiKey`. |
| `EVM_PRIVATE_KEY` | Stored buyer private key; highest private-key precedence. |
| `LOOPFARE_PRIVATE_KEY` | Stored buyer private key when `EVM_PRIVATE_KEY` is unset. |
| `LOOPFARE_DEV_PAYMENT=1` | Makes `call` use development-payment mode. |

There are no environment overrides for the budget token, daily limit, or local spend counter. When an environment private key is present, the CLI derives and displays its address instead of trusting a stale stored address. Configure a budget for that effective wallet before paying.

## Command summary

| Command | Purpose |
| --- | --- |
| `config` | Show redacted local configuration. |
| `set-api <url>` | Save the Loopfare API base URL. |
| `doctor` | Check runtime, API, wallet, budget, and configuration readiness. |
| `signup --email <email>` | Create a seller account and save its API key. |
| `login --api-key <key>` | Save an existing seller key. |
| `whoami` | Validate the seller key and show account identity. |
| `rotate-key` | Replace the seller API key. |
| `projects create/list/get/delete` | Manage seller projects. |
| `protect` | Create a protected route. |
| `routes list/update/delete` | Manage protected routes. |
| `earnings` | Show project payments and aggregate earnings. |
| `wallet create/show/import` | Manage the local buyer wallet. |
| `budget set/show` | Manage the buyer daily budget. |
| `call <url>` | Make an x402-aware HTTP request. |

## `config`

```text
loopfare config
```

Shows:

- configuration file path;
- effective API URL;
- optional email label;
- a redacted seller API-key prefix;
- wallet address and whether a private key exists;
- daily budget and whether a budget token exists;
- current UTC date and locally recorded spend for that date.

It does not validate the API key, contact the service, or expose full secrets.

## `set-api`

```text
loopfare set-api <url>
```

Arguments:

| Argument | Required | Meaning |
| --- | --- | --- |
| `<url>` | Yes | Base URL using `http` or `https`, such as `https://loopfare.example`. |

The CLI parses and normalizes the URL, removes one trailing slash, saves it, and prints the result. An active `LOOPFARE_API_URL` environment variable remains the effective value for that process, but environment overrides are never persisted into the config file implicitly.

## `doctor`

```text
loopfare doctor [--timeout <ms>]
```

Checks:

- Node.js major-version support;
- `GET /api` and `GET /health/ready` on the effective service;
- advertised application version, network, protocol, and demo availability;
- whether seller, wallet, and budget configuration exists; and
- whether the local configuration file has owner-only permissions on POSIX systems.

The default timeout is 5000 milliseconds and the accepted range is 250–30000. The command never prints private keys, complete seller keys, or budget tokens. It exits nonzero when the configured API is unreachable or not ready, while missing optional seller/wallet setup is reported through `next` steps.

## `signup`

```text
loopfare signup --email <email>
```

Options:

| Option | Required | Meaning |
| --- | --- | --- |
| `--email <email>` | Yes | Valid seller email, at most 254 characters. |

Creates an account, saves the returned API key and email, and prints the key. The key is shown once by the API. Signup is limited to five attempts per hour per client identifier and may be disabled by the operator.

## `login`

```text
loopfare login --api-key <key> [--email <email>]
```

Options:

| Option | Required | Meaning |
| --- | --- | --- |
| `--api-key <key>` | Yes | Existing `lf_...` seller key. |
| `--email <email>` | No | Local label only. |

Saves the values without contacting the server. The output redacts the key. Use `whoami` to validate it.

## `whoami`

```text
loopfare whoami
```

Calls `GET /v1/auth/me` and prints `accountId` and `email`. Requires an effective seller API key.

## `rotate-key`

```text
loopfare rotate-key
```

Calls `POST /v1/auth/rotate-key`, saves and prints the replacement, and invalidates the previous key immediately. Capture the output securely and update automation secrets in the same operating session.

## `projects create`

```text
loopfare projects create --name <name> --slug <slug> --pay-to <address>
```

Options:

| Option | Required | Meaning |
| --- | --- | --- |
| `--name <name>` | Yes | Display name, 1–80 characters. |
| `--slug <slug>` | Yes | Globally unique 2–40 character public slug: letters, numbers, and single hyphens. |
| `--pay-to <address>` | Yes | `0x`-prefixed 40-byte EVM receiving address. |

Returns the project database fields plus `proxyBase`. The slug is normalized to lowercase. Verify the receiving address and network; there is no project-update command.

## `projects list`

```text
loopfare projects list
```

Returns `{ "projects": [...] }` for the authenticated account, newest first. Each project includes `proxyBase`.

## `projects get`

```text
loopfare projects get <id>
```

Arguments:

| Argument | Required | Meaning |
| --- | --- | --- |
| `<id>` | Yes | Project ID returned by create/list. |

Returns `project`, `routes`, and aggregate `earnings`.

## `projects delete`

```text
loopfare projects delete <id> --yes
```

Arguments and options:

| Item | Required | Meaning |
| --- | --- | --- |
| `<id>` | Yes | Project ID. |
| `--yes` | Yes | Non-interactive confirmation of permanent deletion. |

Deletes the project and cascades deletion to its routes. The CLI reports `deletedProjectId` after HTTP 204.

## `protect`

```text
loopfare protect --project <id> --origin <url> [options]
```

Options:

| Option | Required | Default | Meaning |
| --- | --- | --- | --- |
| `--project <id>` | Yes | — | Project ID. |
| `--origin <url>` | Yes | — | Public upstream HTTP/HTTPS base URL. |
| `--path <pattern>` | No | `/*` | Exact, parameterized, or trailing-wildcard path. |
| `--price <price>` | No | `$0.001` | Per-call USDC amount; `$` optional, up to six decimal places, `$0.000001`–`$10000`. |
| `--description <text>` | No | `Protected by Loopfare` | Route/payment description, at most 500 characters. |
| `--methods <list>` | No | All seven supported methods | Comma-separated `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`, or `*`. |

Creates an enabled route and prints `route`, `publicUrl`, and an example proxy URL. Origin safety checks reject internal/private destinations in production.

## `routes list`

```text
loopfare routes list --project <id>
```

Options:

| Option | Required | Meaning |
| --- | --- | --- |
| `--project <id>` | Yes | Project ID. |

Returns `{ "routes": [...] }`, newest first.

## `routes update`

```text
loopfare routes update --project <id> --route <id> [changes]
```

Identity options:

| Option | Required | Meaning |
| --- | --- | --- |
| `--project <id>` | Yes | Owning project ID. |
| `--route <id>` | Yes | Route ID. |

Change options:

| Option | Meaning |
| --- | --- |
| `--origin <url>` | Replace the upstream origin after safety validation. |
| `--path <pattern>` | Replace the path pattern. |
| `--price <price>` | Replace the per-call price. |
| `--description <text>` | Replace the description. An empty shell argument can clear it. |
| `--methods <list>` | Replace the entire method list. |
| `--enable` | Enable matching. |
| `--disable` | Disable matching. |

At least one change is required. `--enable` and `--disable` cannot be used together. The result is `{ "route": ... }`.

## `routes delete`

```text
loopfare routes delete --project <id> --route <id> --yes
```

Options:

| Option | Required | Meaning |
| --- | --- | --- |
| `--project <id>` | Yes | Owning project ID. |
| `--route <id>` | Yes | Route ID. |
| `--yes` | Yes | Non-interactive confirmation of permanent deletion. |

Returns `deletedRouteId` after HTTP 204.

## `earnings`

```text
loopfare earnings --project <id> [--limit <n>]
```

Options:

| Option | Required | Default | Meaning |
| --- | --- | --- | --- |
| `--project <id>` | Yes | — | Project ID. |
| `--limit <n>` | No | `50` | Recent payment count, integer 1–100. |

Returns `payments` and `earnings` (`count`, `volume_usd`). Both `settled` and local-development `dev_settled` events contribute to the aggregate.

## `wallet create`

```text
loopfare wallet create [--show-private-key]
```

Options:

| Option | Default | Meaning |
| --- | --- | --- |
| `--show-private-key` | Off | Include the generated key in output. It is always saved locally. |

Generates a new EVM private key/address and overwrites the stored wallet fields. By default only the address is printed. Back up an existing wallet before running this command. The previous budget token, limit, and local-spend fields are cleared; set a new budget before paying with the new address.

## `wallet show`

```text
loopfare wallet show
```

Prints the current address and config path. It uses a stored address first; when none exists, it derives an address from the effective private key.

## `wallet import`

```text
loopfare wallet import --private-key <key>
```

Options:

| Option | Required | Meaning |
| --- | --- | --- |
| `--private-key <key>` | Yes | EVM private key; the `0x` prefix is optional. |

Validates the key by deriving an account, then saves the key and address. Passing secrets on a command line can expose them through history or process inspection.

## `budget set`

```text
loopfare budget set --daily <usd>
```

Options:

| Option | Required | Meaning |
| --- | --- | --- |
| `--daily <usd>` | Yes | Positive numeric daily limit, at most `1000000`. |

Requires a wallet and service API URL. It creates or reuses the local `lb_...` budget token, saves the local limit/address, and sends the limit to `POST /v1/buyer/budget` with `X-Loopfare-Budget-Token`.

The server returns:

```json
{
  "budget": {
    "walletAddress": "0x...",
    "dailyLimitUsd": 5,
    "spentTodayUsd": 0,
    "remainingTodayUsd": 5,
    "spentDay": "YYYY-MM-DD",
    "updatedAt": "ISO-8601 timestamp"
  }
}
```

The budget token that first claims a wallet remains required for future changes.

## `budget show`

```text
loopfare budget show
```

Requires a wallet and existing budget token. Reads `GET /v1/buyer/budget/:address` and returns the public budget object above. It does not expose the token.

## `call`

```text
loopfare call <url> [options]
```

Argument:

| Argument | Required | Meaning |
| --- | --- | --- |
| `<url>` | Yes | Full `http` or `https` URL. |

Options:

| Option | Default | Meaning |
| --- | --- | --- |
| `-X, --method <method>` | `GET` | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, or `OPTIONS`; case-insensitive input. |
| `-d, --data <body>` | None | Request body. GET and HEAD reject it. When present, the client forces `Content-Type: application/json`. |
| `-H, --header <header...>` | None | One or more `Key: Value` extra headers. Entries without `:` are ignored. |
| `--dev` | Off | Send the local-only `LOOPFARE-DEV-PAYMENT: ok` header instead of x402 payment. |
| `--no-budget` | Off | Explicitly allow a real payment without local budget enforcement. |

Real-payment requirements:

- a stored or environment private key;
- by default, a positive local daily budget and secret budget token;
- an x402 v2 exact-scheme challenge using official USDC on Base (`eip155:8453`) or Base Sepolia (`eip155:84532`);
- enough compatible funds in the wallet.

The client chooses the cheapest compatible requirement that fits the remaining local budget. Before signing, it atomically reserves the quoted amount in the local UTC-day counter; a short-lived file lock prevents concurrent CLI processes from selecting the same remaining allowance. Failed verification or settlement releases the reservation, and successful settlement reconciles it with the facilitator amount. When calling a Loopfare proxy, the CLI also sends the wallet address and budget token so that proxy can apply its server-side reservation.

Representative JSON result:

```json
{
  "status": 200,
  "paymentStatus": "settled",
  "paymentHeader": {},
  "body": {},
  "wallet": "0x...",
  "budget": {
    "dailyLimitUsd": 5,
    "spentTodayUsd": 0.001
  }
}
```

Development mode returns a different shape:

```json
{
  "status": 200,
  "payment": "dev",
  "body": {}
}
```

Use a low-value dedicated wallet. `--no-budget` disables local enforcement for the call; budget state is not an on-chain cap.

## Route-path and pricing grammar

Path patterns are normalized with a leading slash. Supported matching forms are:

| Form | Example | Matches |
| --- | --- | --- |
| Exact | `/v1/quote` | Only `/v1/quote`. |
| Parameter segment | `/v1/users/:id` | One value in the `:id` position. |
| Trailing wildcard | `/v1/*` | `/v1` and all descendants. |
| Segment wildcard | `/v1/*/detail` | Any one segment in that position. |

Price input becomes a `$`-prefixed string. It must be between `$0.000001` and `$10000` and have at most six decimal places, matching USDC precision.

## JSON automation contract

Pass `--json` before the command:

```bash
loopfare --json whoami
```

Success is pretty-printed JSON on stdout. Runtime/API failures are also JSON on stdout and exit with code 1:

```json
{
  "error": "API 404 /v1/projects/example",
  "body": {
    "message": "Project not found"
  }
}
```

Commander usage errors, such as a missing required option, may use its standard help/error output. Automation should check the exit code before consuming output.

Safe shell pattern:

```bash
set -o pipefail
if output="$(loopfare --json projects list)"; then
  printf '%s\n' "$output" | jq -e '.projects | type == "array"'
else
  status=$?
  printf '%s\n' "$output" >&2
  exit "$status"
fi
```

Avoid embedding API keys or private keys in scripts. Inject them through a secret manager, disable shell tracing around secret-bearing steps, and prevent captured command output from being published as CI artifacts.

## Exit behavior

- Successful commands exit `0`.
- Caught validation, network, API, wallet, budget, and payment errors exit `1`.
- `call` also exits `1` when the final HTTP response is not successful, after printing the response.
- Help and version requests exit after printing their text.

## Common errors

| Message/status | Meaning |
| --- | --- |
| `No wallet` | Create/import a wallet or supply an environment key. |
| `No private key` | An address alone cannot sign; provide the matching private key. |
| `No hard budget is configured` | Run `budget set`, or deliberately use `--no-budget`. |
| `Payment exceeds the remaining daily budget` | No compatible requirement fits the local remainder. |
| `Invalid budget token` | The local token does not own the server budget for that wallet. |
| `API 401` | Seller key is missing/invalid, or a budget token was missing from a budget API call. |
| `API 403` | Often an invalid budget token. |
| `API 404` | Project/route was not owned or found, or no endpoint exists. |
| `API 409` | Existing email or globally duplicated project slug. |
| `API 429` | Rate limit exceeded; inspect `Retry-After`. |
| `Loopfare CLI only pays USDC on Base or Base Sepolia` | The x402 challenge used an unsupported network or asset. |

Detailed workflows and safety guidance are in [SELLER_MANUAL.md](./SELLER_MANUAL.md) and [BUYER_MANUAL.md](./BUYER_MANUAL.md).
