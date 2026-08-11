import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const catalogPath = `${packageDir}/locales/en.json`;
const outputPath = `${packageDir}/src/catalog.generated.ts`;

function parameterizedTree(value) {
  if (typeof value === "string") {
    return value.includes("{{") ? value : undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("en.json must be a nested object with string leaves");
  }

  const entries = Object.entries(value).flatMap(([key, child]) => {
    const parameterized = parameterizedTree(child);
    return parameterized === undefined ? [] : [[key, parameterized]];
  });
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function typeReference(path) {
  const root = path.length === 0 ? "typeof en" : "(typeof en)";
  return `${root}${path.map((key) => `[${JSON.stringify(key)}]`).join("")}`;
}

function propertyName(key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function renderOverrides(tree, path = [], depth = 0) {
  const indent = "  ".repeat(depth);
  const childIndent = "  ".repeat(depth + 1);
  const fields = Object.entries(tree).map(([key, value]) => {
    if (typeof value === "string") {
      return `${childIndent}${propertyName(key)}: ${JSON.stringify(value)};`;
    }
    return `${childIndent}${propertyName(key)}: ${renderOverrides(value, [...path, key], depth + 1)};`;
  });
  return `${typeReference(path)} & {\n${fields.join("\n")}\n${indent}}`;
}

const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const tree = parameterizedTree(catalog);
if (tree === undefined || typeof tree === "string") {
  throw new Error("en.json must contain parameterized nested catalog entries");
}

const generated = `// Generated from locales/en.json. Run pnpm generate:types after catalog changes.\nimport type en from "../locales/en.json";\n\nexport type Catalog = ${renderOverrides(tree)};\n`;

if (process.argv.includes("--check")) {
  const current = readFileSync(outputPath, "utf8");
  if (current !== generated) {
    throw new Error(
      "src/catalog.generated.ts is stale; run pnpm generate:types",
    );
  }
} else {
  writeFileSync(outputPath, generated);
}
