import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

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

export function configPath() {
  return FILE;
}

export function loadConfig(): LoopfareConfig {
  if (!existsSync(FILE)) {
    return { apiUrl: process.env.LOOPFARE_API_URL ?? "http://localhost:4021" };
  }
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as LoopfareConfig;
    return {
      apiUrl: process.env.LOOPFARE_API_URL ?? raw.apiUrl ?? "http://localhost:4021",
      apiKey: process.env.LOOPFARE_API_KEY ?? raw.apiKey,
      email: raw.email,
      privateKey: process.env.EVM_PRIVATE_KEY ?? process.env.LOOPFARE_PRIVATE_KEY ?? raw.privateKey,
      address: raw.address,
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
  const current = loadConfig();
  const next = { ...current, ...partial };
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  chmodSync(DIR, 0o700);
  writeFileSync(FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  chmodSync(FILE, 0o600);
  return next;
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
