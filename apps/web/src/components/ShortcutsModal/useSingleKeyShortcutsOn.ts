import { useSyncExternalStore } from "react";

import {
  readServerSingleKeyShortcutsOn,
  readSingleKeyShortcutsOn,
  subscribeSingleKeyShortcuts,
} from "@web/utils/single-key-shortcuts";

/** Whether a key pressed alone runs a shortcut on this device; on in the server render. */
export function useSingleKeyShortcutsOn(): boolean {
  return useSyncExternalStore(
    subscribeSingleKeyShortcuts,
    readSingleKeyShortcutsOn,
    readServerSingleKeyShortcutsOn,
  );
}
