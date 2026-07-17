import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { fetch as proxyFetch } from "undici";
import { z } from "zod";
import { config } from "./config.js";
import {
  documentationHtml,
  publicDocMarkdown,
  publicDocs,
} from "./docs-site.js";
import {
  canSpendBudget,
  createAccount,
  createProject,
  createRoute,
  databaseReady,
  deleteProject,
  deleteRoute,
  ensureBootstrapAccount,
  findRouteForRequest,
  getAccountByApiKey,
  getAccountByEmail,
  getBudgetForToken,
  getEarnings,
  getProjectById,
  listPayments,
  listProjects,
  listRoutes,
  normalizeMethods,
  normalizePrice,
  priceToUsd,
  recordPayment,
  refundBudgetSpend,
  rotateApiKey,
  setBudget,
  trySpendBudget,
  updateRoute,
} from "./db.js";
import { assertSafeOrigin, safeProxyDispatcher } from "./origin-security.js";
import { faviconSvg, websiteHtml } from "./site.js";
import {
  buildDemoPaymentMiddleware,
  buildRoutePaymentMiddleware,
  isDevPaymentAuthorized,
  publicResourceUrl,
} from "./x402.js";

type AuthEnv = {
  Variables: {
    accountId: string;
    email: string;
    requestId: string;
  };
};

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
  const requestId = c.req.header("X-Request-Id")?.slice(0, 100) || randomUUID();
  const startedAt = Date.now();
  c.set("requestId", requestId);
  c.header("X-Request-Id", requestId);
  await next();
  c.header("X-Response-Time", `${Date.now() - startedAt}ms`);
  if (!c.req.path.startsWith("/health")) {
    console.log(
      JSON.stringify({
        level: "info",
        message: "request",
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Date.now() - startedAt,
      }),
    );
  }
});

app.use(
  "/v1/*",
  cors({
    origin: (origin) => (config.corsOrigins.includes(origin.replace(/\/$/, "")) ? origin : undefined),
    allowHeaders: [
      "Authorization",
      "Content-Type",
      "Payment-Signature",
      "X-Loopfare-Budget-Token",
      "X-Loopfare-Wallet",
    ],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
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
  c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
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
  return c.body(faviconSvg(), 200, { "Content-Type": "image/svg+xml; charset=utf-8" });
});
app.get("/favicon.ico", (c) => c.redirect("/favicon.svg", 301));

app.get("/robots.txt", (c) =>
  c.text(`User-agent: *\nAllow: /\nDisallow: /v1/\nSitemap: ${config.publicUrl}/sitemap.xml\n`),
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
  c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
  return c.html(documentationHtml({ publicUrl: config.publicUrl })!);
});

app.get("/docs/:document", (c) => {
  const document = c.req.param("document");
  const wantsMarkdown = document.endsWith(".md");
  const slug = wantsMarkdown ? document.slice(0, -3) : document;
  const content = wantsMarkdown
    ? publicDocMarkdown(slug)
    : documentationHtml({ publicUrl: config.publicUrl, slug });
  if (!content) return c.json({ error: "doc_not_found", message: "Documentation page not found" }, 404);
  c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
  return wantsMarkdown
    ? c.text(content, 200, { "Content-Type": "text/markdown; charset=utf-8" })
    : c.html(content);
});

app.get("/api", (c) =>
  c.json({
    name: "loopfare",
    version: "0.2.5",
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
      agentSkill: "GET /skill.md",
    },
  }),
);

app.get("/health", (c) =>
  c.json({
    ok: databaseReady(),
    service: "loopfare",
    version: "0.2.5",
    network: config.network,
    demoEnabled: config.demoEnabled,
    timestamp: new Date().toISOString(),
  }),
);

app.get("/health/live", (c) => c.json({ ok: true }));
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

const requireAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key) throw new HTTPException(401, { message: "Missing Bearer API key" });
  const account = getAccountByApiKey(key);
  if (!account) throw new HTTPException(401, { message: "Invalid API key" });
  c.set("accountId", account.id);
  c.set("email", account.email);
  await next();
};

const signupSchema = z.object({ email: z.string().email().max(254) });

app.post(
  "/v1/auth/signup",
  rateLimit({ limit: 5, windowMs: 60 * 60_000 }),
  async (c) => {
    if (!config.signupEnabled) {
      return c.json({ error: "signup_disabled", message: "New signups are temporarily closed" }, 503);
    }
    const body = signupSchema.parse(await c.req.json());
    const existing = getAccountByEmail(body.email);
    if (existing) {
      return c.json(
        {
          error: "account_exists",
          message: "An account already exists for this email. Use or rotate its API key.",
        },
        409,
      );
    }
    const { account, apiKey } = createAccount(body.email);
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

// ── Projects and protected routes ────────────────────────────────

const projectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/i, "slug must contain letters, numbers, and single hyphens"),
  payTo: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "payTo must be an EVM address"),
});

app.post("/v1/projects", requireAuth, async (c) => {
  const body = projectSchema.parse(await c.req.json());
  try {
    const project = createProject({
      accountId: c.get("accountId"),
      name: body.name,
      slug: body.slug,
      payTo: body.payTo,
    });
    return c.json({ ...project, proxyBase: `${config.publicUrl}/p/${project.slug}` }, 201);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return c.json({ error: "slug_taken", message: "Project slug already exists" }, 409);
    }
    throw error;
  }
});

app.get("/v1/projects", requireAuth, (c) => {
  const projects = listProjects(c.get("accountId")).map((project) => ({
    ...project,
    proxyBase: `${config.publicUrl}/p/${project.slug}`,
  }));
  return c.json({ projects });
});

app.get("/v1/projects/:id", requireAuth, (c) => {
  const project = getOwnedProject(c.get("accountId"), c.req.param("id"));
  return c.json({
    project: { ...project, proxyBase: `${config.publicUrl}/p/${project.slug}` },
    routes: listRoutes(project.id),
    earnings: getEarnings(project.id),
  });
});

app.delete("/v1/projects/:id", requireAuth, (c) => {
  const project = getOwnedProject(c.get("accountId"), c.req.param("id"));
  deleteProject(project.id);
  return c.body(null, 204);
});

const routeFields = {
  pathPattern: z.string().trim().min(1).max(500),
  originUrl: z.string().trim().url().max(2_048),
  price: z.string().trim().min(1).max(32).refine(isValidPrice, "Invalid price"),
  description: z.string().trim().max(500).optional(),
  methods: z.string().trim().max(200).refine(isValidMethods, "Invalid HTTP methods").optional(),
};
const routeSchema = z.object(routeFields);
const routePatchSchema = z
  .object({ ...routeFields, enabled: z.boolean().optional() })
  .partial()
  .refine((input) => Object.keys(input).length > 0, "At least one field is required");

app.post("/v1/projects/:id/routes", requireAuth, async (c) => {
  const project = getOwnedProject(c.get("accountId"), c.req.param("id"));
  const body = routeSchema.parse(await c.req.json());
  try {
    await assertSafeOrigin(body.originUrl);
  } catch (error) {
    throw new HTTPException(400, { message: errorMessage(error) });
  }
  const route = createRoute({
    projectId: project.id,
    pathPattern: body.pathPattern,
    originUrl: body.originUrl,
    price: body.price,
    description: body.description,
    methods: body.methods,
  });
  return c.json(
    {
      route,
      publicUrl: `${config.publicUrl}/p/${project.slug}${route.path_pattern.replace(/\*$/, "")}`,
      example: `${config.publicUrl}/p/${project.slug}/...`,
    },
    201,
  );
});

app.get("/v1/projects/:id/routes", requireAuth, (c) => {
  const project = getOwnedProject(c.get("accountId"), c.req.param("id"));
  return c.json({ routes: listRoutes(project.id) });
});

app.patch("/v1/projects/:id/routes/:routeId", requireAuth, async (c) => {
  const project = getOwnedProject(c.get("accountId"), c.req.param("id"));
  const body = routePatchSchema.parse(await c.req.json());
  if (body.originUrl) {
    try {
      await assertSafeOrigin(body.originUrl);
    } catch (error) {
      throw new HTTPException(400, { message: errorMessage(error) });
    }
  }
  const route = updateRoute(c.req.param("routeId"), project.id, body);
  if (!route) throw new HTTPException(404, { message: "Route not found" });
  return c.json({ route });
});

app.delete("/v1/projects/:id/routes/:routeId", requireAuth, (c) => {
  const project = getOwnedProject(c.get("accountId"), c.req.param("id"));
  if (!deleteRoute(c.req.param("routeId"), project.id)) {
    throw new HTTPException(404, { message: "Route not found" });
  }
  return c.body(null, 204);
});

app.get("/v1/projects/:id/payments", requireAuth, (c) => {
  const project = getOwnedProject(c.get("accountId"), c.req.param("id"));
  const limit = parseLimit(c.req.query("limit"));
  return c.json({
    payments: listPayments({ projectId: project.id, limit }),
    earnings: getEarnings(project.id),
  });
});

app.get("/v1/payments", requireAuth, (c) =>
  c.json({
    payments: listPayments({ accountId: c.get("accountId"), limit: parseLimit(c.req.query("limit")) }),
  }),
);

// ── Buyer budget safety rail ─────────────────────────────────────

const budgetSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  dailyLimitUsd: z.number().positive().max(1_000_000),
});

app.post("/v1/buyer/budget", async (c) => {
  const body = budgetSchema.parse(await c.req.json());
  const token = requireBudgetToken(c);
  const budget = setBudget(body.walletAddress, body.dailyLimitUsd, token);
  if (!budget) throw new HTTPException(403, { message: "Invalid budget token" });
  return c.json({ budget: publicBudget(budget) });
});

app.get("/v1/buyer/budget/:address", (c) => {
  const budget = getBudgetForToken(c.req.param("address"), requireBudgetToken(c));
  if (!budget) throw new HTTPException(403, { message: "Invalid budget token" });
  return c.json({ budget: publicBudget(budget) });
});

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
      { error: "demo_not_configured", message: "The demo receiving wallet is not configured" },
      503,
    );
  }
  if (
    config.devMode &&
    isDevPaymentAuthorized(c.req.header("LOOPFARE-DEV-PAYMENT"), config.demoPrice)
  ) {
    recordPayment({
      method: c.req.method,
      path: c.req.path,
      price: config.demoPrice,
      status: "dev_settled",
      buyerHint: "dev-mode",
    });
    return next();
  }
  if (!config.devMode || c.req.header("PAYMENT-SIGNATURE")) {
    const result = await buildDemoPaymentMiddleware()(c, next);
    const response = result instanceof Response ? result : c.res;
    if (response.status < 400 && response.headers.has("PAYMENT-RESPONSE")) {
      recordPayment({
        method: c.req.method,
        path: c.req.path,
        price: config.demoPrice,
        status: "settled",
        txHash: settlementTransactionHash(response.headers.get("PAYMENT-RESPONSE")),
        buyerHint: c.req.header("X-Loopfare-Wallet") ?? null,
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

async function handlePaidProxy(c: Context<AuthEnv>) {
  const projectSlug = c.req.param("projectSlug");
  if (!projectSlug) throw new HTTPException(400, { message: "Project slug is required" });
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
  try {
    safeOrigin = await assertSafeOrigin(route.origin_url);
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
    return c.json({ error: "origin_unavailable", message: "The configured origin is unavailable" }, 502);
  }

  const wallet = c.req.header("X-Loopfare-Wallet");
  const budgetToken = c.req.header("X-Loopfare-Budget-Token");
  const amountUsd = priceToUsd(route.price);
  if (budgetToken && !wallet) {
    return c.json({ error: "wallet_required", message: "Budget token requires a wallet header" }, 400);
  }
  if (wallet && budgetToken) {
    const check = canSpendBudget(wallet, budgetToken, amountUsd);
    if (!check.ok) {
      return c.json(
        {
          error: check.unauthorized ? "invalid_budget_token" : "budget_exceeded",
          message: check.reason,
          budget: check.budget ? publicBudget(check.budget) : undefined,
        },
        check.unauthorized ? 403 : 402,
      );
    }
  }

  if (
    config.devMode &&
    isDevPaymentAuthorized(c.req.header("LOOPFARE-DEV-PAYMENT"), route.price)
  ) {
    let budgetReserved = false;
    if (wallet && budgetToken) {
      const reservation = trySpendBudget(wallet, budgetToken, amountUsd);
      if (!reservation.ok) return budgetFailureResponse(c, reservation);
      budgetReserved = true;
    }
    let response: Response;
    try {
      response = await proxyToOrigin(c, safeOrigin, rest);
    } catch (error) {
      if (budgetReserved) refundBudgetSpend(wallet!, budgetToken!, amountUsd);
      throw error;
    }
    if (response.status < 400) {
      recordPayment({
        routeId: route.id,
        projectId: route.project_id,
        method: c.req.method,
        path: c.req.path,
        price: route.price,
        status: "dev_settled",
        buyerHint: wallet ?? "dev-mode",
      });
    } else if (budgetReserved) {
      refundBudgetSpend(wallet!, budgetToken!, amountUsd);
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
    description: route.description || `Loopfare protected: ${projectSlug}${rest}`,
  });
  let budgetReserved = false;
  let gateResult: void | Response;
  try {
    gateResult = await gate(c, async () => {
      paid = true;
      if (wallet && budgetToken) {
        const reservation = trySpendBudget(wallet, budgetToken, amountUsd);
        if (!reservation.ok) {
          c.res = budgetFailureResponse(c, reservation);
          return;
        }
        budgetReserved = true;
      }
      c.res = await proxyToOrigin(c, safeOrigin, rest);
    });
  } catch (error) {
    if (budgetReserved) refundBudgetSpend(wallet!, budgetToken!, amountUsd);
    throw error;
  }

  if (!paid) {
    if (gateResult instanceof Response) return gateResult;
    if (c.res) return c.res;
    return c.json(
      { error: "payment_required", price: route.price, network: config.network, payTo: route.pay_to },
      402,
    );
  }

  // paymentMiddleware settles only after the upstream response succeeds, then
  // adds PAYMENT-RESPONSE to that same response. Never record a payment merely
  // because verification reached the origin handler.
  const settledResponse = c.res;
  if (settledResponse.status >= 400 || !settledResponse.headers.has("PAYMENT-RESPONSE")) {
    if (budgetReserved) refundBudgetSpend(wallet!, budgetToken!, amountUsd);
    return settledResponse;
  }
  recordPayment({
    routeId: route.id,
    projectId: route.project_id,
    method: c.req.method,
    path: c.req.path,
    price: route.price,
    status: "settled",
    txHash: settlementTransactionHash(settledResponse.headers.get("PAYMENT-RESPONSE")),
    buyerHint: wallet ?? null,
  });
  return settledResponse;
}

// Register both forms because Hono's trailing wildcard does not match every
// router/runtime combination when the project base has no trailing slash.
app.all("/p/:projectSlug", handlePaidProxy);
app.all("/p/:projectSlug/*", handlePaidProxy);

// ── Errors and helpers ────────────────────────────────────────────

app.notFound((c) => c.json({ error: "not_found", path: c.req.path }, 404));

app.onError((error, c) => {
  if (error instanceof z.ZodError) {
    return c.json({ error: "validation_error", issues: error.issues }, 400);
  }
  if (error instanceof HTTPException) {
    const status = error.status as 400 | 401 | 403 | 404 | 405 | 409 | 413 | 422 | 429 | 500 | 502 | 503 | 504;
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
    return c.json({ error: "invalid_json", message: "Request body must be valid JSON" }, 400);
  }
  console.error(
    JSON.stringify({
      level: "error",
      message: "request_failed",
      requestId: c.get("requestId"),
      error: errorMessage(error),
      stack: config.isProduction ? undefined : error instanceof Error ? error.stack : undefined,
    }),
  );
  return c.json(
    {
      error: "internal_error",
      message: config.isProduction ? "An unexpected error occurred" : errorMessage(error),
      requestId: c.get("requestId"),
    },
    500,
  );
});

function getOwnedProject(accountId: string, projectId: string) {
  const project = getProjectById(projectId);
  if (!project || project.account_id !== accountId) {
    throw new HTTPException(404, { message: "Project not found" });
  }
  return project;
}

async function proxyToOrigin(c: Context<AuthEnv>, originBase: string, path: string) {
  const incoming = new URL(c.req.url);
  const target = new URL(originBase);
  target.pathname = `${target.pathname.replace(/\/$/, "")}${path}`.replace(/\/{2,}/g, "/");
  target.search = incoming.search;

  const headers = new Headers();
  c.req.raw.headers.forEach((value, key) => {
    if (!REQUEST_HEADERS_TO_STRIP.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("X-Forwarded-By", "loopfare");
  headers.set("X-Loopfare-Request-Id", c.get("requestId"));

  const init: Parameters<typeof proxyFetch>[1] = {
    method: c.req.method,
    headers,
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
      throw new HTTPException(504, { message: "The seller origin timed out", cause });
    }
    throw new HTTPException(502, { message: "The seller origin could not be reached", cause });
  }
  const responseHeaders = new Headers(upstream.headers);
  for (const header of RESPONSE_HEADERS_TO_STRIP) responseHeaders.delete(header);
  responseHeaders.set("X-Loopfare-Proxied", "1");
  responseHeaders.set("X-Loopfare-Request-Id", c.get("requestId"));
  // Undici and the DOM library describe Node's same runtime Web Stream with
  // distinct TypeScript declarations, so bridge the type without buffering it.
  return new Response(upstream.body as unknown as BodyInit | null, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

const REQUEST_HEADERS_TO_STRIP = new Set([
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

function rateLimit(options: { limit: number; windowMs: number }): MiddlewareHandler<AuthEnv> {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return async (c, next) => {
    const timestamp = Date.now();
    const key = clientIdentifier(c);
    const current = buckets.get(key);
    const bucket =
      !current || current.resetAt <= timestamp
        ? { count: 0, resetAt: timestamp + options.windowMs }
        : current;
    bucket.count += 1;
    buckets.set(key, bucket);
    c.header("RateLimit-Limit", String(options.limit));
    c.header("RateLimit-Remaining", String(Math.max(0, options.limit - bucket.count)));
    c.header("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > options.limit) {
      c.header("Retry-After", String(Math.ceil((bucket.resetAt - timestamp) / 1000)));
      return c.json({ error: "rate_limited", message: "Too many requests" }, 429);
    }
    if (buckets.size > 10_000) {
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= timestamp) buckets.delete(bucketKey);
      }
    }
    await next();
  };
}

function clientIdentifier(c: Context) {
  return (
    c.req.header("CF-Connecting-IP") ||
    c.req.header("X-Real-IP") ||
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function requireBudgetToken(c: Context) {
  const authorization = c.req.header("Authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const token = c.req.header("X-Loopfare-Budget-Token") || bearer;
  if (!token || token.length < 24 || token.length > 200) {
    throw new HTTPException(401, { message: "Missing or invalid budget token" });
  }
  return token;
}

function publicBudget(budget: {
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
    remainingTodayUsd: Math.max(0, budget.daily_limit_usd - budget.spent_today_usd),
    spentDay: budget.spent_day,
    updatedAt: budget.updated_at,
  };
}

function budgetFailureResponse(
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

function parseLimit(value?: string) {
  if (!value) return 50;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new HTTPException(400, { message: "limit must be an integer from 1 to 100" });
  }
  return parsed;
}

function isValidPrice(value: string) {
  try {
    normalizePrice(value);
    return true;
  } catch {
    return false;
  }
}

function isValidMethods(value: string) {
  try {
    normalizeMethods(value);
    return true;
  } catch {
    return false;
  }
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

function settlementTransactionHash(header: string | null): string | null {
  if (!header) return null;
  try {
    const decoded = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as {
      transaction?: unknown;
    };
    return typeof decoded.transaction === "string" ? decoded.transaction.slice(0, 200) : null;
  } catch {
    return null;
  }
}

ensureBootstrapAccount();

export { app };
