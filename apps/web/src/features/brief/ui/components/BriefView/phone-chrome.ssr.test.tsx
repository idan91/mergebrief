// No jsdom: renders the way the server does, before any viewport is read.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { briefFixture, FixtureBriefView } from "@web/features/brief/test-utils";
import { I18nProvider } from "@web/i18n/I18nProvider";

vi.mock("@tanstack/react-start/server", () => ({
  getCookie: () => undefined,
}));

async function renderBriefToString(): Promise<string> {
  const queryClient = new QueryClient();
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <FixtureBriefView />
        </I18nProvider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();

  return renderToString(<RouterProvider router={router} />);
}

function countTitleHeadings(html: string): number {
  const titleHeading = new RegExp(
    `<h1[^>]*>${briefFixture.pr.title}</h1>`,
    "g",
  );
  return html.match(titleHeading)?.length ?? 0;
}

describe("the phone chrome on the server render", () => {
  it("ships the sideways row beside the upright chrome for CSS to pick", async () => {
    const html = await renderBriefToString();

    expect(html).toContain('data-testid="landscape-row"');
    expect(html).toContain("data-landscape-row");
    expect(html).toContain('data-testid="phone-bar"');
    expect(html).toContain("data-phone-bar");
    expect(countTitleHeadings(html)).toBe(2);
  });
});
