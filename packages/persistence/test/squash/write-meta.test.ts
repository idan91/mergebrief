// The squashed folder's meta files: a one-entry journal that drizzle's
// migrator treats as already applied on a database at the chain tip, and a
// snapshot that must match the chain's latest, so a schema the baseline
// freezes is the schema the code declares.
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { generateDrizzleJson } from "drizzle-kit/api";
import { describe, expect, it } from "vitest";
import {
  applyProofVerdict,
  buildBaselineSnapshot,
  buildJournal,
  compareSnapshots,
  readJournal,
  readLastEntry,
  writeSquashedFolder,
} from "../../scripts/squash/logic/write-meta";
import {
  ProofStepNames,
  SquashModes,
  SquashOutcomes,
  type JournalEntry,
  type ProofReport,
  type SquashedFolder,
} from "../../scripts/squash/types";
import { CREATE_FIRST, makeScratchDir, writeChainFixture } from "./helpers";

const LAST_CHAIN_ENTRY: JournalEntry = {
  idx: 70,
  version: "7",
  when: 1792878123045,
  tag: "0070_awaits-recovery",
  breakpoints: true,
};

describe("buildJournal", () => {
  it("holds one entry stamped with the last chain when", () => {
    expect(buildJournal(LAST_CHAIN_ENTRY)).toEqual({
      version: "7",
      dialect: "postgresql",
      entries: [
        {
          idx: 0,
          version: "7",
          when: 1792878123045,
          tag: "0000_baseline",
          breakpoints: true,
        },
      ],
    });
  });
});

describe("readJournal", () => {
  function stubJournalDir(text: string): string {
    const dir = makeScratchDir("squash-journal-");
    mkdirSync(join(dir, "meta"));
    writeFileSync(join(dir, "meta", "_journal.json"), text);
    return dir;
  }

  it("refuses a journal that is not JSON", () => {
    const dir = stubJournalDir("{ not json");

    expect(readJournal(dir).ok).toBe(false);
  });

  it("refuses JSON that is not a journal", () => {
    const dir = stubJournalDir(JSON.stringify({ entries: "none" }));

    expect(readJournal(dir).ok).toBe(false);
  });

  it("reads a well-formed journal", () => {
    const journal = buildJournal(LAST_CHAIN_ENTRY);
    const dir = stubJournalDir(JSON.stringify(journal));

    expect(readJournal(dir)).toEqual({ ok: true, value: journal });
  });
});

describe("readLastEntry", () => {
  it("refuses a journal with no entries", () => {
    const empty = { version: "7", dialect: "postgresql", entries: [] };

    expect(readLastEntry(empty)).toEqual({
      ok: false,
      error: "the migrations journal holds no entries",
    });
  });
});

describe("buildBaselineSnapshot", () => {
  it("starts the snapshot chain from the zero id", async () => {
    const snapshot = await buildBaselineSnapshot();

    expect(snapshot.prevId).toBe("00000000-0000-0000-0000-000000000000");
    expect(snapshot.dialect).toBe("postgresql");
    expect(Object.keys(snapshot.tables)).toContain("public.pull_request");
  });
});

describe("compareSnapshots", () => {
  const base = {
    id: "a",
    prevId: "b",
    tables: {
      "public.t": {
        columns: { id: { name: "id", type: "bigint", notNull: true } },
      },
    },
  };

  it("ignores id and prevId", () => {
    const other = { ...base, id: "x", prevId: "y" };

    expect(compareSnapshots(base, other)).toEqual({ equal: true, drift: [] });
  });

  it("names a changed column by its path", () => {
    const other = {
      ...base,
      tables: {
        "public.t": {
          columns: { id: { name: "id", type: "integer", notNull: true } },
        },
      },
    };

    expect(compareSnapshots(base, other)).toEqual({
      equal: false,
      drift: ["tables.public.t.columns.id.type"],
    });
  });

  it("names a table one side lacks", () => {
    const other = { ...base, tables: {} };

    expect(compareSnapshots(base, other).drift).toEqual(["tables.public.t"]);
  });
});

describe("applyProofVerdict", () => {
  const PROVEN: ProofReport = { ok: true, steps: [] };
  const FAILED: ProofReport = {
    ok: false,
    steps: [{ name: ProofStepNames.DUMP_DIFF, ok: false, detail: "differs" }],
  };

  function stubSquashed(): SquashedFolder {
    const dir = makeScratchDir("squash-squashed-");
    const journal = buildJournal(LAST_CHAIN_ENTRY);
    return writeSquashedFolder(
      dir,
      CREATE_FIRST,
      journal,
      generateDrizzleJson({}),
    );
  }

  function stubMigrationsDir(): string {
    const dir = makeScratchDir("squash-drizzle-");
    writeChainFixture(dir);
    return dir;
  }

  function readFolderFiles(dir: string): Record<string, string> {
    const files: Record<string, string> = {};
    const names = readdirSync(dir, { recursive: true, encoding: "utf8" });
    for (const name of names.toSorted()) {
      const path = join(dir, name);
      if (statSync(path).isFile()) {
        files[name] = readFileSync(path, "utf8");
      }
    }
    return files;
  }

  it("leaves the folder untouched when a proof leg failed", () => {
    const target = stubMigrationsDir();
    const before = readFolderFiles(target);

    const outcome = applyProofVerdict(
      SquashModes.WRITE,
      FAILED,
      target,
      stubSquashed(),
    );

    expect(outcome).toBe(SquashOutcomes.PROOF_FAILED);
    expect(readFolderFiles(target)).toEqual(before);
  });

  it("leaves the folder untouched under --check", () => {
    const target = stubMigrationsDir();
    const before = readFolderFiles(target);

    const outcome = applyProofVerdict(
      SquashModes.CHECK,
      PROVEN,
      target,
      stubSquashed(),
    );

    expect(outcome).toBe(SquashOutcomes.CHECKED);
    expect(readFolderFiles(target)).toEqual(before);
  });

  it("replaces the chain with exactly the three squashed files", () => {
    const target = stubMigrationsDir();
    const squashed = stubSquashed();

    const outcome = applyProofVerdict(
      SquashModes.WRITE,
      PROVEN,
      target,
      squashed,
    );

    expect(outcome).toBe(SquashOutcomes.WRITTEN);
    expect(readFolderFiles(target)).toEqual({
      "0000_baseline.sql": readFileSync(squashed.sqlFile, "utf8"),
      "meta/0000_snapshot.json": readFileSync(squashed.snapshotFile, "utf8"),
      "meta/_journal.json": readFileSync(squashed.journalFile, "utf8"),
    });
  });
});
