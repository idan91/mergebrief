import type { TranslationKey } from "i18n";

export interface FocusShortcutKey {
  key: string;
  shift?: boolean;
}

export interface FocusShortcut {
  id: string;
  keys: readonly FocusShortcutKey[];
  descriptionKey: TranslationKey;
}
