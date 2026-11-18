import type { ValueOf } from "types";

declare const name: string;
declare const label: string | undefined;
declare function describe(text: string): string;

const BadgeVariants = { OPEN: "open", DRAFT: "draft" } as const;
const EditorModes = { WRITE: "write" } as const;
type EditorMode = ValueOf<typeof EditorModes>;

const FALLBACK = "suggested change"; // reports
const LEAVE_PROMPT = "You have an unsaved comment. Leave this page?"; // reports
const BADGE_LABEL = {
  [BadgeVariants.OPEN]: "Open", // reports
  [BadgeVariants.DRAFT]: "draft",
} as const;
const MODE_LABELS: Record<EditorMode, string> = {
  [EditorModes.WRITE]: "Write", // reports
};
const SECTIONS = [
  { id: "general", heading: "General shortcuts" }, // reports
];
const GREETING = `Hello ${"there"}`; // reports
const CHOICE = Math.random() > 0.5 ? "Left side" : "right"; // reports
const STATES = { CHANGES_REQUESTED: "changes requested" } as const; // reports
const LABELS = { OPEN: "Open pull request" } satisfies Record<string, string>; // reports
const SHOWN = label ?? "Untitled brief"; // reports
const WELCOME = "Hello " + name; // reports
const PADDED = " Open"; // reports
const _PRIVATE_NOTE = "Visible copy"; // reports
const BUILD_COPY = () => ({ retry: "Try again" }); // reports
const DESCRIBED = describe("Pull request description"); // reports
const PHASES = new Map([["queued", "Waiting in queue"]]); // reports

export {
  FALLBACK,
  LEAVE_PROMPT,
  BADGE_LABEL,
  MODE_LABELS,
  SECTIONS,
  GREETING,
  CHOICE,
  STATES,
  LABELS,
  SHOWN,
  WELCOME,
  PADDED,
  _PRIVATE_NOTE,
  BUILD_COPY,
  DESCRIBED,
  PHASES,
};
