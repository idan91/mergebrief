import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

export function recordReply(
  storePath: string,
  replyId: number,
): Result<void, Error> {
  const current = readReplyIds(storePath);
  if (!current.ok) {
    return current;
  }
  current.value.add(replyId);

  mkdirSync(dirname(storePath), { recursive: true });
  const replyIds = [...current.value].toSorted((left, right) => left - right);
  writeFileSync(storePath, `${JSON.stringify({ replyIds }, undefined, 2)}\n`);
  return { ok: true, value: undefined };
}
