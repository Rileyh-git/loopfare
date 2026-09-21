import { config } from "./config.js";

/** Only use middleware-generated receipts; origin payment headers are stripped. */
export function settlement(
  header: string | null,
):
  | { transaction: string; payer?: string; network: string; amount?: string }
  | undefined {
  if (!header || header.length > 16_384) return undefined;
  try {
    const value = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
    if (
      value.success !== true ||
      value.network !== config.networkCaip2 ||
      typeof value.transaction !== "string" ||
      !/^0x[\da-fA-F]{64}$/.test(value.transaction)
    )
      return undefined;
    return {
      transaction: value.transaction,
      network: value.network,
      payer:
        typeof value.payer === "string" &&
        /^0x[\da-fA-F]{40}$/.test(value.payer)
          ? value.payer.toLowerCase()
          : undefined,
      amount:
        typeof value.amount === "string" && /^\d+$/.test(value.amount)
          ? value.amount
          : undefined,
    };
  } catch {
    return undefined;
  }
}
