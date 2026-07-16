import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { normalizeOriginUrl } from "./origin-security.js";

export type Account = {
  id: string;
  email: string;
  api_key_hash: string;
  api_key_prefix: string;
  created_at: string;
};

export type Project = {
  id: string;
  account_id: string;
  name: string;
  slug: string;
  pay_to: string;
  created_at: string;
};

export type ProtectedRoute = {
  id: string;
  project_id: string;
  path_pattern: string;
  methods: string;
  origin_url: string;
  price: string;
  description: string;
  enabled: number;
  created_at: string;
};

export type PaymentEvent = {
  id: string;
  route_id: string | null;
  project_id: string | null;
  method: string;
  path: string;
  price: string;
  status: string;
  tx_hash: string | null;
  buyer_hint: string | null;
  created_at: string;
};

export type BuyerBudget = {
  id: string;
  wallet_address: string;
  access_token_hash: string | null;
  daily_limit_usd: number;
  spent_today_usd: number;
  spent_day: string;
  updated_at: string;
};

const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
db.pragma("synchronous = NORMAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    api_key TEXT NOT NULL UNIQUE,
    api_key_hash TEXT,
    api_key_prefix TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    pay_to TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS routes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    path_pattern TEXT NOT NULL,
    methods TEXT NOT NULL DEFAULT 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
    origin_url TEXT NOT NULL,
    price TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    route_id TEXT,
    project_id TEXT,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    price TEXT NOT NULL,
    status TEXT NOT NULL,
    tx_hash TEXT,
    buyer_hint TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS buyer_budgets (
    id TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL UNIQUE,
    access_token_hash TEXT,
    daily_limit_usd REAL NOT NULL DEFAULT 5,
    spent_today_usd REAL NOT NULL DEFAULT 0,
    spent_day TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_routes_project ON routes(project_id);
  CREATE INDEX IF NOT EXISTS idx_payments_project_created ON payments(project_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at);
  CREATE INDEX IF NOT EXISTS idx_projects_account ON projects(account_id);
  CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);
`);

// Forward-only, idempotent migrations for databases created by the MVP.
ensureColumn("accounts", "api_key_hash", "TEXT");
ensureColumn("accounts", "api_key_prefix", "TEXT");
ensureColumn("buyer_budgets", "access_token_hash", "TEXT");
db.exec(`CREATE INDEX IF NOT EXISTS idx_accounts_api_key_hash ON accounts(api_key_hash)`);
migrateLegacyApiKeys();

function ensureColumn(table: "accounts" | "buyer_budgets", column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrateLegacyApiKeys() {
  const rows = db
    .prepare(`SELECT id, api_key FROM accounts WHERE api_key_hash IS NULL OR api_key_hash = ''`)
    .all() as Array<{ id: string; api_key: string }>;
  const update = db.prepare(
    `UPDATE accounts SET api_key = ?, api_key_hash = ?, api_key_prefix = ? WHERE id = ?`,
  );
  const migration = db.transaction(() => {
    for (const row of rows) {
      const hash = hashSecret(row.api_key);
      update.run(`hashed:${hash}`, hash, secretPrefix(row.api_key), row.id);
    }
  });
  migration();
}

function now() {
  return new Date().toISOString();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function hashSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

function secretPrefix(secret: string) {
  return secret.slice(0, 10);
}

export function createAccount(
  email: string,
  providedApiKey = `lf_${nanoid(40)}`,
): { account: Account; apiKey: string } {
  const account: Account = {
    id: nanoid(),
    email: email.toLowerCase().trim(),
    api_key_hash: hashSecret(providedApiKey),
    api_key_prefix: secretPrefix(providedApiKey),
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO accounts (id, email, api_key, api_key_hash, api_key_prefix, created_at)
     VALUES (@id, @email, @legacy_key, @api_key_hash, @api_key_prefix, @created_at)`,
  ).run({ ...account, legacy_key: `hashed:${account.api_key_hash}` });
  return { account, apiKey: providedApiKey };
}

export function getAccountByApiKey(apiKey: string): Account | undefined {
  return db
    .prepare(
      `SELECT id, email, api_key_hash, api_key_prefix, created_at
       FROM accounts WHERE api_key_hash = ?`,
    )
    .get(hashSecret(apiKey)) as Account | undefined;
}

export function getAccountByEmail(email: string): Account | undefined {
  return db
    .prepare(
      `SELECT id, email, api_key_hash, api_key_prefix, created_at
       FROM accounts WHERE email = ?`,
    )
    .get(email.toLowerCase().trim()) as Account | undefined;
}

export function rotateApiKey(accountId: string): { apiKey: string; prefix: string } {
  const apiKey = `lf_${nanoid(40)}`;
  const hash = hashSecret(apiKey);
  const prefix = secretPrefix(apiKey);
  db.prepare(
    `UPDATE accounts
     SET api_key = ?, api_key_hash = ?, api_key_prefix = ?
     WHERE id = ?`,
  ).run(`hashed:${hash}`, hash, prefix, accountId);
  return { apiKey, prefix };
}

export function ensureBootstrapAccount(): Account | undefined {
  if (!config.adminApiKey) return undefined;
  const email = "owner@loopfare.local";
  const existing = getAccountByEmail(email);
  if (existing) return existing;
  return createAccount(email, config.adminApiKey).account;
}

export function createProject(input: {
  accountId: string;
  name: string;
  slug: string;
  payTo: string;
}): Project {
  const project: Project = {
    id: nanoid(),
    account_id: input.accountId,
    name: input.name.trim(),
    slug: input.slug.toLowerCase(),
    pay_to: input.payTo,
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO projects (id, account_id, name, slug, pay_to, created_at)
     VALUES (@id, @account_id, @name, @slug, @pay_to, @created_at)`,
  ).run(project);
  return project;
}

export function listProjects(accountId: string): Project[] {
  return db
    .prepare(`SELECT * FROM projects WHERE account_id = ? ORDER BY created_at DESC`)
    .all(accountId) as Project[];
}

export function getProjectBySlug(slug: string): Project | undefined {
  return db.prepare(`SELECT * FROM projects WHERE slug = ?`).get(slug) as Project | undefined;
}

export function getProjectById(id: string): Project | undefined {
  return db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as Project | undefined;
}

export function deleteProject(id: string) {
  return db.prepare(`DELETE FROM projects WHERE id = ?`).run(id).changes > 0;
}

export function createRoute(input: {
  projectId: string;
  pathPattern: string;
  originUrl: string;
  price: string;
  description?: string;
  methods?: string;
}): ProtectedRoute {
  const route: ProtectedRoute = {
    id: nanoid(),
    project_id: input.projectId,
    path_pattern: normalizePathPattern(input.pathPattern),
    methods: normalizeMethods(input.methods),
    origin_url: normalizeOriginUrl(input.originUrl),
    price: normalizePrice(input.price),
    description: input.description?.trim() || "Protected by Loopfare",
    enabled: 1,
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO routes (id, project_id, path_pattern, methods, origin_url, price, description, enabled, created_at)
     VALUES (@id, @project_id, @path_pattern, @methods, @origin_url, @price, @description, @enabled, @created_at)`,
  ).run(route);
  return route;
}

export function updateRoute(
  id: string,
  projectId: string,
  input: Partial<{
    pathPattern: string;
    originUrl: string;
    price: string;
    description: string;
    methods: string;
    enabled: boolean;
  }>,
): ProtectedRoute | undefined {
  const current = getRouteById(id);
  if (!current || current.project_id !== projectId) return undefined;
  const next: ProtectedRoute = {
    ...current,
    path_pattern:
      input.pathPattern === undefined
        ? current.path_pattern
        : normalizePathPattern(input.pathPattern),
    origin_url:
      input.originUrl === undefined ? current.origin_url : normalizeOriginUrl(input.originUrl),
    price: input.price === undefined ? current.price : normalizePrice(input.price),
    description: input.description === undefined ? current.description : input.description.trim(),
    methods: input.methods === undefined ? current.methods : normalizeMethods(input.methods),
    enabled: input.enabled === undefined ? current.enabled : input.enabled ? 1 : 0,
  };
  db.prepare(
    `UPDATE routes
     SET path_pattern = @path_pattern, methods = @methods, origin_url = @origin_url,
         price = @price, description = @description, enabled = @enabled
     WHERE id = @id AND project_id = @project_id`,
  ).run(next);
  return next;
}

export function deleteRoute(id: string, projectId: string) {
  return db.prepare(`DELETE FROM routes WHERE id = ? AND project_id = ?`).run(id, projectId)
    .changes > 0;
}

export function listRoutes(projectId: string): ProtectedRoute[] {
  return db
    .prepare(`SELECT * FROM routes WHERE project_id = ? ORDER BY created_at DESC`)
    .all(projectId) as ProtectedRoute[];
}

export function getRouteById(id: string): ProtectedRoute | undefined {
  return db.prepare(`SELECT * FROM routes WHERE id = ?`).get(id) as ProtectedRoute | undefined;
}

export function findRouteForRequest(
  projectSlug: string,
  method: string,
  pathAfterProject: string,
): (ProtectedRoute & { pay_to: string; project_slug: string }) | undefined {
  const project = getProjectBySlug(projectSlug);
  if (!project) return undefined;
  const routes = listRoutes(project.id).filter((route) => route.enabled === 1);
  const path = normalizePathPattern(pathAfterProject || "/");
  for (const route of routes) {
    const methods = route.methods.split(",");
    if (!methods.includes(method.toUpperCase()) && !methods.includes("*")) continue;
    if (matchPath(route.path_pattern, path)) {
      return { ...route, pay_to: project.pay_to, project_slug: project.slug };
    }
  }
  return undefined;
}

export function recordPayment(input: {
  routeId?: string | null;
  projectId?: string | null;
  method: string;
  path: string;
  price: string;
  status: string;
  txHash?: string | null;
  buyerHint?: string | null;
}): PaymentEvent {
  const event: PaymentEvent = {
    id: nanoid(),
    route_id: input.routeId ?? null,
    project_id: input.projectId ?? null,
    method: input.method,
    path: input.path,
    price: input.price,
    status: input.status,
    tx_hash: input.txHash ?? null,
    buyer_hint: input.buyerHint ?? null,
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO payments (id, route_id, project_id, method, path, price, status, tx_hash, buyer_hint, created_at)
     VALUES (@id, @route_id, @project_id, @method, @path, @price, @status, @tx_hash, @buyer_hint, @created_at)`,
  ).run(event);
  return event;
}

export function listPayments(opts: {
  projectId?: string;
  accountId?: string;
  limit?: number;
}): PaymentEvent[] {
  const limit = clampLimit(opts.limit);
  if (opts.projectId) {
    return db
      .prepare(`SELECT * FROM payments WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(opts.projectId, limit) as PaymentEvent[];
  }
  if (opts.accountId) {
    return db
      .prepare(
        `SELECT pay.* FROM payments pay
         JOIN projects p ON p.id = pay.project_id
         WHERE p.account_id = ?
         ORDER BY pay.created_at DESC LIMIT ?`,
      )
      .all(opts.accountId, limit) as PaymentEvent[];
  }
  return [];
}

export function getEarnings(projectId: string): { count: number; volume_usd: number } {
  const rows = db
    .prepare(
      `SELECT price FROM payments
       WHERE project_id = ? AND status IN ('settled', 'dev_settled')`,
    )
    .all(projectId) as Array<{ price: string }>;
  const volume = rows.reduce((sum, row) => sum + priceToUsd(row.price), 0);
  return { count: rows.length, volume_usd: Number(volume.toFixed(6)) };
}

export function setBudget(
  walletAddress: string,
  dailyLimitUsd: number,
  accessToken: string,
): BuyerBudget | undefined {
  const address = walletAddress.toLowerCase();
  const tokenHash = hashSecret(accessToken);
  const existing = getBudgetByAddress(address);
  if (existing?.access_token_hash && existing.access_token_hash !== tokenHash) return undefined;

  if (!existing) {
    const budget: BuyerBudget = {
      id: nanoid(),
      wallet_address: address,
      access_token_hash: tokenHash,
      daily_limit_usd: dailyLimitUsd,
      spent_today_usd: 0,
      spent_day: today(),
      updated_at: now(),
    };
    db.prepare(
      `INSERT INTO buyer_budgets
       (id, wallet_address, access_token_hash, daily_limit_usd, spent_today_usd, spent_day, updated_at)
       VALUES (@id, @wallet_address, @access_token_hash, @daily_limit_usd, @spent_today_usd, @spent_day, @updated_at)`,
    ).run(budget);
    return budget;
  }

  db.prepare(
    `UPDATE buyer_budgets
     SET access_token_hash = ?, daily_limit_usd = ?, updated_at = ? WHERE id = ?`,
  ).run(tokenHash, dailyLimitUsd, now(), existing.id);
  return getBudgetForToken(address, accessToken);
}

export function getBudgetForToken(
  walletAddress: string,
  accessToken: string,
): BuyerBudget | undefined {
  const budget = getBudgetByAddress(walletAddress.toLowerCase());
  if (!budget?.access_token_hash || budget.access_token_hash !== hashSecret(accessToken)) {
    return undefined;
  }
  return resetBudgetDay(budget);
}

export function canSpendBudget(
  walletAddress: string,
  accessToken: string,
  amountUsd: number,
): { ok: boolean; budget?: BuyerBudget; reason?: string; unauthorized?: boolean } {
  const budget = getBudgetForToken(walletAddress, accessToken);
  if (!budget) return { ok: false, unauthorized: true, reason: "Invalid budget token" };
  if (budget.spent_today_usd + amountUsd > budget.daily_limit_usd + 1e-9) {
    return {
      ok: false,
      budget,
      reason: `Daily budget exceeded (limit $${budget.daily_limit_usd}, spent $${budget.spent_today_usd.toFixed(4)}, need $${amountUsd})`,
    };
  }
  return { ok: true, budget };
}

export function trySpendBudget(
  walletAddress: string,
  accessToken: string,
  amountUsd: number,
): { ok: boolean; budget?: BuyerBudget; reason?: string; unauthorized?: boolean } {
  const spend = db.transaction(() => {
    const check = canSpendBudget(walletAddress, accessToken, amountUsd);
    if (!check.ok || !check.budget) return check;
    const result = db.prepare(
      `UPDATE buyer_budgets
       SET spent_today_usd = spent_today_usd + ?, updated_at = ?
       WHERE id = ? AND spent_today_usd + ? <= daily_limit_usd + 0.000000001`,
    ).run(amountUsd, now(), check.budget.id, amountUsd);
    if (result.changes === 0) {
      return { ok: false, budget: getBudgetForToken(walletAddress, accessToken), reason: "Daily budget exceeded" };
    }
    return { ok: true, budget: getBudgetForToken(walletAddress, accessToken) };
  });
  return spend();
}

/** Release a same-day reservation when the origin or settlement fails. */
export function refundBudgetSpend(
  walletAddress: string,
  accessToken: string,
  amountUsd: number,
): boolean {
  const budget = getBudgetForToken(walletAddress, accessToken);
  if (!budget || budget.spent_day !== today()) return false;
  return (
    db.prepare(
      `UPDATE buyer_budgets
       SET spent_today_usd = MAX(0, spent_today_usd - ?), updated_at = ?
       WHERE id = ? AND access_token_hash = ? AND spent_day = ?`,
    ).run(amountUsd, now(), budget.id, hashSecret(accessToken), today()).changes > 0
  );
}

function getBudgetByAddress(walletAddress: string): BuyerBudget | undefined {
  return db
    .prepare(`SELECT * FROM buyer_budgets WHERE wallet_address = ?`)
    .get(walletAddress) as BuyerBudget | undefined;
}

function resetBudgetDay(budget: BuyerBudget): BuyerBudget {
  if (budget.spent_day === today()) return budget;
  db.prepare(
    `UPDATE buyer_budgets
     SET spent_today_usd = 0, spent_day = ?, updated_at = ? WHERE id = ?`,
  ).run(today(), now(), budget.id);
  return getBudgetByAddress(budget.wallet_address)!;
}

export function databaseReady() {
  const result = db.prepare(`SELECT 1 AS ok`).get() as { ok: number };
  return result.ok === 1;
}

export function closeDatabase() {
  db.close();
}

export function priceToUsd(price: string): number {
  const cleaned = price.trim().replace(/^\$/, "");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

export function normalizePrice(price: string): string {
  const candidate = price.trim().startsWith("$") ? price.trim() : `$${price.trim()}`;
  if (!/^\$(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(candidate)) {
    throw new Error("Price must be a dollar amount with up to 6 decimal places");
  }
  const value = priceToUsd(candidate);
  if (value < 0.000001 || value > 10_000) {
    throw new Error("Price must be between $0.000001 and $10,000");
  }
  return candidate;
}

export function normalizeMethods(methods?: string): string {
  const allowed = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "*"]);
  const values = (methods ?? "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS")
    .split(",")
    .map((method) => method.trim().toUpperCase())
    .filter(Boolean);
  if (values.length === 0 || values.some((method) => !allowed.has(method))) {
    throw new Error("Methods must be a comma-separated list of valid HTTP methods");
  }
  return [...new Set(values)].join(",");
}

export function normalizePathPattern(path: string): string {
  let normalized = path.trim();
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  if (normalized.length > 500) throw new Error("Path pattern is too long");
  if (normalized.includes("?") || normalized.includes("#")) {
    throw new Error("Path pattern cannot contain a query string or fragment");
  }
  if (normalized.length > 1 && normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  return normalized;
}

/** Simple glob: exact match, :param segments, or trailing star. */
export function matchPath(pattern: string, path: string): boolean {
  const expected = normalizePathPattern(pattern);
  const actual = normalizePathPattern(path);
  if (expected === actual) return true;
  if (expected.endsWith("/*")) {
    const base = expected.slice(0, -2) || "/";
    if (actual === base) return true;
    return actual.startsWith(base === "/" ? "/" : `${base}/`);
  }
  const expectedParts = expected.split("/").filter(Boolean);
  const actualParts = actual.split("/").filter(Boolean);
  if (expectedParts.length !== actualParts.length) return false;
  return expectedParts.every(
    (part, index) => part.startsWith(":") || part === "*" || part === actualParts[index],
  );
}

function clampLimit(limit = 50) {
  if (!Number.isFinite(limit)) return 50;
  return Math.max(1, Math.min(100, Math.trunc(limit)));
}
