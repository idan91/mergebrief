import { describe, expect, it } from "vitest";

import {
  activeMentionQuery,
  applyLinePrefix,
  applyLinkTemplate,
  applyMarkdownWrap,
  applyOrderedListPrefix,
  continueListOnEnter,
  filterByHandlePrefix,
  fitListToAnchor,
  indentListSelection,
  insertMention,
  readMentionHandle,
  replaceSelectionWithSuggestion,
  buildUploadPlaceholders,
  findUploadPlaceholders,
  hasUploadPlaceholder,
  insertPlaceholder,
  parseRetryAfterSeconds,
  replacePlaceholder,
} from "./utils";
import {
  MentionCandidateKinds,
  RetryAfterRejections,
  type MentionCandidate,
} from "./types";
import { createI18n } from "i18n";

const t = createI18n().t;

describe("applyMarkdownWrap", () => {
  it("wraps selected text with markdown markers", () => {
    expect(applyMarkdownWrap("hello world", 6, 11, "**")).toEqual({
      text: "hello **world**",
      selectionStart: 8,
      selectionEnd: 13,
    });
  });

  it("inserts an empty pair at a collapsed selection", () => {
    expect(applyMarkdownWrap("hello", 5, 5, "`")).toEqual({
      text: "hello``",
      selectionStart: 6,
      selectionEnd: 6,
    });
  });
});

describe("applyLinePrefix", () => {
  it("prefixes every selected line and collapses the caret to the end", () => {
    expect(applyLinePrefix("one\ntwo", 0, 7, "- ")).toEqual({
      text: "- one\n- two",
      selectionStart: 11,
      selectionEnd: 11,
    });
  });

  it("inserts only the marker at a collapsed selection, no placeholder", () => {
    expect(applyLinePrefix("", 0, 0, "- [ ] ")).toEqual({
      text: "- [ ] ",
      selectionStart: 6,
      selectionEnd: 6,
    });
  });

  it("puts the marker at the line start when the caret sits mid-line", () => {
    expect(applyLinePrefix("note", 4, 4, "> ")).toEqual({
      text: "> note",
      selectionStart: 6,
      selectionEnd: 6,
    });
  });
});

describe("applyLinkTemplate", () => {
  it("wraps the selection as link text", () => {
    expect(applyLinkTemplate(t, "see docs", 4, 8)).toEqual({
      text: "see [docs](https://example.com)",
      selectionStart: 5,
      selectionEnd: 9,
    });
  });
});

describe("continueListOnEnter", () => {
  it("continues a bulleted item", () => {
    const text = "- first";
    expect(continueListOnEnter(text, 7, 7)).toEqual({
      text: "- first\n- ",
      selectionStart: 10,
      selectionEnd: 10,
    });
  });

  it("increments a numbered item", () => {
    const text = "1. one\n2. two";
    expect(continueListOnEnter(text, 13, 13)).toEqual({
      text: "1. one\n2. two\n3. ",
      selectionStart: 17,
      selectionEnd: 17,
    });
  });

  it("continues a task item unchecked, even from a checked one", () => {
    const text = "- [x] done";
    expect(continueListOnEnter(text, 10, 10)).toEqual({
      text: "- [x] done\n- [ ] ",
      selectionStart: 17,
      selectionEnd: 17,
    });
  });

  it("keeps the indent and splits text after the caret into the new item", () => {
    const text = "  - abcd";
    expect(continueListOnEnter(text, 6, 6)).toEqual({
      text: "  - ab\n  - cd",
      selectionStart: 11,
      selectionEnd: 11,
    });
  });

  it("terminates the list on an empty item", () => {
    const text = "- one\n- ";
    expect(continueListOnEnter(text, 8, 8)).toEqual({
      text: "- one\n",
      selectionStart: 6,
      selectionEnd: 6,
    });
  });

  it("declines outside lists and on non-collapsed selections", () => {
    expect(continueListOnEnter("plain text", 5, 5)).toBeNull();
    expect(continueListOnEnter("- item", 2, 4)).toBeNull();
  });

  it("declines when the caret sits inside the marker", () => {
    expect(continueListOnEnter("- item", 1, 1)).toBeNull();
  });
});

describe("indentListSelection", () => {
  it("indents a single list line and moves the caret with it", () => {
    expect(indentListSelection("- item", 3, 3, "indent")).toEqual({
      text: "  - item",
      selectionStart: 5,
      selectionEnd: 5,
    });
  });

  it("outdents back to the margin", () => {
    expect(indentListSelection("  - item", 5, 5, "outdent")).toEqual({
      text: "- item",
      selectionStart: 3,
      selectionEnd: 3,
    });
  });

  it("indents every list line in a multi-line selection", () => {
    const text = "- one\n- two";
    expect(indentListSelection(text, 0, 11, "indent")).toEqual({
      text: "  - one\n  - two",
      selectionStart: 2,
      selectionEnd: 15,
    });
  });

  it("declines when no selected line is a list item", () => {
    expect(indentListSelection("plain", 2, 2, "indent")).toBeNull();
  });

  it("declines an at-margin outdent instead of consuming a no-op", () => {
    expect(indentListSelection("- item", 3, 3, "outdent")).toBeNull();
  });

  it("excludes a line the selection only touches at column 0", () => {
    // Selection ends at the start of line 2 (shift-down selection): line 2
    // is not visibly selected, so outdent must not touch it, and line 1
    // is already at the margin, so the whole edit declines.
    expect(indentListSelection("- a\n  - b", 0, 4, "outdent")).toBeNull();
  });
});

describe("applyOrderedListPrefix", () => {
  it("starts at 1 with no numbered context", () => {
    expect(applyOrderedListPrefix("alpha", 0, 5)).toEqual({
      text: "1. alpha",
      selectionStart: 8,
      selectionEnd: 8,
    });
  });

  it("inserts only the marker at a collapsed selection, no placeholder", () => {
    expect(applyOrderedListPrefix("", 0, 0)).toEqual({
      text: "1. ",
      selectionStart: 3,
      selectionEnd: 3,
    });
  });

  it("continues numbering from the line above, collapsed caret included", () => {
    expect(applyOrderedListPrefix("1. one\ntwo", 7, 10)).toEqual({
      text: "1. one\n2. two",
      selectionStart: 13,
      selectionEnd: 13,
    });
    expect(applyOrderedListPrefix("1. one\n", 7, 7)).toEqual({
      text: "1. one\n2. ",
      selectionStart: 10,
      selectionEnd: 10,
    });
  });

  it("numbers a multi-line selection sequentially", () => {
    const text = "a\nb";
    expect(applyOrderedListPrefix(text, 0, 3)).toEqual({
      text: "1. a\n2. b",
      selectionStart: 9,
      selectionEnd: 9,
    });
  });
});

describe("activeMentionQuery", () => {
  it("finds the mention being typed at the caret", () => {
    expect(activeMentionQuery("hi @al", 6)).toEqual({ start: 3, query: "al" });
    expect(activeMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
  });

  it("requires a boundary before the @, so emails are not mentions", () => {
    expect(activeMentionQuery("mail me a@b", 11)).toBeNull();
  });

  it("follows a team slug after the org", () => {
    expect(activeMentionQuery("cc @acme/core-a", 15)).toEqual({
      start: 3,
      query: "acme/core-a",
    });
    expect(activeMentionQuery("cc @acme/web.ui", 15)).toEqual({
      start: 3,
      query: "acme/web.ui",
    });
  });

  it("ends the mention at a sentence dot", () => {
    expect(activeMentionQuery("@acme/core.", 11)).toBeNull();
  });

  it("declines when the caret has left the mention", () => {
    expect(activeMentionQuery("@alice done", 11)).toBeNull();
  });

  it("suppresses mentions inside an open code fence of either style", () => {
    expect(activeMentionQuery("```\n@al", 7)).toBeNull();
    expect(activeMentionQuery("~~~\n@al", 7)).toBeNull();
    expect(activeMentionQuery("```\ncode\n```\n@al", 16)).toEqual({
      start: 13,
      query: "al",
    });
  });
});

describe("insertMention", () => {
  it("replaces the typed query with the login and a trailing space", () => {
    expect(insertMention("hi @al there", 3, 6, "alice")).toEqual({
      text: "hi @alice  there",
      selectionStart: 10,
      selectionEnd: 10,
    });
  });

  it("consumes the token tail on a mid-token accept", () => {
    expect(insertMention("@albert", 0, 3, "alice")).toEqual({
      text: "@alice ",
      selectionStart: 7,
      selectionEnd: 7,
    });
  });

  it("consumes a team slug tail but leaves a sentence dot", () => {
    expect(insertMention("@acme/core-team.", 0, 3, "acme/core")).toEqual({
      text: "@acme/core .",
      selectionStart: 11,
      selectionEnd: 11,
    });
  });
});

describe("readMentionHandle", () => {
  it("reads the login of a user and the combined slug of a team", () => {
    expect(
      readMentionHandle({ kind: MentionCandidateKinds.USER, login: "alice" }),
    ).toBe("alice");
    expect(
      readMentionHandle({
        kind: MentionCandidateKinds.TEAM,
        combinedSlug: "acme/core",
        name: "Core",
      }),
    ).toBe("acme/core");
  });
});

describe("filterByHandlePrefix", () => {
  const CANDIDATES: readonly MentionCandidate[] = [
    { kind: MentionCandidateKinds.USER, login: "Alice" },
    { kind: MentionCandidateKinds.USER, login: "malice" },
    { kind: MentionCandidateKinds.USER, login: "albert" },
    {
      kind: MentionCandidateKinds.TEAM,
      combinedSlug: "acme/core",
      name: "Alpha core",
    },
  ];

  it("keeps handles starting with the query, ignoring case, in pool order", () => {
    expect(filterByHandlePrefix(CANDIDATES, "AL")).toEqual([
      CANDIDATES[0],
      CANDIDATES[2],
    ]);
  });

  it("matches a team on its combined slug, never its name", () => {
    expect(filterByHandlePrefix(CANDIDATES, "acme/c")).toEqual([CANDIDATES[3]]);
    expect(filterByHandlePrefix(CANDIDATES, "alpha")).toEqual([]);
  });

  it("keeps the whole pool for an empty query", () => {
    expect(filterByHandlePrefix(CANDIDATES, "")).toEqual(CANDIDATES);
  });
});

describe("fitListToAnchor", () => {
  function fitList(referenceWidth: number, availableHeight: number) {
    const floating = { style: {} } as HTMLElement;
    const state = {
      rects: { reference: { width: referenceWidth } },
      availableHeight,
      elements: { floating },
    } as unknown as Parameters<typeof fitListToAnchor>[0];

    fitListToAnchor(state);
    return floating.style;
  }

  it("takes the textarea's width and caps its height to the room left", () => {
    const style = fitList(320, 180);

    expect(style.inlineSize).toBe("320px");
    expect(style.maxBlockSize).toBe("180px");
  });

  it("caps the height at zero when no room is left", () => {
    expect(fitList(320, -40).maxBlockSize).toBe("0px");
  });
});

describe("replaceSelectionWithSuggestion", () => {
  it("replaces a selected range with a suggestion fence", () => {
    expect(
      replaceSelectionWithSuggestion("Before\nAfter", 7, 12, "next();"),
    ).toEqual({
      text: "Before\n```suggestion\nnext();\n```",
      selectionStart: 21,
      selectionEnd: 28,
    });
  });
});

describe("insertPlaceholder", () => {
  it("puts the placeholder on its own line at the caret", () => {
    const edit = insertPlaceholder("before\nafter", 7, 7, "![Uploading x…]()");

    expect(edit.text).toBe("before\n![Uploading x…]()\nafter");
    expect(edit.selectionStart).toBe("before\n![Uploading x…]()".length);
    expect(edit.selectionEnd).toBe(edit.selectionStart);
  });

  it("adds no blank lines when the caret already sits on a line edge", () => {
    const edit = insertPlaceholder("line\n", 5, 5, "P");

    expect(edit.text).toBe("line\nP");
  });

  it("replaces a selection", () => {
    const edit = insertPlaceholder("keep drop keep", 5, 9, "P");

    expect(edit.text).toBe("keep \nP\n keep");
  });
});

describe("buildUploadPlaceholders", () => {
  it("numbers a name the batch or the text already holds", () => {
    const files = [
      new File([""], "image.png"),
      new File([""], "image.png"),
      new File([""], "other.png"),
    ];

    const placeholders = buildUploadPlaceholders(
      files,
      "![Uploading image.png…]()\n![Uploading image.png (2)…]()",
      new Set(["![Uploading other.png…]()"]),
    );

    expect(placeholders).toEqual([
      "![Uploading image.png (3)…]()",
      "![Uploading image.png (4)…]()",
      "![Uploading other.png (2)…]()",
    ]);
  });

  it("drops link syntax and control characters from a file name", () => {
    const files = [
      new File([""], "x](https://evil.example/a.png"),
      new File([""], "ab]cd.png"),
      new File([""], "a\nb\u0000c.png"),
      new File([""], "]"),
    ];

    const placeholders = buildUploadPlaceholders(files, "", new Set());

    expect(placeholders).toEqual([
      "![Uploading x(https://evil.example/a.png…]()",
      "![Uploading abcd.png…]()",
      "![Uploading abc.png…]()",
      "![Uploading image…]()",
    ]);
    for (const placeholder of placeholders) {
      expect(hasUploadPlaceholder(placeholder)).toBe(true);
    }
  });
});

describe("hasUploadPlaceholder", () => {
  it("sees an upload's line and nothing else", () => {
    expect(hasUploadPlaceholder("a\n![Uploading shot.png…]()\nb")).toBe(true);
    expect(hasUploadPlaceholder("![Image](https://x/y.png)")).toBe(false);
    expect(hasUploadPlaceholder("Uploading shot.png")).toBe(false);
  });
});

describe("findUploadPlaceholders", () => {
  it("lists every upload line in order and nothing else", () => {
    const text = "a\n![Uploading a.png…]()\n![Image](x)\n![Uploading b.png…]()";
    expect(findUploadPlaceholders(text)).toEqual([
      "![Uploading a.png…]()",
      "![Uploading b.png…]()",
    ]);
    expect(findUploadPlaceholders("plain")).toEqual([]);
  });
});

describe("replacePlaceholder", () => {
  it("swaps the first placeholder for the image line", () => {
    const edit = replacePlaceholder("a\nP\nb\nP", "P", "![Image](u)");

    expect(edit?.text).toBe("a\n![Image](u)\nb\nP");
    expect(edit?.selectionStart).toBe("a\n![Image](u)".length);
  });

  it("removes the placeholder and its line break on failure", () => {
    expect(replacePlaceholder("a\nP\nb", "P", "")?.text).toBe("a\nb");
    expect(replacePlaceholder("a\nP", "P", "")?.text).toBe("a\n");
  });

  it("declines when the writer edited the placeholder away", () => {
    expect(replacePlaceholder("a\nb", "P", "![Image](u)")).toBeNull();
  });
});

describe("parseRetryAfterSeconds", () => {
  const RETRY_AT = "Wed, 21 Oct 2026 07:28:00 GMT";
  const RETRY_AT_MS = Date.UTC(2026, 9, 21, 7, 28, 0);
  const JUST_UNDER_TWO_MINUTES_MS = 119_500;
  const FIVE_SECONDS_MS = 5_000;

  it("reads whole seconds", () => {
    expect(parseRetryAfterSeconds("120", RETRY_AT_MS)).toEqual({
      ok: true,
      value: 120,
    });
    expect(parseRetryAfterSeconds("0", RETRY_AT_MS)).toEqual({
      ok: true,
      value: 0,
    });
  });

  it("reads the seconds until an HTTP-date, rounded up", () => {
    const nowMs = RETRY_AT_MS - JUST_UNDER_TWO_MINUTES_MS;

    expect(parseRetryAfterSeconds(RETRY_AT, nowMs)).toEqual({
      ok: true,
      value: 120,
    });
  });

  it("reads an HTTP-date in the past as no wait", () => {
    const nowMs = RETRY_AT_MS + FIVE_SECONDS_MS;

    expect(parseRetryAfterSeconds(RETRY_AT, nowMs)).toEqual({
      ok: true,
      value: 0,
    });
  });

  it.each([
    ["soon", RetryAfterRejections.UNRECOGNIZED],
    ["1.5", RetryAfterRejections.UNRECOGNIZED],
    ["-3", RetryAfterRejections.UNRECOGNIZED],
    ["12s", RetryAfterRejections.UNRECOGNIZED],
    ["99999999999999999999", RetryAfterRejections.OUT_OF_RANGE],
    ["Wed, 21 Oct 2026 07:28:00", RetryAfterRejections.UNRECOGNIZED],
    ["Wed, 21 Oct 2026 07:28:00 PST", RetryAfterRejections.UNRECOGNIZED],
    ["21 Oct 2026 07:28:00 GMT", RetryAfterRejections.UNRECOGNIZED],
    ["Wednesday, 21-Oct-26 07:28:00 GMT", RetryAfterRejections.UNRECOGNIZED],
    ["Wed, 99 Oct 2026 07:28:00 GMT", RetryAfterRejections.INVALID_DATE],
  ])("refuses a retry-after of %s", (retryAfter, rejection) => {
    expect(parseRetryAfterSeconds(retryAfter, RETRY_AT_MS)).toEqual({
      ok: false,
      error: rejection,
    });
  });
});
