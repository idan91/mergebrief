// @vitest-environment jsdom
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { UploadAttachmentResponse } from "contract";
import type { Equals } from "types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod/v4";

import type * as ApiFetchModule from "@web/data/apiFetch";
import { apiFetch } from "@web/data/apiFetch";
import type { ReadsWireFields } from "@web/test/wire-fields";
import { AttachmentScopeProvider } from "../Markdown/context";
import { MarkdownTextarea } from ".";
import type { uploadAttachmentResponseSchema } from "./schemas";
import {
  MentionCandidateKinds,
  type MentionCandidate,
  type MentionSuggestions,
} from "./types";
import { resetAttachmentUploadState } from "./useAttachmentUpload";

function Harness({
  initial = "",
  label = "Comment",
  readOnly = false,
  suggestionSeed,
  mentionCandidates,
  mentionSuggestions,
  onMentionQueryChange,
  onEscape,
  onSubmit,
}: {
  initial?: string;
  label?: string;
  readOnly?: boolean;
  suggestionSeed?: string | undefined;
  mentionCandidates?: readonly MentionCandidate[] | undefined;
  mentionSuggestions?: MentionSuggestions | undefined;
  onMentionQueryChange?: ((query: string | undefined) => void) | undefined;
  onEscape?: (() => void) | undefined;
  onSubmit?: (() => void) | undefined;
}) {
  const [value, setValue] = useState(initial);
  return (
    <MarkdownTextarea
      label={label}
      mentionCandidates={mentionCandidates}
      mentionSuggestions={mentionSuggestions}
      readOnly={readOnly}
      suggestionSeed={suggestionSeed}
      value={value}
      onChange={setValue}
      onEscape={onEscape}
      onMentionQueryChange={onMentionQueryChange}
      onSubmit={onSubmit}
    />
  );
}

function textarea(): HTMLTextAreaElement {
  const element = screen.getByLabelText("Comment");
  if (!(element instanceof HTMLTextAreaElement)) {
    throw new Error("expected a textarea");
  }
  return element;
}

describe("MarkdownTextarea", () => {
  it("renders a labeled textarea inside a Write tab", () => {
    render(<Harness />);
    expect(textarea()).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Write", selected: true }),
    ).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Preview", selected: false }),
    ).toBeTruthy();
  });

  it("switches to the preview panel and renders markdown", () => {
    render(<Harness initial="**bold move**" />);
    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(
      screen.getByRole("tab", { name: "Preview", selected: true }),
    ).toBeTruthy();
    expect(screen.getByText("bold move").tagName).toBe("STRONG");
    // The write panel and its textarea are hidden: one visible panel.
    expect(screen.getAllByRole("tabpanel").length).toBe(1);
  });

  it("moves between tabs with arrow keys", () => {
    render(<Harness />);
    const writeTab = screen.getByRole("tab", { name: "Write" });
    writeTab.focus();
    // Bubbles to the tablist's keydown handler.
    fireEvent.keyDown(writeTab, { key: "ArrowRight" });
    expect(
      screen.getByRole("tab", { name: "Preview", selected: true }),
    ).toBeTruthy();
  });

  it("exposes a formatting toolbar with one roving tab stop", () => {
    render(<Harness />);
    const toolbar = screen.getByRole("toolbar", { name: "Formatting" });
    const buttons = screen.getAllByRole("button", {
      name: /Bold|Italic|Inline code|Quote|Bulleted list|Numbered list|Task list|Link/,
    });
    expect(buttons.length).toBe(8);
    expect(buttons.filter((button) => button.tabIndex === 0).length).toBe(1);
    const bold = screen.getByRole("button", { name: "Bold" });
    bold.focus();
    fireEvent.keyDown(toolbar, { key: "ArrowRight" });
    const italic = screen.getByRole("button", { name: "Italic" });
    expect(document.activeElement).toBe(italic);
    // The tab stop roves with focus: Tab out and back must re-enter at
    // the last-focused control, not reset to the first button.
    expect(italic.tabIndex).toBe(0);
    expect(bold.tabIndex).toBe(-1);
  });

  it("wraps the selection when a formatting button is clicked", () => {
    render(<Harness initial="hello world" />);
    const input = textarea();
    input.setSelectionRange(6, 11);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(input.value).toBe("hello **world**");
  });

  it("applies formatting shortcuts from the keyboard", () => {
    render(<Harness initial="hello world" />);
    const input = textarea();
    input.setSelectionRange(0, 5);
    fireEvent.keyDown(input, { key: "b", metaKey: true });
    expect(input.value).toBe("**hello** world");
  });

  it("is inert while read-only: toolbar and shortcuts must not mutate", () => {
    render(<Harness initial="hello" readOnly />);
    const input = textarea();
    input.setSelectionRange(0, 5);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(input.value).toBe("hello");
    fireEvent.keyDown(input, { key: "b", metaKey: true });
    expect(input.value).toBe("hello");
  });

  it("scopes textarea ids per instance", () => {
    render(
      <>
        <Harness label="First" />
        <Harness label="Second" />
      </>,
    );
    const first = screen.getByLabelText("First");
    const second = screen.getByLabelText("Second");
    expect(first.id).not.toBe(second.id);
    expect(first.id.length).toBeGreaterThan(0);
  });

  it("continues a list on Enter; Shift+Enter stays a plain newline", () => {
    render(<Harness initial="- item" />);
    const input = textarea();
    input.setSelectionRange(6, 6);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("- item\n- ");
    // Shift+Enter falls through to the browser default (no marker insert).
    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(input.value).toBe("- item\n- ");
  });

  it("indents and outdents list lines with Tab/Shift+Tab", () => {
    render(<Harness initial="- item" />);
    const input = textarea();
    input.setSelectionRange(3, 3);
    fireEvent.keyDown(input, { key: "Tab" });
    expect(input.value).toBe("  - item");
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(input.value).toBe("- item");
  });

  it("submits on Cmd/Ctrl+Enter from the preview panel too", () => {
    const onSubmit = vi.fn();
    render(<Harness initial="ready" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    fireEvent.keyDown(screen.getByRole("tabpanel"), {
      key: "Enter",
      metaKey: true,
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("ignores keydowns that commit an IME composition", () => {
    const onSubmit = vi.fn();
    render(<Harness initial="- item" onSubmit={onSubmit} />);
    const input = textarea();
    input.setSelectionRange(6, 6);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(input.value).toBe("- item");
    fireEvent.keyDown(input, {
      key: "Enter",
      metaKey: true,
      isComposing: true,
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("stops Escape propagation only when a consumer hook handles it", () => {
    const windowListener = vi.fn();
    window.addEventListener("keydown", windowListener);
    try {
      const onEscape = vi.fn();
      const { unmount } = render(<Harness onEscape={onEscape} />);
      fireEvent.keyDown(textarea(), { key: "Escape" });
      expect(onEscape).toHaveBeenCalledTimes(1);
      expect(windowListener).not.toHaveBeenCalled();
      unmount();
      // Without the hook, Escape must keep bubbling (CommentComposer's
      // window-level close listener depends on it).
      render(<Harness />);
      fireEvent.keyDown(textarea(), { key: "Escape" });
      expect(windowListener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", windowListener);
    }
  });

  it("wraps inline code on Cmd/Ctrl+E", () => {
    render(<Harness initial="hello world" />);
    const input = textarea();
    input.setSelectionRange(0, 5);
    fireEvent.keyDown(input, { key: "e", metaKey: true });
    expect(input.value).toBe("`hello` world");
  });

  it("toggles Write/Preview on Cmd/Ctrl+Shift+P", () => {
    render(<Harness initial="text" />);
    fireEvent.keyDown(textarea(), { key: "p", metaKey: true, shiftKey: true });
    expect(
      screen.getByRole("tab", { name: "Preview", selected: true }),
    ).toBeTruthy();
  });

  describe("mention autocomplete", () => {
    const CANDIDATES: readonly MentionCandidate[] = [
      {
        kind: MentionCandidateKinds.USER,
        login: "alice",
        name: "Alice Example",
        avatarUrl: "https://avatars.example/alice.png",
      },
      { kind: MentionCandidateKinds.USER, login: "albert" },
      {
        kind: MentionCandidateKinds.USER,
        login: "bob",
        avatarUrl: "https://avatars.example/bob.png",
      },
      {
        kind: MentionCandidateKinds.TEAM,
        combinedSlug: "acme/core",
        name: "Core maintainers",
      },
    ];

    function typeMention(text: string) {
      const input = textarea();
      fireEvent.change(input, { target: { value: text } });
      return input;
    }

    it("opens a filtered listbox while typing a mention", () => {
      render(<Harness mentionCandidates={CANDIDATES} />);
      typeMention("hi @al");
      const options = screen.getAllByRole("option");
      expect(options.map((option) => option.textContent?.trim())).toEqual([
        "@alice Alice Example",
        "@albert",
      ]);
      expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    });

    it("renders avatar and display name when the candidate carries them", () => {
      render(<Harness mentionCandidates={CANDIDATES} />);
      typeMention("hi @al");
      const [alice, albert] = screen.getAllByRole("option");
      if (alice === undefined || albert === undefined) {
        throw new Error("expected two options");
      }
      // Rich candidate: avatar image + login + muted display name.
      const avatar = alice.querySelector("img");
      expect(avatar?.getAttribute("src")).toBe(
        "https://avatars.example/alice.png",
      );
      // Decorative; the option text already carries the identity.
      expect(avatar?.getAttribute("alt")).toBe("");
      expect(alice.textContent?.trim()).toBe("@alice Alice Example");
      // Login-only candidate: no img, no name, still a valid option.
      expect(albert.querySelector("img")).toBeNull();
      expect(albert.textContent?.trim()).toBe("@albert");
    });

    it("keeps the mention list in the editor's flow by default", () => {
      render(<Harness mentionCandidates={CANDIDATES} />);
      typeMention("hi @al");
      const popup = screen.getByRole("listbox").parentElement;
      expect(popup?.hasAttribute("data-variant")).toBe(false);
      expect(popup?.getAttribute("style")).toBeNull();
    });

    it("stays closed with no candidate pool", () => {
      render(<Harness />);
      typeMention("hi @al");
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("inserts the highlighted login on Enter and closes", () => {
      render(<Harness mentionCandidates={CANDIDATES} />);
      const input = typeMention("hi @al");
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(input.value).toBe("hi @albert ");
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("inserts on mousedown selection", () => {
      render(<Harness mentionCandidates={CANDIDATES} />);
      const input = typeMention("@b");
      fireEvent.mouseDown(screen.getByRole("option", { name: "@bob" }));
      expect(input.value).toBe("@bob ");
    });

    it("Escape dismisses the popup without firing the consumer hook", () => {
      const onEscape = vi.fn();
      render(<Harness mentionCandidates={CANDIDATES} onEscape={onEscape} />);
      const input = typeMention("@al");
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByRole("listbox")).toBeNull();
      expect(onEscape).not.toHaveBeenCalled();
      // A second Escape (popup closed) reaches the consumer hook.
      fireEvent.keyDown(input, { key: "Escape" });
      expect(onEscape).toHaveBeenCalledTimes(1);
    });

    it("Cmd+Enter belongs to the editor and submits what the user sees", () => {
      const onSubmit = vi.fn();
      render(<Harness mentionCandidates={CANDIDATES} onSubmit={onSubmit} />);
      const input = typeMention("hi @al");
      fireEvent.keyDown(input, { key: "Enter", metaKey: true });
      // No insertion: the submit captures the body exactly as displayed.
      expect(input.value).toBe("hi @al");
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it("accepts with Tab too", () => {
      render(<Harness mentionCandidates={CANDIDATES} />);
      const input = typeMention("@b");
      fireEvent.keyDown(input, { key: "Tab" });
      expect(input.value).toBe("@bob ");
    });

    it("ignores keydowns from an IME composition", () => {
      render(<Harness mentionCandidates={CANDIDATES} />);
      const input = typeMention("@al");
      fireEvent.keyDown(input, { key: "ArrowDown", isComposing: true });
      expect(
        screen
          .getByRole("option", { name: /@alice/ })
          .getAttribute("aria-selected"),
      ).toBe("true");
    });

    it("closes on blur and reopens on the next caret activity", () => {
      render(<Harness mentionCandidates={CANDIDATES} />);
      const input = typeMention("@al");
      expect(screen.getByRole("listbox")).toBeTruthy();
      fireEvent.blur(input);
      expect(screen.queryByRole("listbox")).toBeNull();
      typeMention("@ali");
      expect(screen.getByRole("listbox")).toBeTruthy();
    });

    it("an Escape dismissal dies with the mention: retyping reopens", () => {
      render(<Harness mentionCandidates={CANDIDATES} />);
      const input = typeMention("@a");
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByRole("listbox")).toBeNull();
      typeMention("");
      typeMention("@b");
      expect(screen.getByRole("listbox")).toBeTruthy();
    });

    it("a team row names itself a team with the slug first", () => {
      render(<Harness mentionCandidates={CANDIDATES} />);
      typeMention("@ac");
      const team = screen.getByRole("option", {
        name: "Team @acme/core Core maintainers",
      });
      expect(team.querySelector("img")).toBeNull();
      expect(team.querySelector("svg")).not.toBeNull();
    });

    it("selecting a team inserts its combined slug", () => {
      render(<Harness mentionCandidates={CANDIDATES} />);
      const input = typeMention("cc @acme/co");
      fireEvent.keyDown(input, { key: "Enter" });
      expect(input.value).toBe("cc @acme/core ");
    });

    it("Enter falls through to list continuation when the popup is closed", () => {
      render(<Harness mentionCandidates={CANDIDATES} />);
      const input = typeMention("- item");
      input.setSelectionRange(6, 6);
      fireEvent.keyDown(input, { key: "Enter" });
      expect(input.value).toBe("- item\n- ");
    });
  });

  describe("mention suggestions from the caller", () => {
    const BOB: MentionCandidate = {
      kind: MentionCandidateKinds.USER,
      login: "bob",
    };
    const CORE: MentionCandidate = {
      kind: MentionCandidateKinds.TEAM,
      combinedSlug: "acme/core",
      name: "Core",
    };
    const ZED: MentionCandidate = {
      kind: MentionCandidateKinds.USER,
      login: "zed",
    };

    function typeMention(text: string) {
      const input = textarea();
      fireEvent.change(input, { target: { value: text } });
      return input;
    }

    function readOptionNames(): string[] {
      const options = screen.getAllByRole("option");
      const names = options.map((option) => option.textContent?.trim() ?? "");
      return names;
    }

    function readSearchStatus(): HTMLElement {
      return screen.getByRole("status");
    }

    it("reports the query being typed and its end", () => {
      const onMentionQueryChange = vi.fn();
      render(
        <Harness
          mentionSuggestions={{ query: "", candidates: [], pending: false }}
          onMentionQueryChange={onMentionQueryChange}
        />,
      );
      typeMention("hi @al");
      expect(onMentionQueryChange).toHaveBeenLastCalledWith("al");
      typeMention("hi @al done");
      expect(onMentionQueryChange).toHaveBeenLastCalledWith(undefined);
    });

    it("shows the caller's answer as given, without filtering", () => {
      render(
        <Harness
          mentionSuggestions={{
            query: "al",
            candidates: [BOB, CORE],
            pending: false,
          }}
        />,
      );
      typeMention("hi @al");
      expect(readOptionNames()).toEqual(["@bob", "@acme/core Core"]);
    });

    it("keeps the last answer on screen while the next one is pending", () => {
      const view = render(
        <Harness
          mentionSuggestions={{ query: "a", candidates: [BOB], pending: false }}
        />,
      );
      typeMention("@a");
      expect(readOptionNames()).toEqual(["@bob"]);
      typeMention("@al");
      expect(readOptionNames()).toEqual(["@bob"]);
      view.rerender(
        <Harness
          mentionSuggestions={{ query: "a", candidates: [BOB], pending: true }}
        />,
      );
      expect(readOptionNames()).toEqual(["@bob"]);
      expect(screen.getByText("Searching…")).toBeTruthy();
    });

    it("opens with only the search state before the first answer", () => {
      render(
        <Harness
          mentionSuggestions={{ query: "", candidates: [], pending: true }}
        />,
      );
      typeMention("@a");
      expect(screen.getByRole("listbox")).toBeTruthy();
      expect(screen.queryAllByRole("option")).toEqual([]);
      expect(screen.getByText("Searching…")).toBeTruthy();
    });

    it("stays quiet about searching while rows are on screen", () => {
      const view = render(
        <Harness
          mentionSuggestions={{ query: "a", candidates: [BOB], pending: false }}
        />,
      );
      typeMention("@a");
      typeMention("@al");
      view.rerender(
        <Harness
          mentionSuggestions={{ query: "a", candidates: [BOB], pending: true }}
        />,
      );
      expect(readSearchStatus().textContent).toBe("");
    });

    it("arrow keys on an empty pending list keep the first row next", () => {
      const view = render(
        <Harness
          mentionSuggestions={{ query: "a", candidates: [], pending: true }}
        />,
      );
      typeMention("@a");
      fireEvent.keyDown(textarea(), { key: "ArrowDown" });
      view.rerender(
        <Harness
          mentionSuggestions={{ query: "a", candidates: [BOB], pending: false }}
        />,
      );
      fireEvent.keyDown(textarea(), { key: "Enter" });
      expect(textarea().value).toBe("@bob ");
    });

    it("a late answer to an older query never replaces the newer one", () => {
      const view = render(
        <Harness
          mentionSuggestions={{
            query: "al",
            candidates: [ZED],
            pending: false,
          }}
        />,
      );
      typeMention("@al");
      expect(readOptionNames()).toEqual(["@zed"]);
      view.rerender(
        <Harness
          mentionSuggestions={{ query: "a", candidates: [BOB], pending: false }}
        />,
      );
      expect(readOptionNames()).toEqual(["@zed"]);
    });

    it("the keyboard works on the list as shown while pending", () => {
      render(
        <Harness
          mentionSuggestions={{
            query: "a",
            candidates: [BOB, ZED],
            pending: true,
          }}
        />,
      );
      const input = typeMention("@a");
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(input.value).toBe("@zed ");
    });

    it("announces the search politely and clears when it lands", () => {
      const view = render(
        <Harness
          mentionSuggestions={{ query: "", candidates: [], pending: true }}
        />,
      );
      expect(readSearchStatus().getAttribute("aria-live")).toBe("polite");
      expect(readSearchStatus().textContent).toBe("");
      typeMention("@a");
      expect(readSearchStatus().textContent).toBe(
        "Searching for mention suggestions",
      );
      view.rerender(
        <Harness
          mentionSuggestions={{ query: "a", candidates: [BOB], pending: false }}
        />,
      );
      expect(readSearchStatus().textContent).toBe("");
    });

    it("closes on an empty answer with nothing pending", () => {
      render(
        <Harness
          mentionSuggestions={{ query: "a", candidates: [], pending: false }}
        />,
      );
      typeMention("@a");
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("stays inert while read-only", () => {
      const onMentionQueryChange = vi.fn();
      render(
        <Harness
          initial="@a"
          mentionSuggestions={{ query: "a", candidates: [BOB], pending: false }}
          readOnly
          onMentionQueryChange={onMentionQueryChange}
        />,
      );
      const input = textarea();
      input.setSelectionRange(2, 2);
      fireEvent.select(input);
      expect(screen.queryByRole("listbox")).toBeNull();
      expect(onMentionQueryChange).not.toHaveBeenCalledWith("a");
    });
  });

  it("only offers Insert suggestion when seeded", () => {
    render(<Harness />);
    expect(
      screen.queryByRole("button", { name: "Insert suggestion" }),
    ).toBeNull();
    cleanup();
    render(<Harness suggestionSeed="const a = 1;" />);
    fireEvent.click(screen.getByRole("button", { name: "Insert suggestion" }));
    expect(textarea().value).toBe("```suggestion\nconst a = 1;\n```");
  });
});

vi.mock("@web/data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return { ...actual, apiFetch: vi.fn() };
});

const apiFetchMock = vi.mocked(apiFetch);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const BRANCH_URL =
  "https://github.com/octo/hello/blob/mergebrief/attachments/3e5dffc4-bd05-4a01-98e8-1c519ba4cf00.png?raw=true";

function makeImageFile(name = "image.png", type = "image/png"): File {
  return new File([PNG_BYTES], name, { type });
}

function deferUpload(): { resolve: (response: Response) => void } {
  let resolve: (response: Response) => void = () => undefined;
  apiFetchMock.mockReturnValueOnce(
    new Promise<Response>((settle) => {
      resolve = settle;
    }),
  );
  return { resolve: (response) => resolve(response) };
}

function uploadedResponse(): Response {
  return new Response(JSON.stringify({ url: BRANCH_URL }), { status: 201 });
}

function refusedResponse(code: string, status: number): Response {
  return new Response(JSON.stringify({ error: code, code }), { status });
}

const LIMIT_CODE = "attachment-limit-reached";
const LIMIT_COPY =
  "You have attached as many images as this server allows for now, so the image was not attached. Try again in a few minutes.";
const RETRY_AFTER_SECONDS = 60;
const MS_PER_SECOND = 1000;

const LIMIT_CEILING_SECONDS = 3600;
const HUGE_RETRY_AFTER_SECONDS = 10 * LIMIT_CEILING_SECONDS;
const LIMIT_FALLBACK_SECONDS = 60;

function makeLimitedResponse(retryAfter = RETRY_AFTER_SECONDS): Response {
  return new Response(JSON.stringify({ error: LIMIT_CODE, code: LIMIT_CODE }), {
    status: 429,
    headers: { "retry-after": String(retryAfter) },
  });
}

interface AttachHarnessProps {
  readonly initial?: string;
  readonly repoId?: string;
  readonly installed?: boolean;
  readonly scoped?: boolean;
  readonly readOnly?: boolean;
  readonly announce?: ((message: string) => void) | undefined;
  readonly announceQuietly?: ((message: string) => void) | undefined;
  readonly onAttachError?: ((copy: string) => void) | undefined;
  readonly onSubmit?: (() => void) | undefined;
}

function AttachHarness({
  initial = "",
  repoId = "555",
  installed = true,
  scoped = true,
  readOnly = false,
  announce,
  announceQuietly,
  onAttachError,
  onSubmit,
}: AttachHarnessProps) {
  const [value, setValue] = useState(initial);
  const editor = (
    <MarkdownTextarea
      announce={announce}
      announceQuietly={announceQuietly}
      label="Comment"
      readOnly={readOnly}
      value={value}
      onAttachError={onAttachError}
      onChange={setValue}
      onSubmit={onSubmit}
    />
  );
  if (!scoped) {
    return editor;
  }
  return (
    <AttachmentScopeProvider installed={installed} prNumber={7} repoId={repoId}>
      {editor}
    </AttachmentScopeProvider>
  );
}

const holdCommits = { current: false };
let releaseHeldCommit: () => void = () => undefined;

/** An owner whose commit lands later than a zero timer, as it does in a browser. */
function HeldCommitHarness() {
  const [value, setValue] = useState("");
  function holdOrCommit(next: string) {
    if (!holdCommits.current) {
      setValue(next);
      return;
    }
    releaseHeldCommit = () => {
      act(() => setValue(next));
    };
  }
  return (
    <AttachmentScopeProvider installed prNumber={7} repoId="555">
      <MarkdownTextarea label="Comment" value={value} onChange={holdOrCommit} />
    </AttachmentScopeProvider>
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

type ParsedUploadReceipt = z.output<typeof uploadAttachmentResponseSchema>;

true satisfies Equals<ParsedUploadReceipt, UploadAttachmentResponse>;
true satisfies ReadsWireFields<ParsedUploadReceipt, UploadAttachmentResponse>;

describe("MarkdownTextarea image attachments", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    resetAttachmentUploadState();
    holdCommits.current = false;
  });

  it("pastes an image as a placeholder and swaps in the image line", async () => {
    const announce = vi.fn();
    const announceQuietly = vi.fn();
    const { resolve } = deferUpload();
    render(
      <AttachHarness
        announce={announce}
        announceQuietly={announceQuietly}
        initial="Look:"
      />,
    );
    const input = textarea();
    input.setSelectionRange(5, 5);

    fireEvent.paste(input, {
      clipboardData: { files: [makeImageFile()], getData: () => "" },
    });

    expect(input.value).toBe("Look:\n![Uploading image.png…]()");
    expect(announceQuietly).toHaveBeenCalledWith("Uploading image");
    expect(announce).not.toHaveBeenCalled();
    await flush();
    const [path, init] = apiFetchMock.mock.calls[0] ?? [];
    expect(path).toBe("/api/repos/555/pulls/7/attachments");
    expect(init?.method).toBe("POST");
    expect(init?.headers?.["content-type"]).toBe("image/png");
    expect(init?.body).toBeInstanceOf(File);

    resolve(uploadedResponse());
    await flush();

    expect(input.value).toBe(`Look:\n![Image](${BRANCH_URL})`);
    expect(announce).not.toHaveBeenCalled();
    expect(announceQuietly).toHaveBeenCalledTimes(1);
  });

  it("drops an image onto the textarea", async () => {
    apiFetchMock.mockResolvedValueOnce(uploadedResponse());
    render(<AttachHarness />);

    fireEvent.drop(textarea(), {
      dataTransfer: { files: [makeImageFile("shot.png")] },
    });
    await flush();

    expect(textarea().value).toBe(`![Image](${BRANCH_URL})`);
  });

  it("lands every image of a multi-file drop, one upload at a time", async () => {
    const first = deferUpload();
    render(<AttachHarness />);

    fireEvent.drop(textarea(), {
      dataTransfer: {
        files: [makeImageFile("image.png"), makeImageFile("image.png")],
      },
    });

    expect(textarea().value).toBe(
      "![Uploading image.png…]()\n![Uploading image.png (2)…]()",
    );
    // The second upload waits for the first: every commit moves one head.
    await flush();
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    const second = deferUpload();
    first.resolve(uploadedResponse());
    await flush();
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    second.resolve(
      new Response(JSON.stringify({ url: "https://example.com/b.png" }), {
        status: 201,
      }),
    );
    await flush();

    expect(textarea().value).toBe(
      `![Image](${BRANCH_URL})\n![Image](https://example.com/b.png)`,
    );
  });

  it("encodes the repository id into the upload path", async () => {
    apiFetchMock.mockResolvedValueOnce(uploadedResponse());
    render(<AttachHarness repoId="a/b" />);

    fireEvent.paste(textarea(), {
      clipboardData: { files: [makeImageFile()], getData: () => "" },
    });
    await flush();

    const [path] = apiFetchMock.mock.calls[0] ?? [];
    expect(path).toBe("/api/repos/a%2Fb/pulls/7/attachments");
  });

  it("removes the placeholder when the receipt carries no url", async () => {
    const onAttachError = vi.fn();
    apiFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ url: 7 }), { status: 201 }),
    );
    render(<AttachHarness onAttachError={onAttachError} />);
    const input = textarea();

    fireEvent.paste(input, {
      clipboardData: { files: [makeImageFile()], getData: () => "" },
    });
    await flush();

    expect(input.value).toBe("");
    expect(onAttachError).toHaveBeenCalledWith(
      "The image could not be uploaded. It was not attached; try again.",
    );
  });

  it("removes the placeholder and reports a refused push", async () => {
    const onAttachError = vi.fn();
    const announce = vi.fn();
    apiFetchMock.mockResolvedValueOnce(
      refusedResponse("attachments-disabled", 403),
    );
    render(<AttachHarness announce={announce} onAttachError={onAttachError} />);
    const input = textarea();
    fireEvent.paste(input, {
      clipboardData: { files: [makeImageFile()], getData: () => "" },
    });
    await flush();

    expect(input.value).toBe("");
    const copy = onAttachError.mock.calls[0]?.[0];
    expect(copy).toContain("blocks attachment pushes");
    expect(announce).toHaveBeenLastCalledWith(copy);
    const attach = screen.getByRole("button", { name: "Attach image" });
    expect(attach.getAttribute("aria-disabled")).toBe("true");
  });

  describe("inside the retry-after window", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("a batch behind a 429 makes one request and leaves no placeholder", async () => {
      const onAttachError = vi.fn();
      apiFetchMock.mockResolvedValueOnce(makeLimitedResponse());
      render(<AttachHarness onAttachError={onAttachError} />);

      fireEvent.drop(textarea(), {
        dataTransfer: {
          files: [
            makeImageFile("a.png"),
            makeImageFile("b.png"),
            makeImageFile("c.png"),
          ],
        },
      });
      await flush();
      await flush();
      await flush();

      expect(apiFetchMock).toHaveBeenCalledTimes(1);
      expect(onAttachError).toHaveBeenCalledTimes(1);
      expect(onAttachError).toHaveBeenLastCalledWith(LIMIT_COPY);
      expect(textarea().value).toBe("");
    });

    it("a later drop inside the window makes no request", async () => {
      const onAttachError = vi.fn();
      apiFetchMock.mockResolvedValueOnce(makeLimitedResponse());
      render(<AttachHarness onAttachError={onAttachError} />);
      fireEvent.drop(textarea(), {
        dataTransfer: { files: [makeImageFile()] },
      });
      await flush();

      vi.setSystemTime(Date.now() + (RETRY_AFTER_SECONDS / 2) * MS_PER_SECOND);
      fireEvent.drop(textarea(), {
        dataTransfer: { files: [makeImageFile()] },
      });
      await flush();

      expect(apiFetchMock).toHaveBeenCalledTimes(1);
      expect(onAttachError).toHaveBeenCalledTimes(2);
      expect(onAttachError).toHaveBeenLastCalledWith(LIMIT_COPY);
      expect(textarea().value).toBe("");
    });

    it("a drop after the window has passed asks the server again", async () => {
      apiFetchMock.mockResolvedValueOnce(makeLimitedResponse());
      render(<AttachHarness />);
      fireEvent.drop(textarea(), {
        dataTransfer: { files: [makeImageFile()] },
      });
      await flush();

      vi.setSystemTime(Date.now() + RETRY_AFTER_SECONDS * MS_PER_SECOND);
      apiFetchMock.mockResolvedValueOnce(uploadedResponse());
      fireEvent.drop(textarea(), {
        dataTransfer: { files: [makeImageFile()] },
      });
      await flush();

      expect(apiFetchMock).toHaveBeenCalledTimes(2);
      expect(textarea().value).toBe(`![Image](${BRANCH_URL})`);
    });

    it("caps a huge retry-after at one hour", async () => {
      apiFetchMock.mockResolvedValueOnce(
        makeLimitedResponse(HUGE_RETRY_AFTER_SECONDS),
      );
      render(<AttachHarness />);
      fireEvent.drop(textarea(), {
        dataTransfer: { files: [makeImageFile()] },
      });
      await flush();

      vi.setSystemTime(Date.now() + LIMIT_CEILING_SECONDS * MS_PER_SECOND);
      apiFetchMock.mockResolvedValueOnce(uploadedResponse());
      fireEvent.drop(textarea(), {
        dataTransfer: { files: [makeImageFile()] },
      });
      await flush();

      expect(apiFetchMock).toHaveBeenCalledTimes(2);
    });

    it("waits the fallback minute when a 429 has no retry-after", async () => {
      apiFetchMock.mockResolvedValueOnce(refusedResponse(LIMIT_CODE, 429));
      render(<AttachHarness />);
      fireEvent.drop(textarea(), {
        dataTransfer: { files: [makeImageFile()] },
      });
      await flush();
      const limitedAt = Date.now();

      vi.setSystemTime(
        limitedAt + (LIMIT_FALLBACK_SECONDS - 1) * MS_PER_SECOND,
      );
      fireEvent.drop(textarea(), {
        dataTransfer: { files: [makeImageFile()] },
      });
      await flush();
      expect(apiFetchMock).toHaveBeenCalledTimes(1);

      vi.setSystemTime(limitedAt + LIMIT_FALLBACK_SECONDS * MS_PER_SECOND);
      apiFetchMock.mockResolvedValueOnce(uploadedResponse());
      fireEvent.drop(textarea(), {
        dataTransfer: { files: [makeImageFile()] },
      });
      await flush();

      expect(apiFetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it("holds Cmd/Ctrl+Enter while an upload is in flight and says so", async () => {
    const announce = vi.fn();
    const onAttachError = vi.fn();
    const onSubmit = vi.fn();
    const { resolve } = deferUpload();
    render(
      <AttachHarness
        announce={announce}
        onAttachError={onAttachError}
        onSubmit={onSubmit}
      />,
    );
    const input = textarea();
    fireEvent.paste(input, {
      clipboardData: { files: [makeImageFile()], getData: () => "" },
    });
    await flush();

    fireEvent.keyDown(input, { key: "Enter", metaKey: true });

    const wait =
      "An image is still uploading; wait for it to land before submitting.";
    expect(onSubmit).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith(wait);
    expect(onAttachError).toHaveBeenCalledWith(wait);

    resolve(uploadedResponse());
    await flush();
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("holds Cmd/Ctrl+Enter on a placeholder the text already carries", () => {
    const onSubmit = vi.fn();
    render(
      <AttachHarness
        initial={"see\n![Uploading shot.png…]()"}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.keyDown(textarea(), { key: "Enter", metaKey: true });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps the caret where the writer was typing when the swap lands", async () => {
    const { resolve } = deferUpload();
    render(<AttachHarness />);
    const input = textarea();
    input.focus();
    fireEvent.paste(input, {
      clipboardData: { files: [makeImageFile()], getData: () => "" },
    });
    await flush();
    fireEvent.change(input, {
      target: { value: `${input.value}\nmore words` },
    });
    const caret = input.value.length - " words".length;
    input.setSelectionRange(caret, caret);

    resolve(uploadedResponse());
    await flush();

    expect(input.value).toBe(`![Image](${BRANCH_URL})\nmore words`);
    const expected = input.value.length - " words".length;
    expect(input.selectionStart).toBe(expected);
    expect(input.selectionEnd).toBe(expected);
  });

  it("keeps the caret when React commits the swap after a timer", async () => {
    const { resolve } = deferUpload();
    render(<HeldCommitHarness />);
    const input = textarea();
    input.focus();
    fireEvent.paste(input, {
      clipboardData: { files: [makeImageFile()], getData: () => "" },
    });
    await flush();
    fireEvent.change(input, {
      target: { value: `${input.value}\nmore words` },
    });
    const caret = input.value.length - " words".length;
    input.setSelectionRange(caret, caret);

    holdCommits.current = true;
    resolve(uploadedResponse());
    await flush();
    await flush();
    releaseHeldCommit();

    expect(input.value).toBe(`![Image](${BRANCH_URL})\nmore words`);
    const expected = input.value.length - " words".length;
    expect(input.selectionStart).toBe(expected);
    expect(input.selectionEnd).toBe(expected);
  });

  it("keeps the caret when a refused batch removes two placeholders", async () => {
    const { resolve } = deferUpload();
    render(<AttachHarness />);
    const input = textarea();
    input.focus();
    fireEvent.drop(input, {
      dataTransfer: {
        files: [makeImageFile("a.png"), makeImageFile("b.png")],
      },
    });
    await flush();
    fireEvent.change(input, {
      target: { value: `${input.value}\nmore words` },
    });
    const caret = input.value.length - " words".length;
    input.setSelectionRange(caret, caret);

    resolve(refusedResponse("attachments-disabled", 403));
    await flush();
    await flush();

    expect(input.value).toBe("more words");
    const expected = input.value.length - " words".length;
    expect(input.selectionStart).toBe(expected);
    expect(input.selectionEnd).toBe(expected);
  });

  it("a placeholder the writer deleted keeps its name taken until it lands", async () => {
    const first = deferUpload();
    const second = deferUpload();
    render(<AttachHarness />);
    const input = textarea();
    fireEvent.paste(input, {
      clipboardData: { files: [makeImageFile()], getData: () => "" },
    });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.paste(input, {
      clipboardData: { files: [makeImageFile()], getData: () => "" },
    });
    await flush();

    expect(input.value).toBe("![Uploading image.png (2)…]()");

    first.resolve(uploadedResponse());
    await flush();
    expect(input.value).toBe("![Uploading image.png (2)…]()");

    second.resolve(
      new Response(JSON.stringify({ url: "https://example.com/b.png" }), {
        status: 201,
      }),
    );
    await flush();
    expect(input.value).toBe("![Image](https://example.com/b.png)");
  });

  it("a swap that lands after the composer left is adopted on remount", async () => {
    const { resolve } = deferUpload();
    const first = render(<AttachHarness />);
    const input = textarea();
    fireEvent.paste(input, {
      clipboardData: { files: [makeImageFile()], getData: () => "" },
    });
    await flush();
    const held = input.value;
    first.unmount();

    resolve(uploadedResponse());
    await flush();
    render(<AttachHarness initial={held} />);
    await flush();

    expect(textarea().value).toBe(`![Image](${BRANCH_URL})`);
  });

  it("a second paste of the same name gets its own placeholder", async () => {
    const first = deferUpload();
    const second = deferUpload();
    render(<AttachHarness initial={"top\n\nbottom"} />);
    const input = textarea();

    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.paste(input, {
      clipboardData: { files: [makeImageFile()], getData: () => "" },
    });
    input.setSelectionRange(3, 3);
    fireEvent.paste(input, {
      clipboardData: { files: [makeImageFile()], getData: () => "" },
    });
    await flush();

    expect(input.value).toBe(
      "top\n![Uploading image.png (2)…]()\n\nbottom\n![Uploading image.png…]()",
    );
    first.resolve(uploadedResponse());
    await flush();
    second.resolve(
      new Response(JSON.stringify({ url: "https://example.com/b.png" }), {
        status: 201,
      }),
    );
    await flush();

    expect(input.value).toBe(
      `top\n![Image](https://example.com/b.png)\n\nbottom\n![Image](${BRANCH_URL})`,
    );
  });

  it("a drop adds a line and keeps the writer's selection", async () => {
    apiFetchMock.mockResolvedValueOnce(uploadedResponse());
    render(<AttachHarness initial="keep this word" />);
    const input = textarea();
    input.setSelectionRange(5, 9);

    fireEvent.drop(input, {
      dataTransfer: { files: [makeImageFile("shot.png")] },
    });
    await flush();

    expect(input.value).toBe(`keep this\n![Image](${BRANCH_URL})\n word`);
  });

  it("a batch behind a refused push asks nothing more of the server", async () => {
    const onAttachError = vi.fn();
    apiFetchMock.mockResolvedValueOnce(
      refusedResponse("attachments-disabled", 403),
    );
    render(<AttachHarness onAttachError={onAttachError} />);

    fireEvent.drop(textarea(), {
      dataTransfer: {
        files: [makeImageFile("a.png"), makeImageFile("b.png")],
      },
    });
    await flush();
    await flush();

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(onAttachError).toHaveBeenCalledTimes(1);
    expect(textarea().value).toBe("");
  });

  it("refuses an oversized or non-image file before any request", () => {
    const onAttachError = vi.fn();
    render(<AttachHarness onAttachError={onAttachError} />);
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.png", {
      type: "image/png",
    });

    fireEvent.drop(textarea(), { dataTransfer: { files: [big] } });
    fireEvent.drop(textarea(), {
      dataTransfer: { files: [makeImageFile("v.svg", "image/svg+xml")] },
    });

    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(onAttachError).toHaveBeenCalledTimes(2);
    expect(textarea().value).toBe("");
  });

  it("leaves a text paste to the browser", () => {
    render(<AttachHarness />);

    fireEvent.paste(textarea(), {
      clipboardData: { files: [], getData: () => "plain" },
    });

    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("opens the file picker from the toolbar and uploads the pick", async () => {
    apiFetchMock.mockResolvedValueOnce(uploadedResponse());
    render(<AttachHarness />);
    const picker = document.querySelector("input[type=file]");
    if (!(picker instanceof HTMLInputElement)) {
      throw new Error("expected a file input");
    }
    const click = vi.spyOn(picker, "click");

    fireEvent.click(screen.getByRole("button", { name: "Attach image" }));
    expect(click).toHaveBeenCalledTimes(1);
    fireEvent.change(picker, { target: { files: [makeImageFile()] } });
    await flush();

    expect(textarea().value).toBe(`![Image](${BRANCH_URL})`);
    expect(screen.getByText("mergebrief/attachments").tagName).toBe("CODE");
  });

  it("is off with a reason outside a pull request or without the app", () => {
    const { unmount } = render(<AttachHarness scoped={false} />);
    const unscoped = screen.getByRole("button", { name: "Attach image" });
    expect(unscoped.getAttribute("aria-disabled")).toBe("true");
    expect(unscoped.getAttribute("aria-description")).toContain(
      "inside a pull request",
    );
    expect(screen.queryByText(/mergebrief\/attachments/)).toBeNull();
    unmount();

    render(<AttachHarness installed={false} />);
    const urlBox = screen.getByRole("button", { name: "Attach image" });
    expect(urlBox.getAttribute("aria-disabled")).toBe("true");
    expect(urlBox.getAttribute("aria-description")).toContain("App installed");
    fireEvent.paste(textarea(), {
      clipboardData: { files: [makeImageFile()], getData: () => "" },
    });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("stays inert while read-only", () => {
    render(<AttachHarness readOnly />);

    fireEvent.drop(textarea(), {
      dataTransfer: { files: [makeImageFile()] },
    });

    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});
