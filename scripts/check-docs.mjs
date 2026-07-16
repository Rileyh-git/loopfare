import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([".git", "node_modules", "dist"]);

function markdownFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(path));
    else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") files.push(path);
  }
  return files;
}

const failures = [];
const files = markdownFiles(root);
const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;

for (const file of files) {
  const content = readFileSync(file, "utf8");
  const fences = content.match(/^```/gm)?.length ?? 0;
  if (fences % 2 !== 0) failures.push(`${file}: unbalanced fenced code block`);

  for (const match of content.matchAll(linkPattern)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, "");
    if (
      !rawTarget ||
      rawTarget.startsWith("#") ||
      rawTarget.startsWith("/") ||
      /^[a-z][a-z0-9+.-]*:/i.test(rawTarget)
    ) {
      continue;
    }
    const relativeTarget = decodeURIComponent(rawTarget.split(/[?#]/, 1)[0]);
    const target = resolve(dirname(file), relativeTarget);
    if (!existsSync(target) || (!statSync(target).isFile() && !statSync(target).isDirectory())) {
      failures.push(`${file}: missing relative link target ${rawTarget}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Verified ${files.length} Markdown files and their relative links.`);
