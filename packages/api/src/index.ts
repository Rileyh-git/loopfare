import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { config } from "./config.js";

serve(
  {
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  },
  (info) => {
    console.log(`[loopfare] listening on http://${info.address}:${info.port}`);
    console.log(`[loopfare] network=${config.network} (${config.networkCaip2})`);
    console.log(`[loopfare] facilitator=${config.facilitatorUrl}`);
    console.log(`[loopfare] publicUrl=${config.publicUrl}`);
    console.log(`[loopfare] devMode=${config.devMode}`);
    console.log(`[loopfare] demo GET ${config.publicUrl}/demo/v1/fortune`);
  },
);
