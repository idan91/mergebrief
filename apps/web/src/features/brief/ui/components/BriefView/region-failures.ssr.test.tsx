// No jsdom: renders the way the server does, where no error boundary catches.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ConversationModule from "@web/features/conversation";
import type {
  ConversationPlan,
  ConversationSectionProps,
} from "@web/features/conversation";
import { buildBriefViewHtml } from "@web/features/brief/test-utils";
import { appI18n } from "@web/i18n/I18nProvider";
import type { RevisionTimelinePlan } from "../../../model/types";
import { SIDEBAR_COOKIE } from "./Sidebar/storage";
import type * as RevisionsModule from "./Sidebar/Tabs/Revisions";
import type { RevisionsProps } from "./Sidebar/Tabs/Revisions";
import type * as ThisPrModule from "./Sidebar/Tabs/ThisPr";
import type { ThisPrProps } from "./Sidebar/Tabs/ThisPr";
import {
  SidebarTabs,
  type SidebarPreference,
  type SidebarTab,
} from "./Sidebar/types";

const STORY_GROUP = 'data-testid="story-group"';

const fault = vi.hoisted(() => ({
  conversation: false,
  thisPr: false,
  revisions: false,
}));
const requestCookies = vi.hoisted(() => new Map<string, string>());

vi.mock("@tanstack/react-start/server", () => ({
  getCookie: (name: string) => requestCookies.get(name),
}));

vi.mock("@web/features/conversation", async (importOriginal) => {
  const actual = await importOriginal<typeof ConversationModule>();
  function FaultyConversationSection(props: ConversationSectionProps) {
    if (fault.conversation) {
      throw new Error("section failed");
    }
    return <actual.ConversationSection {...props} />;
  }
  return { ...actual, ConversationSection: FaultyConversationSection };
});

vi.mock("./Sidebar/Tabs/ThisPr", async (importOriginal) => {
  const actual = await importOriginal<typeof ThisPrModule>();
  function FaultyThisPr(props: ThisPrProps) {
    if (fault.thisPr) {
      throw new Error("tab failed");
    }
    return <actual.ThisPr {...props} />;
  }
  return { ...actual, ThisPr: FaultyThisPr };
});

vi.mock("./Sidebar/Tabs/Revisions", async (importOriginal) => {
  const actual = await importOriginal<typeof RevisionsModule>();
  function FaultyRevisions(props: RevisionsProps) {
    if (fault.revisions) {
      throw new Error("tab failed");
    }
    return <actual.Revisions {...props} />;
  }
  return { ...actual, Revisions: FaultyRevisions };
});

function stubRevisionPlan(): RevisionTimelinePlan {
  return {
    view: {
      rows: [
        {
          key: "a",
          ordinal: 1,
          shortSha: "aaaaaaa",
          current: true,
          newest: true,
        },
      ],
    },
    selectRevision: vi.fn(),
  };
}

function stubPlan(): ConversationPlan {
  const plan = {
    queryOptions: {
      queryKey: ["conversation", "42", 7],
      queryFn: () => new Promise(() => undefined),
      retry: false,
    },
    postReply: vi.fn(),
  };
  // Structural stand-in for the real plan (test-only escape hatch).
  return plan as unknown as ConversationPlan;
}

/** The request of a reader who left the sidebar open on `tab`. */
function openSidebar(tab: SidebarTab): void {
  const preference: SidebarPreference = { expanded: true, tab };
  const stored = JSON.stringify(preference);
  requestCookies.set(SIDEBAR_COOKIE, encodeURIComponent(stored));
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  fault.conversation = false;
  fault.thisPr = false;
  fault.revisions = false;
  requestCookies.clear();
  vi.restoreAllMocks();
});

describe("BriefView on the server render, a region that throws", () => {
  it("renders the story and both regions when nothing throws", async () => {
    openSidebar(SidebarTabs.THIS_PR);

    const html = await buildBriefViewHtml({ conversation: stubPlan() });

    expect(html).toContain(STORY_GROUP);
    expect(html).not.toContain(appI18n.t("conversation.renderFailed"));
    expect(html).not.toContain(appI18n.t("brief.sidebar.renderFailed"));
  });

  it("keeps the story when the conversation section throws", async () => {
    fault.conversation = true;

    const html = await buildBriefViewHtml({ conversation: stubPlan() });

    expect(html).toContain(appI18n.t("conversation.renderFailed"));
    expect(html).toContain(STORY_GROUP);
  });

  it("keeps the story when a sidebar tab throws", async () => {
    fault.thisPr = true;
    openSidebar(SidebarTabs.THIS_PR);

    const html = await buildBriefViewHtml();

    expect(html).toContain(appI18n.t("brief.sidebar.renderFailed"));
    expect(html).toContain(STORY_GROUP);
  });

  it("keeps the story when the Revisions tab throws", async () => {
    fault.revisions = true;
    openSidebar(SidebarTabs.REVISIONS);

    const html = await buildBriefViewHtml({ revisions: stubRevisionPlan() });

    expect(html).toContain(appI18n.t("brief.sidebar.renderFailed"));
    expect(html).toContain(STORY_GROUP);
  });
});
