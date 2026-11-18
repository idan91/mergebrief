import { ELKJS_PACKAGE, LIBVIPS_PACKAGE_PREFIX } from "./consts";

const LIBVIPS_KEY = new RegExp(
  `^ {2}'?${LIBVIPS_PACKAGE_PREFIX.replace("/", "\\/")}[a-z0-9-]+@([^'(:\\s]+)`,
  "gm",
);
const ELKJS_KEY = new RegExp(`^ {2}'?${ELKJS_PACKAGE}@([^'(:\\s]+)`, "gm");

function readKeyVersions(lockfileText: string, key: RegExp): string[] {
  const versions = new Set<string>();
  for (const match of lockfileText.matchAll(key)) {
    const [, version] = match;
    if (version !== undefined) {
      versions.add(version);
    }
  }
  return [...versions].toSorted();
}

/** Each distinct version of the libvips platform builds the lockfile holds, sorted. */
export function readLockfileLibvipsVersions(lockfileText: string): string[] {
  return readKeyVersions(lockfileText, LIBVIPS_KEY);
}

/** Each distinct elkjs version the lockfile holds, sorted. */
export function readLockfileElkjsVersions(lockfileText: string): string[] {
  return readKeyVersions(lockfileText, ELKJS_KEY);
}
