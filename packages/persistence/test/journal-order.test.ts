// The journal-order judgment of `check:migrations`: every journal `when` sits
// above the one before it, or drizzle skips the later entry for good on a
// database already migrated past the earlier one.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  collectJournalOrderOffenders,
  findJournalOrderOffenders,
} from "../scripts/journal-order";

const MIGRATIONS_DIR = fileURLToPath(new URL("../drizzle", import.meta.url));

function makeMigrationsDir(journal: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mb-journal-order-"));
  mkdirSync(join(dir, "meta"));
  writeFileSync(join(dir, "meta", "_journal.json"), journal);
  return dir;
}

describe("findJournalOrderOffenders", () => {
  it("passes a journal whose when values strictly increase", () => {
    const entries = [
      { tag: "0001_a", when: 10 },
      { tag: "0002_b", when: 20 },
    ];

    expect(findJournalOrderOffenders(entries)).toEqual([]);
  });

  it("names an entry whose when sits below the one before it", () => {
    const entries = [
      { tag: "0001_a", when: 10 },
      { tag: "0002_b", when: 30 },
      { tag: "0003_c", when: 20 },
      { tag: "0004_d", when: 40 },
    ];

    expect(findJournalOrderOffenders(entries)).toEqual([
      { tag: "0003_c", when: 20, previousTag: "0002_b", previousWhen: 30 },
    ]);
  });

  it("names an entry whose when equals the one before it", () => {
    const entries = [
      { tag: "0001_a", when: 10 },
      { tag: "0002_b", when: 10 },
    ];

    expect(findJournalOrderOffenders(entries)).toEqual([
      { tag: "0002_b", when: 10, previousTag: "0001_a", previousWhen: 10 },
    ]);
  });
});

describe("collectJournalOrderOffenders", () => {
  it("refuses a journal it cannot parse", () => {
    const dir = makeMigrationsDir('{"entries":[{"tag":"0001_a"}]}');

    expect(collectJournalOrderOffenders(dir)).toMatchObject({ ok: false });
  });

  it("holds the checked-in journal strictly increasing", () => {
    expect(collectJournalOrderOffenders(MIGRATIONS_DIR)).toEqual({
      ok: true,
      value: [],
    });
  });
});
