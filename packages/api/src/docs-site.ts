import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type PublicDoc = {
  slug: string;
  title: string;
  description: string;
  category: "Start here" | "Use Loopfare" | "Build with Loopfare" | "Operate Loopfare";
  file: string;
};

export const publicDocs: readonly PublicDoc[] = [
  {
    slug: "quickstart",
    title: "Quickstart",
    description: "Protect an API and make a paid test call on Base Sepolia.",
    category: "Start here",
    file: "docs/QUICKSTART.md",
  },
  {
    slug: "concepts",
    title: "Core concepts",
    description: "Projects, routes, x402 challenges, settlement, wallets, and budgets.",
    category: "Start here",
    file: "docs/CONCEPTS.md",
  },
  {
    slug: "faq",
    title: "FAQ",
    description: "Short answers about payments, custody, testnet, pricing, and limits.",
    category: "Start here",
    file: "docs/FAQ.md",
  },
  {
    slug: "glossary",
    title: "Glossary",
    description: "Definitions for the payment and API terms used throughout Loopfare.",
    category: "Start here",
    file: "docs/GLOSSARY.md",
  },
  {
    slug: "support",
    title: "Support",
    description: "Where to ask questions, report bugs, and disclose security issues.",
    category: "Start here",
    file: "docs/SUPPORT.md",
  },
  {
    slug: "seller-manual",
    title: "Seller manual",
    description: "The complete guide to accounts, projects, routes, pricing, and earnings.",
    category: "Use Loopfare",
    file: "docs/SELLER_MANUAL.md",
  },
  {
    slug: "buyer-manual",
    title: "Buyer manual",
    description: "Wallet safety, USDC funding, daily budgets, and paid agent requests.",
    category: "Use Loopfare",
    file: "docs/BUYER_MANUAL.md",
  },
  {
    slug: "cli-reference",
    title: "CLI reference",
    description: "Every command, option, environment override, and JSON output workflow.",
    category: "Use Loopfare",
    file: "docs/CLI_REFERENCE.md",
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    description: "Diagnose authentication, route, budget, facilitator, and deployment errors.",
    category: "Use Loopfare",
    file: "docs/TROUBLESHOOTING.md",
  },
  {
    slug: "api-reference",
    title: "API reference",
    description: "HTTP endpoints, schemas, authentication, headers, examples, and limits.",
    category: "Build with Loopfare",
    file: "docs/API_REFERENCE.md",
  },
  {
    slug: "error-reference",
    title: "Error reference",
    description: "Status codes and stable error identifiers with recommended responses.",
    category: "Build with Loopfare",
    file: "docs/ERROR_REFERENCE.md",
  },
  {
    slug: "architecture",
    title: "Architecture",
    description: "Components, data model, paid request lifecycle, and trust boundaries.",
    category: "Build with Loopfare",
    file: "docs/ARCHITECTURE.md",
  },
  {
    slug: "agent-integration",
    title: "Agent integration",
    description: "Make Loopfare discoverable and safe for autonomous software buyers.",
    category: "Build with Loopfare",
    file: "docs/AGENT_INTEGRATION.md",
  },
  {
    slug: "self-hosting",
    title: "Self-hosting",
    description: "Run Loopfare locally or deploy it with persistent storage on Railway.",
    category: "Operate Loopfare",
    file: "docs/SELF_HOSTING.md",
  },
  {
    slug: "operations",
    title: "Operations manual",
    description: "Monitoring, backups, restore drills, incidents, scaling, and rollback.",
    category: "Operate Loopfare",
    file: "docs/OPERATIONS_MANUAL.md",
  },
  {
    slug: "security-model",
    title: "Security model",
    description: "Threat model, SSRF controls, secret handling, and residual risks.",
    category: "Operate Loopfare",
    file: "docs/SECURITY_MODEL.md",
  },
  {
    slug: "production-checklist",
    title: "Production checklist",
    description: "Release gates for testnet beta and the separate Base mainnet launch.",
    category: "Operate Loopfare",
    file: "docs/PRODUCTION.md",
  },
  {
    slug: "contributing",
    title: "Contributing",
    description: "Development setup, code standards, testing, and release workflow.",
    category: "Operate Loopfare",
    file: "docs/CONTRIBUTING.md",
  },
  {
    slug: "release-notes",
    title: "Release notes",
    description: "Public beta changes, compatibility notes, and upgrade guidance.",
    category: "Operate Loopfare",
    file: "docs/RELEASE_NOTES.md",
  },
];

const categories = ["Start here", "Use Loopfare", "Build with Loopfare", "Operate Loopfare"] as const;
const fileToSlug = new Map(publicDocs.map((doc) => [doc.file.split("/").pop()!.toLowerCase(), doc.slug]));
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function findPublicDoc(slug: string): PublicDoc | undefined {
  return publicDocs.find((doc) => doc.slug === slug);
}

export function publicDocMarkdown(slug: string): string | undefined {
  const doc = findPublicDoc(slug);
  if (!doc) return undefined;
  return readFileSync(resolve(projectRoot, doc.file), "utf8");
}

export function documentationHtml(options: { publicUrl: string; slug?: string }): string | undefined {
  const selected = options.slug ? findPublicDoc(options.slug) : undefined;
  if (options.slug && !selected) return undefined;
  const title = selected ? `${selected.title} · Loopfare documentation` : "Loopfare documentation";
  const description = selected?.description ?? "Guides, manuals, API reference, and operator documentation for Loopfare.";
  const canonical = `${options.publicUrl}/docs${selected ? `/${selected.slug}` : ""}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="theme-color" content="#f5f3ef">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <style>${documentationCss}</style>
</head>
<body>
  <a class="skip" href="#content">Skip to documentation</a>
  <div class="beta"><i></i> Base Sepolia beta · Documentation v0.2</div>
  <header>
    <a class="brand" href="/" aria-label="Loopfare home">${logoSvg}<span>loopfare</span></a>
    <nav aria-label="Documentation navigation">
      <a href="/">Product</a><a class="active" href="/docs">Docs</a><a href="/skill.md">Agent skill</a><a href="https://github.com/Rileyh-git/loopfare">GitHub</a>
    </nav>
  </header>
  <details class="mobile-nav"><summary>Documentation menu</summary>${documentationNavigation(selected?.slug)}</details>
  <div class="layout">
    <aside aria-label="Documentation sections">${documentationNavigation(selected?.slug)}</aside>
    <main id="content">${selected ? articleHtml(selected) : landingHtml()}</main>
  </div>
  <footer><span>Loopfare documentation · MIT licensed</span><span><a href="/health">Service status</a> · <a href="https://github.com/Rileyh-git/loopfare/issues">Get help</a></span></footer>
  <script>
    document.querySelectorAll('[data-copy]').forEach(function (button) {
      button.addEventListener('click', function () {
        var code = button.parentElement && button.parentElement.nextElementSibling;
        if (!code) return;
        navigator.clipboard.writeText(code.textContent || '').then(function () {
          button.textContent = 'Copied'; setTimeout(function () { button.textContent = 'Copy'; }, 1300);
        });
      });
    });
  </script>
</body>
</html>`;
}

function landingHtml(): string {
  return `<section class="docs-hero">
    <div class="kicker">Documentation</div>
    <h1>Build, pay, and operate with confidence.</h1>
    <p>Everything needed to protect an API, pay for a request, integrate an agent, or run Loopfare in production.</p>
    <div class="hero-actions"><a class="primary" href="/docs/quickstart">Start the quickstart →</a><a href="/docs/api-reference">Browse the API</a></div>
  </section>
  <section class="path-grid" aria-label="Documentation paths">
    <a href="/docs/seller-manual"><small>For API sellers</small><strong>Turn an existing endpoint into paid infrastructure.</strong><span>Open seller manual →</span></a>
    <a href="/docs/buyer-manual"><small>For agents and buyers</small><strong>Fund safely, set a budget, and make paid calls.</strong><span>Open buyer manual →</span></a>
    <a href="/docs/self-hosting"><small>For operators</small><strong>Deploy, monitor, back up, and recover Loopfare.</strong><span>Open operator docs →</span></a>
  </section>
  ${categories
    .map(
      (category) => `<section class="doc-group"><h2>${category}</h2><div class="doc-cards">${publicDocs
        .filter((doc) => doc.category === category)
        .map((doc) => `<a href="/docs/${doc.slug}"><strong>${escapeHtml(doc.title)}</strong><p>${escapeHtml(doc.description)}</p><span>Read guide →</span></a>`)
        .join("")}</div></section>`,
    )
    .join("")}`;
}

function articleHtml(doc: PublicDoc): string {
  const markdown = publicDocMarkdown(doc.slug)!;
  return `<article>
    <div class="breadcrumbs"><a href="/docs">Docs</a><span>/</span><span>${escapeHtml(doc.category)}</span></div>
    <div class="article-intro"><div class="kicker">${escapeHtml(doc.category)}</div><h1>${escapeHtml(doc.title)}</h1><p>${escapeHtml(doc.description)}</p><a class="raw" href="/docs/${doc.slug}.md">View as Markdown</a></div>
    <div class="markdown">${renderMarkdown(markdown)}</div>
    <div class="article-end"><strong>Was something unclear?</strong><span>Open an issue with the page name and the detail you expected.</span><a href="https://github.com/Rileyh-git/loopfare/issues/new">Improve this page →</a></div>
  </article>`;
}

function documentationNavigation(active?: string): string {
  return `<a class="nav-home${active ? "" : " current"}" href="/docs">Documentation home</a>${categories
    .map(
      (category) => `<div class="nav-group"><h2>${category}</h2>${publicDocs
        .filter((doc) => doc.category === category)
        .map((doc) => `<a${doc.slug === active ? ' class="current" aria-current="page"' : ""} href="/docs/${doc.slug}">${escapeHtml(doc.title)}</a>`)
        .join("")}</div>`,
    )
    .join("")}`;
}

function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim()) { index += 1; continue; }

    const fence = line.match(/^```([\w+-]*)\s*$/);
    if (fence) {
      const language = fence[1] || "text";
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index]!)) code.push(lines[index++]!);
      index += 1;
      output.push(`<div class="code-block"><div><span>${escapeHtml(language)}</span><button type="button" data-copy>Copy</button></div><pre><code>${escapeHtml(code.join("\n"))}</code></pre></div>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(6, heading[1]!.length + 1);
      const text = heading[2]!.replace(/\s+#+$/, "");
      output.push(`<h${level} id="${headingId(text)}">${inlineMarkdown(text)}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^---+$/.test(line.trim())) { output.push("<hr>"); index += 1; continue; }

    if (line.includes("|") && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1]!)) {
      const headers = tableCells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index]!.includes("|") && lines[index]!.trim()) rows.push(tableCells(lines[index++]!));
      output.push(`<div class="table-wrap"><table><thead><tr>${headers.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      const pattern = ordered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
      while (index < lines.length) {
        const match = lines[index]!.match(pattern);
        if (!match) break;
        items.push(match[1]!); index += 1;
      }
      const tag = ordered ? "ol" : "ul";
      output.push(`<${tag}>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</${tag}>`);
      continue;
    }

    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (index < lines.length && lines[index]!.startsWith(">")) quote.push(lines[index++]!.replace(/^>\s?/, ""));
      output.push(`<blockquote>${inlineMarkdown(quote.join(" "))}</blockquote>`);
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index]!.trim() && !isBlockStart(lines, index)) paragraph.push(lines[index++]!.trim());
    output.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
  }
  return output.join("\n");
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index]!;
  return /^(#{1,6})\s+|^```|^\s*[-*+]\s+|^\s*\d+\.\s+|^>|^---+$/.test(line) ||
    (line.includes("|") && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1]!));
}

function inlineMarkdown(input: string): string {
  const tokens: string[] = [];
  const token = (html: string) => { const key = `\u0000${tokens.length}\u0000`; tokens.push(html); return key; };
  let value = input.replace(/`([^`]+)`/g, (_match, code: string) => token(`<code>${escapeHtml(code)}</code>`));
  value = value.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) => {
    const safeHref = documentationHref(href.trim());
    return token(`<a href="${escapeHtml(safeHref)}">${escapeHtml(label)}</a>`);
  });
  value = escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  return value.replace(/\u0000(\d+)\u0000/g, (_match, position: string) => tokens[Number(position)] ?? "");
}

function documentationHref(href: string): string {
  if (/^(https?:\/\/|mailto:|\/|#)/i.test(href)) return href;
  const file = href.replace(/^\.\//, "").split("#")[0]!.split("/").pop()!.toLowerCase();
  const anchor = href.includes("#") ? `#${href.split("#").slice(1).join("#")}` : "";
  const slug = fileToSlug.get(file);
  return slug ? `/docs/${slug}${anchor}` : "#";
}

function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function headingId(value: string): string {
  return value.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
}

const logoSvg = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#17151f"/><path d="M8 11h10.5a5 5 0 1 1 0 10H13" fill="none" stroke="#c8ff68" stroke-width="3" stroke-linecap="round"/><path d="m8 16 5-4v8z" fill="#f5f3ef"/></svg>`;

const documentationCss = `
:root{--paper:#f5f3ef;--ink:#17151f;--muted:#6f6a76;--line:rgba(23,21,31,.13);--purple:#5e43c6;--night:#171420;--lime:#c8ff68;--sans:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--serif:"Iowan Old Style","Palatino Linotype",Georgia,serif;color-scheme:light}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.65 var(--sans)}a{color:inherit;text-decoration:none}.skip{position:fixed;top:-60px;left:16px;z-index:20;padding:10px 14px;background:var(--ink);color:#fff;border-radius:8px}.skip:focus{top:16px}.beta{min-height:34px;display:flex;align-items:center;justify-content:center;gap:9px;background:var(--night);color:#eeeaf5;font-size:12px}.beta i{width:7px;height:7px;border-radius:50%;background:var(--lime);box-shadow:0 0 0 4px rgba(200,255,104,.12)}header{height:76px;padding:0 max(24px,calc((100vw - 1280px)/2));display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);background:rgba(245,243,239,.95);position:sticky;top:0;z-index:10;backdrop-filter:blur(15px)}.brand{display:flex;align-items:center;gap:10px;font-size:20px;font-weight:780;letter-spacing:-.04em}.brand svg{width:29px}header nav{display:flex;gap:28px;font-size:14px}header nav a{color:#4e4954}header nav .active{color:var(--ink);font-weight:700}.layout{max-width:1280px;margin:0 auto;display:grid;grid-template-columns:260px minmax(0,1fr);gap:64px;padding:54px 24px 110px}aside{position:sticky;top:110px;height:calc(100vh - 140px);overflow:auto;padding-right:22px;border-right:1px solid var(--line)}.nav-home,.nav-group a{display:block;padding:7px 10px;margin:1px 0;border-radius:7px;color:#5f5a65;font-size:13px}.nav-home{margin-bottom:20px;font-weight:700}.nav-group{margin:0 0 22px}.nav-group h2{margin:0 0 6px;padding:0 10px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#9a949e}.nav-group a:hover,.nav-group a.current,.nav-home.current{background:#e9e5f0;color:#4d36a4}.nav-group a.current{font-weight:700}.mobile-nav{display:none}.docs-hero{padding:60px 0 80px;border-bottom:1px solid var(--line)}.kicker{color:var(--purple);font-size:11px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;margin-bottom:16px}.docs-hero h1,.article-intro h1{font:500 clamp(48px,6vw,78px)/1 var(--serif);letter-spacing:-.05em;margin:0 0 21px;max-width:850px}.docs-hero>p,.article-intro>p{max-width:720px;color:var(--muted);font-size:19px}.hero-actions{display:flex;gap:10px;margin-top:30px}.hero-actions a{padding:12px 17px;border:1px solid var(--line);border-radius:9px;font-weight:700}.hero-actions .primary{background:var(--ink);color:white}.path-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;margin:54px 0 86px;background:var(--line);border:1px solid var(--line)}.path-grid a{min-height:235px;padding:27px;background:#fff}.path-grid small{color:var(--purple);font-weight:800;text-transform:uppercase;letter-spacing:.09em}.path-grid strong{display:block;margin:50px 0 23px;font:500 26px/1.12 var(--serif)}.path-grid span,.doc-cards span{color:var(--purple);font-weight:700;font-size:13px}.doc-group{margin:0 0 70px}.doc-group>h2{font:500 35px var(--serif);letter-spacing:-.035em;border-bottom:1px solid var(--line);padding-bottom:16px}.doc-cards{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}.doc-cards a{padding:24px;border:1px solid var(--line);border-radius:11px;background:rgba(255,255,255,.5)}.doc-cards a:hover{border-color:#9480dd;transform:translateY(-1px)}.doc-cards strong{font-size:17px}.doc-cards p{min-height:48px;color:var(--muted);font-size:13px}.breadcrumbs{display:flex;gap:9px;color:#8a838e;font-size:12px;margin:4px 0 56px}.breadcrumbs a{color:var(--purple)}.article-intro{padding:0 0 48px;border-bottom:1px solid var(--line)}.article-intro h1{font-size:clamp(48px,5vw,70px)}.raw{display:inline-block;margin-top:15px;color:var(--purple);font-size:13px;font-weight:700}.markdown{max-width:800px;padding:50px 0}.markdown h2,.markdown h3,.markdown h4{scroll-margin-top:110px;letter-spacing:-.03em}.markdown h2{font:500 38px/1.15 var(--serif);margin:70px 0 21px;padding-top:12px;border-top:1px solid var(--line)}.markdown h2:first-child{margin-top:0}.markdown h3{font-size:23px;margin:45px 0 15px}.markdown h4{font-size:17px;margin:32px 0 12px}.markdown p{color:#4f4a55;margin:0 0 18px}.markdown a{color:#5138b0;text-decoration:underline;text-underline-offset:3px}.markdown strong{color:var(--ink)}.markdown code{padding:2px 5px;border-radius:5px;background:#e9e5ee;color:#513a91;font:13px ui-monospace,SFMono-Regular,Menlo,monospace}.markdown ul,.markdown ol{padding-left:25px;margin:0 0 24px}.markdown li{margin:7px 0;color:#4f4a55}.markdown blockquote{margin:25px 0;padding:18px 20px;border-left:3px solid var(--purple);background:#ebe7f1;color:#514b5a}.markdown hr{border:0;border-top:1px solid var(--line);margin:55px 0}.code-block{margin:25px 0;border-radius:11px;overflow:hidden;background:#111019;box-shadow:0 20px 50px rgba(20,15,30,.12)}.code-block>div{display:flex;justify-content:space-between;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.1);color:#8e8795;font-size:11px}.code-block button{border:0;background:transparent;color:#c5b7fc;cursor:pointer}.code-block pre{margin:0;padding:20px;overflow:auto;color:#f0edf5;font:13px/1.75 ui-monospace,SFMono-Regular,Menlo,monospace}.code-block code{padding:0;background:transparent;color:inherit}.table-wrap{overflow:auto;margin:24px 0;border:1px solid var(--line);border-radius:9px}.table-wrap table{width:100%;border-collapse:collapse;background:rgba(255,255,255,.5);font-size:13px}.table-wrap th,.table-wrap td{text-align:left;padding:12px 14px;border-bottom:1px solid var(--line);vertical-align:top}.table-wrap th{background:#e9e5ed}.article-end{display:grid;gap:5px;max-width:800px;margin-top:35px;padding:27px;border-radius:12px;background:var(--night);color:#fff}.article-end span{color:#aaa4b0}.article-end a{color:#c6b6ff;font-weight:700;margin-top:10px}footer{display:flex;justify-content:space-between;gap:20px;padding:28px max(24px,calc((100vw - 1280px)/2));background:#0f0d14;color:#89838f;font-size:12px}footer a{color:#c3b8df}@media(max-width:860px){header nav a:not(.active){display:none}.layout{display:block;padding-top:25px}.layout aside{display:none}.mobile-nav{display:block;margin:20px;border:1px solid var(--line);border-radius:9px;padding:13px 15px}.mobile-nav summary{font-weight:750;cursor:pointer}.mobile-nav .nav-home{margin-top:15px}.path-grid,.doc-cards{grid-template-columns:1fr}.path-grid a{min-height:190px}.docs-hero{padding-top:35px}.docs-hero h1{font-size:49px}footer{display:block}footer span{display:block;margin:5px 0}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important}}
`;
