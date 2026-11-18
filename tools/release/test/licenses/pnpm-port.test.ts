import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseLicenseListing } from "../../src/logic/licenses";
import { createPnpmLicensesPort } from "../../src/logic/licenses/pnpm-port";

const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

const PNPM_TIMEOUT_MS = 60_000;

describe("the pnpm licenses port", () => {
  it(
    "lists the CLI bundle's inlined dependencies from the workspace",
    () => {
      const raw = createPnpmLicensesPort(REPO_ROOT).listProductionLicenses();

      const listing = parseLicenseListing(raw);

      expect(listing.ok).toBe(true);
      const names = listing.ok ? listing.value.map((pkg) => pkg.name) : [];
      expect(names).toContain("commander");
      expect(names).toContain("zod");
    },
    PNPM_TIMEOUT_MS,
  );
});
