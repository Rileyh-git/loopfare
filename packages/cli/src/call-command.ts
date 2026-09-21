import type { Command } from "commander";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { safeFetch, budgetHeaders } from "./network.js";
import {
  currentDailySpend,
  loadConfig,
  reconcileDailySpend,
  reserveDailySpend,
} from "./config.js";
import { fail, print } from "./output.js";
import { LOOPFARE_VERSION } from "./version.js";
export function registerCallCommand(
  program: Command,
  jsonFlag: () => boolean,
  requireWalletAddress: () => string,
) {
  // ── call ──────────────────────────────────────────────────────────

  program
    .command("call")
    .description("Call a paid URL; handles x402 payment automatically")
    .argument("<url>", "Full URL to call")
    .option("-X, --method <method>", "HTTP method", "GET")
    .option("-d, --data <body>", "Request body")
    .option("-H, --header <header...>", "Extra headers (Key: Value)")
    .option("--dev", "Use LOOPFARE-DEV-PAYMENT header (server dev mode)", false)
    .option(
      "--no-budget",
      "Explicitly allow a real payment without a configured budget",
    )
    .option(
      "--network <network>",
      "Allowed payment network: base-sepolia or base",
      "base-sepolia",
    )
    .option("--max-price <usd>", "Maximum per-call USDC price", "1")
    .option("--pay-to <address>", "Only pay this seller address")
    .action(
      async (
        url: string,
        opts: {
          method: string;
          data?: string;
          header?: string[];
          dev?: boolean;
          budget?: boolean;
          network: string;
          maxPrice: string;
          payTo?: string;
        },
      ) => {
        const j = jsonFlag();
        try {
          const cfg = loadConfig();
          const parsedUrl = new URL(url);
          if (!["base-sepolia", "base"].includes(opts.network))
            throw new Error("Choose base-sepolia or base");
          const maxPrice = Number(opts.maxPrice);
          if (!Number.isFinite(maxPrice) || maxPrice <= 0 || maxPrice > 10_000)
            throw new Error("Maximum price must be >0 and <=10000 USDC");
          if (opts.payTo && !/^0x[a-fA-F0-9]{40}$/.test(opts.payTo))
            throw new Error("Invalid payee address");
          if (parsedUrl.username || parsedUrl.password)
            throw new Error("Paid URLs must not contain credentials");
          if (
            parsedUrl.protocol !== "https:" &&
            !["localhost", "127.0.0.1", "[::1]"].includes(parsedUrl.hostname)
          )
            throw new Error("Remote paid endpoints require HTTPS");
          if (
            parsedUrl.protocol !== "http:" &&
            parsedUrl.protocol !== "https:"
          ) {
            throw new Error("Paid URL must use http or https");
          }
          const method = opts.method.toUpperCase();
          if (
            ![
              "GET",
              "POST",
              "PUT",
              "PATCH",
              "DELETE",
              "HEAD",
              "OPTIONS",
            ].includes(method)
          ) {
            throw new Error("Unsupported HTTP method");
          }
          if ((method === "GET" || method === "HEAD") && opts.data) {
            throw new Error(`${method} requests cannot include --data`);
          }
          const headers: Record<string, string> = {};
          headers["User-Agent"] = `loopfare-cli/${LOOPFARE_VERSION}`;
          if (parsedUrl.origin === new URL(cfg.apiUrl).origin) {
            if (cfg.telemetryEnabled && cfg.installId)
              headers["X-Loopfare-Install-Id"] = cfg.installId;
            else headers["X-Loopfare-Telemetry"] = "off";
            if (process.env.LOOPFARE_TEST_TRAFFIC === "1")
              headers["X-Loopfare-Traffic"] = "test";
          }
          for (const h of opts.header ?? []) {
            const idx = h.indexOf(":");
            if (idx === -1) continue;
            headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
          }
          if (
            opts.data &&
            !Object.keys(headers).some(
              (name) => name.toLowerCase() === "content-type",
            )
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
            Object.assign(
              headers,
              budgetHeaders(url, cfg.apiUrl, cfg.budgetToken),
            );
            const res = await safeFetch(url, {
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
          Object.assign(
            headers,
            budgetHeaders(url, cfg.apiUrl, cfg.budgetToken),
          );

          const enforceBudget = opts.budget !== false;
          const spend = currentDailySpend(cfg);
          if (enforceBudget && (!cfg.dailyBudgetUsd || !cfg.budgetToken)) {
            throw new Error(
              "No hard budget is configured. Run: loopfare budget set --daily 5  (or explicitly pass --no-budget)",
            );
          }
          const remainingUsd = Math.max(
            0,
            (cfg.dailyBudgetUsd ?? 0) - spend.spentTodayUsd,
          );
          let selectedAmountUsd = 0;
          let reservedAmountUsd = 0;
          let reservationId: string | undefined;

          const client = new x402Client();
          client.register("eip155:8453", new ExactEvmScheme(signer));
          client.register("eip155:84532", new ExactEvmScheme(signer));
          client.registerPolicy((_version, requirements) => {
            const supported = requirements
              .filter(
                (requirement) =>
                  requirement.network ===
                    (opts.network === "base"
                      ? "eip155:8453"
                      : "eip155:84532") &&
                  (!opts.payTo ||
                    requirement.payTo.toLowerCase() ===
                      opts.payTo.toLowerCase()),
              )
              .map((requirement) => ({
                requirement,
                amountUsd: baseUsdcAmount(requirement),
              }))
              .filter(
                (
                  entry,
                ): entry is {
                  requirement: (typeof requirements)[number];
                  amountUsd: number;
                } =>
                  entry.amountUsd !== undefined && entry.amountUsd <= maxPrice,
              )
              .sort((a, b) => a.amountUsd - b.amountUsd);
            if (supported.length === 0) {
              throw new Error(
                "Loopfare CLI only pays USDC on Base or Base Sepolia",
              );
            }
            const affordable = enforceBudget
              ? supported.filter(
                  (entry) => entry.amountUsd <= remainingUsd + 1e-9,
                )
              : supported;
            if (affordable.length === 0) {
              throw new Error(
                `Payment exceeds the remaining daily budget of $${remainingUsd.toFixed(6)}`,
              );
            }
            selectedAmountUsd = affordable[0]!.amountUsd;
            if (enforceBudget && reservedAmountUsd === 0) {
              reservationId = reserveDailySpend(
                selectedAmountUsd,
                cfg.dailyBudgetUsd!,
                affordable[0]!.requirement.network,
              );
              reservedAmountUsd = selectedAmountUsd;
            }
            return affordable.map((entry) => entry.requirement);
          });
          const fetchWithPayment = wrapFetchWithPayment(safeFetch, client);
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
                result.header &&
                "success" in result.header &&
                result.header.amount
                  ? result.header.amount
                  : undefined;
              chargedUsd = settledAtomic
                ? atomicUsdcToUsd(settledAtomic)
                : selectedAmountUsd;
              reconcileDailySpend(reservationId!, chargedUsd);
              keepReservation = true;
            }
          } finally {
            if (enforceBudget && reservedAmountUsd > 0 && !keepReservation) {
              // A dropped response does not prove the signed payment failed.
              reconcileDailySpend(reservationId!);
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
    if (!expected || requirement.asset.toLowerCase() !== expected)
      return undefined;
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
}
