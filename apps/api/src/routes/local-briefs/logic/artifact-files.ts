import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "logging";
import type { Result } from "types/utils";
import { LocalBriefsFailureKinds, type LocalBriefsFailure } from "../types";

const NOT_FOUND_FAILURE: LocalBriefsFailure = {
  kind: LocalBriefsFailureKinds.NOT_FOUND,
};
const UNREADABLE_FAILURE: LocalBriefsFailure = {
  kind: LocalBriefsFailureKinds.UNREADABLE,
};

function isMissingFile(error: unknown): boolean {
  const missing =
    error instanceof Error && "code" in error && error.code === "ENOENT";
  return missing;
}

export function isNotFound(read: Result<unknown, LocalBriefsFailure>): boolean {
  const notFound =
    !read.ok && read.error.kind === LocalBriefsFailureKinds.NOT_FOUND;
  return notFound;
}

/** A missing file is `not-found`; any other failure is logged and `unreadable`. */
export async function readArtifactFile(
  dir: string,
  name: string,
  log: Logger,
): Promise<Result<string, LocalBriefsFailure>> {
  try {
    const text = await readFile(join(dir, name), "utf8");
    return { ok: true, value: text };
  } catch (error) {
    if (isMissingFile(error)) {
      return { ok: false, error: NOT_FOUND_FAILURE };
    }
    log.warn("local brief artifact unreadable", { err: error, artifact: name });
    return { ok: false, error: UNREADABLE_FAILURE };
  }
}

/** The first of `names`, in order, that exists. */
export async function readFirstArtifactFile(
  dir: string,
  names: readonly string[],
  log: Logger,
): Promise<Result<string, LocalBriefsFailure>> {
  const reads = await Promise.all(
    names.map((name) => readArtifactFile(dir, name, log)),
  );
  const found = reads.find((read) => !isNotFound(read));
  return found ?? { ok: false, error: NOT_FOUND_FAILURE };
}

/** The value stays `unknown`: the wire's reader parses it. */
export function parseArtifactJson(
  text: string,
  name: string,
  log: Logger,
): Result<unknown, LocalBriefsFailure> {
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch (error) {
    log.warn("local brief artifact is not JSON", {
      err: error,
      artifact: name,
    });
    return { ok: false, error: UNREADABLE_FAILURE };
  }
}

/** A directory that does not exist yet holds zero local briefs. */
export async function listArtifactNames(
  dir: string,
  log: Logger,
): Promise<Result<readonly string[], LocalBriefsFailure>> {
  try {
    const names = await readdir(dir);
    return { ok: true, value: names };
  } catch (error) {
    if (isMissingFile(error)) {
      return { ok: true, value: [] };
    }
    log.warn("local brief directory unreadable", { err: error });
    return { ok: false, error: UNREADABLE_FAILURE };
  }
}
