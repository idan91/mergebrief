// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ConversationModule from "@web/features/conversation";
import type {
  ConversationPlan,
  ConversationSectionProps,
} from "@web/features/conversation";
import { mountBriefView } from "@web/features/brief/test-utils";

const sectionFault = vi.hoisted(() => ({ thrown: false }));

vi.mock("@web/features/conversation", async (importOriginal) => {
  const actual = await importOriginal<typeof ConversationModule>();
  function FaultyConversationSection(props: ConversationSectionProps) {
    if (sectionFault.thrown) {
      throw new Error("section failed");
    }
    return <actual.ConversationSection {...props} />;
  }
  return { ...actual, ConversationSection: FaultyConversationSection };
});

beforeEach(() => {
  sectionFault.thrown = true;
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  // React reports a caught render error on the console; that is the path under test.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  sectionFault.thrown = false;
  cleanup();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

function stubPlan(): ConversationPlan {
  const plan = {
    queryOptions: {
      queryKey: ["conversation", "42", 7],
      queryFn: async () => ({
        kind: "ready",
        conversation: {
          threads: [],
          reviews: [],
          prComments: [],
          hasMoreThreads: false,
          hasMoreReviews: false,
          hasMorePrComments: false,
        },
      }),
      retry: false,
    },
    postReply: vi.fn(),
  };
  // Structural stand-in for the real plan (test-only escape hatch).
  return plan as unknown as ConversationPlan;
}

describe("BriefView, a conversation section that cannot render", () => {
  it("names the section and keeps the story on screen", async () => {
    await mountBriefView({ conversation: stubPlan() });

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "The conversation could not be shown",
      }),
    ).toBeTruthy();
    expect(screen.getAllByTestId("story-group").length).toBeGreaterThan(0);
  });

  it("shows the section again for the next brief", async () => {
    const view = await mountBriefView({ conversation: stubPlan() });
    await screen.findByRole("alert");
    sectionFault.thrown = false;

    view.rerender({ briefId: "brief-next" });

    expect(
      await screen.findByRole("button", { name: /Conversation/ }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", {
        name: "The conversation could not be shown",
      }),
    ).toBeNull();
  });
});
