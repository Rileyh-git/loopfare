import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { config } from "./config.js";
import {
  createAccount,
  createProject,
  createRoute,
  ensureBootstrapAccount,
  findRouteForRequest,
  getAccountByApiKey,
  getAccountByEmail,
  getEarnings,
  getOrCreateBudget,
  getProjectById,
  listPayments,
  listProjects,
  listRoutes,
  priceToUsd,
  recordPayment,
  setBudget,
  trySpendBudget,
} from "./db.js";
import {
  buildDemoPaymentMiddleware,
  buildRoutePaymentMiddleware,
  isDevPaymentAuthorized,
} from "./x402.js";

type AuthEnv = {
  Variables: {
    accountId: string;
    email: string;
  };
};

const app = new Hono<AuthEnv>();

app.use("*", cors());

app.get("/", (c) => {
  return c.json({
    name: "loopfare",
    version: "0.1.0",
    tagline: "Charge AI agents per request",
    network: config.network,
    networkCaip2: config.networkCaip2,
    publicUrl: config.publicUrl,
    devMode: config.devMode,
    docs: {
      health: "GET /health",
      signup: "POST /v1/auth/signup",
      projects: "POST /v1/projects",
      protect: "POST /v1/projects/:id/routes",
      proxy: "ANY /p/:projectSlug/*",
      demo: "GET /demo/v1/fortune",
      agentSkill: "GET /skill.md",
    },
  });
});

app.get("/health", (c) => c.json({ ok: true, network: config.network }));

app.get("/skill.md", async (c) => {
  const body = `# Loopfare — agent skill

Charge and pay for HTTP APIs with x402 on Base.

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

## Demo (no setup)

\`GET ${config.publicUrl}/demo/v1/fortune\` returns HTTP 402 until paid via x402 (Base ${config.network}).

Dev mode: if \`LOOPFARE_DEV_MODE=true\`, send header \`LOOPFARE-DEV-PAYMENT: ok\`.
`;
  return c.text(body, 200, { "Content-Type": "text/markdown; charset=utf-8" });
});

// ── Auth ──────────────────────────────────────────────────────────

const signupSchema = z.object({
  email: z.string().email(),
});

app.post("/v1/auth/signup", async (c) => {
  const body = signupSchema.parse(await c.req.json());
  const existing = getAccountByEmail(body.email);
  if (existing) {
    return c.json(
      {
        error: "account_exists",
        message: "Account already exists. Use your existing API key.",
        email: existing.email,
      },
      409,
    );
  }
  const account = createAccount(body.email);
  return c.json(
    {
      id: account.id,
      email: account.email,
      apiKey: account.api_key,
      createdAt: account.created_at,
      hint: "Store apiKey securely. Pass as Authorization: Bearer <apiKey>",
    },
    201,
  );
});

app.get("/v1/auth/me", requireAuth, (c) => {
  return c.json({
    accountId: c.get("accountId"),
    email: c.get("email"),
  });
});

// ── Projects & routes (seller) ────────────────────────────────────

const projectSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/i, "slug must be alphanumeric/hyphens"),
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
    return c.json(
      {
        ...project,
        proxyBase: `${config.publicUrl}/p/${project.slug}`,
      },
      201,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("UNIQUE")) {
      return c.json({ error: "slug_taken", message: "Project slug already exists" }, 409);
    }
    throw err;
  }
});

app.get("/v1/projects", requireAuth, (c) => {
  const projects = listProjects(c.get("accountId")).map((p) => ({
    ...p,
    proxyBase: `${config.publicUrl}/p/${p.slug}`,
  }));
  return c.json({ projects });
});

app.get("/v1/projects/:id", requireAuth, (c) => {
  const project = getOwnedProject(c.get("accountId"), c.req.param("id"));
  const routes = listRoutes(project.id);
  const earnings = getEarnings(project.id);
  return c.json({
    project: { ...project, proxyBase: `${config.publicUrl}/p/${project.slug}` },
    routes,
    earnings,
  });
});

const routeSchema = z.object({
  pathPattern: z.string().min(1).default("/*"),
  originUrl: z.string().url(),
  price: z.string().min(1),
  description: z.string().max(500).optional(),
  methods: z.string().optional(),
});

app.post("/v1/projects/:id/routes", requireAuth, async (c) => {
  const project = getOwnedProject(c.get("accountId"), c.req.param("id"));
  const body = routeSchema.parse(await c.req.json());
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

app.get("/v1/projects/:id/payments", requireAuth, (c) => {
  const project = getOwnedProject(c.get("accountId"), c.req.param("id"));
  const limit = Number(c.req.query("limit") ?? 50);
  return c.json({
    payments: listPayments({ projectId: project.id, limit }),
    earnings: getEarnings(project.id),
  });
});

app.get("/v1/payments", requireAuth, (c) => {
  return c.json({ payments: listPayments({ limit: Number(c.req.query("limit") ?? 50) }) });
});

// ── Buyer budgets (optional server-side tracking) ─────────────────

const budgetSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  dailyLimitUsd: z.number().positive().max(1_000_000).optional(),
});

app.post("/v1/buyer/budget", async (c) => {
  const body = budgetSchema.parse(await c.req.json());
  const budget = body.dailyLimitUsd
    ? setBudget(body.walletAddress, body.dailyLimitUsd)
    : getOrCreateBudget(body.walletAddress);
  return c.json({ budget });
});

app.get("/v1/buyer/budget/:address", (c) => {
  const budget = getOrCreateBudget(c.req.param("address"));
  return c.json({ budget });
});

// ── Demo paid endpoint ────────────────────────────────────────────

const fortunes = [
  "Your agent will ship before the meeting ends.",
  "A 402 is just a handshake in disguise.",
  "Micropayments compound like compound interest for machines.",
  "The best API key is no API key — just pay and go.",
  "Context is expensive; paid tools should be cheap.",
];

app.use("/demo/v1/fortune", async (c, next) => {
  if (config.devMode && isDevPaymentAuthorized(c.req.header("LOOPFARE-DEV-PAYMENT"), config.demoPrice)) {
    recordPayment({
      method: c.req.method,
      path: c.req.path,
      price: config.demoPrice,
      status: "dev_settled",
      buyerHint: "dev-mode",
    });
    return next();
  }

  // Real x402 path (or non-dev)
  if (!config.devMode || c.req.header("PAYMENT-SIGNATURE") || c.req.header("payment-signature")) {
    const mw = buildDemoPaymentMiddleware();
    return mw(c, next);
  }

  // Dev mode without payment header: still return 402-like guidance for agents
  if (config.devMode) {
    return c.json(
      {
        error: "payment_required",
        message: "Payment required for demo fortune",
        price: config.demoPrice,
        network: config.network,
        networkCaip2: config.networkCaip2,
        payTo: config.demoPayTo,
        facilitator: config.facilitatorUrl,
        devMode: true,
        howToPay: {
          x402: "Use loopfare call or @x402/fetch with a funded Base wallet",
          dev: "Send header LOOPFARE-DEV-PAYMENT: ok (only when LOOPFARE_DEV_MODE=true)",
        },
      },
      402,
    );
  }

  const mw = buildDemoPaymentMiddleware();
  return mw(c, next);
});

app.get("/demo/v1/fortune", (c) => {
  const fortune = fortunes[Math.floor(Math.random() * fortunes.length)]!;
  return c.json({
    fortune,
    charged: config.demoPrice,
    network: config.network,
    product: "loopfare",
  });
});

// ── Paid reverse proxy ────────────────────────────────────────────

app.all("/p/:projectSlug/*", async (c) => {
  const projectSlug = c.req.param("projectSlug");
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

  // Optional buyer budget pre-check if wallet header present
  const wallet = c.req.header("X-Loopfare-Wallet");
  if (wallet) {
    const amount = priceToUsd(route.price);
    const spend = trySpendBudget(wallet, amount);
    if (!spend.ok) {
      return c.json(
        {
          error: "budget_exceeded",
          message: spend.reason,
          budget: spend.budget,
        },
        402,
      );
    }
  }

  // Dev payment short-circuit
  if (config.devMode && isDevPaymentAuthorized(c.req.header("LOOPFARE-DEV-PAYMENT"), route.price)) {
    recordPayment({
      routeId: route.id,
      projectId: route.project_id,
      method: c.req.method,
      path: c.req.path,
      price: route.price,
      status: "dev_settled",
      buyerHint: wallet ?? "dev-mode",
    });
    return proxyToOrigin(c, route.origin_url, rest);
  }

  // x402 gate then proxy
  let paid = false;
  const paymentPath = c.req.path;
  const mw = buildRoutePaymentMiddleware({
    method: c.req.method,
    path: paymentPath,
    price: route.price,
    payTo: route.pay_to,
    description: route.description || `Loopfare protected: ${projectSlug}${rest}`,
  });

  const gateResult = await mw(c, async () => {
    paid = true;
  });

  if (!paid) {
    // Middleware returned a 402 (or other) response
    if (gateResult instanceof Response) return gateResult;
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

  recordPayment({
    routeId: route.id,
    projectId: route.project_id,
    method: c.req.method,
    path: c.req.path,
    price: route.price,
    status: "settled",
    buyerHint: wallet ?? null,
  });

  return proxyToOrigin(c, route.origin_url, rest);
});

// ── Error handling ────────────────────────────────────────────────

app.onError((err, c) => {
  if (err instanceof z.ZodError) {
    return c.json({ error: "validation_error", issues: err.issues }, 400);
  }
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  console.error(err);
  return c.json({ error: "internal_error", message: err.message }, 500);
});

// ── Helpers ───────────────────────────────────────────────────────

async function requireAuth(c: any, next: () => Promise<void>) {
  const header = c.req.header("Authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : header.trim();
  if (!key) {
    throw new HTTPException(401, { message: "Missing API key (Authorization: Bearer lf_...)" });
  }
  const account = getAccountByApiKey(key);
  if (!account) {
    throw new HTTPException(401, { message: "Invalid API key" });
  }
  c.set("accountId", account.id);
  c.set("email", account.email);
  await next();
}

function getOwnedProject(accountId: string, projectId: string) {
  const project = getProjectById(projectId);
  if (!project || project.account_id !== accountId) {
    throw new HTTPException(404, { message: "Project not found" });
  }
  return project;
}

async function proxyToOrigin(
  c: any,
  originBase: string,
  pathAfterProject: string,
): Promise<Response> {
  const url = new URL(c.req.url);
  const target = `${originBase}${pathAfterProject}${url.search}`;

  const headers = new Headers();
  c.req.raw.headers.forEach((value: string, key: string) => {
    const lower = key.toLowerCase();
    if (
      lower === "host" ||
      lower === "connection" ||
      lower === "content-length" ||
      lower === "authorization" ||
      lower === "loopfare-dev-payment" ||
      lower === "payment-signature" ||
      lower === "x-payment" ||
      lower === "x-loopfare-wallet"
    ) {
      return;
    }
    headers.set(key, value);
  });
  headers.set("X-Forwarded-By", "loopfare");

  const init: RequestInit = {
    method: c.req.method,
    headers,
    redirect: "manual",
  };

  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    init.body = await c.req.arrayBuffer();
  }

  const upstream = await fetch(target, init);
  const outHeaders = new Headers(upstream.headers);
  outHeaders.set("X-Loopfare-Proxied", "1");
  outHeaders.delete("content-encoding");
  outHeaders.delete("transfer-encoding");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}

// Bootstrap default account for local convenience
const bootstrap = ensureBootstrapAccount();
console.log(`[loopfare] bootstrap account email=${bootstrap.email} apiKey=${bootstrap.api_key}`);

export { app };
