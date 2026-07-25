const RESET = "\u001B[0m";
const LIME = "\u001B[38;2;200;255;104m";
const PURPLE = "\u001B[38;2;94;67;198m";
const MUTED = "\u001B[38;2;155;148;166m";
const BOLD = "\u001B[1m";

const GLYPHS: Record<string, readonly string[]> = {
  A: ["01110", "10001", "11111", "10001", "10001"],
  E: ["11111", "10000", "11110", "10000", "11111"],
  F: ["11111", "10000", "11110", "10000", "10000"],
  L: ["10000", "10000", "10000", "10000", "11111"],
  O: ["01110", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "11110", "10000", "10000"],
  R: ["11110", "10001", "11110", "10100", "10010"],
};

export type SignupWelcome = {
  accountId: string;
  email: string;
  storedAt: string;
};

export type WelcomeRenderOptions = {
  color?: boolean;
  columns?: number;
  home?: string;
};

export function supportsColor(
  stream: Pick<NodeJS.WriteStream, "isTTY"> = process.stdout,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (environment.NO_COLOR !== undefined || environment.TERM === "dumb") return false;
  if (environment.FORCE_COLOR !== undefined) return environment.FORCE_COLOR !== "0";
  return Boolean(stream.isTTY);
}

export function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

export function renderSignupWelcome(
  signup: SignupWelcome,
  options: WelcomeRenderOptions = {},
): string {
  const columns = Math.max(20, Math.floor(options.columns ?? process.stdout.columns ?? 80));
  const color = options.color ?? supportsColor();
  const home = options.home ?? process.env.HOME;
  const storedAt = shortenHome(signup.storedAt, home);
  const wide = columns >= 52;

  const wordmark = wide
    ? [
        ...renderPixelWord("LOOP", color),
        "",
        ...renderPixelWord("FARE", color),
      ].map((line) => (line ? `  ${line}` : line))
    : renderCompactWordmark(columns, color);

  const tagline = fit(
    wide ? "  MAKE EVERY API CALL PAY ITS FARE" : "MAKE EVERY CALL PAY",
    columns,
  );
  const account = fit(`✓  Account ready   ${signup.email}`, columns);
  const accountId = fit(`   Account ID      ${signup.accountId}`, columns);
  const key = fit(`✓  API key saved   ${storedAt}`, columns);
  const create = fit("$  loopfare projects create --help", columns);
  const protect = fit("$  loopfare protect --help", columns);

  return [
    ...wordmark,
    "",
    paint(tagline, color, PURPLE, true),
    "",
    paintCheck(account, color),
    paint(accountId, color, MUTED),
    paintCheck(key, color),
    "",
    paint("FIRST ROUTE", color, PURPLE, true),
    paintCommand(create, color),
    paintCommand(protect, color),
  ].join("\n");
}

export function printSignupWelcome(signup: SignupWelcome): void {
  process.stdout.write(`${renderSignupWelcome(signup)}\n`);
}

function renderPixelWord(word: string, color: boolean): string[] {
  const pixelWidth = 2;
  const letterGap = 2;
  const width = word.length * 5 * pixelWidth + (word.length - 1) * letterGap + 1;
  const canvas = Array.from({ length: 6 }, () => Array<string>(width).fill(" "));

  // Lay down the offset shadow first so foreground blocks stay crisp.
  for (const [letterIndex, letter] of [...word].entries()) {
    const glyph = GLYPHS[letter];
    if (!glyph) throw new Error(`No Loopfare wordmark glyph for ${letter}`);
    const origin = letterIndex * (5 * pixelWidth + letterGap);
    for (const [row, pixels] of glyph.entries()) {
      for (const [column, pixel] of [...pixels].entries()) {
        if (pixel !== "1") continue;
        const x = origin + column * pixelWidth;
        canvas[row + 1][x + 1] = "░";
        canvas[row + 1][x + 2] = "░";
      }
    }
  }

  for (const [letterIndex, letter] of [...word].entries()) {
    const glyph = GLYPHS[letter];
    const origin = letterIndex * (5 * pixelWidth + letterGap);
    for (const [row, pixels] of glyph.entries()) {
      for (const [column, pixel] of [...pixels].entries()) {
        if (pixel !== "1") continue;
        const x = origin + column * pixelWidth;
        canvas[row][x] = "█";
        canvas[row][x + 1] = "█";
      }
    }
  }

  return canvas.map((row) => {
    const line = row.join("").trimEnd();
    if (!color) return line;
    return line
      .replace(/░+/g, (shadow) => `${PURPLE}${shadow}${RESET}`)
      .replace(/█+/g, (face) => `${LIME}${face}${RESET}`);
  });
}

function renderCompactWordmark(columns: number, color: boolean): string[] {
  if (columns < 24) return [paint("↪ LOOPFARE", color, LIME, true)];
  const width = Math.min(columns, 36);
  const label = " LOOPFARE ";
  const left = Math.floor((width - label.length - 2) / 2);
  const right = width - label.length - left - 2;
  return [
    paint(`╭${"─".repeat(left)}${label}${"─".repeat(right)}╮`, color, LIME, true),
    paint(`╰${"─".repeat(width - 2)}╯`, color, PURPLE),
  ];
}

function shortenHome(path: string, home?: string): string {
  if (!home) return path;
  if (path === home) return "~";
  if (path.startsWith(`${home}/`) || path.startsWith(`${home}\\`)) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}

function fit(value: string, columns: number): string {
  if ([...value].length <= columns) return value;
  if (columns <= 1) return value.slice(0, columns);
  return `${[...value].slice(0, columns - 1).join("")}…`;
}

function paint(
  value: string,
  color: boolean,
  foreground: string,
  bold = false,
): string {
  if (!color) return value;
  return `${bold ? BOLD : ""}${foreground}${value}${RESET}`;
}

function paintCheck(value: string, color: boolean): string {
  if (!color || !value.startsWith("✓")) return value;
  return `${LIME}✓${RESET}${value.slice(1)}`;
}

function paintCommand(value: string, color: boolean): string {
  if (!color || !value.startsWith("$")) return value;
  return `${LIME}$${RESET}${MUTED}${value.slice(1)}${RESET}`;
}
