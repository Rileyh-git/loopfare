import type { Context } from "hono";
import type { RequestUsageContext, UsageEventInput } from "./usage.js";
export type AuthEnv = {
  Variables: {
    accountId: string;
    email: string;
    requestId: string;
    usage: RequestUsageContext;
  };
};

export type UsageTracker = (
  c: Context<AuthEnv>,
  input: UsageEventInput & { walletAddress?: string },
) => void;
