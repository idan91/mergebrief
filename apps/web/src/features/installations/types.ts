// Shapes + boundary guards for the /api/auth/installations endpoints.
import type { Result as SharedResult } from "types/utils";

type Result<T> = SharedResult<T, string>;

export interface InstallationOption {
  readonly installationId: string;
  readonly accountLogin: string;
  readonly isCurrent: boolean;
  readonly isDefault: boolean;
}

export interface InstallationsView {
  readonly installations: InstallationOption[];
  readonly currentInstallationId: string;
  readonly defaultInstallationId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOption(value: unknown): Result<InstallationOption> {
  if (!isRecord(value))
    return { ok: false, error: "installation must be an object" };
  if (typeof value["installationId"] !== "string") {
    return { ok: false, error: "installationId must be a string" };
  }
  if (typeof value["accountLogin"] !== "string") {
    return { ok: false, error: "accountLogin must be a string" };
  }
  if (
    typeof value["isCurrent"] !== "boolean" ||
    typeof value["isDefault"] !== "boolean"
  ) {
    return { ok: false, error: "isCurrent/isDefault must be booleans" };
  }
  return {
    ok: true,
    value: {
      installationId: value["installationId"],
      accountLogin: value["accountLogin"],
      isCurrent: value["isCurrent"],
      isDefault: value["isDefault"],
    },
  };
}

export function parseInstallationsView(
  value: unknown,
): Result<InstallationsView> {
  if (!isRecord(value) || !Array.isArray(value["installations"])) {
    return { ok: false, error: "response must carry installations[]" };
  }
  if (typeof value["currentInstallationId"] !== "string") {
    return { ok: false, error: "currentInstallationId must be a string" };
  }
  const defaultId = value["defaultInstallationId"];
  if (defaultId !== null && typeof defaultId !== "string") {
    return {
      ok: false,
      error: "defaultInstallationId must be a string or null",
    };
  }
  const installations: InstallationOption[] = [];
  for (const item of value["installations"]) {
    const parsed = parseOption(item);
    if (!parsed.ok) return parsed;
    installations.push(parsed.value);
  }
  return {
    ok: true,
    value: {
      installations,
      currentInstallationId: value["currentInstallationId"],
      defaultInstallationId: defaultId,
    },
  };
}
