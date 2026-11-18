// `prepublishOnly`: a publish of the repo's `0.0.0` dev sentinel would ship a
// CLI that never checks for updates and never warns about skew, silently.
// The stamp step writes the tag's version into package.json before this
// runs, and the bundle must have been built after that stamp: tsup inlines
// the version at build, so a stale `dist/` carries the old number.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEV_SENTINEL = "0.0.0";
const BUNDLE_PATH = fileURLToPath(
  new URL("../dist/mergebrief.js", import.meta.url),
);

function readPackageVersion(): string {
  const pkg: { version: string } = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  return pkg.version;
}

/** What the built bundle prints for `--version`; absent without a build. */
function readBundleVersion(): string | undefined {
  if (!existsSync(BUNDLE_PATH)) {
    return undefined;
  }
  const printed = execFileSync(process.execPath, [BUNDLE_PATH, "--version"], {
    encoding: "utf8",
    env: { MERGEBRIEF_NO_VERSION_WARNING: "1" },
  });
  return printed.trim();
}

function refuse(reason: string): number {
  process.stderr.write(`refusing to publish mergebrief: ${reason}\n`);
  return 1;
}

function main(): number {
  const version = readPackageVersion();
  if (version === DEV_SENTINEL) {
    return refuse(
      `package.json holds the ${DEV_SENTINEL} sentinel; stamp the tag's version first`,
    );
  }
  const bundleVersion = readBundleVersion();
  if (bundleVersion === undefined) {
    return refuse("dist/mergebrief.js is missing; build after the stamp");
  }
  if (bundleVersion !== version) {
    return refuse(
      `dist/mergebrief.js prints ${bundleVersion} but package.json says ${version}; rebuild after the stamp`,
    );
  }
  process.stdout.write(`publishing mergebrief@${version}\n`);
  return 0;
}

process.exit(main());
