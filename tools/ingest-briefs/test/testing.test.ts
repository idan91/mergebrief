import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stageCommittedBriefs } from "../src/testing";

async function makeSourceDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "committed-briefs-"));
  for (const [name, text] of Object.entries(files)) {
    await writeFile(join(dir, name), text);
  }
  return dir;
}

describe("stageCommittedBriefs", () => {
  it("renames committed briefs to the artifact suffix", async () => {
    const source = await makeSourceDir({
      "a_1_aaaaaaaa-brief.json": '{"brief":1}',
      "a_1_aaaaaaaa.diffs.json": '{"diffs":1}',
    });

    const staged = await stageCommittedBriefs(source);

    expect((await readdir(staged)).toSorted()).toEqual([
      "a_1_aaaaaaaa.brief.json",
      "a_1_aaaaaaaa.diffs.json",
    ]);
    expect(
      await readFile(join(staged, "a_1_aaaaaaaa.brief.json"), "utf8"),
    ).toBe('{"brief":1}');
    expect(
      await readFile(join(staged, "a_1_aaaaaaaa.diffs.json"), "utf8"),
    ).toBe('{"diffs":1}');
  });

  it("copies artifact-named briefs unchanged", async () => {
    const source = await makeSourceDir({ "b_2_bbbbbbbb.brief.json": "{}" });

    const staged = await stageCommittedBriefs(source);

    expect(staged).not.toBe(source);
    expect(await readdir(staged)).toEqual(["b_2_bbbbbbbb.brief.json"]);
  });

  it("leaves the source directory as it was", async () => {
    const source = await makeSourceDir({ "c_1_cccccccc-brief.json": "{}" });

    await stageCommittedBriefs(source);

    expect(await readdir(source)).toEqual(["c_1_cccccccc-brief.json"]);
  });
});
