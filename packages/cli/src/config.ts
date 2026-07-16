import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type LoopfareConfig = {
  apiUrl: string;
  apiKey?: string;
  email?: string;
  privateKey?: string;
  address?: string;
  dailyBudgetUsd?: number;
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
    };
  } catch {
    return { apiUrl: process.env.LOOPFARE_API_URL ?? "http://localhost:4021" };
  }
}

export function saveConfig(partial: Partial<LoopfareConfig>): LoopfareConfig {
  const current = loadConfig();
  const next = { ...current, ...partial };
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}
