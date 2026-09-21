#!/usr/bin/env node
import { registerCallCommand } from "./call-command.js";
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { api } from "./api.js";
import { printSignupWelcome } from "./brand.js";
import { runDoctor } from "./doctor.js";
import {
  configPath,
  currentDailySpend,
  ensureBudgetToken,
  loadConfig,
  saveConfig,
  replaceWallet,
  validateApiUrl,
} from "./config.js";
import { fail, print } from "./output.js";
import { LOOPFARE_VERSION } from "./version.js";
import { registerOnboarding } from "./onboarding.js";

const program = new Command();

program
  .name("loopfare")
  .description("Charge AI agents per request — x402 paywall CLI for Base")
  .version(LOOPFARE_VERSION)
  .option("--json", "Machine-readable JSON output", false);

function jsonFlag(): boolean {
  return Boolean(program.opts().json);
}
registerOnboarding(program, jsonFlag);
program
  .command("telemetry")
  .description(
    "Opt in or out of pseudonymous first-party CLI usage; off by default",
  )
  .argument("<setting>", "on or off")
  .action((setting: string) => {
    if (!["on", "off"].includes(setting)) throw new Error("Choose on or off");
    saveConfig({
      telemetryEnabled: setting === "on",
      installId:
        setting === "on"
          ? (loadConfig().installId ?? randomBytes(16).toString("hex"))
          : undefined,
    });
    print(
      {
        enabled: setting === "on",
        scope:
          "Configured Loopfare API only; no private keys, request bodies, or payment signatures",
      },
      jsonFlag(),
    );
  });

function requireWalletAddress(): string {
  const cfg = loadConfig();
  if (cfg.privateKey) {
    return privateKeyToAccount(cfg.privateKey as `0x${string}`).address;
  }
  if (cfg.address) return cfg.address;
  throw new Error("No wallet. Run: loopfare wallet create");
}

// ── config ────────────────────────────────────────────────────────

program
  .command("config")
  .description("Show local CLI config (secrets redacted)")
  .action(() => {
    const cfg = loadConfig();
    print(
      {
        path: configPath(),
        apiUrl: cfg.apiUrl,
        email: cfg.email,
        apiKey: cfg.apiKey ? `${cfg.apiKey.slice(0, 8)}…` : undefined,
        address: cfg.address,
        hasPrivateKey: Boolean(cfg.privateKey),
        dailyBudgetUsd: cfg.dailyBudgetUsd,
        hasBudgetToken: Boolean(cfg.budgetToken),
        ...currentDailySpend(cfg),
      },
      jsonFlag(),
    );
  });

program
  .command("set-api")
  .description("Set API base URL")
  .argument("<url>", "e.g. https://api-production-dd0a0.up.railway.app")
  .option(
    "--switch-profile",
    "Confirm switching servers; credentials remain scoped to each origin",
  )
  .action((url: string, opts: { switchProfile?: boolean }) => {
    const current = loadConfig();
    const target = validateApiUrl(url);
    if (
      target !== new URL(current.apiUrl).origin &&
      (current.apiKey || current.budgetToken) &&
      !opts.switchProfile
    )
      throw new Error(
        "Use --switch-profile to switch servers. Existing credentials will not be sent to the new server.",
      );
    const cfg = saveConfig({ apiUrl: target });
    print({ apiUrl: cfg.apiUrl }, jsonFlag());
  });

program
  .command("doctor")
  .description("Check runtime, API, wallet, budget, and config readiness")
  .option(
    "--timeout <ms>",
    "Network timeout in milliseconds",
    (value) => Number(value),
    5_000,
  )
  .action(async (opts: { timeout: number }) => {
    const j = jsonFlag();
    try {
      if (
        !Number.isInteger(opts.timeout) ||
        opts.timeout < 250 ||
        opts.timeout > 30_000
      ) {
        throw new Error(
          "Doctor timeout must be an integer from 250 to 30000 milliseconds",
        );
      }
      const report = await runDoctor(fetch, opts.timeout);
      print(report, j);
      if (!report.ok) process.exitCode = 1;
    } catch (error) {
      fail(error, j);
    }
  });

program
  .command("metrics")
  .description("Show read-only owner usage metrics")
  .option(
    "--days <days>",
    "Reporting window in days",
    (value) => Number(value),
    30,
  )
  .action(async (opts: { days: number }) => {
    const j = jsonFlag();
    try {
      if (!Number.isInteger(opts.days) || opts.days < 1 || opts.days > 3_650) {
        throw new Error("Metrics days must be an integer from 1 to 3650");
      }
      const token =
        process.env.LOOPFARE_METRICS_API_KEY ?? process.env.METRICS_API_KEY;
      if (!token) {
        throw new Error("Set LOOPFARE_METRICS_API_KEY or METRICS_API_KEY");
      }
      const result = await api(`/v1/admin/metrics?days=${opts.days}`, {
        auth: false,
        headers: { Authorization: `Bearer ${token}` },
      });
      print(result, j);
    } catch (error) {
      fail(error, j);
    }
  });

// ── auth ──────────────────────────────────────────────────────────

program
  .command("signup")
  .description("Create a seller account and store API key")
  .requiredOption("--email <email>", "Email address")
  .action(async (opts: { email: string }) => {
    const j = jsonFlag();
    try {
      const res = await api<{
        id: string;
        email: string;
        apiKey: string;
      }>("/v1/auth/signup", {
        method: "POST",
        auth: false,
        body: JSON.stringify({ email: opts.email }),
      });
      saveConfig({ apiKey: res.apiKey, email: res.email });
      const result = {
        id: res.id,
        email: res.email,
        apiKey: res.apiKey,
        storedAt: configPath(),
        message: "API key saved to ~/.loopfare/config.json",
      };
      if (j) print(result, true);
      else {
        printSignupWelcome({
          accountId: result.id,
          email: result.email,
          storedAt: result.storedAt,
        });
      }
    } catch (err) {
      fail(err, j);
    }
  });

program
  .command("login")
  .description("Store an existing API key")
  .requiredOption("--api-key <key>", "lf_… API key")
  .option("--email <email>", "Optional email label")
  .action((opts: { apiKey: string; email?: string }) => {
    saveConfig({ apiKey: opts.apiKey, email: opts.email });
    print(
      { ok: true, email: opts.email, apiKey: `${opts.apiKey.slice(0, 8)}…` },
      jsonFlag(),
    );
  });

program
  .command("whoami")
  .description("Show seller identity from API")
  .action(async () => {
    const j = jsonFlag();
    try {
      print(await api("/v1/auth/me"), j);
    } catch (err) {
      fail(err, j);
    }
  });

program
  .command("rotate-key")
  .description("Rotate the seller API key and store the replacement")
  .action(async () => {
    const j = jsonFlag();
    try {
      const result = await api<{ apiKey: string; apiKeyPrefix: string }>(
        "/v1/auth/rotate-key",
        { method: "POST" },
      );
      saveConfig({ apiKey: result.apiKey });
      print(
        {
          ok: true,
          ...(j ? { apiKey: result.apiKey } : {}),
          apiKeyPrefix: result.apiKeyPrefix,
          storedAt: configPath(),
          message: "The previous API key no longer works.",
        },
        j,
      );
    } catch (err) {
      fail(err, j);
    }
  });

// ── seller projects ───────────────────────────────────────────────

const projects = program
  .command("projects")
  .description("Manage seller projects");

projects
  .command("create")
  .description("Create a project")
  .requiredOption("--name <name>", "Display name")
  .requiredOption("--slug <slug>", "URL slug")
  .requiredOption("--pay-to <address>", "Receiving wallet 0x…")
  .action(async (opts: { name: string; slug: string; payTo: string }) => {
    const j = jsonFlag();
    try {
      print(
        await api("/v1/projects", {
          method: "POST",
          body: JSON.stringify({
            name: opts.name,
            slug: opts.slug,
            payTo: opts.payTo,
          }),
        }),
        j,
      );
    } catch (err) {
      fail(err, j);
    }
  });

projects
  .command("list")
  .description("List projects")
  .action(async () => {
    const j = jsonFlag();
    try {
      print(await api("/v1/projects"), j);
    } catch (err) {
      fail(err, j);
    }
  });

projects
  .command("get")
  .description("Get project details, routes, earnings")
  .argument("<id>", "Project id")
  .action(async (id: string) => {
    const j = jsonFlag();
    try {
      print(await api(`/v1/projects/${id}`), j);
    } catch (err) {
      fail(err, j);
    }
  });

projects
  .command("delete")
  .description("Delete a project and its routes")
  .argument("<id>", "Project id")
  .requiredOption("--yes", "Confirm permanent deletion")
  .action(async (id: string) => {
    const j = jsonFlag();
    try {
      await api(`/v1/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
      print({ ok: true, deletedProjectId: id }, j);
    } catch (err) {
      fail(err, j);
    }
  });

program
  .command("protect")
  .description("Protect an origin URL behind Loopfare x402")
  .requiredOption("--project <id>", "Project id")
  .requiredOption("--origin <url>", "Upstream origin base URL")
  .option("--path <pattern>", "Path pattern", "/*")
  .option("--price <price>", "Price e.g. 0.001 or $0.001", "$0.001")
  .option("--description <text>", "Route description")
  .option("--methods <list>", "Comma-separated HTTP methods")
  .action(
    async (opts: {
      project: string;
      origin: string;
      path: string;
      price: string;
      description?: string;
      methods?: string;
    }) => {
      const j = jsonFlag();
      try {
        print(
          await api(`/v1/projects/${opts.project}/routes`, {
            method: "POST",
            body: JSON.stringify({
              pathPattern: opts.path,
              originUrl: opts.origin,
              price: opts.price,
              description: opts.description,
              methods: opts.methods,
            }),
          }),
          j,
        );
      } catch (err) {
        fail(err, j);
      }
    },
  );

const routes = program.command("routes").description("Manage protected routes");

routes
  .command("list")
  .description("List routes for a project")
  .requiredOption("--project <id>", "Project id")
  .action(async (opts: { project: string }) => {
    const j = jsonFlag();
    try {
      print(
        await api(`/v1/projects/${encodeURIComponent(opts.project)}/routes`),
        j,
      );
    } catch (err) {
      fail(err, j);
    }
  });

routes
  .command("update")
  .description("Update a protected route")
  .requiredOption("--project <id>", "Project id")
  .requiredOption("--route <id>", "Route id")
  .option("--origin <url>", "New upstream origin")
  .option("--path <pattern>", "New path pattern")
  .option("--price <price>", "New price")
  .option("--description <text>", "New description")
  .option("--methods <list>", "Comma-separated HTTP methods")
  .option("--enable", "Enable the route")
  .option("--disable", "Disable the route")
  .action(
    async (opts: {
      project: string;
      route: string;
      origin?: string;
      path?: string;
      price?: string;
      description?: string;
      methods?: string;
      enable?: boolean;
      disable?: boolean;
    }) => {
      const j = jsonFlag();
      try {
        if (opts.enable && opts.disable)
          throw new Error("Choose --enable or --disable, not both");
        const body = {
          ...(opts.origin ? { originUrl: opts.origin } : {}),
          ...(opts.path ? { pathPattern: opts.path } : {}),
          ...(opts.price ? { price: opts.price } : {}),
          ...(opts.description !== undefined
            ? { description: opts.description }
            : {}),
          ...(opts.methods ? { methods: opts.methods } : {}),
          ...(opts.enable ? { enabled: true } : {}),
          ...(opts.disable ? { enabled: false } : {}),
        };
        if (Object.keys(body).length === 0)
          throw new Error("Provide at least one change");
        print(
          await api(
            `/v1/projects/${encodeURIComponent(opts.project)}/routes/${encodeURIComponent(opts.route)}`,
            { method: "PATCH", body: JSON.stringify(body) },
          ),
          j,
        );
      } catch (err) {
        fail(err, j);
      }
    },
  );

routes
  .command("delete")
  .description("Delete a protected route")
  .requiredOption("--project <id>", "Project id")
  .requiredOption("--route <id>", "Route id")
  .requiredOption("--yes", "Confirm permanent deletion")
  .action(async (opts: { project: string; route: string }) => {
    const j = jsonFlag();
    try {
      await api(
        `/v1/projects/${encodeURIComponent(opts.project)}/routes/${encodeURIComponent(opts.route)}`,
        { method: "DELETE" },
      );
      print({ ok: true, deletedRouteId: opts.route }, j);
    } catch (err) {
      fail(err, j);
    }
  });

program
  .command("earnings")
  .description("Show payments and earnings for a project")
  .requiredOption("--project <id>", "Project id")
  .option("--limit <n>", "Max payments", "50")
  .action(async (opts: { project: string; limit: string }) => {
    const j = jsonFlag();
    try {
      print(
        await api(`/v1/projects/${opts.project}/payments?limit=${opts.limit}`),
        j,
      );
    } catch (err) {
      fail(err, j);
    }
  });

// ── buyer wallet ──────────────────────────────────────────────────

const wallet = program.command("wallet").description("Buyer wallet management");

wallet
  .command("create")
  .description("Create a new local EVM wallet (Base)")
  .option(
    "--show-private-key",
    "Include the private key in command output",
    false,
  )
  .option(
    "--replace",
    "Replace the existing wallet only after securely backing it up",
    false,
  )
  .action((opts: { showPrivateKey?: boolean; replace?: boolean }) => {
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    replaceWallet(pk, opts.replace);
    print(
      {
        address: account.address,
        ...(opts.showPrivateKey ? { privateKey: pk } : {}),
        storedAt: configPath(),
        warning:
          "The private key was stored with mode 600 and is hidden by default. Back it up before funding this wallet.",
        next: "Set a daily budget before funding this address.",
        faucet: "https://portal.cdp.coinbase.com/products/faucet",
      },
      jsonFlag(),
    );
  });

wallet
  .command("show")
  .description("Show current wallet address")
  .action(() => {
    const j = jsonFlag();
    try {
      print({ address: requireWalletAddress(), configPath: configPath() }, j);
    } catch (err) {
      fail(err, j);
    }
  });

wallet
  .command("import")
  .description("Import an existing private key")
  .option(
    "--private-key <key>",
    "Deprecated: key may be exposed in shell history; prefer --stdin",
  )
  .option("--stdin", "Read the private key from standard input")
  .option(
    "--replace",
    "Replace the existing wallet only after securely backing it up",
  )
  .action(
    (opts: { privateKey?: string; stdin?: boolean; replace?: boolean }) => {
      if (Boolean(opts.privateKey) === Boolean(opts.stdin))
        throw new Error("Choose exactly one of --stdin or --private-key");
      const input = opts.stdin
        ? readFileSync(0, "utf8").trim()
        : opts.privateKey!;
      const pk = input.startsWith("0x") ? input : `0x${input}`;
      const account = privateKeyToAccount(pk as `0x${string}`);
      replaceWallet(pk, opts.replace);
      print({ address: account.address, storedAt: configPath() }, jsonFlag());
    },
  );

// ── budget ────────────────────────────────────────────────────────

const budget = program
  .command("budget")
  .description("Buyer daily spend budget");
budget
  .command("reservations")
  .description(
    "Inspect durable local payment reservations, including unknown outcomes",
  )
  .action(() =>
    print(
      {
        reservations: loadConfig().reservations ?? {},
        warning:
          "Unknown/reserved payments remain counted across days. Reconcile with authoritative settlement evidence before any manual recovery; never retry to bypass a cap.",
      },
      jsonFlag(),
    ),
  );

budget
  .command("set")
  .description("Set daily USD budget for the local wallet")
  .requiredOption("--daily <usd>", "Daily limit in USD", (v) => Number(v))
  .action(async (opts: { daily: number }) => {
    const j = jsonFlag();
    try {
      const address = requireWalletAddress();
      if (
        !Number.isFinite(opts.daily) ||
        opts.daily <= 0 ||
        opts.daily > 1_000_000
      ) {
        throw new Error(
          "Daily budget must be greater than 0 and at most $1,000,000",
        );
      }
      const budgetToken = ensureBudgetToken();
      const cfg = loadConfig();
      if (!cfg.privateKey)
        throw new Error(
          "A local signing wallet is required to prove budget ownership",
        );
      const challenge = await api<{
        nonce: string;
        message: string;
        expiresAt: number;
      }>("/v1/buyer/budget/challenge", {
        method: "POST",
        auth: false,
        headers: { "X-Loopfare-Budget-Token": budgetToken },
        body: JSON.stringify({
          walletAddress: address,
          dailyLimitUsd: opts.daily,
        }),
      });
      if (
        !/^[a-f0-9]{64}$/.test(challenge.nonce) ||
        !Number.isSafeInteger(challenge.expiresAt) ||
        challenge.expiresAt <= Date.now() ||
        challenge.expiresAt > Date.now() + 6 * 60_000
      )
        throw new Error("Invalid ownership challenge expiry or nonce");
      const expected = `Loopfare budget authorization\nOrigin: ${new URL(cfg.apiUrl).origin}\nWallet: ${address.toLowerCase()}\nDaily USDC limit: ${opts.daily}\nToken SHA256: ${createHash("sha256").update(budgetToken).digest("hex")}\nNonce: ${challenge.nonce}\nExpires: ${new Date(challenge.expiresAt).toISOString()}\nThis rotates the server budget credential, not your wallet key.`;
      if (challenge.message !== expected)
        throw new Error("Refusing to sign an unexpected budget message");
      const signature = await privateKeyToAccount(
        cfg.privateKey as `0x${string}`,
      ).signMessage({ message: challenge.message });
      print(
        await api("/v1/buyer/budget", {
          method: "POST",
          auth: false,
          headers: { "X-Loopfare-Budget-Token": budgetToken },
          body: JSON.stringify({
            walletAddress: address,
            dailyLimitUsd: opts.daily,
            nonce: challenge.nonce,
            signature,
          }),
        }),
        j,
      );
      saveConfig({ dailyBudgetUsd: opts.daily, address });
    } catch (err) {
      fail(err, j);
    }
  });

budget
  .command("show")
  .description("Show budget for local wallet")
  .action(async () => {
    const j = jsonFlag();
    try {
      const address = requireWalletAddress();
      const cfg = loadConfig();
      if (!cfg.budgetToken)
        throw new Error("No budget token. Run: loopfare budget set --daily 5");
      print(
        await api(`/v1/buyer/budget/${address}`, {
          auth: false,
          headers: { "X-Loopfare-Budget-Token": cfg.budgetToken },
        }),
        j,
      );
    } catch (err) {
      fail(err, j);
    }
  });

registerCallCommand(program, jsonFlag, requireWalletAddress);

program.parseAsync(process.argv).catch((err) => {
  fail(err, Boolean(program.opts().json));
});
