// drizzle applies a journal entry only when its `when` is above the newest
// `created_at` the database's ledger holds, so an entry at or below the one
// before it never applies on a database already migrated past that one. An
// `idx` off its position marks a hand-edited or badly merged journal.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "types/utils";
import { z } from "zod/v4";
import type {
  JournalEntry,
  JournalIndexOffender,
  JournalOffenders,
  JournalOrderOffender,
} from "./types";

const JournalSchema = z.object({
  entries: z.array(
    z.object({ idx: z.number().int(), tag: z.string(), when: z.number() }),
  ),
});

export function findJournalOrderOffenders(
  entries: readonly Pick<JournalEntry, "tag" | "when">[],
): JournalOrderOffender[] {
  const offenders: JournalOrderOffender[] = [];
  for (const [position, entry] of entries.entries()) {
    const previous = entries[position - 1];
    if (previous !== undefined && entry.when <= previous.when) {
      offenders.push({
        tag: entry.tag,
        when: entry.when,
        previousTag: previous.tag,
        previousWhen: previous.when,
      });
    }
  }
  return offenders;
}

export function findJournalIndexOffenders(
  entries: readonly Pick<JournalEntry, "idx" | "tag">[],
): JournalIndexOffender[] {
  const offenders: JournalIndexOffender[] = [];
  for (const [position, entry] of entries.entries()) {
    if (entry.idx !== position) {
      offenders.push({ tag: entry.tag, idx: entry.idx, expectedIdx: position });
    }
  }
  return offenders;
}

/** The entries of `dir/meta/_journal.json` out of order or off position, or why it did not parse. */
export function collectJournalOrderOffenders(
  dir: string,
): Result<JournalOffenders, string> {
  const text = readFileSync(join(dir, "meta", "_journal.json"), "utf8");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "meta/_journal.json is not JSON" };
  }

  const parsed = JournalSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }
  const { entries } = parsed.data;
  const offenders: JournalOffenders = {
    order: findJournalOrderOffenders(entries),
    index: findJournalIndexOffenders(entries),
  };
  return { ok: true, value: offenders };
}
