import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { config } from "./config.js";
import { closeDatabase } from "./db.js";
import { closeProxyDispatcher } from "./origin-security.js";

const server = serve(
  {
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  },
  (info) => {
    console.log(
      JSON.stringify({
        level: "info",
        message: "server_started",
        address: info.address,
        port: info.port,
        network: config.network,
        publicUrl: config.publicUrl,
        devMode: config.devMode,
        demoEnabled: config.demoEnabled,
      }),
    );
  },
);

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ level: "info", message: "server_stopping", signal }));
  server.close(() => {
    void closeProxyDispatcher().finally(() => {
      closeDatabase();
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
