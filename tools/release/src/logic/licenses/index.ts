import type { Result } from "types/utils";

import { type ExitCode, ExitCodes } from "../../types";
import { parseArgv } from "../argv";
import { classifyLicenses } from "./classify";
import { LicenseListingSchema } from "./schemas";
import type { LicensedPackage, LicensesCommandDeps } from "./types";

function formatPackage(pkg: LicensedPackage): string {
  return `${pkg.name}@${pkg.versions.join(",")} ${pkg.license}`;
}

/** The listing flattened to one entry per package, its license taken from the group pnpm put it in. */
export function parseLicenseListing(
  raw: string,
): Result<readonly LicensedPackage[], string> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "the license listing is not JSON" };
  }

  const parsed = LicenseListingSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: "the license listing is not the pnpm licenses shape",
    };
  }
  const packages = Object.entries(parsed.data).flatMap(([license, entries]) =>
    entries.map((entry) => ({
      name: entry.name,
      versions: entry.versions,
      license,
    })),
  );
  return { ok: true, value: packages };
}

/** `release licenses`: every production dependency's license is allowed or excepted by name. */
export function runLicenses(
  argv: readonly string[],
  deps: LicensesCommandDeps,
): ExitCode {
  const args = parseArgv(argv, { valued: [], boolean: [], maxPositionals: 0 });
  if (!args.ok) {
    deps.writeError(`release: ${args.error}; licenses takes no arguments\n`);
    return ExitCodes.USAGE;
  }

  const listing = parseLicenseListing(deps.port.listProductionLicenses());
  if (!listing.ok) {
    deps.writeError(`release: ${listing.error}\n`);
    return ExitCodes.REFUSED;
  }

  const verdict = classifyLicenses(listing.value);
  if (!verdict.ok) {
    for (const pkg of verdict.error) {
      deps.writeError(`release: license not allowed: ${formatPackage(pkg)}\n`);
    }
    return ExitCodes.REFUSED;
  }

  for (const pkg of verdict.value.excepted) {
    deps.writeOut(`release: excepted ${formatPackage(pkg)}: ${pkg.reason}\n`);
  }
  deps.writeOut(
    `release: ${verdict.value.checked} packages, every license allowed\n`,
  );
  return ExitCodes.OK;
}
