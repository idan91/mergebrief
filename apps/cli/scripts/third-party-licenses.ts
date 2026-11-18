import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "types/utils";
import { z } from "zod/v4";

interface BundledLicense {
  name: string;
  version: string;
  license: string;
  text: string;
}

const INSTALLED_PACKAGE_DIR = /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//;
const LICENSE_FILE = /^licen[cs]e(?:[.-]|$)/i;
const SECTION_RULE = "-".repeat(72);

const manifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  license: z.string().min(1).optional(),
});

export function getBundledPackageDirs(inputPaths: string[]): string[] {
  const packageDirs = new Set<string>();
  for (const inputPath of inputPaths) {
    const packageDir = INSTALLED_PACKAGE_DIR.exec(inputPath)?.[1];
    if (packageDir !== undefined) {
      packageDirs.add(packageDir);
    }
  }
  return [...packageDirs].toSorted();
}

function parseJson(text: string): Result<unknown, string> {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: reason };
  }
}

function readLicenseText(packageDir: string, fileName: string): string {
  const text = readFileSync(join(packageDir, fileName), "utf8");
  return text.trim();
}

export function readBundledLicense(
  packageDir: string,
): Result<BundledLicense, string> {
  const manifestText = readFileSync(join(packageDir, "package.json"), "utf8");
  const manifestJson = parseJson(manifestText);
  if (!manifestJson.ok) {
    return {
      ok: false,
      error: `${packageDir} has a malformed package.json: ${manifestJson.error}`,
    };
  }

  const manifest = manifestSchema.safeParse(manifestJson.value);
  if (!manifest.success) {
    return { ok: false, error: `${packageDir} has no name and version` };
  }

  const { name, version, license } = manifest.data;
  const licenseFiles = readdirSync(packageDir)
    .filter((fileName) => LICENSE_FILE.test(fileName))
    .toSorted();
  if (licenseFiles.length === 0) {
    return { ok: false, error: `${name}@${version} ships no license file` };
  }
  if (license === undefined) {
    return { ok: false, error: `${name}@${version} names no license` };
  }

  const text = licenseFiles
    .map((fileName) => readLicenseText(packageDir, fileName))
    .join("\n\n");
  return { ok: true, value: { name, version, license, text } };
}

export function formatThirdPartyLicenses(licenses: BundledLicense[]): string {
  const sections = licenses.map(
    ({ name, version, license, text }) =>
      `${SECTION_RULE}\n${name} ${version}\nLicense: ${license}\n\n${text}\n`,
  );
  return [
    "Third-party packages bundled into dist/mergebrief.js, with their license notices.\n",
    ...sections,
  ].join("\n");
}

export function buildThirdPartyLicenses(
  inputPaths: string[],
): Result<string, string[]> {
  const licenses: BundledLicense[] = [];
  const errors: string[] = [];
  for (const packageDir of getBundledPackageDirs(inputPaths)) {
    const read = readBundledLicense(packageDir);
    if (read.ok) {
      licenses.push(read.value);
    } else {
      errors.push(read.error);
    }
  }

  if (errors.length > 0) {
    return { ok: false, error: errors };
  }
  return { ok: true, value: formatThirdPartyLicenses(licenses) };
}
