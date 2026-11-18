// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MentionBounds } from "contract";

import { Markdown } from "@web/components/Markdown";

vi.mock("../../../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "../../../../data/apiFetch";
import { MentionTargetsProvider } from ".";
import { MENTION_LOOKUP_WAIT_MS } from "./utils";

const apiFetchMock = vi.mocked(apiFetch);

const REPO_ID = "42";
const SETTLE_ROUNDS = 5;

function stubFound(users: readonly string[], teams: readonly string[] = []) {
  const body = JSON.stringify({ users, teams });
  const answer = new Response(body, { status: 200 });
  return answer;
}

/** Moves the clock past the batch wait, then lets each fetch and its state land. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(MENTION_LOOKUP_WAIT_MS);
  });
  for (let round = 0; round < SETTLE_ROUNDS; round += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

function readAskedTargets(call: number): readonly string[] {
  const path = apiFetchMock.mock.calls[call]?.[0] ?? "";
  const asked = new URL(path, "https://app.example").searchParams.get(
    "targets",
  );
  const targets = asked?.split(",") ?? [];
  return targets;
}

function renderBodies(bodies: readonly string[], viewerLogin?: string) {
  const view = (
    <MentionTargetsProvider repoId={REPO_ID} viewerLogin={viewerLogin}>
      {bodies.map((body) => (
        <Markdown content={body} key={body} renderMentions />
      ))}
    </MentionTargetsProvider>
  );
  return render(view);
}

describe("MentionTargetsProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiFetchMock.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("resolves mentions under StrictMode's double effect run", async () => {
    apiFetchMock.mockResolvedValue(stubFound(["cara"]));

    render(
      <StrictMode>
        <MentionTargetsProvider repoId={REPO_ID}>
          <Markdown content="cc @cara" renderMentions />
        </MentionTargetsProvider>
      </StrictMode>,
    );
    await settle();

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "@cara" })).toBeTruthy();
  });

  it("keeps the new repo's links when the old repo answers late", async () => {
    let answerOldRepo: (response: Response) => void = () => {};
    apiFetchMock
      .mockReturnValueOnce(new Promise((done) => (answerOldRepo = done)))
      .mockResolvedValueOnce(stubFound(["cara"]));

    const body = <Markdown content="cc @cara" renderMentions />;
    const view = render(
      <MentionTargetsProvider repoId={REPO_ID}>{body}</MentionTargetsProvider>,
    );
    await settle();
    view.rerender(
      <MentionTargetsProvider repoId="43">{body}</MentionTargetsProvider>,
    );
    await settle();
    answerOldRepo(stubFound([]));
    await settle();

    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("link", { name: "@cara" })).toBeTruthy();
  });

  it("asks once for every distinct target a page's bodies hold", async () => {
    apiFetchMock.mockResolvedValue(stubFound(["Cara"], ["acme/core"]));

    renderBodies(["cc @cara and @acme/core", "thanks @CARA, @dan"]);
    await settle();

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(readAskedTargets(0)).toEqual(["cara", "acme/core", "dan"]);
    expect(screen.getAllByRole("link", { name: /@cara/i })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "@acme/core" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "@dan" })).toBeNull();
  });

  it("splits a page past the per-call bound into several lookups", async () => {
    apiFetchMock.mockImplementation(() => Promise.resolve(stubFound([])));
    const logins = Array.from(
      { length: MentionBounds.TARGETS_PER_CALL + 1 },
      (_, position) => `user${String(position)}`,
    );

    const body = logins.map((login) => `@${login}`).join(" ");
    renderBodies([body]);
    await settle();

    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    expect(readAskedTargets(0)).toHaveLength(MentionBounds.TARGETS_PER_CALL);
    expect(readAskedTargets(1)).toEqual([
      `user${String(MentionBounds.TARGETS_PER_CALL)}`,
    ]);
  });

  it("asks only about targets no earlier lookup covered", async () => {
    apiFetchMock.mockImplementation(() => Promise.resolve(stubFound(["cara"])));
    const view = renderBodies(["@cara"]);
    await settle();

    view.rerender(
      <MentionTargetsProvider repoId={REPO_ID}>
        <Markdown content="@cara" renderMentions />
        <Markdown content="@cara and @erin" renderMentions />
      </MentionTargetsProvider>,
    );
    await settle();

    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    expect(readAskedTargets(1)).toEqual(["erin"]);
  });

  it("leaves a failed lookup's mentions as plain text and never retries", async () => {
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});
    apiFetchMock.mockResolvedValue(new Response("{}", { status: 503 }));
    const view = renderBodies(["ping @cara"]);
    await settle();

    view.rerender(
      <MentionTargetsProvider repoId={REPO_ID}>
        <Markdown content="ping @cara" renderMentions />
        <Markdown content="again @cara" renderMentions />
      </MentionTargetsProvider>,
    );
    await settle();

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getAllByTestId("mention")).toHaveLength(2);
    expect(reported).not.toHaveBeenCalled();
  });

  it("leaves mentions plain and reports an answer off its shape", async () => {
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ users: "cara" }), { status: 200 }),
    );
    renderBodies(["ping @cara"]);
    await settle();

    expect(screen.queryByRole("link")).toBeNull();
    expect(reported).toHaveBeenCalledTimes(1);
  });

  it("highlights the viewer's own mention once it resolves", async () => {
    apiFetchMock.mockResolvedValue(stubFound(["octocat"]));

    renderBodies(["over to you @OctoCat"], "octocat");
    await settle();

    const link = screen.getByRole("link", { name: "@OctoCat" });
    expect(link.getAttribute("data-variant")).toBe("viewer");
  });
});
