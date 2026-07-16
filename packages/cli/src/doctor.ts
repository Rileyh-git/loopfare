import { existsSync, statSync } from "node:fs";
import { configPath, currentDailySpend, loadConfig } from "./config.js";
import { LOOPFARE_VERSION } from "./version.js";

type PublicMetadata = {
  name?: string;
  version?: string;
  network?: string;
  networkCaip2?: string;
  protocol?: string;
  demoEnabled?: boolean;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function requestJson(
  fetcher: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<{ status: number; body: unknown }> {
  const response = await fetcher(url, {
    headers: { "User-Agent": `loopfare-cli/${LOOPFARE_VERSION}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Retain text so doctor can explain a non-JSON service response.
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { status: response.status, body };
}

export async function runDoctor(fetcher: typeof fetch = fetch, timeoutMs = 5_000) {
  const config = loadConfig();
  const apiUrl = config.apiUrl.replace(/\/$/, "");
  let metadata: PublicMetadata | undefined;
  let metadataStatus: number | undefined;
  let readinessStatus: number | undefined;
  let networkError: string | undefined;

  const [metadataResult, readinessResult] = await Promise.allSettled([
    requestJson(fetcher, `${apiUrl}/api`, timeoutMs),
    requestJson(fetcher, `${apiUrl}/health/ready`, timeoutMs),
  ]);
  if (metadataResult.status === "fulfilled") {
    metadataStatus = metadataResult.value.status;
    metadata = metadataResult.value.body as PublicMetadata;
  } else {
    networkError = errorMessage(metadataResult.reason);
  }
  if (readinessResult.status === "fulfilled") {
    readinessStatus = readinessResult.value.status;
  } else {
    networkError ??= errorMessage(readinessResult.reason);
  }

  const file = configPath();
  const fileExists = existsSync(file);
  const fileMode = fileExists ? statSync(file).mode & 0o777 : undefined;
  const spend = currentDailySpend(config);
  const reachable = metadataStatus !== undefined || readinessStatus !== undefined;
  const ready = readinessStatus !== undefined;
  const next: string[] = [];

  if (!reachable) next.push(`Check connectivity or run: loopfare set-api ${apiUrl}`);
  if (!config.apiKey) next.push("Create a seller account with: loopfare signup --email you@example.com");
  if (!config.privateKey) next.push("Create a disposable test wallet with: loopfare wallet create");
  if (config.privateKey && (!config.dailyBudgetUsd || !config.budgetToken)) {
    next.push("Set a test budget with: loopfare budget set --daily 1");
  }
  if (metadata?.demoEnabled === false) {
    next.push("The hosted paid demo is disabled; use the local development demo or a seller route.");
  }

  return {
    ok: reachable && ready,
    cliVersion: LOOPFARE_VERSION,
    runtime: {
      node: process.version,
      supported: Number(process.versions.node.split(".")[0]) >= 22,
    },
    api: {
      url: apiUrl,
      reachable,
      ready,
      metadataStatus,
      readinessStatus,
      version: metadata?.version,
      network: metadata?.network,
      networkCaip2: metadata?.networkCaip2,
      protocol: metadata?.protocol,
      demoEnabled: metadata?.demoEnabled,
      error: networkError,
    },
    seller: {
      configured: Boolean(config.apiKey),
      email: config.email,
    },
    wallet: {
      configured: Boolean(config.privateKey),
      address: config.address,
    },
    budget: {
      configured: Boolean(config.dailyBudgetUsd && config.budgetToken),
      dailyLimitUsd: config.dailyBudgetUsd,
      ...spend,
    },
    config: {
      path: file,
      exists: fileExists,
      mode: fileMode === undefined ? undefined : fileMode.toString(8).padStart(3, "0"),
      secure:
        !fileExists || process.platform === "win32" || (fileMode !== undefined && (fileMode & 0o077) === 0),
    },
    next,
  };
}
