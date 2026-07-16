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
};

const DIR = join(homedir(), ".loopfare");
const FILE = join(DIR, "config.json");
const LOCK_FILE = `${FILE}.lock`;

export function configPath() {
  return FILE;
}

export function loadConfig(): LoopfareConfig {
  const raw = readStoredConfig();
  try {
    const privateKey =
      process.env.EVM_PRIVATE_KEY ?? process.env.LOOPFARE_PRIVATE_KEY ?? raw.privateKey;
    let address = raw.address;
    if (privateKey) {
      try {
        address = privateKeyToAccount(privateKey as `0x${string}`).address;
      } catch {
        address = undefined;
      }
    }
    return {
      apiUrl: process.env.LOOPFARE_API_URL ?? raw.apiUrl ?? "http://localhost:4021",
      apiKey: process.env.LOOPFARE_API_KEY ?? raw.apiKey,
      email: raw.email,
      privateKey,
      address,
      dailyBudgetUsd: raw.dailyBudgetUsd,
      budgetToken: raw.budgetToken,
      spentTodayUsd: raw.spentTodayUsd,
      spentDay: raw.spentDay,
    };
  } catch {
    return { apiUrl: process.env.LOOPFARE_API_URL ?? "http://localhost:4021" };
  }
}

export function saveConfig(partial: Partial<LoopfareConfig>): LoopfareConfig {
  return withConfigLock(() => {
    const next = { ...readStoredConfig(), ...partial };
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
    spentTodayUsd: config.spentDay === spentDay ? config.spentTodayUsd ?? 0 : 0,
  };
}

/** Atomically reserve local budget before a payment can be signed. */
export function reserveDailySpend(amountUsd: number, dailyLimitUsd: number) {
  return withConfigLock(() => {
    const config = readStoredConfig();
    const spend = currentDailySpend(config);
    if (spend.spentTodayUsd + amountUsd > dailyLimitUsd + 1e-9) {
      throw new Error(
        `Payment exceeds the remaining daily budget of $${Math.max(0, dailyLimitUsd - spend.spentTodayUsd).toFixed(6)}`,
      );
    }
    const spentTodayUsd = Number((spend.spentTodayUsd + amountUsd).toFixed(6));
    writeStoredConfig({
      ...config,
      dailyBudgetUsd: dailyLimitUsd,
      spentDay: spend.spentDay,
      spentTodayUsd,
    });
    return { ...spend, spentTodayUsd };
  });
}

/** Release a local reservation when verification, origin handling, or settlement fails. */
export function releaseDailySpend(amountUsd: number) {
  withConfigLock(() => {
    const config = readStoredConfig();
    const spend = currentDailySpend(config);
    writeStoredConfig({
      ...config,
      spentDay: spend.spentDay,
      spentTodayUsd: Number(Math.max(0, spend.spentTodayUsd - amountUsd).toFixed(6)),
    });
  });
}

/** Reconcile the reserved quote with the facilitator's authoritative settled amount. */
export function reconcileDailySpend(reservedUsd: number, settledUsd: number) {
  if (Math.abs(reservedUsd - settledUsd) < 1e-9) return;
  withConfigLock(() => {
    const config = readStoredConfig();
    const spend = currentDailySpend(config);
    writeStoredConfig({
      ...config,
      spentDay: spend.spentDay,
      spentTodayUsd: Number(
        Math.max(0, spend.spentTodayUsd - reservedUsd + settledUsd).toFixed(6),
      ),
    });
  });
}

function readStoredConfig(): LoopfareConfig {
  if (!existsSync(FILE)) return { apiUrl: "http://localhost:4021" };
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as LoopfareConfig;
  } catch {
    return { apiUrl: "http://localhost:4021" };
  }
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
      if (recoveryError === error) throw new Error("Another Loopfare process is updating the local budget; retry shortly");
      throw recoveryError;
    }
  }

  try {
    return operation();
  } finally {
    closeSync(descriptor);
    try { unlinkSync(LOCK_FILE); } catch { /* already cleaned */ }
  }
}
