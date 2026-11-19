import { describe, expect, it } from "vitest";
import { cleanJsonText } from "../src/db/json-text";
import {
  type AppDatabase,
  createArtifactStore,
  createTenantRepository,
  type TenantContext,
} from "../src/index";
import {
  isInstallationId,
  isRepoId,
  type InstallationId,
  type RepoId,
} from "../src/types";
import { PrStates } from "types/pull-requests";
import { STORED_BODY_VERSION } from "brief-core/artifact";
import { brandWith, registerSharedPglite } from "./helpers";

const TENANT: InstallationId = brandWith(isInstallationId, 1000n);
const REPO: RepoId = brandWith(isRepoId, 777n);
const CTX: TenantContext = { installationId: TENANT };
const REPLACEMENT = String.fromCodePoint(0xfffd);

async function seedBrief(
  handle: AppDatabase,
  body: string,
  repoConfig?: string,
) {
  const repo = createTenantRepository(handle, CTX);
  const pr = await repo.pullRequests.upsert({
    repoId: REPO,
    prNumber: 7,
    state: PrStates.OPEN,
  });
  const write = {
    pullRequestId: pr.id,
    baseSha: "base",
    headSha: "head",
    headIndex: 0,
    commitCount: 1,
    provider: "anthropic",
    model: "opus",
    effort: "high",
    usedGroupIds: [],
    bodyVersion: STORED_BODY_VERSION,
    body,
  };
  const written = await createArtifactStore(handle, CTX).briefs.write(
    repoConfig === undefined ? write : { ...write, repoConfig },
  );
  return { pr, written };
}

describe("cleanJsonText", () => {
  it("keeps a clean document's exact bytes", () => {
    const text = '{ "b": 1,  "a": "café 😀" }';

    expect(cleanJsonText(text)).toBe(text);
  });

  it.each([
    ["a doubled backslash before u0000", String.raw`{ "a":  "\\\\u0000" }`],
    ["a surrogate pair in lower case", String.raw`{ "a":  "\ud83d\ude00" }`],
    ["a surrogate pair in upper case", String.raw`{ "a":  "\uD83D\uDE00" }`],
  ])("keeps the exact bytes of %s", (_label, text) => {
    expect(cleanJsonText(text)).toBe(text);
  });

  it.each([
    ["an escaped NUL", String.raw`{"a":"x\u0000y"}`, `x${REPLACEMENT}y`],
    [
      "an upper case lone high",
      String.raw`{"a":"x\uD83Dy"}`,
      `x${REPLACEMENT}y`,
    ],
    ["a lone low", String.raw`{"a":"x\ude00y"}`, `x${REPLACEMENT}y`],
    [
      "a NUL after a doubled backslash",
      String.raw`{"a":"\\\u0000"}`,
      `${String.fromCodePoint(92)}${REPLACEMENT}`,
    ],
  ])("replaces %s", (_label, text, expected) => {
    expect(JSON.parse(cleanJsonText(text))).toEqual({ a: expected });
  });

  it.each([
    ["a NUL", { a: "x\u0000y" }, { a: `x${REPLACEMENT}y` }],
    ["a lone surrogate", { a: "cut\ud83d" }, { a: `cut${REPLACEMENT}` }],
    ["a nested NUL", { a: [{ b: "\u0000" }] }, { a: [{ b: REPLACEMENT }] }],
    ["a NUL in a key", { "k\u0000": 1 }, { [`k${REPLACEMENT}`]: 1 }],
  ])("replaces %s", (_label, input, expected) => {
    expect(JSON.parse(cleanJsonText(JSON.stringify(input)))).toEqual(expected);
  });

  it.each([
    [
      "a lone low after an escaped backslash and ud83d",
      String.raw`{"a":"\\ud83d\ude00"}`,
      `${String.fromCodePoint(92)}ud83d${REPLACEMENT}`,
    ],
    [
      "a lone high before an escaped backslash",
      String.raw`{"a":"\ud83d\\ude00"}`,
      `${REPLACEMENT}${String.fromCodePoint(92)}ude00`,
    ],
  ])(
    "tells a real escape from ordinary text in %s",
    (_label, text, expected) => {
      expect(JSON.parse(cleanJsonText(text))).toEqual({ a: expected });
    },
  );

  it("replaces a duplicate key's escape that parsing would hide", () => {
    expect(cleanJsonText(String.raw`{"a":"\u0000","a":"ok"}`)).toBe(
      `{"a":"${REPLACEMENT}","a":"ok"}`,
    );
  });

  it("keeps every byte around a replaced escape", () => {
    expect(cleanJsonText(String.raw`{ "b":  1, "a": "x\u0000y" }`)).toBe(
      `{ "b":  1, "a": "x${REPLACEMENT}y" }`,
    );
  });

  it("leaves text that is not JSON for the CHECK to refuse", () => {
    expect(cleanJsonText("not json")).toBe("not json");
  });
});

describe("JSON document columns", () => {
  const shared = registerSharedPglite();

  it("stores a NUL-bearing body a later jsonb cast can read", async () => {
    const body = JSON.stringify({ summary: "x\u0000y", tail: "cut\ud83d" });

    await seedBrief(shared.handle, body, JSON.stringify({ note: "\u0000" }));

    const rows = await shared.harness.raw(
      `select body::jsonb ->> 'summary' as summary,
              repo_config::jsonb ->> 'note' as note
         from brief`,
    );
    expect(rows[0]).toEqual({
      summary: `x${REPLACEMENT}y`,
      note: REPLACEMENT,
    });
  });

  it("stores a rewrite through the same guard", async () => {
    await seedBrief(shared.handle, '{"v":1}');
    await seedBrief(shared.handle, JSON.stringify({ v: "\u0000" }));

    const rows = await shared.harness.raw(
      "select body::jsonb ->> 'v' as v from brief",
    );
    expect(rows[0]?.["v"]).toBe(REPLACEMENT);
  });

  it("keeps an omitted repo config null", async () => {
    await seedBrief(shared.handle, '{"v":1}');

    const rows = await shared.harness.raw("select repo_config from brief");
    expect(rows[0]?.["repo_config"]).toBeNull();
  });

  it.each([
    ["not JSON", "not json"],
    ["a JSON array", "[1]"],
    ["a JSON string", '"text"'],
  ])("refuses a brief body that is %s", async (_label, body) => {
    await expect(seedBrief(shared.handle, body)).rejects.toMatchObject({
      cause: { constraint: "brief_body_check" },
    });
  });

  it("refuses a brief repo config that is not a JSON object", async () => {
    await expect(
      seedBrief(shared.handle, '{"v":1}', "[1]"),
    ).rejects.toMatchObject({
      cause: { constraint: "brief_repo_config_check" },
    });
  });

  it("holds the shape on every document column", async () => {
    const checks = await shared.harness.raw(
      `select con.conname as name, pg_get_constraintdef(con.oid) as definition
         from pg_constraint con
        where con.contype = 'c' and pg_get_constraintdef(con.oid) ilike '%is json%'
        order by con.conname`,
    );

    expect(checks).toEqual([
      { name: "brief_body_check", definition: "CHECK ((body IS JSON OBJECT))" },
      {
        name: "brief_repo_config_check",
        definition: "CHECK ((repo_config IS JSON OBJECT))",
      },
      {
        name: "chunk_layout_body_check",
        definition: "CHECK ((body IS JSON OBJECT))",
      },
      {
        name: "comparison_marks_body_check",
        definition: "CHECK ((body IS JSON OBJECT))",
      },
      { name: "delta_body_check", definition: "CHECK ((body IS JSON OBJECT))" },
      {
        name: "generation_part_body_check",
        definition: "CHECK ((body IS JSON OBJECT))",
      },
      {
        name: "generation_repo_config_check",
        definition: "CHECK ((repo_config IS JSON OBJECT))",
      },
      {
        name: "hunk_span_spans_check",
        definition: "CHECK ((spans IS JSON ARRAY))",
      },
      {
        name: "revision_narrative_body_check",
        definition: "CHECK ((body IS JSON OBJECT))",
      },
    ]);
  });
});
