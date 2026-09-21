import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AuthEnv, UsageTracker } from "./types.js";
import { rateLimit } from "./rate-limit.js";
import { budgetChallenge, authorizeBudget } from "./budget-ownership.js";
import { database, getBudgetForToken } from "./db.js";
export function registerBudgetRoutes(
  app: Hono<AuthEnv>,
  trackUsage: UsageTracker,
) {
  const budgetSchema = z.object({
    walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    dailyLimitUsd: z.number().positive().max(1_000_000),
  });

  app.post(
    "/v1/buyer/budget/challenge",
    rateLimit({ limit: 30, windowMs: 60_000 }),
    async (c) => {
      const body = budgetSchema.parse(await c.req.json());
      return c.json(
        budgetChallenge(
          body.walletAddress,
          body.dailyLimitUsd,
          requireBudgetToken(c),
        ),
      );
    },
  );

  app.post(
    "/v1/buyer/budget",
    rateLimit({ limit: 30, windowMs: 60_000 }),
    async (c) => {
      const body = budgetSchema
        .extend({
          nonce: z.string().length(64),
          signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
        })
        .parse(await c.req.json());
      const token = requireBudgetToken(c);
      const budget = await authorizeBudget(
        body.walletAddress,
        body.dailyLimitUsd,
        token,
        body.nonce,
        body.signature as `0x${string}`,
      );
      if (!budget)
        throw new HTTPException(403, { message: "Invalid budget token" });
      trackUsage(c, {
        eventType: "wallet_configured",
        route: "/v1/buyer/budget",
        statusCode: 200,
        walletAddress: body.walletAddress,
      });
      return c.json({ budget: publicBudget(budget) });
    },
  );

  app.get("/v1/buyer/budget/:address", (c) => {
    const budget = getBudgetForToken(
      c.req.param("address"),
      requireBudgetToken(c),
    );
    if (!budget)
      throw new HTTPException(403, { message: "Invalid budget token" });
    return c.json({ budget: publicBudget(budget) });
  });
  app.get("/v1/buyer/budget/:address/reservations", (c) => {
    const budget = getBudgetForToken(
      c.req.param("address"),
      requireBudgetToken(c),
    );
    if (!budget)
      throw new HTTPException(403, { message: "Invalid budget token" });
    return c.json({
      reservations: database
        .prepare(
          "SELECT id, day, amount_atomic, network, state, created_at FROM budget_reservations WHERE wallet = ? ORDER BY created_at DESC LIMIT 100",
        )
        .all(budget.wallet_address),
    });
  });
}
function requireBudgetToken(c: Context) {
  const authorization = c.req.header("Authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  const token = c.req.header("X-Loopfare-Budget-Token") || bearer;
  if (!token || token.length < 24 || token.length > 200) {
    throw new HTTPException(401, {
      message: "Missing or invalid budget token",
    });
  }
  return token;
}

export function publicBudget(budget: {
  wallet_address: string;
  daily_limit_usd: number;
  spent_today_usd: number;
  spent_day: string;
  updated_at: string;
}) {
  return {
    walletAddress: budget.wallet_address,
    dailyLimitUsd: budget.daily_limit_usd,
    spentTodayUsd: budget.spent_today_usd,
    remainingTodayUsd: Math.max(
      0,
      budget.daily_limit_usd - budget.spent_today_usd,
    ),
    spentDay: budget.spent_day,
    updatedAt: budget.updated_at,
  };
}

export function budgetFailureResponse(
  c: Context<AuthEnv>,
  check: {
    ok: boolean;
    budget?: Parameters<typeof publicBudget>[0];
    reason?: string;
    unauthorized?: boolean;
  },
) {
  return c.json(
    {
      error: check.unauthorized ? "invalid_budget_token" : "budget_exceeded",
      message: check.reason,
      budget: check.budget ? publicBudget(check.budget) : undefined,
    },
    check.unauthorized ? 403 : 402,
  );
}
