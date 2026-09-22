// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../../../i18n/I18nProvider";
import { renderInRouter } from "../../../../test/router";
import { buildLocalBriefsQueryOptions } from "../../queries";
import type { LocalBriefSummary } from "../../types";
import { LocalBriefsSection } from "./LocalBriefsSection";

function renderSection(enabled: boolean, queryClient: QueryClient) {
  return renderInRouter(
    <I18nProvider>
      <LocalBriefsSection enabled={enabled} />
    </I18nProvider>,
    queryClient,
  );
}

const BRIEFS: LocalBriefSummary[] = [
  {
    id: "example-repo_7_abcdef01",
    artifactKind: "brief",
    repo: "example/repo",
    number: 7,
    title: "Add the thing",
    sha: "abcdef0123456789abcdef0123456789abcdef01",
  },
  {
    id: "example-repo_7_22222222",
    artifactKind: "delta",
    repo: "example/repo",
    number: 7,
    title: "Add the thing, revised",
    sha: "2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    baselineSha: "abcdef0123456789abcdef0123456789abcdef01",
    headSha: "2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  },
];

describe("LocalBriefsSection", () => {
  afterEach(cleanup);

  it("renders nothing and never queries without a session", async () => {
    const queryClient = new QueryClient();
    await renderSection(false, queryClient);
    expect(screen.queryByRole("region")).toBeNull();
    const state = queryClient.getQueryState(
      buildLocalBriefsQueryOptions().queryKey,
    );
    expect(state?.fetchStatus ?? "idle").toBe("idle");
  });

  it("lists each artifact as a row linking to its brief", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(buildLocalBriefsQueryOptions().queryKey, BRIEFS);
    await renderSection(true, queryClient);

    expect(screen.getByRole("region", { name: "Local briefs" })).toBeTruthy();
    const rows = screen.getAllByTestId("local-brief-row");
    expect(rows).toHaveLength(2);
    const delta = within(rows[1]!).getByRole("link");
    expect(delta.getAttribute("href")).toBe("/briefs/example-repo_7_22222222");
    expect(within(rows[1]!).getByText("delta")).toBeTruthy();
    expect(within(rows[1]!).getByText("abcdef0 \u2192 2222222")).toBeTruthy();
    expect(within(rows[0]!).getByText("#7")).toBeTruthy();
  });

  it("renders nothing for an empty directory", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(buildLocalBriefsQueryOptions().queryKey, []);
    await renderSection(true, queryClient);
    expect(screen.queryByRole("region")).toBeNull();
  });
});
