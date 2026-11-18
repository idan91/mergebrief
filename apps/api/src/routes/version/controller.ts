// Hono-free. The release snapshot plus the viewer's own dismissal, and the
// dismissal write, which takes only the latest release the check knows of
// and never a security release.
import type { VersionResponse } from "contract";
import {
  createUserSettingsStore,
  formatSemver,
  parseSemver,
} from "persistence";
import type { Mutable, Result } from "types/utils";
import {
  DismissRefusals,
  type DismissRefusal,
  type DismissVersionInput,
  type ReadVersionInput,
  type VersionControllerDeps,
} from "./types";

async function readVersion(
  deps: VersionControllerDeps,
  input: ReadVersionInput,
): Promise<VersionResponse> {
  const dismissedVersion = await createUserSettingsStore(
    deps.handle,
  ).readDismissedVersion(input.reviewerId);

  const response: Mutable<VersionResponse> = { ...deps.readSnapshot() };
  if (dismissedVersion !== undefined) {
    response.dismissedVersion = dismissedVersion;
  }
  return response;
}

async function dismissVersion(
  deps: VersionControllerDeps,
  input: DismissVersionInput,
): Promise<Result<undefined, DismissRefusal>> {
  const snapshot = deps.readSnapshot();
  const parsed = parseSemver(input.version);
  if (!parsed.ok) {
    return { ok: false, error: DismissRefusals.NOT_LATEST };
  }
  const version = formatSemver(parsed.value);
  const isLatest = snapshot.latest !== undefined && snapshot.latest === version;
  if (!isLatest) {
    return { ok: false, error: DismissRefusals.NOT_LATEST };
  }
  if (snapshot.security === true) {
    return { ok: false, error: DismissRefusals.SECURITY_RELEASE };
  }

  await createUserSettingsStore(deps.handle).setDismissedVersion(
    input.reviewerId,
    version,
  );
  return { ok: true, value: undefined };
}

export const versionController = { readVersion, dismissVersion };
