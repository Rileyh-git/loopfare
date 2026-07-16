import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import type { RoutesConfig } from "@x402/core/http";
import type { MiddlewareHandler } from "hono";
import { config } from "./config.js";

type Caip2 = `${string}:${string}`;

let resourceServer: x402ResourceServer | null = null;

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

export function buildDemoPaymentMiddleware(): MiddlewareHandler {
  const server = getResourceServer();
  const routes: RoutesConfig = {
    "GET /demo/v1/fortune": {
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
  return paymentMiddleware(routes, server);
}

export function buildRoutePaymentMiddleware(opts: {
  method: string;
  path: string;
  price: string;
  payTo: string;
  description: string;
}): MiddlewareHandler {
  const server = getResourceServer();
  const key = `${opts.method.toUpperCase()} ${opts.path}`;
  const routes: RoutesConfig = {
    [key]: {
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
