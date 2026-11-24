import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { Result } from "types/utils";
import { z } from "zod/v4";

const storeSchema = z.object({ replyIds: z.array(z.number()) });

/**
 * Replies this tool posted. Both agents and the maintainer post under one login,
 * so a recorded id is the only proof that a thread's last word is an answer.
 */
export function readReplyIds(storePath: string): Result<Set<number>, Error> {
  if (!existsSync(storePath)) {
    return { ok: true, value: new Set() };
  }
  try {
    const parsed = storeSchema.safeParse(
      JSON.parse(readFileSync(storePath, "utf8")),
    );
    if (!parsed.success) {
      return {
        ok: false,
        error: new Error(`reply store ${storePath} is malformed`),
      };
    }
    return { ok: true, value: new Set(parsed.data.replyIds) };
  } catch (error) {
    return {
      ok: false,
      error: new Error(
        `reply store ${storePath} is unreadable: ${String(error)}`,
      ),
    };
  }
}

const LOCK_WAIT_MS = 25;
const LOCK_ATTEMPTS = 80;
const STALE_LOCK_MS = 10_000;

/** An exclusive lock file beside the store; one left by a crashed writer expires. */
function withStoreLock<Value>(
  storePath: string,
  work: () => Result<Value, Error>,
): Result<Value, Error> {
  const lockPath = `${storePath}.lock`;
  mkdirSync(dirname(storePath), { recursive: true });
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      closeSync(openSync(lockPath, "wx"));
    } catch {
      const age =
        Date.now() -
        (statSync(lockPath, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
      if (age > STALE_LOCK_MS) {
        rmSync(lockPath, { force: true });
      } else {
        Atomics.wait(
          new Int32Array(new SharedArrayBuffer(4)),
          0,
          0,
          LOCK_WAIT_MS,
        );
      }
      continue;
    }
    try {
      return work();
    } finally {
      rmSync(lockPath, { force: true });
    }
  }
  return {
    ok: false,
    error: new Error(`reply store ${storePath} is locked by another writer`),
  };
}

/** Read-modify-write under the lock, then an atomic rename, so a reader never sees a half-written store. */
export function recordReply(
  storePath: string,
  replyId: number,
): Result<void, Error> {
  return withStoreLock(storePath, () => {
    const current = readReplyIds(storePath);
    if (!current.ok) {
      return current;
    }
    current.value.add(replyId);
    const replyIds = [...current.value].toSorted((left, right) => left - right);
    const temporary = `${storePath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ replyIds }, undefined, 2)}\n`);
    renameSync(temporary, storePath);
    return { ok: true, value: undefined };
  });
}
