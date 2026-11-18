// Test harness on the `ingest-briefs/testing` subpath. Committed fixture
// briefs end in `-brief.json` because gitleaks opens any name containing
// `.br` as a brotli archive and scans nothing; ingest reads `.brief.json`.
import { cp, mkdtemp, readdir, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const COMMITTED_BRIEF_SUFFIX = "-brief.json";
const ARTIFACT_BRIEF_SUFFIX = ".brief.json";

/** Copies `dir` to a fresh temp directory with committed briefs under artifact names; returns its path. */
export async function stageCommittedBriefs(dir: string): Promise<string> {
  const staged = await mkdtemp(join(tmpdir(), "committed-briefs-"));
  await cp(dir, staged, { recursive: true });

  const committed = (await readdir(staged)).filter((name) =>
    name.endsWith(COMMITTED_BRIEF_SUFFIX),
  );
  for (const name of committed) {
    const stem = name.slice(0, -COMMITTED_BRIEF_SUFFIX.length);
    await rename(
      join(staged, name),
      join(staged, stem + ARTIFACT_BRIEF_SUFFIX),
    );
  }
  return staged;
}
