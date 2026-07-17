import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import type { RoutesConfig } from "@x402/core/http";
import type { MiddlewareHandler } from "hono";
import { config } from "./config.js";

type Caip2 = `${string}:${string}`;

let resourceServer: x402ResourceServer | null = null;

type RoutePaymentOptions = {
  method: string;
  path: string;
  resource: string;
  price: string;
  payTo: string;
  description: string;
};

export function publicResourceUrl(path: string, search = ""): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("Public resource path must be an absolute application path");
  }
  if (search && !search.startsWith("?")) {
    throw new Error("Public resource search must be empty or start with ?");
  }
  return `${config.publicUrl}${path}${search}`;
}

export function getResourceServer(): x402ResourceServer {
  if (resourceServer) return resourceServer;
  const facilitatorClient = new HTTPFacilitatorClient({
    url: config.facilitatorUrl,
  });
  resourceServer = new x402ResourceServer(facilitatorClient).register(
    config.networkCaip2 as Caip2,
    new ExactEvmScheme(),
  );
  return resourceServer;
}

export function buildDemoPaymentRoutes(): RoutesConfig {
  return {
    "GET /demo/v1/fortune": {
      resource: publicResourceUrl("/demo/v1/fortune"),
      accepts: [
        {
          scheme: "exact",
          price: config.demoPrice,
          network: config.networkCaip2 as Caip2,
          payTo: config.demoPayTo,
        },
      ],
      description: "Loopfare demo: paid fortune cookie for AI agents",
      mimeType: "application/json",
    },
  };
}

export function buildDemoPaymentMiddleware(): MiddlewareHandler {
  const server = getResourceServer();
  const routes = buildDemoPaymentRoutes();
  return paymentMiddleware(routes, server);
}

export function buildRoutePaymentRoutes(opts: RoutePaymentOptions): RoutesConfig {
  const key = `${opts.method.toUpperCase()} ${opts.path}`;
  return {
    [key]: {
      resource: opts.resource,
      accepts: [
        {
          scheme: "exact",
          price: opts.price,
          network: config.networkCaip2 as Caip2,
          payTo: opts.payTo as `0x${string}`,
        },
      ],
      description: opts.description.slice(0, 500),
      mimeType: "application/json",
    },
  };
}

export function buildRoutePaymentMiddleware(opts: RoutePaymentOptions): MiddlewareHandler {
  const server = getResourceServer();
  const routes = buildRoutePaymentRoutes(opts);
  return paymentMiddleware(routes, server);
}

export function isDevPaymentAuthorized(headerValue: string | undefined, price: string): boolean {
  if (!config.devMode) return false;
  if (!headerValue) return false;
  // LOOPFARE-DEV-PAYMENT: <price> or "ok"
  const v = headerValue.trim().toLowerCase();
  if (v === "ok" || v === "1" || v === "true") return true;
  return v === price.toLowerCase() || v === price.replace(/^\$/, "").toLowerCase();
}
