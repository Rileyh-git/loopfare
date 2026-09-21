import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { fetch as proxyFetch } from "undici";
import type { AuthEnv, UsageTracker } from "./types.js";
import { config } from "./config.js";
import {
  canSpendBudget,
  findRouteForRequest,
  finishBudgetReservation,
  priceToUsd,
  recordPayment,
  refundBudgetSpend,
  trySpendBudget,
} from "./db.js";
import { assertSafeOrigin, safeProxyDispatcher } from "./origin-security.js";
import { originCredential, originVerified } from "./origin-auth.js";
import {
  buildRoutePaymentMiddleware,
  isDevPaymentAuthorized,
  publicResourceUrl,
} from "./x402.js";
import { claimPayment, completePayment } from "./payment-journal.js";
import { settlement } from "./settlement.js";
import { publicBudget, budgetFailureResponse } from "./budget-routes.js";
export function registerProxyRoutes(
  app: Hono<AuthEnv>,
  trackUsage: UsageTracker,
) {
  async function handlePaidProxy(c: Context<AuthEnv>) {
    const projectSlug = c.req.param("projectSlug");
    if (!projectSlug)
      throw new HTTPException(400, { message: "Project slug is required" });
    const rest = c.req.path.replace(`/p/${projectSlug}`, "") || "/";
    const route = findRouteForRequest(projectSlug, c.req.method, rest);
    if (!route) {
      return c.json(
        {
          error: "route_not_found",
          message: `No protected route matched ${c.req.method} ${rest} for project ${projectSlug}`,
        },
        404,
      );
    }

    let safeOrigin: string;
    if (!["GET", "HEAD"].includes(c.req.method))
      return c.json(
        {
          error: "paid_writes_disabled",
          message:
            "Paid writes are disabled until durable idempotency is implemented",
        },
        405,
      );
    if (!config.devMode && !originVerified(route.id))
      return c.json({ error: "origin_not_verified" }, 503);
    try {
      safeOrigin = await assertSafeOrigin(route.origin_url);
      if (!config.devMode && new URL(safeOrigin).protocol !== "https:")
        throw new Error("Authenticated origins require HTTPS");
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "blocked_origin",
          requestId: c.get("requestId"),
          routeId: route.id,
          reason: errorMessage(error),
        }),
      );
      return c.json(
        {
          error: "origin_unavailable",
          message: "The configured origin is unavailable",
        },
        502,
      );
    }

    const wallet = c.req.header("X-Loopfare-Wallet");
    const budgetToken = c.req.header("X-Loopfare-Budget-Token");
    const amountUsd = priceToUsd(route.price);
    const devAuthorized =
      config.devMode &&
      isDevPaymentAuthorized(c.req.header("LOOPFARE-DEV-PAYMENT"), route.price);
    const hasPaymentSignature = Boolean(c.req.header("PAYMENT-SIGNATURE"));
    trackUsage(c, {
      eventType: "proxy_request",
      route: c.req.path,
      projectId: route.project_id,
      walletAddress: wallet,
      amountUsd,
    });
    trackUsage(c, {
      eventType:
        devAuthorized || hasPaymentSignature
          ? "payment_attempted"
          : "payment_challenge",
      route: c.req.path,
      projectId: route.project_id,
      walletAddress: wallet,
      amountUsd,
    });
    if (budgetToken && !wallet) {
      return c.json(
        {
          error: "wallet_required",
          message: "Budget token requires a wallet header",
        },
        400,
      );
    }
    if (wallet && budgetToken) {
      const check = canSpendBudget(wallet, budgetToken, amountUsd);
      if (!check.ok) {
        return c.json(
          {
            error: check.unauthorized
              ? "invalid_budget_token"
              : "budget_exceeded",
            message: check.reason,
            budget: check.budget ? publicBudget(check.budget) : undefined,
          },
          check.unauthorized ? 403 : 402,
        );
      }
    }

    if (devAuthorized) {
      let budgetReserved: string | undefined;
      if (wallet && budgetToken) {
        const reservation = trySpendBudget(wallet, budgetToken, amountUsd);
        if (!reservation.ok) return budgetFailureResponse(c, reservation);
        budgetReserved = reservation.reservationId;
      }
      let response: Response;
      try {
        response = await proxyToOrigin(c, safeOrigin, rest, route.id);
      } catch (error) {
        if (budgetReserved)
          refundBudgetSpend(wallet!, budgetToken!, budgetReserved);
        throw error;
      }
      if (response.status < 400) {
        if (budgetReserved) finishBudgetReservation(budgetReserved, "settled");
        recordPayment({
          routeId: route.id,
          projectId: route.project_id,
          method: c.req.method,
          path: c.req.path,
          price: route.price,
          status: "dev_settled",
          buyerHint: wallet ?? "dev-mode",
        });
        trackUsage(c, {
          eventType: "payment_settled",
          route: c.req.path,
          statusCode: response.status,
          projectId: route.project_id,
          walletAddress: wallet,
          amountUsd,
          metadata: { mode: "dev" },
        });
      } else if (budgetReserved) {
        refundBudgetSpend(wallet!, budgetToken!, budgetReserved);
      }
      return response;
    }

    let paid = false;
    const gate = buildRoutePaymentMiddleware({
      method: c.req.method,
      path: c.req.path,
      resource: publicResourceUrl(c.req.path, new URL(c.req.url).search),
      price: route.price,
      payTo: route.pay_to,
      description:
        route.description || `Loopfare protected: ${projectSlug}${rest}`,
    });
    let budgetReserved: string | undefined;
    let gateResult: void | Response;
    let operationId: string | undefined;
    try {
      gateResult = await gate(c, async () => {
        paid = true;
        operationId = claimPayment(
          c.req.header("PAYMENT-SIGNATURE")!,
          c.get("requestId"),
          route.id,
        );
        if (!operationId) {
          c.res = c.json(
            {
              error: "payment_replayed",
              message:
                "This payment has already been submitted; inspect its outcome instead of retrying the signature",
            },
            409,
          );
          return;
        }
        if (wallet && budgetToken) {
          const reservation = trySpendBudget(wallet, budgetToken, amountUsd);
          if (!reservation.ok) {
            c.res = budgetFailureResponse(c, reservation);
            return;
          }
          budgetReserved = reservation.reservationId;
        }
        c.res = await proxyToOrigin(c, safeOrigin, rest, route.id);
      });
    } catch (error) {
      if (budgetReserved) finishBudgetReservation(budgetReserved, "unknown");
      if (operationId) completePayment(operationId, "unknown");
      throw error;
    }

    if (!paid) {
      if (gateResult instanceof Response) return gateResult;
      if (c.res) return c.res;
      return c.json(
        {
          error: "payment_required",
          price: route.price,
          network: config.network,
          payTo: route.pay_to,
        },
        402,
      );
    }

    // paymentMiddleware settles only after the upstream response succeeds, then
    // adds PAYMENT-RESPONSE to that same response. Never record a payment merely
    // because verification reached the origin handler.
    const settledResponse = c.res;
    const receipt = settlement(settledResponse.headers.get("PAYMENT-RESPONSE"));
    if (settledResponse.status >= 400 || !receipt) {
      if (budgetReserved) finishBudgetReservation(budgetReserved, "unknown");
      if (operationId) completePayment(operationId, "unknown");
      return settledResponse;
    }
    if (budgetReserved) finishBudgetReservation(budgetReserved, "settled");
    if (operationId)
      completePayment(operationId, "settled", receipt.transaction);
    recordPayment({
      routeId: route.id,
      projectId: route.project_id,
      method: c.req.method,
      path: c.req.path,
      price: route.price,
      status: "settled",
      isTest: c.get("usage").testTraffic,
      txHash: receipt.transaction,
      buyerHint: receipt.payer ?? null,
      amountAtomic: receipt.amount,
    });
    trackUsage(c, {
      eventType: "payment_settled",
      route: c.req.path,
      statusCode: settledResponse.status,
      projectId: route.project_id,
      walletAddress: receipt.payer,
      amountUsd,
      metadata: { mode: "x402" },
    });
    return settledResponse;
  }

  // Register both forms because Hono's trailing wildcard does not match every
  // router/runtime combination when the project base has no trailing slash.
  app.all("/p/:projectSlug", handlePaidProxy);
  app.all("/p/:projectSlug/*", handlePaidProxy);
}
async function proxyToOrigin(
  c: Context<AuthEnv>,
  originBase: string,
  path: string,
  routeId: string,
) {
  const incoming = new URL(c.req.url);
  const target = new URL(originBase);
  target.pathname = `${target.pathname.replace(/\/$/, "")}${path}`.replace(
    /\/{2,}/g,
    "/",
  );
  target.search = incoming.search;

  const headers = new Headers();
  c.req.raw.headers.forEach((value, key) => {
    if (!REQUEST_HEADERS_TO_STRIP.has(key.toLowerCase()))
      headers.set(key, value);
  });
  headers.set("X-Forwarded-By", "loopfare");
  const secret = originCredential(routeId);
  if (secret) headers.set("X-Loopfare-Origin-Secret", secret);
  headers.set("X-Loopfare-Request-Id", c.get("requestId"));

  const init: NonNullable<Parameters<typeof proxyFetch>[1]> = {
    method: c.req.method,
    headers: Array.from(headers.entries()),
    redirect: "manual",
    signal: AbortSignal.timeout(config.proxyTimeoutMs),
    dispatcher: safeProxyDispatcher,
  };
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    init.body = await c.req.arrayBuffer();
  }

  let upstream: Awaited<ReturnType<typeof proxyFetch>>;
  try {
    upstream = await proxyFetch(target, init);
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error));
    if (cause.name === "AbortError" || cause.name === "TimeoutError") {
      throw new HTTPException(504, {
        message: "The seller origin timed out",
        cause,
      });
    }
    throw new HTTPException(502, {
      message: "The seller origin could not be reached",
      cause,
    });
  }
  const responseHeaders = new Headers(upstream.headers);
  if (upstream.status >= 300 && upstream.status < 400) {
    await upstream.body?.cancel();
    throw new HTTPException(502, {
      message: "Origin redirects are not supported",
    });
  }
  for (const header of RESPONSE_HEADERS_TO_STRIP)
    responseHeaders.delete(header);
  responseHeaders.set("X-Loopfare-Proxied", "1");
  responseHeaders.set("X-Loopfare-Request-Id", c.get("requestId"));
  // Bound decoded bytes too: a compressed response can expand beyond wire limits.
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const reader = upstream.body?.getReader();
  try {
    if (reader)
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length;
        if (bytes > config.maxProxyResponseBytes)
          throw new HTTPException(502, {
            message: "Origin response exceeds the configured limit",
          });
        chunks.push(part.value);
      }
  } catch (error) {
    await reader?.cancel().catch(() => {});
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(502, {
      message: "Origin response could not be read completely",
    });
  }
  return new Response(
    c.req.method === "HEAD" || upstream.status === 204
      ? null
      : Buffer.concat(chunks),
    {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    },
  );
}

const REQUEST_HEADERS_TO_STRIP = new Set([
  "settlement-overrides",
  "x-loopfare-origin-secret",
  "payment-response",
  "payment-required",
  "authorization",
  "connection",
  "content-length",
  "cookie",
  "host",
  "keep-alive",
  "loopfare-dev-payment",
  "payment-signature",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-loopfare-budget-token",
  "x-loopfare-wallet",
  "x-payment",
]);
const RESPONSE_HEADERS_TO_STRIP = [
  "settlement-overrides",
  "x-loopfare-origin-secret",
  "payment-response",
  "payment-required",
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "set-cookie",
  "set-cookie2",
  "transfer-encoding",
  "upgrade",
];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
