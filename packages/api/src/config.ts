import { config as loadEnv } from "dotenv";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Load .env from the monorepo root or cwd (works in workspaces + Railway).
const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  resolve(process.cwd(), ".env"),
  resolve(here, "../../../.env"),
  resolve(here, "../../.env"),
];
for (const path of candidates) {
  if (existsSync(path)) {
    loadEnv({ path });
    break;
  }
}

export type LoopfareNetwork = "base-sepolia" | "base";

/** CAIP-2 network ids used by x402 v2. */
export const NETWORK_CAIP2: Record<LoopfareNetwork, string> = {
  "base-sepolia": "eip155:84532",
  base: "eip155:8453",
};

const booleanFromEnv = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4021),
  HOST: z.string().min(1).default("0.0.0.0"),
  PUBLIC_URL: z.string().url().optional(),
  RAILWAY_PUBLIC_DOMAIN: z.string().min(1).optional(),
  DATABASE_PATH: z.string().min(1).default("./data/loopfare.db"),
  LOOPFARE_NETWORK: z.enum(["base-sepolia", "base"]).default("base-sepolia"),
  FACILITATOR_URL: z.string().url().default("https://x402.org/facilitator"),
  DEMO_PAY_TO: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "DEMO_PAY_TO must be an EVM address")
    .default("0x0000000000000000000000000000000000000000"),
  DEMO_PRICE: z
    .string()
    .regex(/^\$(?:0|[1-9]\d*)(?:\.\d{1,6})?$/, "DEMO_PRICE must look like $0.001")
    .default("$0.001"),
  LOOPFARE_DEV_MODE: booleanFromEnv,
  SIGNUP_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  ALLOW_PRIVATE_ORIGINS: booleanFromEnv,
  ADMIN_API_KEY: z.string().min(24).optional(),
  CORS_ORIGINS: z.string().optional(),
  PROXY_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  MAX_REQUEST_BODY_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(10 * 1024 * 1024)
    .default(1024 * 1024),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid Loopfare configuration: ${details}`);
}

const env = parsed.data;
if (env.NODE_ENV === "production" && env.LOOPFARE_DEV_MODE) {
  throw new Error("LOOPFARE_DEV_MODE must be false in production");
}
if (env.LOOPFARE_NETWORK === "base" && env.FACILITATOR_URL.includes("x402.org")) {
  throw new Error("Base mainnet requires a mainnet-capable facilitator, not x402.org");
}

const publicUrl = (
  env.PUBLIC_URL ??
  (env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${env.PORT}`)
).replace(/\/$/, "");

const configuredOrigins = (env.CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

export const config = {
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  port: env.PORT,
  host: env.HOST,
  publicUrl,
  databasePath: resolve(env.DATABASE_PATH),
  network: env.LOOPFARE_NETWORK,
  networkCaip2: NETWORK_CAIP2[env.LOOPFARE_NETWORK],
  facilitatorUrl: env.FACILITATOR_URL,
  demoPayTo: env.DEMO_PAY_TO as `0x${string}`,
  demoPrice: env.DEMO_PRICE,
  demoEnabled: !/^0x0{40}$/i.test(env.DEMO_PAY_TO),
  devMode: env.LOOPFARE_DEV_MODE,
  signupEnabled: env.SIGNUP_ENABLED,
  allowPrivateOrigins: env.ALLOW_PRIVATE_ORIGINS,
  adminApiKey: env.ADMIN_API_KEY,
  corsOrigins: configuredOrigins.length > 0 ? configuredOrigins : [new URL(publicUrl).origin],
  proxyTimeoutMs: env.PROXY_TIMEOUT_MS,
  maxRequestBodyBytes: env.MAX_REQUEST_BODY_BYTES,
} as const;

mkdirSync(dirname(config.databasePath), { recursive: true });
