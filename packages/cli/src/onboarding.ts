import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { api } from "./api.js";
import { loadConfig, saveConfig } from "./config.js";
import { print } from "./output.js";

export function registerOnboarding(program: Command, json: () => boolean) {
  program
    .command("init")
    .description(
      "Set up one read-only seller endpoint and its origin ownership challenge",
    )
    .option(
      "--email <email>",
      "Create an account if no seller key is configured",
    )
    .requiredOption("--name <name>", "Project name")
    .requiredOption("--slug <slug>", "Unique project slug")
    .requiredOption("--pay-to <address>", "Seller receiving address")
    .requiredOption("--origin <url>", "Seller-controlled HTTPS origin")
    .requiredOption(
      "--origin-secret-file <path>",
      "File containing a 32–512 character origin secret",
    )
    .option("--path <pattern>", "Read-only route pattern", "/v1/*")
    .option("--price <usd>", "Per-call price", "$0.001")
    .action(async (opts) => {
      const secret = readFileSync(opts.originSecretFile, "utf8").trim();
      if (secret.length < 32 || secret.length > 512 || /[\r\n]/.test(secret))
        throw new Error("Invalid origin secret file");
      if (!loadConfig().apiKey) {
        if (!opts.email) throw new Error("Sign in first or provide --email");
        const account = await api<{ apiKey: string; email: string }>(
          "/v1/auth/signup",
          {
            auth: false,
            method: "POST",
            body: JSON.stringify({ email: opts.email }),
          },
        );
        saveConfig({ apiKey: account.apiKey, email: account.email });
      }
      const result = await api<{ id: string }>("/v1/projects", {
        method: "POST",
        body: JSON.stringify({
          name: opts.name,
          slug: opts.slug,
          payTo: opts.payTo,
        }),
      });
      const projectId = result.id;
      // Report recoverable IDs immediately; never roll back by deleting user data.
      process.stderr.write(`Created project ${projectId}\n`);
      const { route } = await api<{ route: { id: string } }>(
        `/v1/projects/${projectId}/routes`,
        {
          method: "POST",
          body: JSON.stringify({
            pathPattern: opts.path,
            originUrl: opts.origin,
            price: opts.price,
            methods: "GET,HEAD",
          }),
        },
      );
      process.stderr.write(`Created route ${route.id}\n`);
      const challenge = await api(
        `/v1/projects/${projectId}/routes/${route.id}/origin-credential`,
        { method: "PUT", body: JSON.stringify({ secret }) },
      );
      print(
        {
          projectId,
          routeId: route.id,
          challenge,
          next: `Protect all origin endpoints with X-Loopfare-Origin-Secret, then run: loopfare verify-origin ${projectId} ${route.id}`,
          test: `After verification: loopfare call ${loadConfig().apiUrl}/p/${opts.slug}${opts.path.replace(/\*$/, "")} --network base-sepolia --max-price ${opts.price.replace(/^\$/, "")}`,
        },
        json(),
      );
    });

  program
    .command("verify-origin")
    .description("Verify origin ownership and enable a read-only route")
    .argument("<project-id>")
    .argument("<route-id>")
    .action(async (projectId, routeId) =>
      print(
        await api(
          `/v1/projects/${encodeURIComponent(projectId)}/routes/${encodeURIComponent(routeId)}/verify-origin`,
          { method: "POST" },
        ),
        json(),
      ),
    );

  program
    .command("origin-secret")
    .description(
      "Set or rotate an origin secret; disables the route until reverified",
    )
    .argument("<project-id>")
    .argument("<route-id>")
    .requiredOption("--file <path>", "Secret file")
    .action(async (projectId, routeId, opts) =>
      print(
        await api(
          `/v1/projects/${encodeURIComponent(projectId)}/routes/${encodeURIComponent(routeId)}/origin-credential`,
          {
            method: "PUT",
            body: JSON.stringify({
              secret: readFileSync(opts.file, "utf8").trim(),
            }),
          },
        ),
        json(),
      ),
    );
}
