import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPOSITORY } from "../src/consts";

const CI_WORKFLOW = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  ".github",
  "workflows",
  "ci.yml",
);
const JOBS_KEY = "\njobs:\n";
const JOB_KEY = /^ {2}(?<name>[a-z][\w-]*):$/gm;
const JOB_CONDITION_PREFIX = "    if: ";
// Every job names its runner four spaces in, so this count is the number of
// jobs however a job key is written.
const JOB_RUNNER = /^ {4}runs-on:/gm;
// A push to main runs a job only in the release repository; anywhere else
// the pull request already ran it.
const PUSH_GUARD = `github.event_name == 'pull_request' || github.repository == '${REPOSITORY.owner}/${REPOSITORY.name}'`;

interface CiJob {
  readonly name: string;
  readonly guarded: boolean;
}

function readJobsBlock(): string {
  const source = readFileSync(CI_WORKFLOW, "utf8");
  const jobsStart = source.indexOf(JOBS_KEY) + JOBS_KEY.length;
  return source.slice(jobsStart);
}

function readCiJobs(): CiJob[] {
  const jobs = readJobsBlock();
  const keys = [...jobs.matchAll(JOB_KEY)];

  return keys.map((key, index) => {
    const block = jobs.slice(key.index, keys[index + 1]?.index);
    const guarded = block
      .split("\n")
      .some(
        (line) =>
          line.startsWith(JOB_CONDITION_PREFIX) && line.includes(PUSH_GUARD),
      );
    return { name: key.groups?.["name"] ?? "", guarded };
  });
}

describe("the push trigger in ci.yml", () => {
  it("reads every job the workflow defines", () => {
    const names = readCiJobs().map((job) => job.name);
    const runners = readJobsBlock().match(JOB_RUNNER) ?? [];

    expect(names).toContain("lint");
    expect(names).toContain("required-checks-passed");
    expect(names).toHaveLength(runners.length);
  });

  it("runs every job on a push only in the release repository", () => {
    const unguarded = readCiJobs().filter((job) => !job.guarded);

    expect(unguarded.map((job) => job.name)).toEqual([]);
  });
});
