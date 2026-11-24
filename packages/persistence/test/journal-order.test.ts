// The journal-order judgment of `check:migrations`: every journal `when` sits
// above the one before it, or drizzle skips the later entry for good on a
// database already migrated past the earlier one; every `idx` is its position.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  collectJournalOrderOffenders,
  findJournalIndexOffenders,
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

describe("findJournalIndexOffenders", () => {
  it("passes a journal whose idx values count up from zero", () => {
    const entries = [
      { idx: 0, tag: "0000_a" },
      { idx: 1, tag: "0001_b" },
    ];

    expect(findJournalIndexOffenders(entries)).toEqual([]);
  });

  it("names an entry whose idx skips a position", () => {
    const entries = [
      { idx: 0, tag: "0000_a" },
      { idx: 2, tag: "0002_b" },
    ];

    expect(findJournalIndexOffenders(entries)).toEqual([
      { tag: "0002_b", idx: 2, expectedIdx: 1 },
    ]);
  });

  it("names a repeated idx and a journal not starting at zero", () => {
    const entries = [
      { idx: 1, tag: "0001_a" },
      { idx: 1, tag: "0001_b" },
    ];

    expect(findJournalIndexOffenders(entries)).toEqual([
      { tag: "0001_a", idx: 1, expectedIdx: 0 },
    ]);
  });
});

describe("collectJournalOrderOffenders", () => {
  it("refuses a journal it cannot parse", () => {
    const dir = makeMigrationsDir('{"entries":[{"tag":"0001_a"}]}');

    expect(collectJournalOrderOffenders(dir)).toMatchObject({ ok: false });
  });

  it("refuses a journal entry without an idx", () => {
    const dir = makeMigrationsDir('{"entries":[{"tag":"0000_a","when":10}]}');

    expect(collectJournalOrderOffenders(dir)).toMatchObject({ ok: false });
  });

  it("reports when and idx offenders from one journal", () => {
    const dir = makeMigrationsDir(
      JSON.stringify({
        entries: [
          { idx: 0, tag: "0000_a", when: 20 },
          { idx: 2, tag: "0001_b", when: 10 },
        ],
      }),
    );

    expect(collectJournalOrderOffenders(dir)).toEqual({
      ok: true,
      value: {
        order: [
          { tag: "0001_b", when: 10, previousTag: "0000_a", previousWhen: 20 },
        ],
        index: [{ tag: "0001_b", idx: 2, expectedIdx: 1 }],
      },
    });
  });

  it("holds the checked-in journal rising and sequential", () => {
    expect(collectJournalOrderOffenders(MIGRATIONS_DIR)).toEqual({
      ok: true,
      value: { order: [], index: [] },
    });
  });
});
