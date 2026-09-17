// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../../../i18n/I18nProvider";
import { buildLocalBriefsQueryOptions } from "../../queries";
import { LocalBriefsSection } from "./LocalBriefsSection";

function renderSection(enabled: boolean, queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <LocalBriefsSection enabled={enabled} />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("LocalBriefsSection", () => {
  afterEach(cleanup);

  it("renders nothing and never queries without a session", () => {
    const queryClient = new QueryClient();
    const { container } = renderSection(false, queryClient);
    expect(container.innerHTML).toBe("");
    const state = queryClient.getQueryState(
      buildLocalBriefsQueryOptions().queryKey,
    );
    expect(state?.fetchStatus ?? "idle").toBe("idle");
  });

  it("renders nothing for an empty directory", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(buildLocalBriefsQueryOptions().queryKey, []);
    const { container } = renderSection(true, queryClient);
    expect(container.innerHTML).toBe("");
  });
});
