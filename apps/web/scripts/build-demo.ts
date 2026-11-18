// Builds the hosted demo and lays it out for a static host: the client build
// becomes the folder root, the shell is copied to the demo route and to
// `404.html`, the build-time server bundle is dropped, and `_headers` keeps
// every page out of search indexes.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { FIXTURE_PR_PATH } from "../e2e/fixtures/ids";
import { DEMO_OUT_DIR, DEMO_SHELL_PAGE } from "../vite.demo.config";

const webDir = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(webDir, DEMO_OUT_DIR);
const clientDir = join(outDir, "client");
const serverDir = join(outDir, "server");
const shellFile = `${DEMO_SHELL_PAGE}.html`;
const NOT_FOUND_FILE = "404.html";
const ROUTE_INDEX_FILE = "index.html";
const HEADERS_FILE = "_headers";
/** Cloudflare's static-asset header rules: every path, never indexed. */
const NO_INDEX_HEADERS = "/*\n  X-Robots-Tag: noindex\n";
const VITE_CONFIG = "vite.demo.config.ts";
/** Every address the demo can land on with a full page load. */
const ROUTE_PATHS = [FIXTURE_PR_PATH, "/settings"];

function runViteBuild(): void {
  const result = spawnSync(
    "pnpm",
    ["exec", "vite", "build", "--config", VITE_CONFIG],
    { cwd: webDir, stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(`vite build exited with ${String(result.status)}`);
  }
}

/** The client build becomes the folder a host serves; the shell render's server bundle goes. */
function flattenClientBuild(): void {
  cpSync(clientDir, outDir, { recursive: true });
  rmSync(clientDir, { recursive: true, force: true });
  rmSync(serverDir, { recursive: true, force: true });
}

/** The shell at every address the demo opens on, for hosts without an SPA fallback. */
function copyShellToRoutes(): void {
  const shell = join(outDir, shellFile);
  copyFileSync(shell, join(outDir, NOT_FOUND_FILE));

  for (const routePath of ROUTE_PATHS) {
    const segments = routePath.split("/").filter(Boolean);
    const routeDir = join(outDir, ...segments);
    mkdirSync(routeDir, { recursive: true });
    copyFileSync(shell, join(routeDir, ROUTE_INDEX_FILE));
  }
}

function writeNoIndexHeaders(): void {
  writeFileSync(join(outDir, HEADERS_FILE), NO_INDEX_HEADERS);
}

function main(): void {
  rmSync(outDir, { recursive: true, force: true });
  runViteBuild();
  flattenClientBuild();
  copyShellToRoutes();
  writeNoIndexHeaders();
  console.info(`demo built: ${outDir}`);
}

main();
