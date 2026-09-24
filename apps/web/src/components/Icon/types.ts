import type { ValueOf } from "types/utils";

/** The set: one file per name under `components/icons`, Phosphor's names. */
export const IconNames = {
  ARROW_UP: "arrow-up",
  ARROW_UP_RIGHT: "arrow-up-right",
  ARROWS_CLOCKWISE: "arrows-clockwise",
  CARET_DOWN: "caret-down",
  CHAT_TEXT: "chat-text",
  CHECK: "check",
  CHECK_CIRCLE: "check-circle",
  CIRCLE: "circle",
  CIRCLE_DASHED: "circle-dashed",
  CIRCLE_HALF: "circle-half",
  CLOCK: "clock",
  CODE: "code",
  COLUMNS: "columns",
  COPY: "copy",
  DOTS_THREE: "dots-three",
  EYE_SLASH: "eye-slash",
  GEAR: "gear",
  GIT_MERGE: "git-merge",
  GIT_PULL_REQUEST: "git-pull-request",
  GITHUB_LOGO: "github-logo",
  KEYBOARD: "keyboard",
  LINK: "link",
  LIST_BULLETS: "list-bullets",
  LIST_CHECKS: "list-checks",
  LIST_NUMBERS: "list-numbers",
  PENCIL_SIMPLE_LINE: "pencil-simple-line",
  QUOTES: "quotes",
  RECORD: "record",
  SIGN_OUT: "sign-out",
  SLIDERS_HORIZONTAL: "sliders-horizontal",
  STACK: "stack",
  TERMINAL: "terminal",
  TEXT_B: "text-b",
  TEXT_ITALIC: "text-italic",
  TRASH: "trash",
  USER: "user",
  WARNING: "warning",
  X: "x",
  X_CIRCLE: "x-circle",
  ANTHROPIC: "anthropic",
  CLAUDE_CODE: "claude-code",
  CURSOR: "cursor",
  OPENAI: "openai",
  OPENROUTER: "openrouter",
} as const;
export type IconName = ValueOf<typeof IconNames>;

/** Three rendered sizes: in a chip, in a control, in a row or a state. */
export const IconSizes = {
  SM: 12,
  MD: 14,
  LG: 16,
} as const;
export type IconSize = ValueOf<typeof IconSizes>;

/** Direction by rotation: one drawing per shape, turned in quarter steps. */
export const IconRotations = {
  NONE: 0,
  QUARTER: 90,
  HALF: 180,
  THREE_QUARTERS: 270,
} as const;
export type IconRotation = ValueOf<typeof IconRotations>;
