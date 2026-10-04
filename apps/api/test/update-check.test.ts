// The update check: fetches the release manifest, computes the gap flags for
// the running version, serves a cached snapshot, and says so once in the log.
import { readFileSync } from "node:fs";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import {
  createUpdateCheck,
  type UpdateCheck,
  type UpdateCheckDeps,
} from "../src/update-check";
import { testLogging, type TestLogging } from "./logging";

const MANIFEST = readFileSync(
  new URL("./fixtures/version.json", import.meta.url),
  "utf8",
);
const MANIFEST_URL = "https://releases.example.test/version.json";
const BOOT = new Date("2026-10-03T10:00:00Z");
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const PAST_WINDOW_MS = HOUR_MS + MINUTE_MS;

type FetchStub = Mock<typeof fetch>;

function stubFetch(body: string, status = 200): FetchStub {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(body, {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
}

function stubFailingFetch(): FetchStub {
  return vi.fn<typeof fetch>(async () => {
    throw new TypeError("fetch failed");
  });
}

interface Fixture {
  readonly check: UpdateCheck;
  readonly fetch: FetchStub;
  readonly logging: TestLogging;
}

function makeCheck(overrides: Partial<UpdateCheckDeps> = {}): Fixture {
  const fetch = stubFetch(MANIFEST);
  const logging = testLogging({ LOG_LEVEL: "debug" });
  const check = createUpdateCheck({
    serverVersion: "1.4.0",
    enabled: true,
    url: MANIFEST_URL,
    fetch,
    log: logging.logger,
    bootDelayMs: 0,
    ...overrides,
  });
  return { check, fetch, logging };
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

function filterLinesFor(logging: TestLogging, evt: string) {
  return logging.lines().filter((line) => line["evt"] === evt);
}

describe("update check", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(BOOT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves only the running version before the first success", () => {
    const { check, fetch } = makeCheck();

    expect(check.snapshot()).toEqual({ version: "1.4.0" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("parses the manifest and reports latest with the gap flags", async () => {
    const { check, fetch } = makeCheck();

    await check.refresh();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(MANIFEST_URL);
    expect(check.snapshot()).toEqual({
      version: "1.4.0",
      latest: "1.6.0",
      releaseNotesUrl:
        "https://github.com/Idan91/code-review/releases/tag/v1.6.0",
      checkedAt: BOOT.toISOString(),
      breaking: true,
      security: true,
    });
  });

  it("serves latest as the canonical triple, whatever the manifest spells", async () => {
    const body = JSON.stringify({
      latest: "v1.6.0+build.7",
      releases: [{ version: "v1.6.0", security: true }],
    });
    const { check, logging } = makeCheck({ fetch: stubFetch(body) });

    await check.refresh();

    expect(check.snapshot()).toMatchObject({
      latest: "1.6.0",
      security: true,
    });
    expect(filterLinesFor(logging, "update.available")[0]).toMatchObject({
      latest: "1.6.0",
    });
  });

  it("computes breaking and security over the gap only", async () => {
    const { check } = makeCheck({ serverVersion: "1.5.0" });

    await check.refresh();

    expect(check.snapshot()).toMatchObject({
      latest: "1.6.0",
      breaking: true,
      security: false,
    });
  });

  it("serves no latest when already on the latest release", async () => {
    const { check } = makeCheck({ serverVersion: "1.6.0" });

    await check.refresh();

    expect(check.snapshot()).toEqual({
      version: "1.6.0",
      checkedAt: BOOT.toISOString(),
    });
  });

  it("ignores unknown fields and skips malformed release entries", async () => {
    const body = JSON.stringify({
      latest: "1.6.0",
      releaseNotesUrl: "https://example.test/notes",
      channel: "stable",
      releases: [
        { version: "1.6.0", security: true, extra: 1 },
        { date: "2026-09-15", breaking: true },
        "garbage",
      ],
    });
    const { check } = makeCheck({ fetch: stubFetch(body) });

    await check.refresh();

    expect(check.snapshot()).toMatchObject({
      latest: "1.6.0",
      releaseNotesUrl: "https://example.test/notes",
      breaking: false,
      security: true,
    });
  });

  it("keeps the last good snapshot when a later fetch fails", async () => {
    const fetch = stubFetch(MANIFEST);
    const { check } = makeCheck({ fetch });
    await check.refresh();
    fetch.mockImplementationOnce(
      async () => new Response("nope", { status: 500 }),
    );

    await check.refresh();

    expect(check.snapshot()).toMatchObject({ latest: "1.6.0" });
  });

  it("refreshes in the background past the hour, serving the cache meanwhile", async () => {
    const { check, fetch } = makeCheck();
    await check.refresh();
    const first = check.snapshot();

    vi.setSystemTime(new Date(BOOT.getTime() + PAST_WINDOW_MS));
    const served = check.snapshot();

    expect(served).toEqual(first);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(check.snapshot().checkedAt).not.toBe(first.checkedAt),
    );
  });

  it("retries at most once an hour after a failed refresh", async () => {
    const fetch = stubFetch(MANIFEST);
    const { check } = makeCheck({ fetch });
    await check.refresh();
    fetch.mockImplementation(async () => new Response("", { status: 503 }));

    vi.setSystemTime(new Date(BOOT.getTime() + PAST_WINDOW_MS));
    check.snapshot();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await settle();
    check.snapshot();
    await settle();
    check.snapshot();
    await settle();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(check.snapshot()).toMatchObject({ latest: "1.6.0" });
  });

  it("retries a failed boot check an hour later on request", async () => {
    const fetch = stubFailingFetch();
    const { check } = makeCheck({ fetch });
    await check.refresh();
    check.snapshot();
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(BOOT.getTime() + PAST_WINDOW_MS));
    check.snapshot();

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });

  it("drops a release notes link that is not an http or https URL", async () => {
    const body = JSON.stringify({
      latest: "1.6.0",
      releaseNotesUrl: "javascript:alert(1)",
      releases: [{ version: "1.6.0", notesUrl: "ftp://notes.example.test" }],
    });
    const { check } = makeCheck({ fetch: stubFetch(body) });

    await check.refresh();

    const snapshot = check.snapshot();
    expect(snapshot.latest).toBe("1.6.0");
    expect(snapshot).not.toHaveProperty("releaseNotesUrl");
  });

  it("does not refresh inside the hour", async () => {
    const { check, fetch } = makeCheck();
    await check.refresh();

    vi.setSystemTime(new Date(BOOT.getTime() + 59 * MINUTE_MS));
    check.snapshot();
    check.snapshot();

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("never fetches when the running version is a dev sentinel", async () => {
    for (const serverVersion of ["dev", "0.0.0"]) {
      const { check, fetch } = makeCheck({ serverVersion });

      check.start();
      await check.refresh();

      expect(fetch).not.toHaveBeenCalled();
      expect(check.snapshot()).toEqual({ version: serverVersion });
      check.stop();
    }
  });

  it("never fetches when the knob is off", async () => {
    const { check, fetch } = makeCheck({ enabled: false });

    check.start();
    await check.refresh();

    expect(fetch).not.toHaveBeenCalled();
    expect(check.snapshot()).toEqual({ version: "1.4.0" });
    check.stop();
  });

  it("fetches once after the boot delay", async () => {
    const { check, fetch } = makeCheck();

    check.start();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    check.stop();

    expect(check.snapshot()).toMatchObject({ latest: "1.6.0" });
  });

  it("serves no latest when the instance is ahead of the manifest", async () => {
    const { check, logging } = makeCheck({ serverVersion: "1.7.0" });

    await check.refresh();

    expect(check.snapshot()).toEqual({
      version: "1.7.0",
      checkedAt: "2026-10-03T10:00:00.000Z",
    });
    expect(filterLinesFor(logging, "update.available")).toEqual([]);
  });

  it("logs a fixed reason for a manifest that is not json", async () => {
    const { check, logging } = makeCheck({
      fetch: stubFetch("<html>secret-host-banner</html>"),
    });

    await check.refresh();

    expect(check.snapshot()).toEqual({ version: "1.4.0" });
    expect(filterLinesFor(logging, "update.check.fail")).toMatchObject([
      { err: "manifest is not json" },
    ]);
  });

  it("refuses a manifest body past the byte cap", async () => {
    const padded = MANIFEST.replace("{", `{"padding":"${"x".repeat(70_000)}",`);
    const { check, logging } = makeCheck({ fetch: stubFetch(padded) });

    await check.refresh();

    expect(check.snapshot()).toEqual({ version: "1.4.0" });
    expect(filterLinesFor(logging, "update.check.fail")).toMatchObject([
      { err: "manifest too large" },
    ]);
  });

  it("stop before the boot delay cancels the boot fetch", async () => {
    const { check, fetch } = makeCheck({ bootDelayMs: 50 });

    check.start();
    check.stop();
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(fetch).not.toHaveBeenCalled();
  });

  it("shares one fetch between overlapping refresh calls", async () => {
    const { check, fetch } = makeCheck();

    await Promise.all([check.refresh(), check.refresh()]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(check.snapshot()).toMatchObject({ latest: "1.6.0" });
  });

  it("logs update.available once per new latest", async () => {
    const fetch = stubFetch(MANIFEST);
    const { check, logging } = makeCheck({ fetch });

    await check.refresh();
    await check.refresh();
    const newer = JSON.stringify({
      latest: "1.7.0",
      releases: [{ version: "1.7.0" }],
    });
    fetch.mockImplementation(async () => new Response(newer, { status: 200 }));
    await check.refresh();

    const lines = filterLinesFor(logging, "update.available");
    expect(lines.map((line) => line["latest"])).toEqual(["1.6.0", "1.7.0"]);
    expect(lines[0]).toMatchObject({
      level: "warn",
      current: "1.4.0",
      breaking: true,
      security: true,
    });
    expect(lines[1]).toMatchObject({ level: "info", security: false });
  });

  it("stays silent in the log when already on the latest release", async () => {
    const { check, logging } = makeCheck({ serverVersion: "1.6.0" });

    await check.refresh();

    expect(filterLinesFor(logging, "update.available")).toEqual([]);
  });

  it("logs update.check.fail at info once then debug", async () => {
    const { check, logging } = makeCheck({ fetch: stubFailingFetch() });

    await check.refresh();
    await check.refresh();

    const lines = filterLinesFor(logging, "update.check.fail");
    expect(lines.map((line) => line["level"])).toEqual(["info", "debug"]);
    expect(check.snapshot()).toEqual({ version: "1.4.0" });
  });

  it("treats a non-2xx answer as a failed check", async () => {
    const { check, logging } = makeCheck({ fetch: stubFetch("", 404) });

    await check.refresh();

    expect(filterLinesFor(logging, "update.check.fail")).toHaveLength(1);
    expect(check.snapshot()).toEqual({ version: "1.4.0" });
  });
});
