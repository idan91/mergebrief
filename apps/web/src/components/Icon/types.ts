import type { ValueOf } from "types/utils";

/** The set: one file per name under `components/icons`, Phosphor's names. */
export const IconNames = {
  ANTHROPIC: "anthropic",
  ARCHIVE: "archive",
  ARROWS_CLOCKWISE: "arrows-clockwise",
  ARROW_ELBOW_DOWN_RIGHT: "arrow-elbow-down-right",
  ARROW_UP: "arrow-up",
  ARROW_UP_RIGHT: "arrow-up-right",
  CARET_DOWN: "caret-down",
  CHAT_TEXT: "chat-text",
  CHECK: "check",
  CHECK_CIRCLE: "check-circle",
  CIRCLE: "circle",
  CIRCLE_DASHED: "circle-dashed",
  CIRCLE_HALF: "circle-half",
  CLAUDE_CODE: "claude-code",
  CLOCK: "clock",
  CODE: "code",
  COLUMNS: "columns",
  COPY: "copy",
  CURSOR: "cursor",
  CURSOR_CLICK: "cursor-click",
  DOTS_THREE: "dots-three",
  EYE_SLASH: "eye-slash",
  FILM_STRIP: "film-strip",
  GEAR: "gear",
  GITHUB_LOGO: "github-logo",
  GIT_MERGE: "git-merge",
  GIT_PULL_REQUEST: "git-pull-request",
  IMAGE: "image",
  KEYBOARD: "keyboard",
  LINK: "link",
  LIST_BULLETS: "list-bullets",
  LIST_CHECKS: "list-checks",
  LIST_NUMBERS: "list-numbers",
  OPENAI: "openai",
  OPENROUTER: "openrouter",
  PENCIL_SIMPLE_LINE: "pencil-simple-line",
  QUESTION: "question",
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
  USERS: "users",
  WARNING: "warning",
  WARNING_DIAMOND: "warning-diamond",
  X: "x",
  X_CIRCLE: "x-circle",
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
