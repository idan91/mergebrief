import { isInstallationId, type InstallationId } from "persistence";

/** Brand a caller-supplied installation id; `undefined` when it isn't a positive int. */
export function toInstallationId(
  raw: string | number,
): InstallationId | undefined {
  let value: bigint;
  if (typeof raw === "number") {
    if (!Number.isSafeInteger(raw)) {
      return undefined;
    }
    value = BigInt(raw);
  } else {
    if (!/^\d+$/.test(raw)) {
      return undefined;
    }
    value = BigInt(raw);
  }
  return isInstallationId(value) ? value : undefined;
}
