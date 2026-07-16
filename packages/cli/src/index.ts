#!/usr/bin/env node
import { Command } from "commander";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { api } from "./api.js";
import { runDoctor } from "./doctor.js";
import {
  configPath,
  currentDailySpend,
  ensureBudgetToken,
  loadConfig,
  reconcileDailySpend,
  releaseDailySpend,
  reserveDailySpend,
  saveConfig,
} from "./config.js";
import { fail, print } from "./output.js";
import { LOOPFARE_VERSION } from "./version.js";

const program = new Command();

program
  .name("loopfare")
  .description("Charge AI agents per request — x402 paywall CLI for Base")
  .version(LOOPFARE_VERSION)
  .option("--json", "Machine-readable JSON output", false);

function jsonFlag(): boolean {
  return Boolean(program.opts().json);
}

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
  .action((url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("API URL must use http or https");
    }
    const cfg = saveConfig({ apiUrl: parsed.toString().replace(/\/$/, "") });
    print({ apiUrl: cfg.apiUrl }, jsonFlag());
  });

program
  .command("doctor")
  .description("Check runtime, API, wallet, budget, and config readiness")
  .option("--timeout <ms>", "Network timeout in milliseconds", (value) => Number(value), 5_000)
  .action(async (opts: { timeout: number }) => {
    const j = jsonFlag();
    try {
      if (!Number.isInteger(opts.timeout) || opts.timeout < 250 || opts.timeout > 30_000) {
        throw new Error("Doctor timeout must be an integer from 250 to 30000 milliseconds");
      }
      const report = await runDoctor(fetch, opts.timeout);
      print(report, j);
      if (!report.ok) process.exitCode = 1;
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
      print(
        {
          id: res.id,
          email: res.email,
          apiKey: res.apiKey,
          storedAt: configPath(),
          message: "API key saved to ~/.loopfare/config.json",
        },
        j,
      );
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
          apiKey: result.apiKey,
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

const projects = program.command("projects").description("Manage seller projects");

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
      print(await api(`/v1/projects/${encodeURIComponent(opts.project)}/routes`), j);
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
        if (opts.enable && opts.disable) throw new Error("Choose --enable or --disable, not both");
        const body = {
          ...(opts.origin ? { originUrl: opts.origin } : {}),
          ...(opts.path ? { pathPattern: opts.path } : {}),
          ...(opts.price ? { price: opts.price } : {}),
          ...(opts.description !== undefined ? { description: opts.description } : {}),
          ...(opts.methods ? { methods: opts.methods } : {}),
          ...(opts.enable ? { enabled: true } : {}),
          ...(opts.disable ? { enabled: false } : {}),
        };
        if (Object.keys(body).length === 0) throw new Error("Provide at least one change");
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
  .option("--show-private-key", "Include the private key in command output", false)
  .action((opts: { showPrivateKey?: boolean }) => {
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    saveConfig({
      privateKey: pk,
      address: account.address,
      dailyBudgetUsd: undefined,
      budgetToken: undefined,
      spentTodayUsd: undefined,
      spentDay: undefined,
    });
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
  .requiredOption("--private-key <key>", "0x-prefixed private key")
  .action((opts: { privateKey: string }) => {
    const pk = opts.privateKey.startsWith("0x")
      ? opts.privateKey
      : `0x${opts.privateKey}`;
    const account = privateKeyToAccount(pk as `0x${string}`);
    saveConfig({
      privateKey: pk,
      address: account.address,
      dailyBudgetUsd: undefined,
      budgetToken: undefined,
      spentTodayUsd: undefined,
      spentDay: undefined,
    });
    print({ address: account.address, storedAt: configPath() }, jsonFlag());
  });

// ── budget ────────────────────────────────────────────────────────

const budget = program.command("budget").description("Buyer daily spend budget");

budget
  .command("set")
  .description("Set daily USD budget for the local wallet")
  .requiredOption("--daily <usd>", "Daily limit in USD", (v) => Number(v))
  .action(async (opts: { daily: number }) => {
    const j = jsonFlag();
    try {
      const address = requireWalletAddress();
      if (!Number.isFinite(opts.daily) || opts.daily <= 0 || opts.daily > 1_000_000) {
        throw new Error("Daily budget must be greater than 0 and at most $1,000,000");
      }
      const budgetToken = ensureBudgetToken();
      saveConfig({ dailyBudgetUsd: opts.daily, address });
      print(
        await api("/v1/buyer/budget", {
          method: "POST",
          auth: false,
          headers: { "X-Loopfare-Budget-Token": budgetToken },
          body: JSON.stringify({
            walletAddress: address,
            dailyLimitUsd: opts.daily,
          }),
        }),
        j,
      );
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
      if (!cfg.budgetToken) throw new Error("No budget token. Run: loopfare budget set --daily 5");
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

// ── call ──────────────────────────────────────────────────────────

program
  .command("call")
  .description("Call a paid URL; handles x402 payment automatically")
  .argument("<url>", "Full URL to call")
  .option("-X, --method <method>", "HTTP method", "GET")
  .option("-d, --data <body>", "Request body")
  .option("-H, --header <header...>", "Extra headers (Key: Value)")
  .option("--dev", "Use LOOPFARE-DEV-PAYMENT header (server dev mode)", false)
  .option("--no-budget", "Explicitly allow a real payment without a configured budget")
  .action(
    async (
      url: string,
      opts: {
        method: string;
        data?: string;
        header?: string[];
        dev?: boolean;
        budget?: boolean;
      },
    ) => {
      const j = jsonFlag();
      try {
        const cfg = loadConfig();
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
          throw new Error("Paid URL must use http or https");
        }
        const method = opts.method.toUpperCase();
        if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method)) {
          throw new Error("Unsupported HTTP method");
        }
        if ((method === "GET" || method === "HEAD") && opts.data) {
          throw new Error(`${method} requests cannot include --data`);
        }
        const headers: Record<string, string> = {};
        for (const h of opts.header ?? []) {
          const idx = h.indexOf(":");
          if (idx === -1) continue;
          headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
        }
        if (
          opts.data &&
          !Object.keys(headers).some((name) => name.toLowerCase() === "content-type")
        ) {
          headers["Content-Type"] = "application/json";
        }

        if (opts.dev || process.env.LOOPFARE_DEV_PAYMENT === "1") {
          headers["LOOPFARE-DEV-PAYMENT"] = "ok";
          try {
            headers["X-Loopfare-Wallet"] = requireWalletAddress();
          } catch {
            /* optional */
          }
          if (cfg.budgetToken) headers["X-Loopfare-Budget-Token"] = cfg.budgetToken;
          const res = await fetch(url, {
            method,
            headers,
            body: opts.data,
          });
          const text = await res.text();
          let body: unknown = text;
          try {
            body = JSON.parse(text);
          } catch {
            /* keep text */
          }
          print({ status: res.status, payment: "dev", body }, j);
          if (!res.ok) process.exit(1);
          return;
        }

        if (!cfg.privateKey) {
          fail(
            new Error(
              "No private key. Run: loopfare wallet create  (or pass --dev for server dev mode)",
            ),
            j,
          );
        }

        const signer = privateKeyToAccount(cfg.privateKey as `0x${string}`);
        headers["X-Loopfare-Wallet"] = signer.address;
        if (cfg.budgetToken) headers["X-Loopfare-Budget-Token"] = cfg.budgetToken;

        const enforceBudget = opts.budget !== false;
        const spend = currentDailySpend(cfg);
        if (enforceBudget && (!cfg.dailyBudgetUsd || !cfg.budgetToken)) {
          throw new Error(
            "No hard budget is configured. Run: loopfare budget set --daily 5  (or explicitly pass --no-budget)",
          );
        }
        const remainingUsd = Math.max(0, (cfg.dailyBudgetUsd ?? 0) - spend.spentTodayUsd);
        let selectedAmountUsd = 0;
        let reservedAmountUsd = 0;

        const client = new x402Client();
        client.register("eip155:8453", new ExactEvmScheme(signer));
        client.register("eip155:84532", new ExactEvmScheme(signer));
        client.registerPolicy((_version, requirements) => {
          const supported = requirements
            .map((requirement) => ({ requirement, amountUsd: baseUsdcAmount(requirement) }))
            .filter(
              (entry): entry is { requirement: (typeof requirements)[number]; amountUsd: number } =>
                entry.amountUsd !== undefined,
            )
            .sort((a, b) => a.amountUsd - b.amountUsd);
          if (supported.length === 0) {
            throw new Error("Loopfare CLI only pays USDC on Base or Base Sepolia");
          }
          const affordable = enforceBudget
            ? supported.filter((entry) => entry.amountUsd <= remainingUsd + 1e-9)
            : supported;
          if (affordable.length === 0) {
            throw new Error(
              `Payment exceeds the remaining daily budget of $${remainingUsd.toFixed(6)}`,
            );
          }
          selectedAmountUsd = affordable[0]!.amountUsd;
          if (enforceBudget && reservedAmountUsd === 0) {
            reserveDailySpend(selectedAmountUsd, cfg.dailyBudgetUsd!);
            reservedAmountUsd = selectedAmountUsd;
          }
          return affordable.map((entry) => entry.requirement);
        });
        const fetchWithPayment = wrapFetchWithPayment(fetch, client);
        const httpClient = new x402HTTPClient(client);

        let response: Response;
        let result: Awaited<ReturnType<typeof httpClient.processResponse>>;
        let chargedUsd = 0;
        let keepReservation = false;
        try {
          response = await fetchWithPayment(url, {
            method,
            headers,
            body: opts.data,
          });

          result = await httpClient.processResponse(response);
          if (enforceBudget && result.paymentStatus === "settled") {
            const settledAtomic =
              result.header && "success" in result.header && result.header.amount
                ? result.header.amount
                : undefined;
            chargedUsd = settledAtomic
              ? atomicUsdcToUsd(settledAtomic)
              : selectedAmountUsd;
            reconcileDailySpend(reservedAmountUsd, chargedUsd);
            keepReservation = true;
          }
        } finally {
          if (enforceBudget && reservedAmountUsd > 0 && !keepReservation) {
            releaseDailySpend(reservedAmountUsd);
          }
        }
        const updatedSpend = currentDailySpend(loadConfig());
        print(
          {
            status: response.status,
            paymentStatus: result.paymentStatus,
            paymentHeader: result.header ?? null,
            body: result.body,
            wallet: signer.address,
            budget: enforceBudget
              ? {
                  dailyLimitUsd: cfg.dailyBudgetUsd,
                  spentTodayUsd: updatedSpend.spentTodayUsd,
                }
              : { enforced: false },
          },
          j,
        );
        if (!response.ok) process.exit(1);
      } catch (err) {
        fail(err, j);
      }
    },
  );

const BASE_USDC = {
  "eip155:8453": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "eip155:84532": "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
} as const;

function baseUsdcAmount(requirement: {
  network: string;
  asset: string;
  amount: string;
}): number | undefined {
  const expected = BASE_USDC[requirement.network as keyof typeof BASE_USDC];
  if (!expected || requirement.asset.toLowerCase() !== expected) return undefined;
  return atomicUsdcToUsd(requirement.amount);
}

function atomicUsdcToUsd(amount: string) {
  if (!/^\d+$/.test(amount)) throw new Error("Invalid USDC payment amount");
  const atomic = BigInt(amount);
  const whole = atomic / 1_000_000n;
  const fraction = atomic % 1_000_000n;
  const value = Number(whole) + Number(fraction) / 1_000_000;
  if (!Number.isSafeInteger(Number(whole)) || !Number.isFinite(value)) {
    throw new Error("USDC payment amount is too large");
  }
  return value;
}

program.parseAsync(process.argv).catch((err) => {
  fail(err, Boolean(program.opts().json));
});
