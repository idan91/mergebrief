import {
  compareSemver,
  formatSemver,
  parseSemver,
  type Semver,
} from "persistence";
import type { Mutable, Result } from "types/utils";
import {
  BOOT_DELAY_MS,
  DEV_VERSIONS,
  FETCH_TIMEOUT_MS,
  MAX_MANIFEST_BYTES,
  MAX_SNAPSHOT_AGE_MS,
} from "./consts";
import { deriveGapFlags, parseVersionManifest } from "./logic/gap";
import type {
  UpdateCheck,
  UpdateCheckDeps,
  VersionManifest,
  VersionSnapshot,
} from "./types";

export type { UpdateCheck, UpdateCheckDeps, VersionSnapshot } from "./types";

interface CachedAnswer {
  readonly snapshot: VersionSnapshot;
  readonly checkedAtMs: number;
}

/** The body as text, or `undefined` once it passes `maxBytes`; the rest is cancelled. */
async function readBoundedText(
  response: Response,
  maxBytes: number,
): Promise<string | undefined> {
  if (response.body === null) {
    return "";
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      return undefined;
    }
    chunks.push(chunk);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * `latest` and the flags appear only when the manifest is ahead of the
 * instance, and `latest` is the canonical triple, never the manifest's own
 * spelling: the band and the dismissal compare it by string.
 */
function shapeSnapshot(
  serverVersion: string,
  running: Semver,
  latest: Semver,
  manifest: VersionManifest,
  checkedAt: Date,
): VersionSnapshot {
  const snapshot: Mutable<VersionSnapshot> = {
    version: serverVersion,
    checkedAt: checkedAt.toISOString(),
  };
  const behind = compareSemver(latest, running) > 0;
  if (!behind) {
    return snapshot;
  }

  const flags = deriveGapFlags(running, latest, manifest.releases);
  snapshot.latest = formatSemver(latest);
  snapshot.breaking = flags.breaking;
  snapshot.security = flags.security;
  if (manifest.releaseNotesUrl !== undefined) {
    snapshot.releaseNotesUrl = manifest.releaseNotesUrl;
  }
  return snapshot;
}

/** A fixed reason on failure: the SyntaxError message would quote the body. */
function parseJson(text: string): Result<unknown, string> {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: "manifest is not json" };
  }
}

/** The release check for one API process: at most one fetch an hour, one log line per new release. */
export function createUpdateCheck(deps: UpdateCheckDeps): UpdateCheck {
  const runningParse = parseSemver(deps.serverVersion);
  const running = runningParse.ok ? runningParse.value : undefined;
  const active =
    deps.enabled &&
    running !== undefined &&
    !DEV_VERSIONS.has(deps.serverVersion);
  const bootDelayMs = deps.bootDelayMs ?? BOOT_DELAY_MS;

  let cached: CachedAnswer | undefined;
  let lastAttemptMs: number | undefined;
  let inFlight: Promise<void> | undefined;
  let bootTimer: NodeJS.Timeout | undefined;
  let announcedLatest: string | undefined;
  let failureAnnounced = false;

  function announce(snapshot: VersionSnapshot): void {
    if (snapshot.latest === undefined || announcedLatest === snapshot.latest) {
      return;
    }
    announcedLatest = snapshot.latest;
    const fields = {
      evt: "update.available",
      current: deps.serverVersion,
      latest: snapshot.latest,
      breaking: snapshot.breaking ?? false,
      security: snapshot.security ?? false,
      releaseNotesUrl: snapshot.releaseNotesUrl,
    };
    if (snapshot.security === true) {
      deps.log.warn(
        "a newer MergeBrief release carries a security fix",
        fields,
      );
      return;
    }
    deps.log.info("a newer MergeBrief release is available", fields);
  }

  function reportFailure(err: string): void {
    const fields = { evt: "update.check.fail", err };
    if (failureAnnounced) {
      deps.log.debug("update check failed", fields);
      return;
    }
    failureAnnounced = true;
    deps.log.info("update check failed", fields);
  }

  async function fetchManifest(): Promise<VersionManifest | undefined> {
    const response = await deps.fetch(deps.url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      reportFailure(`http ${response.status}`);
      return undefined;
    }
    const text = await readBoundedText(response, MAX_MANIFEST_BYTES);
    if (text === undefined) {
      reportFailure("manifest too large");
      return undefined;
    }
    const body = parseJson(text);
    if (!body.ok) {
      reportFailure(body.error);
      return undefined;
    }
    const manifest = parseVersionManifest(body.value);
    if (!manifest.ok) {
      reportFailure(manifest.error);
      return undefined;
    }
    return manifest.value;
  }

  async function runRefresh(): Promise<void> {
    if (!active || running === undefined) {
      return;
    }
    let manifest: VersionManifest | undefined;
    try {
      manifest = await fetchManifest();
    } catch (error) {
      reportFailure(error instanceof Error ? error.message : "unknown");
      return;
    }
    if (manifest === undefined) {
      return;
    }

    const latest = parseSemver(manifest.latest);
    if (!latest.ok) {
      reportFailure("latest is not a version");
      return;
    }
    const checkedAt = new Date();
    const snapshot = shapeSnapshot(
      deps.serverVersion,
      running,
      latest.value,
      manifest,
      checkedAt,
    );
    cached = { snapshot, checkedAtMs: checkedAt.getTime() };
    announce(snapshot);
  }

  function refresh(): Promise<void> {
    if (inFlight === undefined) {
      lastAttemptMs = Date.now();
      inFlight = runRefresh().finally(() => {
        inFlight = undefined;
      });
    }
    return inFlight;
  }

  return {
    start() {
      if (!active || bootTimer !== undefined) {
        return;
      }
      bootTimer = setTimeout(() => {
        bootTimer = undefined;
        void refresh();
      }, bootDelayMs);
      bootTimer.unref();
    },
    stop() {
      if (bootTimer !== undefined) {
        clearTimeout(bootTimer);
        bootTimer = undefined;
      }
    },
    refresh,
    snapshot() {
      const attemptDue =
        lastAttemptMs !== undefined &&
        Date.now() - lastAttemptMs > MAX_SNAPSHOT_AGE_MS;
      if (attemptDue) {
        void refresh();
      }
      return cached?.snapshot ?? { version: deps.serverVersion };
    },
  };
}
