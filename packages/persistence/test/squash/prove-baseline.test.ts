// The proof legs that run without Docker: the PGlite apply, and the ledger
// and behind-tip verdicts over PGlite databases built from a fixture chain.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { generateDrizzleJson } from "drizzle-kit/api";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  buildBaselineSql,
  splitDumpStatements,
} from "../../scripts/squash/logic/build-baseline";
import { normalizeDump } from "../../scripts/squash/logic/dump-schema";
import {
  applyToPglite,
  judgeBehindTipRefusal,
  judgeLedgerContinuity,
  rewindChainByOne,
} from "../../scripts/squash/logic/prove-baseline";
import {
  buildJournal,
  readJournal,
  writeSquashedFolder,
} from "../../scripts/squash/logic/write-meta";
import type { LedgerState } from "../../scripts/squash/types";
import { MIGRATION_REPLAY_TIMEOUT_MS } from "../helpers";
import {
  CHAIN_JOURNAL,
  CHAIN_TIP,
  CREATE_FIRST,
  CREATE_SECOND,
  makeScratchDir,
  writeChainFixture,
} from "./helpers";

const CHAIN_WHEN = 1792878123045;

const SMALL_DUMP = [
  "SET statement_timeout = 0;",
  "SELECT pg_catalog.set_config('search_path', '', false);",
  "CREATE TABLE public.webhook_delivery (",
  "    signature_digest text NOT NULL,",
  "    received_at timestamp with time zone DEFAULT now() NOT NULL,",
  "    CONSTRAINT webhook_delivery_signature_digest_shape CHECK ((signature_digest ~ '^[0-9a-f]{64}$'::text))",
  ");",
  "ALTER TABLE ONLY public.webhook_delivery",
  "    ADD CONSTRAINT webhook_delivery_pkey PRIMARY KEY (signature_digest);",
  "CREATE INDEX webhook_delivery_received_at_idx ON public.webhook_delivery USING btree (received_at);",
  "",
].join("\n");

function buildSmallBaseline(): string {
  const scratch = makeScratchDir("squash-pglite-");

  const statements = splitDumpStatements(normalizeDump(SMALL_DUMP));
  if (!statements.ok) {
    throw new Error(statements.error);
  }
  const journal = buildJournal({
    idx: 70,
    version: "7",
    when: CHAIN_WHEN,
    tag: "0070_awaits-recovery",
    breakpoints: true,
  });
  const folder = writeSquashedFolder(
    scratch,
    buildBaselineSql(statements.value),
    journal,
    generateDrizzleJson({}),
  );
  return folder.dir;
}

describe("applyToPglite", { timeout: MIGRATION_REPLAY_TIMEOUT_MS }, () => {
  it("applies a built baseline and records it under the chain when", async () => {
    const folder = buildSmallBaseline();
    const client = new PGlite();
    onTestFinished(() => client.close());

    await applyToPglite(folder, client);

    const columns = await client.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'webhook_delivery' order by 1",
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "received_at",
      "signature_digest",
    ]);
    const ledger = await client.query<{ created_at: string }>(
      "select created_at from drizzle.__drizzle_migrations",
    );
    expect(ledger.rows.map((row) => Number(row.created_at))).toEqual([
      CHAIN_WHEN,
    ]);
  });
});

describe("judgeLedgerContinuity", () => {
  const TIP_LEDGER: LedgerState = { rows: 2, latest: CHAIN_TIP.when };

  it("refuses when the migrator added a ledger row", () => {
    const after = { ...TIP_LEDGER, rows: 3 };

    expect(judgeLedgerContinuity(TIP_LEDGER, after, CHAIN_TIP.when)).toEqual({
      ok: false,
      error: expect.stringContaining("wrote to a tip database's ledger"),
    });
  });

  it("refuses when the ledger's latest row moved", () => {
    const after = { ...TIP_LEDGER, latest: CHAIN_TIP.when + 1 };

    expect(judgeLedgerContinuity(TIP_LEDGER, after, CHAIN_TIP.when)).toEqual({
      ok: false,
      error: expect.stringContaining("wrote to a tip database's ledger"),
    });
  });

  it("refuses a baseline when newer than the ledger tip", () => {
    const newer = CHAIN_TIP.when + 1;

    expect(judgeLedgerContinuity(TIP_LEDGER, TIP_LEDGER, newer)).toEqual({
      ok: false,
      error: expect.stringContaining("a tip database would re-apply it"),
    });
  });

  it("passes an unchanged ledger at the baseline when", () => {
    const verdict = judgeLedgerContinuity(
      TIP_LEDGER,
      TIP_LEDGER,
      CHAIN_TIP.when,
    );

    expect(verdict.ok).toBe(true);
  });
});

describe("rewindChainByOne", () => {
  it("copies the chain without its newest entry and SQL", () => {
    const scratch = makeScratchDir("squash-rewind-");
    const chainDir = join(scratch, "chain");
    const behindDir = join(scratch, "behind");
    writeChainFixture(chainDir);

    const rewound = rewindChainByOne(chainDir, behindDir);

    expect(rewound).toEqual({ ok: true, value: CHAIN_TIP.tag });
    expect(readJournal(behindDir)).toEqual({
      ok: true,
      value: { ...CHAIN_JOURNAL, entries: CHAIN_JOURNAL.entries.slice(0, -1) },
    });
    expect(existsSync(join(behindDir, `${CHAIN_TIP.tag}.sql`))).toBe(false);
    expect(readJournal(chainDir)).toEqual({ ok: true, value: CHAIN_JOURNAL });
  });
});

describe(
  "baseline over a fixture chain",
  { timeout: MIGRATION_REPLAY_TIMEOUT_MS },
  () => {
    function buildFixtureBaseline(): string {
      const dir = makeScratchDir("squash-fixture-baseline-");
      const sql = buildBaselineSql([CREATE_FIRST, CREATE_SECOND]);
      const folder = writeSquashedFolder(
        dir,
        sql,
        buildJournal(CHAIN_TIP),
        generateDrizzleJson({}),
      );
      return folder.dir;
    }

    async function readPgliteLedger(client: PGlite): Promise<LedgerState> {
      const result = await client.query<{ rows: number; latest: string }>(
        "select count(*)::int as rows, max(created_at)::text as latest from drizzle.__drizzle_migrations",
      );
      const first = result.rows[0];
      return { rows: Number(first?.rows), latest: Number(first?.latest) };
    }

    async function makeMigratedClient(folder: string): Promise<PGlite> {
      const client = new PGlite();
      onTestFinished(() => client.close());
      await applyToPglite(folder, client);
      return client;
    }

    it("leaves a tip database's ledger unchanged", async () => {
      const chainDir = makeScratchDir("squash-fixture-chain-");
      writeChainFixture(chainDir);
      const baseline = buildFixtureBaseline();
      const client = await makeMigratedClient(chainDir);

      const before = await readPgliteLedger(client);
      await applyToPglite(baseline, client);
      const after = await readPgliteLedger(client);

      const verdict = judgeLedgerContinuity(before, after, CHAIN_TIP.when);
      expect(verdict.ok).toBe(true);
    });

    it("refuses a database behind the tip", async () => {
      const scratch = makeScratchDir("squash-fixture-behind-");
      const chainDir = join(scratch, "chain");
      const behindDir = join(scratch, "behind");
      writeChainFixture(chainDir);
      const rewound = rewindChainByOne(chainDir, behindDir);
      if (!rewound.ok) {
        throw new Error(rewound.error);
      }
      const baseline = buildFixtureBaseline();
      const client = await makeMigratedClient(behindDir);

      const verdict = await judgeBehindTipRefusal(rewound.value, () =>
        applyToPglite(baseline, client),
      );

      expect(verdict).toEqual({
        ok: true,
        value: expect.stringContaining(`missing ${CHAIN_TIP.tag}`),
      });
    });

    it("fails the leg when the baseline does not refuse", async () => {
      const chainDir = makeScratchDir("squash-fixture-chain-");
      writeChainFixture(chainDir);
      const baseline = buildFixtureBaseline();
      const client = await makeMigratedClient(chainDir);

      const verdict = await judgeBehindTipRefusal(CHAIN_TIP.tag, () =>
        applyToPglite(baseline, client),
      );

      expect(verdict.ok).toBe(false);
    });
  },
);
