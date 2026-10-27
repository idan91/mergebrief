import { describe, expect, it } from "vitest";
import { flagAddedSecrets } from "../../src/generation/added-secrets";
import { SecretKinds } from "../../src/generation/redaction/types";
import { sanitizeUntrustedDiff } from "../../src/generation/untrusted-text";
import {
  BriefGenerationSchema,
  ChunkSchema,
  RiskSurfaceAttributes,
  UnattributedFileSchema,
} from "../../src/types";
import { FAKE_SECRETS, makeFakePemBlock } from "../secret-fixtures";

const ADDS_SECRET = RiskSurfaceAttributes.ADDS_SECRET;
const TOKEN = FAKE_SECRETS[SecretKinds.GITHUB_TOKEN];

/** Lines 10-12 of config.ts: line 11 adds a token, the removed line held one too. */
const CONFIG_PATCH = [
  "@@ -10,2 +10,3 @@",
  " export const config = {",
  `-  old: "${FAKE_SECRETS[SecretKinds.SLACK_TOKEN]}",`,
  `+  token: "${TOKEN}",`,
  "+  region: 'eu',",
  " };",
].join("\n");

function makeChunk(
  file: string,
  start: number,
  end: number,
  riskSurface: string[] = [],
) {
  return {
    id: `${file}-${start}`,
    file,
    addedRanges: [{ start, end }],
    removedRanges: [],
    riskSurface,
  };
}

describe("flagAddedSecrets", () => {
  it("flags the chunk whose added lines hold a credential", () => {
    const flagged = flagAddedSecrets(
      [makeChunk("config.ts", 11, 11), makeChunk("config.ts", 12, 12)],
      [],
      [{ file: "config.ts", patch: CONFIG_PATCH }],
    );

    expect(flagged.chunks.map((chunk) => chunk.riskSurface)).toEqual([
      [ADDS_SECRET],
      [],
    ]);
  });

  it("does not flag a credential that sits only on a removed line", () => {
    const patch = ["@@ -1,1 +1,1 @@", `-a = "${TOKEN}"`, "+a = env.A"].join(
      "\n",
    );
    const flagged = flagAddedSecrets(
      [{ ...makeChunk("a.py", 1, 1), removedRanges: [{ start: 1, end: 1 }] }],
      [],
      [{ file: "a.py", patch }],
    );

    expect(flagged.chunks[0]?.riskSurface).toEqual([]);
  });

  it.each([
    ["splits", `${TOKEN.slice(0, 8)}\u200B${TOKEN.slice(8)}`],
    ["glues onto a word", `x\u200B${TOKEN}`],
  ])("flags a credential a hidden char %s", (_label, hidden) => {
    const patch = ["@@ -0,0 +1,1 @@", `+t = "${hidden}";`].join("\n");
    const flagged = flagAddedSecrets(
      [makeChunk("t.py", 1, 1)],
      [],
      [{ file: "t.py", patch }],
    );

    expect(sanitizeUntrustedDiff(patch)).not.toContain(TOKEN.slice(8));
    expect(flagged.chunks[0]?.riskSurface).toEqual([ADDS_SECRET]);
  });

  it("flags each added line of a key block", () => {
    const patch = ["@@ -0,0 +1,5 @@", ...makeFakePemBlock("+")].join("\n");
    const flagged = flagAddedSecrets(
      [makeChunk("key.pem", 3, 3)],
      [],
      [{ file: "key.pem", patch }],
    );

    expect(flagged.chunks[0]?.riskSurface).toEqual([ADDS_SECRET]);
  });

  it("flags an unattributed file whose leftover lines add a credential", () => {
    const flagged = flagAddedSecrets(
      [makeChunk("config.ts", 12, 12)],
      [
        {
          file: "config.ts",
          addedRanges: [{ start: 11, end: 11 }],
          removedRanges: [],
        },
      ],
      [{ file: "config.ts", patch: CONFIG_PATCH }],
    );

    expect(flagged.unattributed[0]?.riskSurface).toEqual([ADDS_SECRET]);
    expect(flagged.chunks[0]?.riskSurface).toEqual([]);
  });

  it("removes a stale flag the diff no longer supports and keeps others", () => {
    const flagged = flagAddedSecrets(
      [makeChunk("config.ts", 12, 12, ["hot-path", ADDS_SECRET])],
      [],
      [{ file: "config.ts", patch: CONFIG_PATCH }],
    );

    expect(flagged.chunks[0]?.riskSurface).toEqual(["hot-path"]);
  });

  it("adds the flag once when the model's list already holds others", () => {
    const flagged = flagAddedSecrets(
      [makeChunk("config.ts", 10, 12, ["external-io"])],
      [],
      [{ file: "config.ts", patch: CONFIG_PATCH }],
    );

    expect(flagged.chunks[0]?.riskSurface).toEqual([
      "external-io",
      ADDS_SECRET,
    ]);
  });
});

describe("the adds-secret vocabulary", () => {
  it("is not an attribute the model may emit", () => {
    const parsed =
      BriefGenerationSchema.shape.chunks.element.shape.riskSurface.safeParse([
        ADDS_SECRET,
      ]);

    expect(parsed.success).toBe(false);
  });

  it("is an attribute a stored chunk may carry", () => {
    expect(ChunkSchema.shape.riskSurface.safeParse([ADDS_SECRET]).success).toBe(
      true,
    );
  });

  it("is the only attribute an unattributed file may carry", () => {
    const base = { file: "a.ts", addedRanges: [], removedRanges: [] };

    expect(
      UnattributedFileSchema.safeParse({ ...base, riskSurface: [ADDS_SECRET] })
        .success,
    ).toBe(true);
    expect(
      UnattributedFileSchema.safeParse({ ...base, riskSurface: ["hot-path"] })
        .success,
    ).toBe(false);
  });
});
