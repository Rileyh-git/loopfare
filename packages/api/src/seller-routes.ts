import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { config } from "./config.js";
import { requireAuth } from "./auth.js";
import type { AuthEnv, UsageTracker } from "./types.js";
import {
  database,
  createProject,
  createRoute,
  deleteProject,
  deleteRoute,
  getEarnings,
  getProjectById,
  getRouteById,
  listPayments,
  listProjects,
  listRoutes,
  normalizeMethods,
  normalizePrice,
  updateRoute,
} from "./db.js";
import { assertSafeOrigin } from "./origin-security.js";
import {
  configureOriginCredential,
  invalidateOriginVerification,
  originVerified,
  verifyOriginCredential,
} from "./origin-auth.js";
export function registerSellerRoutes(
  app: Hono<AuthEnv>,
  trackUsage: UsageTracker,
) {
  const projectSchema = z.object({
    name: z.string().trim().min(1).max(80),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/i,
        "slug must contain letters, numbers, and single hyphens",
      ),
    payTo: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "payTo must be an EVM address")
      .refine(
        (value) => !/^0x0{40}$/i.test(value),
        "Receiving address must not be zero",
      ),
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
      trackUsage(c, {
        eventType: "project_created",
        accountId: c.get("accountId"),
        projectId: project.id,
        route: "/v1/projects",
        statusCode: 201,
      });
      return c.json(
        { ...project, proxyBase: `${config.publicUrl}/p/${project.slug}` },
        201,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        return c.json(
          { error: "slug_taken", message: "Project slug already exists" },
          409,
        );
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
      project: {
        ...project,
        proxyBase: `${config.publicUrl}/p/${project.slug}`,
      },
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
    price: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .refine(isValidPrice, "Invalid price"),
    description: z.string().trim().max(500).optional(),
    methods: z
      .string()
      .trim()
      .max(200)
      .refine(
        (value) =>
          isValidMethods(value) &&
          normalizeMethods(value)
            .split(",")
            .every((method) => ["GET", "HEAD"].includes(method)),
        "Only read-only GET/HEAD routes are supported until paid-write idempotency is available",
      )
      .optional(),
  };
  const routeSchema = z.object(routeFields);
  const routePatchSchema = z
    .object({ ...routeFields, enabled: z.boolean().optional() })
    .partial()
    .refine(
      (input) => Object.keys(input).length > 0,
      "At least one field is required",
    );

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
    if (!config.devMode) {
      invalidateOriginVerification(route.id);
      route.enabled = 0;
    }
    trackUsage(c, {
      eventType: "route_created",
      accountId: c.get("accountId"),
      projectId: project.id,
      route: "/v1/projects/:id/routes",
      statusCode: 201,
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
    if (body.originUrl || (!config.devMode && !originVerified(route.id))) {
      invalidateOriginVerification(route.id);
      route.enabled = 0;
    }
    return c.json({ route });
  });

  app.put(
    "/v1/projects/:id/routes/:routeId/origin-credential",
    requireAuth,
    async (c) => {
      const project = getOwnedProject(c.get("accountId"), c.req.param("id"));
      const route = getRouteById(c.req.param("routeId"));
      if (!route || route.project_id !== project.id)
        throw new HTTPException(404, { message: "Route not found" });
      const { secret } = z
        .object({
          secret: z
            .string()
            .min(32)
            .max(512)
            .regex(/^[^\r\n]+$/),
        })
        .parse(await c.req.json());
      if (!config.originEncryptionKey)
        throw new HTTPException(503, {
          message: "Origin secret storage is not configured",
        });
      return c.json(configureOriginCredential(route.id, secret));
    },
  );

  app.post(
    "/v1/projects/:id/routes/:routeId/verify-origin",
    requireAuth,
    async (c) => {
      const project = getOwnedProject(c.get("accountId"), c.req.param("id"));
      const route = getRouteById(c.req.param("routeId"));
      if (!route || route.project_id !== project.id)
        throw new HTTPException(404, { message: "Route not found" });
      try {
        await verifyOriginCredential(route.id, route.origin_url);
      } catch {
        throw new HTTPException(400, {
          message:
            "Origin verification failed; check challenge, authentication, and reachability",
        });
      }
      return c.json({ verified: true, routeId: route.id });
    },
  );

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
      payments: listPayments({
        accountId: c.get("accountId"),
        limit: parseLimit(c.req.query("limit")),
      }),
    }),
  );

  app.get("/v1/projects/:id/operations", requireAuth, (c) => {
    const project = getOwnedProject(c.get("accountId"), c.req.param("id"));
    return c.json({
      operations: database
        .prepare(
          "SELECT op.* FROM payment_operations op JOIN routes r ON r.id = op.route_id WHERE r.project_id = ? ORDER BY op.created_at DESC LIMIT 100",
        )
        .all(project.id),
    });
  });
}
function getOwnedProject(accountId: string, projectId: string) {
  const project = getProjectById(projectId);
  if (!project || project.account_id !== accountId) {
    throw new HTTPException(404, { message: "Project not found" });
  }
  return project;
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

function parseLimit(value?: string) {
  if (!value) return 50;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new HTTPException(400, {
      message: "limit must be an integer from 1 to 100",
    });
  }
  return parsed;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
