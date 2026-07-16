import { config as loadEnv } from "dotenv";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from monorepo root or cwd (works in workspaces + Railway)
const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  resolve(process.cwd(), ".env"),
  resolve(here, "../../../.env"),
  resolve(here, "../../.env"),
];
for (const p of candidates) {
  if (existsSync(p)) {
    loadEnv({ path: p });
    break;
  }
}

export type LoopfareNetwork = "base-sepolia" | "base";

const network = (process.env.LOOPFARE_NETWORK ?? "base-sepolia") as LoopfareNetwork;

/** CAIP-2 network ids used by x402 v2 */
export const NETWORK_CAIP2: Record<LoopfareNetwork, string> = {
  "base-sepolia": "eip155:84532",
  base: "eip155:8453",
};

export const config = {
  port: Number(process.env.PORT ?? 4021),
  host: process.env.HOST ?? "0.0.0.0",
  publicUrl: (process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4021}`).replace(
    /\/$/,
    "",
  ),
  databasePath: resolve(process.env.DATABASE_PATH ?? "./data/loopfare.db"),
  network,
  networkCaip2: NETWORK_CAIP2[network] ?? NETWORK_CAIP2["base-sepolia"],
  facilitatorUrl: process.env.FACILITATOR_URL ?? "https://x402.org/facilitator",
  demoPayTo: (process.env.DEMO_PAY_TO ?? "0x0000000000000000000000000000000000000000") as `0x${string}`,
  demoPrice: process.env.DEMO_PRICE ?? "$0.001",
  devMode: process.env.LOOPFARE_DEV_MODE === "true",
  adminApiKey: process.env.ADMIN_API_KEY,
};

mkdirSync(dirname(config.databasePath), { recursive: true });
