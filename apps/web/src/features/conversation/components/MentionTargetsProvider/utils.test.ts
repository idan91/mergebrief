import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addShownTargets,
  chunkMentionTargets,
  createMentionTargetBatcher,
  createShownMentionTargets,
  MAX_LOOKED_UP_TARGETS,
  MENTION_LOOKUP_WAIT_MS,
  readFoundTargets,
} from "./utils";

describe("chunkMentionTargets", () => {
  it("keeps each lookup within fifty targets", () => {
    const targets = Array.from({ length: 101 }, (_, at) => `u${String(at)}`);

    const sizes = chunkMentionTargets(targets).map((chunk) => chunk.length);
    expect(sizes).toEqual([50, 50, 1]);
  });
});

describe("readFoundTargets", () => {
  it("folds GitHub's casing so a typed target matches", () => {
    const found = readFoundTargets({ users: ["Cara"], teams: ["Acme/Core"] });

    expect([...found]).toEqual(["cara", "acme/core"]);
  });
});

describe("addShownTargets", () => {
  it("adds to the repo's set and starts over for another repo", () => {
    const first = addShownTargets(
      createShownMentionTargets("1"),
      "1",
      new Set(["cara"]),
    );
    const moved = addShownTargets(first, "2", new Set(["dan"]));

    expect([...first.targets]).toEqual(["cara"]);
    expect(moved).toEqual({ repoId: "2", targets: new Set(["dan"]) });
  });

  it("keeps the same set when a lookup found nothing new", () => {
    const shown = createShownMentionTargets("1");

    expect(addShownTargets(shown, "1", new Set())).toBe(shown);
  });
});

describe("createMentionTargetBatcher", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeCountingBatcher() {
    let inFlight = 0;
    let mostInFlight = 0;
    const asked: string[] = [];
    const batcher = createMentionTargetBatcher({
      resolve: async (targets) => {
        inFlight += 1;
        mostInFlight = Math.max(mostInFlight, inFlight);
        asked.push(...targets);
        await Promise.resolve();
        inFlight -= 1;
        return { users: [], teams: [] };
      },
      onFound: vi.fn(),
      onFailed: vi.fn(),
    });
    return { batcher, asked, readMostInFlight: () => mostInFlight };
  }

  it("asks about at most the page's target cap, one call at a time", async () => {
    vi.useFakeTimers();
    const { batcher, asked, readMostInFlight } = makeCountingBatcher();

    for (let index = 0; index <= MAX_LOOKED_UP_TARGETS; index += 1) {
      batcher.request(`user${String(index)}`);
    }
    await vi.advanceTimersByTimeAsync(MENTION_LOOKUP_WAIT_MS);

    expect(asked).toHaveLength(MAX_LOOKED_UP_TARGETS);
    expect(readMostInFlight()).toBe(1);
  });
});
