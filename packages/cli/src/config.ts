import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";

export type LoopfareConfig = {
  apiUrl: string;
  apiKey?: string;
  email?: string;
  privateKey?: string;
  address?: string;
  dailyBudgetUsd?: number;
  budgetToken?: string;
  spentTodayUsd?: number;
  spentDay?: string;
  telemetryEnabled?: boolean;
  installId?: string;
  profiles?: Record<
    string,
    { apiKey?: string; email?: string; budgetToken?: string }
  >;
  reservations?: Record<
    string,
    {
      day: string;
      atomic: number;
      state: "reserved" | "unknown" | "settled" | "failed";
      network?: string;
    }
  >;
};

export const DEFAULT_API_URL = "https://api-production-dd0a0.up.railway.app";

const DIR = process.env.LOOPFARE_CONFIG_DIR ?? join(homedir(), ".loopfare");
const FILE = join(DIR, "config.json");
const LOCK_FILE = `${FILE}.lock`;

export function configPath() {
  return FILE;
}

export function loadConfig(): LoopfareConfig {
  const raw = readStoredConfig();
  const apiUrl = validateApiUrl(
    process.env.LOOPFARE_API_URL ?? raw.apiUrl ?? DEFAULT_API_URL,
  );
  const sameOrigin = new URL(apiUrl).origin === new URL(raw.apiUrl).origin;
  const profile = sameOrigin
    ? raw
    : (raw.profiles?.[new URL(apiUrl).origin] ?? {});
  const privateKey =
    process.env.EVM_PRIVATE_KEY ??
    process.env.LOOPFARE_PRIVATE_KEY ??
    raw.privateKey;
  let address = raw.address;
  if (privateKey) {
    try {
      address = privateKeyToAccount(privateKey as `0x${string}`).address;
    } catch {
      address = undefined;
    }
  }
  return {
    apiUrl,
    apiKey: process.env.LOOPFARE_API_KEY ?? profile.apiKey,
    email: profile.email,
    privateKey,
    address,
    dailyBudgetUsd: raw.dailyBudgetUsd,
    budgetToken: profile.budgetToken,
    spentTodayUsd: raw.spentTodayUsd,
    spentDay: raw.spentDay,
    reservations: raw.reservations,
    telemetryEnabled: raw.telemetryEnabled,
    installId: raw.installId,
  };
}

export function validateApiUrl(value: string): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "API URL must be an origin without credentials, path, query, or fragment",
    );
  }
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  ) {
    throw new Error(
      "Remote API URLs require HTTPS (HTTP is allowed only on loopback)",
    );
  }
  return url.origin;
}

export function saveConfig(partial: Partial<LoopfareConfig>): LoopfareConfig {
  return withConfigLock(() => {
    const raw = readStoredConfig();
    const target = validateApiUrl(
      partial.apiUrl ?? process.env.LOOPFARE_API_URL ?? raw.apiUrl,
    );
    const previous = new URL(raw.apiUrl).origin;
    const profiles = {
      ...raw.profiles,
      [previous]: {
        apiKey: raw.apiKey,
        email: raw.email,
        budgetToken: raw.budgetToken,
      },
    };
    const next = {
      ...raw,
      ...(target !== previous
        ? {
            apiKey: undefined,
            email: undefined,
            budgetToken: undefined,
            ...profiles[target],
          }
        : {}),
      ...partial,
      apiUrl: target,
      profiles,
    };
    writeStoredConfig(next);
    return next;
  });
}

export function ensureBudgetToken(): string {
  const current = loadConfig();
  if (current.budgetToken) return current.budgetToken;
  const budgetToken = `lb_${randomBytes(32).toString("base64url")}`;
  saveConfig({ budgetToken });
  return budgetToken;
}

export function currentDailySpend(config: LoopfareConfig): {
  spentDay: string;
  spentTodayUsd: number;
} {
  const spentDay = new Date().toISOString().slice(0, 10);
  return {
    spentDay,
    spentTodayUsd: config.reservations
      ? Object.values(config.reservations)
          .filter(
            (r) =>
              r.state !== "failed" &&
              (r.day === spentDay || r.state !== "settled"),
          )
          .reduce((sum, r) => sum + r.atomic, 0) / 1_000_000
      : config.spentDay === spentDay
        ? (config.spentTodayUsd ?? 0)
        : 0,
  };
}

/** Atomically reserve local budget before a payment can be signed. */
export function reserveDailySpend(
  amountUsd: number,
  dailyLimitUsd: number,
  network?: string,
) {
  return withConfigLock(() => {
    const config = readStoredConfig();
    const spend = currentDailySpend(config);
    if (spend.spentTodayUsd + amountUsd > dailyLimitUsd + 1e-9) {
      throw new Error(
        `Payment exceeds the remaining daily budget of $${Math.max(0, dailyLimitUsd - spend.spentTodayUsd).toFixed(6)}`,
      );
    }
    const atomic = Math.round(amountUsd * 1_000_000);
    if (!Number.isSafeInteger(atomic) || atomic <= 0)
      throw new Error("Invalid payment amount");
    const id = randomBytes(16).toString("hex");
    const reservations = { ...config.reservations };
    if (!config.reservations && spend.spentTodayUsd > 0)
      reservations.legacy = {
        day: spend.spentDay,
        atomic: Math.round(spend.spentTodayUsd * 1_000_000),
        state: "settled",
      };
    reservations[id] = {
      day: spend.spentDay,
      atomic,
      state: "reserved",
      network,
    };
    const spentTodayUsd = Number((spend.spentTodayUsd + amountUsd).toFixed(6));
    writeStoredConfig({
      ...config,
      dailyBudgetUsd: dailyLimitUsd,
      spentDay: spend.spentDay,
      spentTodayUsd,
      reservations,
    });
    return id;
  });
}

/** Release a local reservation when verification, origin handling, or settlement fails. */
export function releaseDailySpend(id: string) {
  withConfigLock(() => {
    const config = readStoredConfig();
    const reservation = config.reservations?.[id];
    if (!reservation || reservation.state === "settled")
      throw new Error("Reservation cannot be released");
    reservation.state = "failed";
    writeStoredConfig(config);
  });
}

/** Reconcile the reserved quote with the facilitator's authoritative settled amount. */
export function reconcileDailySpend(id: string, settledUsd?: number) {
  withConfigLock(() => {
    const config = readStoredConfig();
    const reservation = config.reservations?.[id];
    if (!reservation) throw new Error("Unknown local reservation");
    if (settledUsd !== undefined) {
      const atomic = Math.round(settledUsd * 1_000_000);
      if (!Number.isSafeInteger(atomic) || atomic < 0)
        throw new Error("Invalid settled amount");
      reservation.atomic = atomic;
    }
    reservation.state = settledUsd === undefined ? "unknown" : "settled";
    writeStoredConfig(config);
  });
}

function readStoredConfig(): LoopfareConfig {
  if (!existsSync(FILE)) return { apiUrl: DEFAULT_API_URL };
  try {
    const value = JSON.parse(readFileSync(FILE, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    validateApiUrl(value.apiUrl ?? DEFAULT_API_URL);
    for (const field of [
      "apiKey",
      "email",
      "privateKey",
      "address",
      "budgetToken",
      "spentDay",
    ]) {
      if (value[field] !== undefined && typeof value[field] !== "string")
        throw new Error();
    }
    for (const field of ["dailyBudgetUsd", "spentTodayUsd"]) {
      if (
        value[field] !== undefined &&
        (!Number.isFinite(value[field]) || value[field] < 0)
      )
        throw new Error();
    }
    if (value.privateKey) privateKeyToAccount(value.privateKey);
    if (
      value.telemetryEnabled !== undefined &&
      typeof value.telemetryEnabled !== "boolean"
    )
      throw new Error();
    if (
      value.installId !== undefined &&
      (typeof value.installId !== "string" ||
        !/^[a-f0-9]{32}$/.test(value.installId))
    )
      throw new Error();
    if (value.profiles !== undefined) {
      if (
        !value.profiles ||
        typeof value.profiles !== "object" ||
        Array.isArray(value.profiles)
      )
        throw new Error();
      for (const [origin, profile] of Object.entries(value.profiles) as [
        string,
        any,
      ][]) {
        validateApiUrl(origin);
        if (!profile || typeof profile !== "object" || Array.isArray(profile))
          throw new Error();
        for (const field of ["apiKey", "email", "budgetToken"])
          if (
            profile[field] !== undefined &&
            typeof profile[field] !== "string"
          )
            throw new Error();
      }
    }
    if (value.reservations !== undefined) {
      if (
        !value.reservations ||
        typeof value.reservations !== "object" ||
        Array.isArray(value.reservations)
      )
        throw new Error();
      for (const r of Object.values(value.reservations) as any[]) {
        if (
          !r ||
          !/^\d{4}-\d{2}-\d{2}$/.test(r.day) ||
          !Number.isSafeInteger(r.atomic) ||
          r.atomic < 0 ||
          !["reserved", "unknown", "settled", "failed"].includes(r.state)
        )
          throw new Error();
      }
    }
    return { ...value, apiUrl: value.apiUrl ?? DEFAULT_API_URL };
  } catch {
    throw new Error(
      `Invalid config at ${FILE}. Restore a secure backup or repair it; the file has not been changed.`,
    );
  }
}

export function replaceWallet(privateKey: string, replace = false) {
  return withConfigLock(() => {
    const current = readStoredConfig();
    if ((current.privateKey || current.address) && !replace)
      throw new Error(
        `Wallet ${current.address ?? "already configured"} exists. Back up its key before using --replace; replacement can lose access to funds.`,
      );
    if (
      Object.values(current.reservations ?? {}).some(
        (r) => r.state === "reserved" || r.state === "unknown",
      )
    )
      throw new Error(
        "Resolve pending payment reservations before replacing this wallet",
      );
    const address = privateKeyToAccount(privateKey as `0x${string}`).address;
    writeStoredConfig({
      ...current,
      privateKey,
      address,
      budgetToken: undefined,
      dailyBudgetUsd: undefined,
      spentDay: undefined,
      spentTodayUsd: undefined,
      reservations: {},
      profiles: Object.fromEntries(
        Object.entries(current.profiles ?? {}).map(([origin, profile]) => [
          origin,
          { ...profile, budgetToken: undefined },
        ]),
      ),
    });
    return address;
  });
}

function writeStoredConfig(config: LoopfareConfig) {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  chmodSync(DIR, 0o700);
  const temporary = `${FILE}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(config, null, 2), { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, FILE);
  chmodSync(FILE, 0o600);
}

function withConfigLock<T>(operation: () => T): T {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  chmodSync(DIR, 0o700);
  let descriptor: number;
  try {
    descriptor = openSync(LOCK_FILE, "wx", 0o600);
  } catch (error) {
    try {
      if (Date.now() - statSync(LOCK_FILE).mtimeMs > 30_000) {
        unlinkSync(LOCK_FILE);
        descriptor = openSync(LOCK_FILE, "wx", 0o600);
      } else {
        throw error;
      }
    } catch (recoveryError) {
      if (recoveryError === error)
        throw new Error(
          "Another Loopfare process is updating the local budget; retry shortly",
        );
      throw recoveryError;
    }
  }

  try {
    return operation();
  } finally {
    closeSync(descriptor);
    try {
      unlinkSync(LOCK_FILE);
    } catch {
      /* already cleaned */
    }
  }
}
