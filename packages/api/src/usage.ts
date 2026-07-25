import { createHmac, randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { database } from "./db.js";

export type UserAgentCategory =
  | "agent"
  | "api_client"
  | "bot"
  | "cli"
  | "desktop_browser"
  | "mobile_browser";

export type UsageEventType =
  | "page_view"
  | "payment_attempted"
  | "payment_challenge"
  | "payment_settled"
  | "project_created"
  | "proxy_request"
  | "request_completed"
  | "route_created"
  | "signup"
  | "wallet_configured";

export type RequestUsageContext = {
  requestId: string;
  sessionId: string | null;
  sessionCookie: string | null;
  networkHash: string | null;
  walletHash: string | null;
  userAgentCategory: UserAgentCategory;
  referrer: string | null;
  isBot: boolean;
  excluded: boolean;
};

export type UsageEventInput = {
  eventType: UsageEventType;
  occurredAt?: string;
  requestId?: string | null;
  method?: string | null;
  route?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
  sessionId?: string | null;
  networkHash?: string | null;
  walletHash?: string | null;
  accountId?: string | null;
  projectId?: string | null;
  userAgentCategory?: UserAgentCategory;
  referrer?: string | null;
  isBot?: boolean;
  amountUsd?: number | null;
  metadata?: Record<string, string | number | boolean | null> | null;
};

export type UsageMetrics = ReturnType<typeof getUsageMetrics>;

database.exec(`
  CREATE TABLE IF NOT EXISTS usage_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS usage_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    request_id TEXT,
    method TEXT,
    route TEXT,
    status_code INTEGER,
    duration_ms INTEGER,
    session_id TEXT,
    network_hash TEXT,
    wallet_hash TEXT,
    account_id TEXT,
    project_id TEXT,
    user_agent_category TEXT NOT NULL DEFAULT 'api_client',
    referrer TEXT,
    is_bot INTEGER NOT NULL DEFAULT 0,
    amount_usd REAL,
    metadata_json TEXT
  );

  CREATE TABLE IF NOT EXISTS usage_daily (
    day TEXT PRIMARY KEY,
    request_count INTEGER NOT NULL DEFAULT 0,
    unique_visitors INTEGER NOT NULL DEFAULT 0,
    returning_visitors INTEGER NOT NULL DEFAULT 0,
    signup_count INTEGER NOT NULL DEFAULT 0,
    project_count INTEGER NOT NULL DEFAULT 0,
    wallet_count INTEGER NOT NULL DEFAULT 0,
    payment_challenge_count INTEGER NOT NULL DEFAULT 0,
    payment_attempt_count INTEGER NOT NULL DEFAULT 0,
    payment_settled_count INTEGER NOT NULL DEFAULT 0,
    proxy_request_count INTEGER NOT NULL DEFAULT 0,
    revenue_usd REAL NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS usage_daily_identities (
    day TEXT NOT NULL,
    kind TEXT NOT NULL,
    value_hash TEXT NOT NULL,
    PRIMARY KEY (day, kind, value_hash)
  );

  CREATE INDEX IF NOT EXISTS idx_usage_events_occurred ON usage_events(occurred_at);
  CREATE INDEX IF NOT EXISTS idx_usage_events_type_occurred
    ON usage_events(event_type, occurred_at);
  CREATE INDEX IF NOT EXISTS idx_usage_events_session_occurred
    ON usage_events(session_id, occurred_at);
  CREATE INDEX IF NOT EXISTS idx_usage_events_wallet_occurred
    ON usage_events(wallet_hash, occurred_at);
  CREATE INDEX IF NOT EXISTS idx_usage_events_route_occurred
    ON usage_events(route, occurred_at);
  CREATE INDEX IF NOT EXISTS idx_usage_daily_identities_lookup
    ON usage_daily_identities(kind, value_hash, day);
`);

const usageSalt = getOrCreateUsageSalt();
let lastPrunedDay = "";

export function createRequestUsageContext(input: {
  requestId: string;
  path: string;
  headers: Headers;
}): RequestUsageContext {
  const userAgent = input.headers.get("user-agent") ?? "";
  const userAgentCategory = classifyUserAgent(userAgent);
  const isBot = userAgentCategory === "bot";
  const excluded = !config.usageTrackingEnabled || isExcludedUsagePath(input.path);
  const existingCookie = readCookie(input.headers.get("cookie"), "lf_session");
  const validCookie =
    existingCookie && /^[A-Za-z0-9_-]{16,128}$/.test(existingCookie)
      ? existingCookie
      : null;
  const isBrowser =
    userAgentCategory === "desktop_browser" || userAgentCategory === "mobile_browser";
  const isBrowserPage =
    input.path === "/" ||
    input.path === "/docs" ||
    (input.path.startsWith("/docs/") && !input.path.endsWith(".md"));
  const sessionCookie =
    !excluded && isBrowser && isBrowserPage && !validCookie ? nanoid(32) : null;
  const rawSession = validCookie ?? sessionCookie;
  const rawNetwork =
    input.headers.get("cf-connecting-ip") ??
    input.headers.get("x-real-ip") ??
    input.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;
  const wallet = input.headers.get("x-loopfare-wallet");

  return {
    requestId: input.requestId,
    sessionId: rawSession ? hashUsageIdentifier("session", rawSession) : null,
    sessionCookie,
    networkHash: rawNetwork ? hashUsageIdentifier("network", rawNetwork) : null,
    walletHash: wallet ? hashUsageIdentifier("wallet", wallet.toLowerCase()) : null,
    userAgentCategory,
    referrer: sanitizeReferrer(input.headers.get("referer")),
    isBot,
    excluded,
  };
}

export function usageCookie(value: string) {
  const secure = config.publicUrl.startsWith("https://") ? "; Secure" : "";
  return `lf_session=${value}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

export function recordUsageEvent(input: UsageEventInput) {
  if (!config.usageTrackingEnabled) return;
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const day = occurredAt.slice(0, 10);
  pruneUsageEvents(day);

  const row = {
    id: nanoid(),
    event_type: input.eventType,
    occurred_at: occurredAt,
    request_id: input.requestId ?? null,
    method: input.method?.toUpperCase() ?? null,
    route: input.route ? normalizeUsageRoute(input.route) : null,
    status_code: input.statusCode ?? null,
    duration_ms:
      input.durationMs === undefined || input.durationMs === null
        ? null
        : Math.max(0, Math.round(input.durationMs)),
    session_id: input.sessionId ?? null,
    network_hash: input.networkHash ?? null,
    wallet_hash: input.walletHash ?? null,
    account_id: input.accountId ?? null,
    project_id: input.projectId ?? null,
    user_agent_category: input.userAgentCategory ?? "api_client",
    referrer: input.referrer ?? null,
    is_bot: input.isBot ? 1 : 0,
    amount_usd:
      input.amountUsd === undefined ||
      input.amountUsd === null ||
      !Number.isFinite(input.amountUsd)
        ? null
        : Number(input.amountUsd.toFixed(6)),
    metadata_json: input.metadata ? JSON.stringify(input.metadata).slice(0, 2_000) : null,
  };

  const write = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO usage_events (
           id, event_type, occurred_at, request_id, method, route, status_code,
           duration_ms, session_id, network_hash, wallet_hash, account_id,
           project_id, user_agent_category, referrer, is_bot, amount_usd,
           metadata_json
         ) VALUES (
           @id, @event_type, @occurred_at, @request_id, @method, @route,
           @status_code, @duration_ms, @session_id, @network_hash, @wallet_hash,
           @account_id, @project_id, @user_agent_category, @referrer, @is_bot,
           @amount_usd, @metadata_json
         )`,
      )
      .run(row);
    updateDailyUsage(day, row);
  });
  write();
}

export function getUsageMetrics(days = 30) {
  const safeDays = Math.max(1, Math.min(config.usageRetentionDays, Math.trunc(days)));
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - safeDays + 1);
  const startIso = `${start.toISOString().slice(0, 10)}T00:00:00.000Z`;
  const endIso = new Date(end.getTime() + 1).toISOString();
  refreshDailyUsage(end.toISOString().slice(0, 10));

  const summary = database
    .prepare(
      `SELECT
         SUM(CASE WHEN event_type = 'request_completed' THEN 1 ELSE 0 END) AS requestCount,
         COUNT(DISTINCT CASE
           WHEN event_type = 'page_view' AND session_id IS NOT NULL THEN session_id
         END) AS uniqueVisitors,
         SUM(CASE WHEN event_type = 'signup' THEN 1 ELSE 0 END) AS signups,
         SUM(CASE WHEN event_type = 'project_created' THEN 1 ELSE 0 END) AS projectsCreated,
         SUM(CASE WHEN event_type = 'wallet_configured' THEN 1 ELSE 0 END) AS walletsConfigured,
         COUNT(DISTINCT CASE WHEN wallet_hash IS NOT NULL THEN wallet_hash END) AS activeWallets,
         SUM(CASE WHEN event_type = 'payment_challenge' THEN 1 ELSE 0 END) AS paymentChallenges,
         SUM(CASE WHEN event_type = 'payment_attempted' THEN 1 ELSE 0 END) AS paymentAttempts,
         SUM(CASE WHEN event_type = 'payment_settled' THEN 1 ELSE 0 END) AS paymentsSettled,
         SUM(CASE
           WHEN event_type = 'payment_settled'
             AND metadata_json LIKE '%"mode":"x402"%'
           THEN 1 ELSE 0
         END) AS x402PaymentsSettled,
         SUM(CASE
           WHEN event_type = 'payment_settled'
             AND metadata_json LIKE '%"mode":"dev"%'
           THEN 1 ELSE 0
         END) AS devPaymentsSettled,
         SUM(CASE
           WHEN event_type = 'payment_settled' AND route = '/demo/v1/fortune'
           THEN 1 ELSE 0
         END) AS demoPaymentsSettled,
         SUM(CASE
           WHEN event_type = 'payment_settled' AND route LIKE '/p/%'
           THEN 1 ELSE 0
         END) AS proxyPaymentsSettled,
         SUM(CASE WHEN event_type = 'proxy_request' THEN 1 ELSE 0 END) AS proxyRequests,
         ROUND(COALESCE(SUM(CASE
           WHEN event_type = 'payment_settled' THEN amount_usd ELSE 0
         END), 0), 6) AS revenueUsd,
         SUM(CASE
           WHEN event_type = 'request_completed' AND status_code >= 400 THEN 1 ELSE 0
         END) AS errorCount
       FROM usage_events
       WHERE occurred_at >= ? AND occurred_at < ? AND is_bot = 0`,
    )
    .get(startIso, endIso) as {
      requestCount: number;
      uniqueVisitors: number;
      signups: number;
      projectsCreated: number;
      walletsConfigured: number;
      activeWallets: number;
      paymentChallenges: number;
      paymentAttempts: number;
      paymentsSettled: number;
      x402PaymentsSettled: number;
      devPaymentsSettled: number;
      demoPaymentsSettled: number;
      proxyPaymentsSettled: number;
      proxyRequests: number;
      revenueUsd: number;
      errorCount: number;
    };

  const returning = database
    .prepare(
      `SELECT COUNT(*) AS count FROM (
         SELECT session_id
         FROM usage_events
         WHERE occurred_at >= ? AND occurred_at < ?
           AND event_type = 'page_view' AND is_bot = 0 AND session_id IS NOT NULL
         GROUP BY session_id
         HAVING COUNT(DISTINCT substr(occurred_at, 1, 10)) > 1
            OR MIN(occurred_at) > (
              SELECT MIN(previous.occurred_at)
              FROM usage_events previous
              WHERE previous.session_id = usage_events.session_id
                AND previous.event_type = 'page_view'
                AND previous.is_bot = 0
            )
       )`,
    )
    .get(startIso, endIso) as { count: number };

  const daily = database
    .prepare(
      `SELECT
         day,
         request_count AS requestCount,
         unique_visitors AS uniqueVisitors,
         returning_visitors AS returningVisitors,
         signup_count AS signups,
         project_count AS projectsCreated,
         wallet_count AS walletsConfigured,
         payment_challenge_count AS paymentChallenges,
         payment_attempt_count AS paymentAttempts,
         payment_settled_count AS paymentsSettled,
         proxy_request_count AS proxyRequests,
         revenue_usd AS revenueUsd,
         error_count AS errorCount
       FROM usage_daily
       WHERE day >= ? AND day <= ?
       ORDER BY day`,
    )
    .all(startIso.slice(0, 10), end.toISOString().slice(0, 10));

  const topRoutes = database
    .prepare(
      `SELECT
         route,
         COUNT(*) AS requests,
         SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errors,
         ROUND(AVG(duration_ms), 1) AS averageDurationMs,
         COUNT(DISTINCT session_id) AS uniqueVisitors
       FROM usage_events
       WHERE occurred_at >= ? AND occurred_at < ?
         AND event_type = 'request_completed' AND is_bot = 0 AND route IS NOT NULL
       GROUP BY route
       ORDER BY requests DESC, route
       LIMIT 20`,
    )
    .all(startIso, endIso);

  const clients = database
    .prepare(
      `SELECT
         user_agent_category AS category,
         COUNT(*) AS requests,
         COUNT(DISTINCT session_id) AS uniqueVisitors
       FROM usage_events
       WHERE occurred_at >= ? AND occurred_at < ?
         AND event_type = 'request_completed' AND is_bot = 0
       GROUP BY user_agent_category
       ORDER BY requests DESC`,
    )
    .all(startIso, endIso);

  const botsFiltered = (
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM usage_events
         WHERE occurred_at >= ? AND occurred_at < ?
           AND event_type = 'request_completed' AND is_bot = 1`,
      )
      .get(startIso, endIso) as { count: number }
  ).count;

  const lifetime = database
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM accounts WHERE email != 'owner@loopfare.local') AS signups,
         (SELECT COUNT(*) FROM projects) AS projects,
         (SELECT COUNT(*) FROM routes) AS protectedRoutes,
         (SELECT COUNT(*) FROM buyer_budgets) AS walletsConfigured,
         (SELECT COUNT(*) FROM payments
            WHERE status IN ('settled', 'dev_settled')) AS paidCalls,
         (SELECT COUNT(*) FROM payments WHERE status = 'settled') AS x402PaidCalls,
         (SELECT COUNT(*) FROM payments WHERE status = 'dev_settled') AS devPaidCalls,
         (SELECT COUNT(*) FROM payments
            WHERE status IN ('settled', 'dev_settled')
              AND path = '/demo/v1/fortune') AS demoPaidCalls,
         (SELECT COUNT(*) FROM payments
            WHERE status IN ('settled', 'dev_settled')
              AND path LIKE '/p/%') AS proxyPaidCalls,
         (SELECT COUNT(DISTINCT buyer_hint) FROM payments
            WHERE status IN ('settled', 'dev_settled')
              AND buyer_hint IS NOT NULL AND buyer_hint != 'dev-mode') AS uniquePaidWallets,
         (SELECT ROUND(COALESCE(SUM(CAST(REPLACE(price, '$', '') AS REAL)), 0), 6)
            FROM payments WHERE status IN ('settled', 'dev_settled')) AS revenueUsd`,
    )
    .get() as Record<string, number>;

  const requestCount = Number(summary.requestCount ?? 0);
  const errorCount = Number(summary.errorCount ?? 0);
  const paymentAttempts = Number(summary.paymentAttempts ?? 0);
  const paymentsSettled = Number(summary.paymentsSettled ?? 0);
  const uniqueVisitors = Number(summary.uniqueVisitors ?? 0);
  const signups = Number(summary.signups ?? 0);

  return {
    window: {
      days: safeDays,
      from: startIso,
      to: endIso,
      timezone: "UTC",
    },
    summary: {
      ...summary,
      requestCount,
      uniqueVisitors,
      signups,
      projectsCreated: Number(summary.projectsCreated ?? 0),
      walletsConfigured: Number(summary.walletsConfigured ?? 0),
      activeWallets: Number(summary.activeWallets ?? 0),
      paymentChallenges: Number(summary.paymentChallenges ?? 0),
      paymentAttempts,
      paymentsSettled,
      x402PaymentsSettled: Number(summary.x402PaymentsSettled ?? 0),
      devPaymentsSettled: Number(summary.devPaymentsSettled ?? 0),
      demoPaymentsSettled: Number(summary.demoPaymentsSettled ?? 0),
      proxyPaymentsSettled: Number(summary.proxyPaymentsSettled ?? 0),
      proxyRequests: Number(summary.proxyRequests ?? 0),
      revenueUsd: Number(summary.revenueUsd ?? 0),
      returningVisitors: returning.count,
      errorCount,
      errorRate: ratio(errorCount, requestCount),
    },
    funnel: {
      uniqueVisitors,
      signups,
      walletsConfigured: Number(summary.walletsConfigured ?? 0),
      paymentAttempts,
      paymentsSettled,
      visitorToSignupRate: ratio(signups, uniqueVisitors),
      paymentConversionRate: ratio(paymentsSettled, paymentAttempts),
    },
    lifetime,
    daily,
    topRoutes,
    clients,
    dataQuality: {
      botsFiltered,
      healthAndAssetRequestsExcluded: true,
      rawIpAddressesStored: false,
      rawUserAgentsStored: false,
      referrerQueryStringsStored: false,
      identifiers: "HMAC-SHA256",
      retentionDays: config.usageRetentionDays,
    },
  };
}

export function hashUsageIdentifier(
  kind: "network" | "session" | "wallet",
  value: string,
) {
  return createHmac("sha256", usageSalt)
    .update(`${kind}:${value.trim()}`)
    .digest("hex");
}

export function classifyUserAgent(userAgent: string): UserAgentCategory {
  const value = userAgent.toLowerCase();
  if (
    /bot|crawler|spider|slurp|bingpreview|headlesschrome|uptime|monitor|statuscake|pingdom/.test(
      value,
    )
  ) {
    return "bot";
  }
  if (/loopfare|curl|wget|httpie|postman|insomnia/.test(value)) return "cli";
  if (/openai|anthropic|claude|langchain|llamaindex|autogen|crewai|agent/.test(value)) {
    return "agent";
  }
  if (/android|iphone|ipad|ipod|mobile/.test(value)) return "mobile_browser";
  if (/mozilla|chrome|safari|firefox|edge|opera/.test(value)) return "desktop_browser";
  return "api_client";
}

export function normalizeUsageRoute(path: string) {
  const [pathname] = path.split(/[?#]/, 1);
  const normalized = (pathname || "/")
    .replace(/\/0x[a-fA-F0-9]{40}(?=\/|$)/g, "/:wallet")
    .replace(
      /\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}(?=\/|$)/g,
      "/:id",
    )
    .replace(/\/[A-Za-z0-9_-]{18,}(?=\/|$)/g, "/:id")
    .replace(/\/\d+(?=\/|$)/g, "/:id");
  return normalized.slice(0, 500);
}

export function sanitizeReferrer(referrer: string | null) {
  if (!referrer) return null;
  try {
    const url = new URL(referrer, config.publicUrl);
    return `${url.origin}${url.pathname}`.slice(0, 500);
  } catch {
    return null;
  }
}

export function isExcludedUsagePath(path: string) {
  return (
    path.startsWith("/health") ||
    path.startsWith("/v1/admin/metrics") ||
    path === "/favicon.ico" ||
    path === "/favicon.svg" ||
    path === "/robots.txt" ||
    path === "/sitemap.xml" ||
    path.startsWith("/apple-touch-icon")
  );
}

function getOrCreateUsageSalt() {
  const existing = database
    .prepare(`SELECT value FROM usage_config WHERE key = 'identifier_salt'`)
    .get() as { value: string } | undefined;
  if (existing) return existing.value;
  const value = randomBytes(32).toString("hex");
  database
    .prepare(`INSERT OR IGNORE INTO usage_config (key, value) VALUES ('identifier_salt', ?)`)
    .run(value);
  return (
    database
      .prepare(`SELECT value FROM usage_config WHERE key = 'identifier_salt'`)
      .get() as { value: string }
  ).value;
}

function updateDailyUsage(
  day: string,
  event: {
    event_type: UsageEventType;
    status_code: number | null;
    session_id: string | null;
    wallet_hash: string | null;
    is_bot: number;
    amount_usd: number | null;
  },
) {
  if (event.is_bot === 1) return;
  const updatedAt = new Date().toISOString();
  database
    .prepare(`INSERT OR IGNORE INTO usage_daily (day, updated_at) VALUES (?, ?)`)
    .run(day, updatedAt);

  const increments: Record<string, number> = {
    request_count: 0,
    unique_visitors: 0,
    returning_visitors: 0,
    signup_count: 0,
    project_count: 0,
    wallet_count: 0,
    payment_challenge_count: 0,
    payment_attempt_count: 0,
    payment_settled_count: 0,
    proxy_request_count: 0,
    revenue_usd: 0,
    error_count: 0,
  };

  if (event.event_type === "request_completed") {
    increments.request_count = 1;
    if ((event.status_code ?? 0) >= 400) increments.error_count = 1;
  } else if (event.event_type === "signup") {
    increments.signup_count = 1;
  } else if (event.event_type === "project_created") {
    increments.project_count = 1;
  } else if (event.event_type === "payment_challenge") {
    increments.payment_challenge_count = 1;
  } else if (event.event_type === "payment_attempted") {
    increments.payment_attempt_count = 1;
  } else if (event.event_type === "payment_settled") {
    increments.payment_settled_count = 1;
    increments.revenue_usd = event.amount_usd ?? 0;
  } else if (event.event_type === "proxy_request") {
    increments.proxy_request_count = 1;
  }

  if (event.event_type === "page_view" && event.session_id) {
    const returning = Boolean(
      database
        .prepare(
          `SELECT 1 FROM usage_daily_identities
           WHERE kind = 'visitor' AND value_hash = ? AND day < ?
           LIMIT 1`,
        )
        .get(event.session_id, day),
    );
    const inserted = database
      .prepare(
        `INSERT OR IGNORE INTO usage_daily_identities (day, kind, value_hash)
         VALUES (?, 'visitor', ?)`,
      )
      .run(day, event.session_id).changes;
    if (inserted > 0) {
      increments.unique_visitors = 1;
      if (returning) increments.returning_visitors = 1;
    }
  }

  if (event.event_type === "wallet_configured" && event.wallet_hash) {
    const inserted = database
      .prepare(
        `INSERT OR IGNORE INTO usage_daily_identities (day, kind, value_hash)
         VALUES (?, 'wallet', ?)`,
      )
      .run(day, event.wallet_hash).changes;
    if (inserted > 0) increments.wallet_count = 1;
  }

  const changed = Object.entries(increments).filter(([, value]) => value !== 0);
  if (changed.length === 0) {
    database.prepare(`UPDATE usage_daily SET updated_at = ? WHERE day = ?`).run(updatedAt, day);
    return;
  }
  const assignments = changed.map(([column]) => `${column} = ${column} + @${column}`);
  database
    .prepare(
      `UPDATE usage_daily
       SET ${assignments.join(", ")}, updated_at = @updated_at
       WHERE day = @day`,
    )
    .run({ ...increments, updated_at: updatedAt, day });
}

function refreshDailyUsage(day: string) {
  const start = `${day}T00:00:00.000Z`;
  const endDate = new Date(start);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const end = endDate.toISOString();
  const row = database
    .prepare(
      `SELECT
         SUM(CASE WHEN event_type = 'request_completed' THEN 1 ELSE 0 END) AS request_count,
         COUNT(DISTINCT CASE
           WHEN event_type = 'page_view' AND session_id IS NOT NULL THEN session_id
         END) AS unique_visitors,
         COUNT(DISTINCT CASE
           WHEN event_type = 'page_view' AND session_id IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM usage_events previous
               WHERE previous.session_id = usage_events.session_id
                 AND previous.event_type = 'page_view'
                 AND previous.is_bot = 0
                 AND previous.occurred_at < ?
             )
           THEN session_id END) AS returning_visitors,
         SUM(CASE WHEN event_type = 'signup' THEN 1 ELSE 0 END) AS signup_count,
         SUM(CASE WHEN event_type = 'project_created' THEN 1 ELSE 0 END) AS project_count,
         COUNT(DISTINCT CASE
           WHEN event_type = 'wallet_configured' AND wallet_hash IS NOT NULL
           THEN wallet_hash
         END) AS wallet_count,
         SUM(CASE WHEN event_type = 'payment_challenge' THEN 1 ELSE 0 END)
           AS payment_challenge_count,
         SUM(CASE WHEN event_type = 'payment_attempted' THEN 1 ELSE 0 END)
           AS payment_attempt_count,
         SUM(CASE WHEN event_type = 'payment_settled' THEN 1 ELSE 0 END)
           AS payment_settled_count,
         SUM(CASE WHEN event_type = 'proxy_request' THEN 1 ELSE 0 END)
           AS proxy_request_count,
         ROUND(COALESCE(SUM(CASE
           WHEN event_type = 'payment_settled' THEN amount_usd ELSE 0
         END), 0), 6) AS revenue_usd,
         SUM(CASE
           WHEN event_type = 'request_completed' AND status_code >= 400 THEN 1 ELSE 0
         END) AS error_count
       FROM usage_events
       WHERE occurred_at >= ? AND occurred_at < ? AND is_bot = 0`,
    )
    .get(start, start, end) as Record<string, number | null>;

  database
    .prepare(
      `INSERT INTO usage_daily (
         day, request_count, unique_visitors, returning_visitors, signup_count,
         project_count, wallet_count, payment_challenge_count,
         payment_attempt_count, payment_settled_count, proxy_request_count,
         revenue_usd, error_count, updated_at
       ) VALUES (
         @day, @request_count, @unique_visitors, @returning_visitors,
         @signup_count, @project_count, @wallet_count,
         @payment_challenge_count, @payment_attempt_count,
         @payment_settled_count, @proxy_request_count, @revenue_usd,
         @error_count, @updated_at
       )
       ON CONFLICT(day) DO UPDATE SET
         request_count = excluded.request_count,
         unique_visitors = excluded.unique_visitors,
         returning_visitors = excluded.returning_visitors,
         signup_count = excluded.signup_count,
         project_count = excluded.project_count,
         wallet_count = excluded.wallet_count,
         payment_challenge_count = excluded.payment_challenge_count,
         payment_attempt_count = excluded.payment_attempt_count,
         payment_settled_count = excluded.payment_settled_count,
         proxy_request_count = excluded.proxy_request_count,
         revenue_usd = excluded.revenue_usd,
         error_count = excluded.error_count,
         updated_at = excluded.updated_at`,
    )
    .run({
      day,
      request_count: Number(row.request_count ?? 0),
      unique_visitors: Number(row.unique_visitors ?? 0),
      returning_visitors: Number(row.returning_visitors ?? 0),
      signup_count: Number(row.signup_count ?? 0),
      project_count: Number(row.project_count ?? 0),
      wallet_count: Number(row.wallet_count ?? 0),
      payment_challenge_count: Number(row.payment_challenge_count ?? 0),
      payment_attempt_count: Number(row.payment_attempt_count ?? 0),
      payment_settled_count: Number(row.payment_settled_count ?? 0),
      proxy_request_count: Number(row.proxy_request_count ?? 0),
      revenue_usd: Number(row.revenue_usd ?? 0),
      error_count: Number(row.error_count ?? 0),
      updated_at: new Date().toISOString(),
    });
}

function pruneUsageEvents(day: string) {
  if (lastPrunedDay === day) return;
  lastPrunedDay = day;
  const cutoff = new Date(`${day}T00:00:00.000Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - config.usageRetentionDays);
  database.prepare(`DELETE FROM usage_events WHERE occurred_at < ?`).run(cutoff.toISOString());
  database
    .prepare(`DELETE FROM usage_daily_identities WHERE day < ?`)
    .run(cutoff.toISOString().slice(0, 10));
}

function readCookie(header: string | null, name: string) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}
