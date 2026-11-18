import type { TFunction } from "i18next";
import type { TranslationKey } from "i18n";
import type { ValueOf } from "types/utils";

export const EditorModes = { WRITE: "write", PREVIEW: "preview" } as const;
export type EditorMode = ValueOf<typeof EditorModes>;

export const MODE_LABEL_KEYS: Record<EditorMode, TranslationKey> = {
  [EditorModes.WRITE]: "shell.editorModeWrite",
  [EditorModes.PREVIEW]: "shell.editorModePreview",
};

export const SUBMIT_COPY_KEYS = {
  POSTED: "review.submitResult.posted",
  FAILED: "review.submitResult.indeterminate",
} as const satisfies Record<string, TranslationKey>;

export const LEAVE_PROMPT_KEY: TranslationKey =
  "shell.unsavedCommentLeavePrompt";
export const MAX_DIGEST_LINE = 80;
export const BRIEF_ID_PATTERN = /^[a-z0-9-]+$/;

export function getModeLabel(t: TFunction, mode: EditorMode): string {
  return t(MODE_LABEL_KEYS[mode]);
}
