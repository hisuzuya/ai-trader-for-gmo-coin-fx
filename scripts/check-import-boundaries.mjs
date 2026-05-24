import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);
const importPattern =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?["']([^"']+)["']|import\(["']([^"']+)["']\)/g;

const rules = [
  {
    label: "packages/domain must not depend on internal packages or apps",
    dir: "packages/domain/src",
    forbidden: [
      /^@ai-trade\/(?:db|config|web|worker)(?:\/|$)/,
      /^@\/?/,
      /^\.\.\/\.\.\/(?:db|config|apps)\//,
    ],
  },
  {
    label: "apps/web must not import apps/worker",
    dir: "apps/web/src",
    forbidden: [/^@ai-trade\/worker(?:\/|$)/, /apps\/worker/],
  },
  {
    label: "apps/worker must not import apps/web",
    dir: "apps/worker/src",
    forbidden: [/^@ai-trade\/web(?:\/|$)/, /apps\/web/],
  },
  {
    label: "packages/db must not import apps",
    dir: "packages/db/src",
    forbidden: [/^@ai-trade\/(?:web|worker)(?:\/|$)/, /apps\//],
  },
  {
    label: "packages/config must not depend on internal packages or apps",
    dir: "packages/config/src",
    forbidden: [/^@ai-trade\//, /apps\//, /packages\//],
  },
];

const failures = [];

for (const rule of rules) {
  for (const file of await listSourceFiles(path.join(root, rule.dir))) {
    const content = await readFile(file, "utf8");

    for (const match of content.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2];

      if (rule.forbidden.some((pattern) => pattern.test(specifier))) {
        failures.push(
          `${rule.label}: ${path.relative(root, file)} imports ${specifier}`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

async function listSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(fullPath)));
      continue;
    }

    if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}
