import { registerBudgetRoutes } from "./budget-routes.js";
import { registerProxyRoutes } from "./proxy-routes.js";
import type { AuthEnv } from "./types.js";
import { requireAuth, requireMetricsAuth } from "./auth.js";
import { rateLimit } from "./rate-limit.js";
import { registerSellerRoutes } from "./seller-routes.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { config } from "./config.js";
import { demoGuide } from "./demo-guide.js";
import { paymentHealth } from "./payment-health.js";
import { settlement } from "./settlement.js";
import {
  documentationHtml,
  publicDocMarkdown,
  publicDocs,
} from "./docs-site.js";
import {
  createAccount,
  databaseReady,
  ensureBootstrapAccount,
  getAccountByEmail,
  priceToUsd,
  recordPayment,
  rotateApiKey,
} from "./db.js";
import { faviconSvg, websiteHtml } from "./site.js";
import { buildDemoPaymentMiddleware, isDevPaymentAuthorized } from "./x402.js";
import {
  createRequestUsageContext,
  getUsageMetrics,
  hashUsageIdentifier,
  recordUsageEvent,
  usageCookie,
} from "./usage.js";
import type { UsageEventInput } from "./usage.js";

const app = new Hono<AuthEnv>();

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
    crossOriginResourcePolicy: "cross-origin",
    permissionsPolicy: {
      camera: ["none"],
      geolocation: ["none"],
      microphone: ["none"],
      payment: ["none"],
    },
    referrerPolicy: "strict-origin-when-cross-origin",
  }),
);

app.use("*", async (c, next) => {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const usage = createRequestUsageContext({
    requestId,
    path: c.req.path,
    headers: c.req.raw.headers,
    url: c.req.url,
  });
  c.set("requestId", requestId);
  c.set("usage", usage);
  c.header("X-Request-Id", requestId);
  if (usage.sessionCookie)
    c.header("Set-Cookie", usageCookie(usage.sessionCookie));

  try {
    await next();
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    trackUsage(c, {
      eventType: "request_completed",
      method: c.req.method,
      route: c.req.path,
      statusCode: errorStatus(error),
      durationMs,
    });
    throw error;
  }

  const durationMs = Date.now() - startedAt;
  c.header("X-Response-Time", `${durationMs}ms`);
  if (usage.sessionCookie) {
    c.header("Cache-Control", "private, no-cache");
  }
  trackUsage(c, {
    eventType: "request_completed",
    method: c.req.method,
    route: c.req.path,
    statusCode: c.res.status,
    durationMs,
  });
  if (isPublicPageView(c) && c.res.status < 400) {
    trackUsage(c, {
      eventType: "page_view",
      method: c.req.method,
      route: c.req.path,
      statusCode: c.res.status,
      durationMs,
    });
  }
  if (!c.req.path.startsWith("/health")) {
    console.log(
      JSON.stringify({
        level: "info",
        message: "request",
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs,
      }),
    );
  }
});

app.use(
  "/v1/*",
  cors({
    origin: (origin) =>
      config.corsOrigins.includes(origin.replace(/\/$/, ""))
        ? origin
        : undefined,
    allowHeaders: [
      "Authorization",
      "Content-Type",
      "Payment-Signature",
      "X-Loopfare-Budget-Token",
      "X-Loopfare-Wallet",
    ],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Payment-Required", "Payment-Response", "X-Request-Id"],
    maxAge: 86_400,
  }),
);

app.use(
  "/v1/*",
  bodyLimit({
    maxSize: config.maxRequestBodyBytes,
    onError: (c) => c.json({ error: "payload_too_large" }, 413),
  }),
);
app.use(
  "/p/*",
  bodyLimit({
    maxSize: config.maxRequestBodyBytes,
    onError: (c) => c.json({ error: "payload_too_large" }, 413),
  }),
);
app.use("/v1/*", rateLimit({ limit: 300, windowMs: 60_000 }));
app.use("/p/*", rateLimit({ limit: 600, windowMs: 60_000 }));
app.use("/demo/*", rateLimit({ limit: 120, windowMs: 60_000 }));

// ── Website, metadata, and health ────────────────────────────────

app.get("/", (c) => {
  c.header("Cache-Control", "private, no-cache");
  return c.html(
    websiteHtml({
      publicUrl: config.publicUrl,
      network: config.network,
      demoEnabled: config.demoEnabled,
    }),
  );
});

app.get("/favicon.svg", (c) => {
  c.header("Cache-Control", "public, max-age=86400");
  return c.body(faviconSvg(), 200, {
    "Content-Type": "image/svg+xml; charset=utf-8",
  });
});
app.get("/demo", (c) =>
  c.html(
    demoGuide().replace("YOUR_LOOPFARE_ORIGIN", escapeXml(config.publicUrl)),
  ),
);
app.get("/social.svg", (c) =>
  c.body(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#171420"/><text x="80" y="270" font-family="monospace" font-size="120" fill="#c8ff68">loopfare</text><text x="80" y="370" font-family="sans-serif" font-size="40" fill="#fff">Make every API call pay its fare.</text><text x="80" y="450" font-family="sans-serif" font-size="28" fill="#bbb">Open-source x402 proxy · Base Sepolia beta</text></svg>`,
    200,
    { "Content-Type": "image/svg+xml" },
  ),
);
app.get("/favicon.ico", (c) => c.redirect("/favicon.svg", 301));

app.get("/robots.txt", (c) =>
  c.text(
    `User-agent: *\nAllow: /\nDisallow: /v1/\nSitemap: ${config.publicUrl}/sitemap.xml\n`,
  ),
);

app.get("/sitemap.xml", (c) => {
  const paths = ["", "/docs", ...publicDocs.map((doc) => `/docs/${doc.slug}`)];
  return c.body(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${escapeXml(`${config.publicUrl}${path}`)}</loc></url>`).join("")}</urlset>`,
    200,
    { "Content-Type": "application/xml; charset=utf-8" },
  );
});

app.get("/docs", (c) => {
  c.header("Cache-Control", "private, no-cache");
  return c.html(documentationHtml({ publicUrl: config.publicUrl })!);
});

app.get("/docs/:document", (c) => {
  const document = c.req.param("document");
  const wantsMarkdown = document.endsWith(".md");
  const slug = wantsMarkdown ? document.slice(0, -3) : document;
  const content = wantsMarkdown
    ? publicDocMarkdown(slug)
    : documentationHtml({ publicUrl: config.publicUrl, slug });
  if (!content)
    return c.json(
      { error: "doc_not_found", message: "Documentation page not found" },
      404,
    );
  c.header(
    "Cache-Control",
    wantsMarkdown
      ? "public, max-age=300, stale-while-revalidate=3600"
      : "private, no-cache",
  );
  return wantsMarkdown
    ? c.text(content, 200, { "Content-Type": "text/markdown; charset=utf-8" })
    : c.html(content);
});

app.get("/api", (c) =>
  c.json({
    name: "loopfare",
    version: "0.3.1",
    tagline: "Make every API call pay its fare",
    network: config.network,
    networkCaip2: config.networkCaip2,
    protocol: "x402-v2",
    publicUrl: config.publicUrl,
    demoEnabled: config.demoEnabled,
    docs: {
      website: "GET /",
      documentation: "GET /docs",
      documentationMarkdown: "GET /docs/:page.md",
      health: "GET /health",
      signup: "POST /v1/auth/signup",
      projects: "GET|POST /v1/projects",
      protect: "POST /v1/projects/:id/routes",
      proxy: "ANY /p/:projectSlug/*",
      demo: "GET /demo/v1/fortune",
      metrics: "GET /v1/admin/metrics?days=30",
      agentSkill: "GET /skill.md",
    },
  }),
);

app.get("/health", (c) =>
  c.json({
    ok: databaseReady(),
    service: "loopfare",
    version: "0.3.1",
    network: config.network,
    demoEnabled: config.demoEnabled,
    timestamp: new Date().toISOString(),
  }),
);

app.get("/health/live", (c) => c.json({ ok: true }));
app.get("/health/payments", async (c) => {
  const result = await paymentHealth();
  return c.json(
    {
      ...result,
      scope:
        "Facilitator capabilities only; not a settlement or backup guarantee",
    },
    result.ok ? 200 : 503,
  );
});
app.get("/health/ready", (c) => {
  const ok = databaseReady();
  return c.json({ ok }, ok ? 200 : 503);
});

app.get("/skill.md", (c) => {
  const body = `# Loopfare — agent skill

Charge and pay for HTTP APIs with x402 v2 on Base.

## Seller (protect an API)

1. Sign up: \`POST ${config.publicUrl}/v1/auth/signup\` with \`{"email":"you@example.com"}\`
2. Create project: \`POST /v1/projects\` with Bearer API key, body \`{"name":"My API","slug":"my-api","payTo":"0x..."}\`
3. Protect origin: \`POST /v1/projects/:id/routes\` body \`{"pathPattern":"/v1/*","originUrl":"https://api.example.com","price":"$0.001"}\`
4. Agents call: \`${config.publicUrl}/p/my-api/v1/...\`

## Buyer (pay as an agent)

\`\`\`bash
loopfare wallet create --json
loopfare budget set --daily 5 --json
loopfare call ${config.publicUrl}/demo/v1/fortune --json
\`\`\`

The paid endpoint responds with an x402 v2 PAYMENT-REQUIRED challenge. Compatible clients retry with PAYMENT-SIGNATURE.

Complete manuals and references: ${config.publicUrl}/docs

Dev mode is local-only: when \`LOOPFARE_DEV_MODE=true\`, send \`LOOPFARE-DEV-PAYMENT: ok\`.
`;
  return c.text(body, 200, { "Content-Type": "text/markdown; charset=utf-8" });
});

// ── Seller authentication ────────────────────────────────────────

const signupSchema = z.object({ email: z.string().email().max(254) });

app.post(
  "/v1/auth/signup",
  rateLimit({ limit: 5, windowMs: 60 * 60_000 }),
  async (c) => {
    if (!config.signupEnabled) {
      return c.json(
        {
          error: "signup_disabled",
          message: "New signups are temporarily closed",
        },
        503,
      );
    }
    const body = signupSchema.parse(await c.req.json());
    if (body.email.trim().toLowerCase().endsWith("@loopfare.local"))
      throw new HTTPException(400, { message: "Reserved account identity" });
    const existing = getAccountByEmail(body.email);
    if (existing) {
      return c.json(
        {
          error: "account_exists",
          message:
            "An account already exists for this email. Use or rotate its API key.",
        },
        409,
      );
    }
    const { account, apiKey } = createAccount(body.email);
    trackUsage(c, {
      eventType: "signup",
      accountId: account.id,
      route: "/v1/auth/signup",
      statusCode: 201,
    });
    return c.json(
      {
        id: account.id,
        email: account.email,
        apiKey,
        apiKeyPrefix: account.api_key_prefix,
        createdAt: account.created_at,
        hint: "Store apiKey securely. It cannot be retrieved later.",
      },
      201,
    );
  },
);

app.get("/v1/auth/me", requireAuth, (c) =>
  c.json({ accountId: c.get("accountId"), email: c.get("email") }),
);

app.post("/v1/auth/rotate-key", requireAuth, (c) => {
  const next = rotateApiKey(c.get("accountId"));
  return c.json({
    apiKey: next.apiKey,
    apiKeyPrefix: next.prefix,
    hint: "The previous API key stopped working immediately.",
  });
});

app.get("/v1/admin/metrics", requireMetricsAuth, (c) => {
  const days = parseMetricsDays(c.req.query("days"));
  return c.json(getUsageMetrics(days));
});

// ── Projects and protected routes ────────────────────────────────

registerSellerRoutes(app, trackUsage);

// ── Buyer budget safety rail ─────────────────────────────────────

registerBudgetRoutes(app, trackUsage);

// ── Demo paid endpoint ────────────────────────────────────────────

const fortunes = [
  "Your agent will ship before the meeting ends.",
  "A 402 is just a handshake in disguise.",
  "Micropayments compound like compound interest for machines.",
  "The best buyer API key is no API key—just pay and go.",
  "Context is expensive; paid tools should be cheap.",
];

app.use("/demo/v1/fortune", async (c, next) => {
  if (!config.demoEnabled && !config.devMode) {
    return c.json(
      {
        error: "demo_not_configured",
        message: "The demo receiving wallet is not configured",
      },
      503,
    );
  }
  const wallet = c.req.header("X-Loopfare-Wallet");
  const devAuthorized =
    config.devMode &&
    isDevPaymentAuthorized(
      c.req.header("LOOPFARE-DEV-PAYMENT"),
      config.demoPrice,
    );
  const hasPaymentSignature = Boolean(c.req.header("PAYMENT-SIGNATURE"));
  trackUsage(c, {
    eventType:
      devAuthorized || hasPaymentSignature
        ? "payment_attempted"
        : "payment_challenge",
    route: "/demo/v1/fortune",
    walletAddress: wallet,
    amountUsd: priceToUsd(config.demoPrice),
  });

  if (devAuthorized) {
    recordPayment({
      method: c.req.method,
      path: c.req.path,
      price: config.demoPrice,
      status: "dev_settled",
      buyerHint: "dev-mode",
    });
    trackUsage(c, {
      eventType: "payment_settled",
      route: "/demo/v1/fortune",
      statusCode: 200,
      walletAddress: wallet,
      amountUsd: priceToUsd(config.demoPrice),
      metadata: { mode: "dev" },
    });
    return next();
  }
  if (!config.devMode || hasPaymentSignature) {
    const result = await buildDemoPaymentMiddleware()(c, next);
    const response = result instanceof Response ? result : c.res;
    const receipt = settlement(response.headers.get("PAYMENT-RESPONSE"));
    if (response.status < 400 && receipt) {
      recordPayment({
        method: c.req.method,
        path: c.req.path,
        price: config.demoPrice,
        status: "settled",
        isTest: c.get("usage").testTraffic,
        txHash: receipt.transaction,
        buyerHint: receipt.payer ?? null,
        amountAtomic: receipt.amount,
      });
      trackUsage(c, {
        eventType: "payment_settled",
        route: "/demo/v1/fortune",
        statusCode: response.status,
        walletAddress: receipt.payer,
        amountUsd: priceToUsd(config.demoPrice),
        metadata: { mode: "x402" },
      });
    }
    return result;
  }
  return c.json(
    {
      error: "payment_required",
      message: "Payment required for demo fortune",
      price: config.demoPrice,
      network: config.network,
      networkCaip2: config.networkCaip2,
      payTo: config.demoPayTo,
      devMode: true,
      howToPay: {
        x402: "Use loopfare call or @x402/fetch with a funded Base wallet",
        dev: "Send LOOPFARE-DEV-PAYMENT: ok",
      },
    },
    402,
  );
});

app.get("/demo/v1/fortune", (c) =>
  c.json({
    fortune: fortunes[Math.floor(Math.random() * fortunes.length)]!,
    charged: config.demoPrice,
    network: config.network,
    product: "loopfare",
  }),
);

// ── Paid reverse proxy ────────────────────────────────────────────

registerProxyRoutes(app, trackUsage);

// ── Errors and helpers ────────────────────────────────────────────

app.notFound((c) => c.json({ error: "not_found", path: c.req.path }, 404));

app.onError((error, c) => {
  if (error instanceof z.ZodError) {
    return c.json({ error: "validation_error", issues: error.issues }, 400);
  }
  if (error instanceof HTTPException) {
    const status = error.status as
      | 400
      | 401
      | 403
      | 404
      | 405
      | 409
      | 413
      | 422
      | 429
      | 500
      | 502
      | 503
      | 504;
    return c.json(
      {
        error: httpErrorCode(status),
        message: error.message,
        requestId: c.get("requestId"),
      },
      status,
    );
  }
  if (error instanceof SyntaxError) {
    return c.json(
      { error: "invalid_json", message: "Request body must be valid JSON" },
      400,
    );
  }
  console.error(
    JSON.stringify({
      level: "error",
      message: "request_failed",
      requestId: c.get("requestId"),
      error: errorMessage(error),
      stack: config.isProduction
        ? undefined
        : error instanceof Error
          ? error.stack
          : undefined,
    }),
  );
  return c.json(
    {
      error: "internal_error",
      message: config.isProduction
        ? "An unexpected error occurred"
        : errorMessage(error),
      requestId: c.get("requestId"),
    },
    500,
  );
});

function trackUsage(
  c: Context<AuthEnv>,
  input: UsageEventInput & { walletAddress?: string },
) {
  const usage = c.get("usage");
  if (usage.excluded) return;
  const { walletAddress, ...event } = input;
  try {
    recordUsageEvent({
      requestId: usage.requestId,
      sessionId: usage.sessionId,
      networkHash: usage.networkHash,
      walletHash:
        walletAddress &&
        (input.eventType === "wallet_configured" ||
          (input.eventType === "payment_settled" &&
            input.metadata?.mode === "x402"))
          ? hashUsageIdentifier(
              "wallet",
              `${config.networkCaip2}:${walletAddress.toLowerCase()}`,
            )
          : null,
      userAgentCategory: usage.userAgentCategory,
      referrer: usage.referrer,
      isBot: usage.isBot,
      ...event,
      metadata: {
        ...event.metadata,
        schemaVersion: 2,
        network: config.networkCaip2,
        demo: c.req.path.startsWith("/demo/"),
        test: usage.testTraffic || config.nodeEnv === "test" || config.devMode,
        campaign: usage.campaign,
        installHash: usage.installHash,
        outcome:
          input.statusCode === 402 &&
          !c.req.header("PAYMENT-SIGNATURE") &&
          !c.req.header("X-Loopfare-Budget-Token") &&
          (c.req.path.startsWith("/demo/") || c.req.path.startsWith("/p/"))
            ? "expected_challenge"
            : input.statusCode === 402
              ? "payment_denied"
              : (input.statusCode ?? 0) >= 500
                ? "service_failure"
                : (input.statusCode ?? 0) >= 400
                  ? "request_failure"
                  : "ok",
      },
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "usage_tracking_failed",
        requestId: usage.requestId,
        error: errorMessage(error),
      }),
    );
  }
}

function isPublicPageView(c: Context<AuthEnv>) {
  if (c.req.method !== "GET") return false;
  const isPublicPage =
    c.req.path === "/" ||
    c.req.path === "/docs" ||
    c.req.path === "/demo" ||
    c.req.path.startsWith("/docs/");
  return (
    isPublicPage &&
    Boolean(c.res.headers.get("content-type")?.includes("text/html"))
  );
}

function errorStatus(error: unknown) {
  if (error instanceof HTTPException) return error.status;
  if (error instanceof z.ZodError || error instanceof SyntaxError) return 400;
  return 500;
}

function parseMetricsDays(value?: string) {
  if (!value) return 30;
  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > config.usageRetentionDays
  ) {
    throw new HTTPException(400, {
      message: `days must be an integer from 1 to ${config.usageRetentionDays}`,
    });
  }
  return parsed;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, (character) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      '"': "&quot;",
    };
    return entities[character]!;
  });
}

function httpErrorCode(status: number) {
  const codes: Record<number, string> = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    422: "unprocessable_entity",
    429: "rate_limited",
    502: "bad_gateway",
    503: "service_unavailable",
    504: "gateway_timeout",
  };
  return codes[status] ?? "internal_error";
}

ensureBootstrapAccount();

export { app };
