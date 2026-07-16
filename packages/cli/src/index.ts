#!/usr/bin/env node
import { Command } from "commander";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { api } from "./api.js";
import { configPath, loadConfig, saveConfig } from "./config.js";
import { fail, print } from "./output.js";

const program = new Command();

program
  .name("loopfare")
  .description("Charge AI agents per request — x402 paywall CLI for Base")
  .version("0.1.0")
  .option("--json", "Machine-readable JSON output", false);

function jsonFlag(): boolean {
  return Boolean(program.opts().json);
}

function requireWalletAddress(): string {
  const cfg = loadConfig();
  if (cfg.address) return cfg.address;
  if (cfg.privateKey) {
    return privateKeyToAccount(cfg.privateKey as `0x${string}`).address;
  }
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
      },
      jsonFlag(),
    );
  });

program
  .command("set-api")
  .description("Set API base URL")
  .argument("<url>", "e.g. http://localhost:4021")
  .action((url: string) => {
    const cfg = saveConfig({ apiUrl: url.replace(/\/$/, "") });
    print({ apiUrl: cfg.apiUrl }, jsonFlag());
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

program
  .command("protect")
  .description("Protect an origin URL behind Loopfare x402")
  .requiredOption("--project <id>", "Project id")
  .requiredOption("--origin <url>", "Upstream origin base URL")
  .option("--path <pattern>", "Path pattern", "/*")
  .option("--price <price>", "Price e.g. 0.001 or $0.001", "$0.001")
  .option("--description <text>", "Route description")
  .action(
    async (opts: {
      project: string;
      origin: string;
      path: string;
      price: string;
      description?: string;
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
            }),
          }),
          j,
        );
      } catch (err) {
        fail(err, j);
      }
    },
  );

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
  .action(() => {
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    saveConfig({ privateKey: pk, address: account.address });
    print(
      {
        address: account.address,
        privateKey: pk,
        storedAt: configPath(),
        warning: "Fund this address with Base Sepolia USDC for testnet payments.",
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
    saveConfig({ privateKey: pk, address: account.address });
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
      saveConfig({ dailyBudgetUsd: opts.daily, address });
      print(
        await api("/v1/buyer/budget", {
          method: "POST",
          auth: false,
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
      print(await api(`/v1/buyer/budget/${address}`, { auth: false }), j);
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
  .action(
    async (
      url: string,
      opts: { method: string; data?: string; header?: string[]; dev?: boolean },
    ) => {
      const j = jsonFlag();
      try {
        const cfg = loadConfig();
        const headers: Record<string, string> = {};
        for (const h of opts.header ?? []) {
          const idx = h.indexOf(":");
          if (idx === -1) continue;
          headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
        }

        if (opts.dev || process.env.LOOPFARE_DEV_PAYMENT === "1") {
          headers["LOOPFARE-DEV-PAYMENT"] = "ok";
          try {
            headers["X-Loopfare-Wallet"] = requireWalletAddress();
          } catch {
            /* optional */
          }
          const res = await fetch(url, {
            method: opts.method,
            headers: {
              ...headers,
              ...(opts.data ? { "Content-Type": "application/json" } : {}),
            },
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

        const client = new x402Client();
        client.register("eip155:*", new ExactEvmScheme(signer));
        const fetchWithPayment = wrapFetchWithPayment(fetch, client);
        const httpClient = new x402HTTPClient(client);

        const response = await fetchWithPayment(url, {
          method: opts.method,
          headers: {
            ...headers,
            ...(opts.data ? { "Content-Type": "application/json" } : {}),
          },
          body: opts.data,
        });

        const result = await httpClient.processResponse(response);
        print(
          {
            status: response.status,
            paymentStatus: result.paymentStatus,
            paymentHeader: result.header ?? null,
            body: result.body,
            wallet: signer.address,
          },
          j,
        );
        if (!response.ok) process.exit(1);
      } catch (err) {
        fail(err, j);
      }
    },
  );

program.parseAsync(process.argv).catch((err) => {
  fail(err, Boolean(program.opts().json));
});
