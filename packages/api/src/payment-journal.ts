import { createHash } from "node:crypto";
import { database } from "./db.js";

/** Claim only after facilitator verification. Never persist payment signatures. */
export function claimPayment(
  signature: string,
  requestId: string,
  routeId: string,
): string | undefined {
  const id = createHash("sha256").update(signature).digest("hex");
  const now = new Date().toISOString();
  return database
    .prepare(
      "INSERT OR IGNORE INTO payment_operations VALUES (?, ?, ?, 'pending', NULL, ?, ?)",
    )
    .run(id, requestId, routeId, now, now).changes
    ? id
    : undefined;
}
export function completePayment(
  id: string,
  state: "settled" | "unknown" | "failed",
  transaction?: string,
) {
  database
    .prepare(
      "UPDATE payment_operations SET state=?, transaction_hash=?, updated_at=? WHERE id=? AND state='pending'",
    )
    .run(state, transaction ?? null, new Date().toISOString(), id);
  if (state === "unknown")
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "payment_outcome_unknown",
        operationId: id,
      }),
    );
}
