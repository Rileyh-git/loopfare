import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { config } from "./config.js";

export type Account = {
  id: string;
  email: string;
  api_key: string;
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
  daily_limit_usd: number;
  spent_today_usd: number;
  spent_day: string;
  updated_at: string;
};

const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    api_key TEXT NOT NULL UNIQUE,
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
    daily_limit_usd REAL NOT NULL DEFAULT 5,
    spent_today_usd REAL NOT NULL DEFAULT 0,
    spent_day TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_routes_project ON routes(project_id);
  CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at);
  CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);
`);

function now() {
  return new Date().toISOString();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function createAccount(email: string, apiKey = `lf_${nanoid(32)}`): Account {
  const account: Account = {
    id: nanoid(),
    email: email.toLowerCase().trim(),
    api_key: apiKey,
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO accounts (id, email, api_key, created_at) VALUES (@id, @email, @api_key, @created_at)`,
  ).run(account);
  return account;
}

export function getAccountByApiKey(apiKey: string): Account | undefined {
  return db.prepare(`SELECT * FROM accounts WHERE api_key = ?`).get(apiKey) as Account | undefined;
}

export function getAccountByEmail(email: string): Account | undefined {
  return db
    .prepare(`SELECT * FROM accounts WHERE email = ?`)
    .get(email.toLowerCase().trim()) as Account | undefined;
}

export function ensureBootstrapAccount(): Account {
  const existing = db.prepare(`SELECT * FROM accounts LIMIT 1`).get() as Account | undefined;
  if (existing) return existing;
  const key = config.adminApiKey ?? `lf_${nanoid(32)}`;
  return createAccount("owner@loopfare.local", key);
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
    name: input.name,
    slug: input.slug.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
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
    methods: input.methods ?? "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS",
    origin_url: input.originUrl.replace(/\/$/, ""),
    price: normalizePrice(input.price),
    description: input.description ?? "Protected by Loopfare",
    enabled: 1,
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO routes (id, project_id, path_pattern, methods, origin_url, price, description, enabled, created_at)
     VALUES (@id, @project_id, @path_pattern, @methods, @origin_url, @price, @description, @enabled, @created_at)`,
  ).run(route);
  return route;
}

export function listRoutes(projectId: string): ProtectedRoute[] {
  return db
    .prepare(`SELECT * FROM routes WHERE project_id = ? ORDER BY created_at DESC`)
    .all(projectId) as ProtectedRoute[];
}

export function getRouteById(id: string): ProtectedRoute | undefined {
  return db.prepare(`SELECT * FROM routes WHERE id = ?`).get(id) as ProtectedRoute | undefined;
}

export function listEnabledRoutes(): Array<ProtectedRoute & { project_slug: string; pay_to: string }> {
  return db
    .prepare(
      `SELECT r.*, p.slug as project_slug, p.pay_to as pay_to
       FROM routes r
       JOIN projects p ON p.id = r.project_id
       WHERE r.enabled = 1`,
    )
    .all() as Array<ProtectedRoute & { project_slug: string; pay_to: string }>;
}

export function findRouteForRequest(
  projectSlug: string,
  method: string,
  pathAfterProject: string,
): (ProtectedRoute & { pay_to: string; project_slug: string }) | undefined {
  const project = getProjectBySlug(projectSlug);
  if (!project) return undefined;
  const routes = listRoutes(project.id).filter((r) => r.enabled === 1);
  const path = normalizePathPattern(pathAfterProject || "/");
  for (const route of routes) {
    const methods = route.methods.split(",").map((m) => m.trim().toUpperCase());
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
  limit?: number;
}): PaymentEvent[] {
  const limit = opts.limit ?? 50;
  if (opts.projectId) {
    return db
      .prepare(
        `SELECT * FROM payments WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(opts.projectId, limit) as PaymentEvent[];
  }
  return db
    .prepare(`SELECT * FROM payments ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as PaymentEvent[];
}

export function getEarnings(projectId: string): { count: number; volume_usd: number } {
  const rows = db
    .prepare(
      `SELECT price, status FROM payments WHERE project_id = ? AND status IN ('settled', 'dev_settled')`,
    )
    .all(projectId) as Array<{ price: string; status: string }>;
  let volume = 0;
  for (const row of rows) {
    volume += priceToUsd(row.price);
  }
  return { count: rows.length, volume_usd: Number(volume.toFixed(6)) };
}

export function getOrCreateBudget(walletAddress: string, dailyLimitUsd = 5): BuyerBudget {
  const address = walletAddress.toLowerCase();
  let budget = db
    .prepare(`SELECT * FROM buyer_budgets WHERE wallet_address = ?`)
    .get(address) as BuyerBudget | undefined;
  if (!budget) {
    budget = {
      id: nanoid(),
      wallet_address: address,
      daily_limit_usd: dailyLimitUsd,
      spent_today_usd: 0,
      spent_day: today(),
      updated_at: now(),
    };
    db.prepare(
      `INSERT INTO buyer_budgets (id, wallet_address, daily_limit_usd, spent_today_usd, spent_day, updated_at)
       VALUES (@id, @wallet_address, @daily_limit_usd, @spent_today_usd, @spent_day, @updated_at)`,
    ).run(budget);
    return budget;
  }
  if (budget.spent_day !== today()) {
    db.prepare(
      `UPDATE buyer_budgets SET spent_today_usd = 0, spent_day = ?, updated_at = ? WHERE id = ?`,
    ).run(today(), now(), budget.id);
    budget.spent_today_usd = 0;
    budget.spent_day = today();
  }
  return budget;
}

export function setBudget(walletAddress: string, dailyLimitUsd: number): BuyerBudget {
  const budget = getOrCreateBudget(walletAddress, dailyLimitUsd);
  db.prepare(
    `UPDATE buyer_budgets SET daily_limit_usd = ?, updated_at = ? WHERE id = ?`,
  ).run(dailyLimitUsd, now(), budget.id);
  return getOrCreateBudget(walletAddress, dailyLimitUsd);
}

export function canSpendBudget(
  walletAddress: string,
  amountUsd: number,
): { ok: boolean; budget: BuyerBudget; reason?: string } {
  const budget = getOrCreateBudget(walletAddress);
  if (budget.spent_today_usd + amountUsd > budget.daily_limit_usd + 1e-9) {
    return {
      ok: false,
      budget,
      reason: `Daily budget exceeded (limit $${budget.daily_limit_usd}, spent $${budget.spent_today_usd.toFixed(4)}, need $${amountUsd})`,
    };
  }
  return { ok: true, budget };
}

export function trySpendBudget(walletAddress: string, amountUsd: number): {
  ok: boolean;
  budget: BuyerBudget;
  reason?: string;
} {
  const check = canSpendBudget(walletAddress, amountUsd);
  if (!check.ok) return check;
  db.prepare(
    `UPDATE buyer_budgets SET spent_today_usd = spent_today_usd + ?, updated_at = ? WHERE id = ?`,
  ).run(amountUsd, now(), check.budget.id);
  return { ok: true, budget: getOrCreateBudget(walletAddress) };
}

export function priceToUsd(price: string): number {
  const cleaned = price.trim().replace(/^\$/, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function normalizePrice(price: string): string {
  const cleaned = price.trim();
  if (cleaned.startsWith("$")) return cleaned;
  return `$${cleaned}`;
}

function normalizePathPattern(path: string): string {
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

/** Simple glob: exact match, :param segments, or trailing * */
export function matchPath(pattern: string, path: string): boolean {
  const p = normalizePathPattern(pattern);
  const t = normalizePathPattern(path);
  if (p === t) return true;
  if (p.endsWith("/*")) {
    const prefix = p.slice(0, -1); // keep trailing slash meaning
    const base = p.slice(0, -2) || "/";
    if (t === base) return true;
    return t.startsWith(base === "/" ? "/" : `${base}/`) || t.startsWith(prefix);
  }
  const pParts = p.split("/").filter(Boolean);
  const tParts = t.split("/").filter(Boolean);
  if (pParts.length !== tParts.length) return false;
  return pParts.every((part, i) => part.startsWith(":") || part === "*" || part === tParts[i]);
}


