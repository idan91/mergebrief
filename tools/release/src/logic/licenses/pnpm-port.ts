import { execFileSync } from "node:child_process";

import type { LicensesPort } from "./types";

const LISTING_MAX_BYTES = 64 * 1024 * 1024;

/** The one file that spawns pnpm; `--prod` is the graph the Image installs and the CLI bundle inlines. */
export function createPnpmLicensesPort(repoRoot: string): LicensesPort {
  return {
    listProductionLicenses() {
      return execFileSync("pnpm", ["licenses", "list", "--json", "--prod"], {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: LISTING_MAX_BYTES,
        stdio: ["ignore", "pipe", "inherit"],
      });
    },
  };
}
