export function print(data: unknown, json: boolean) {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (typeof data === "string") {
    console.log(data);
    return;
  }
  console.log(JSON.stringify(data, null, 2));
}

export function fail(err: unknown, json: boolean): never {
  const message = err instanceof Error ? err.message : String(err);
  const body =
    err && typeof err === "object" && "body" in err
      ? (err as { body: unknown }).body
      : undefined;
  if (json) {
    console.log(JSON.stringify({ error: message, body }, null, 2));
  } else {
    console.error(message);
    if (body) console.error(JSON.stringify(body, null, 2));
  }
  process.exit(1);
}
