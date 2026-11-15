import { z } from "zod/v4";

export const SINGLE_KEY_SHORTCUTS_STORAGE_KEY = "mergebrief.singleKeyShortcuts";

const preferenceSchema = z.boolean();
const listeners = new Set<() => void>();
/** The choice for this page when storage is denied. */
let chosenInMemory: boolean | undefined;

/** The part of a key event that says whether one key was pressed alone. */
export interface KeyPress {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
}

function readStoredChoice(): boolean | undefined {
  try {
    const raw = window.localStorage.getItem(SINGLE_KEY_SHORTCUTS_STORAGE_KEY);
    if (raw === null) {
      return undefined;
    }

    const parsed = preferenceSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a key pressed alone runs a shortcut: on until the reader turns it off on this device. */
export function readSingleKeyShortcutsOn(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  return readStoredChoice() ?? chosenInMemory ?? true;
}

/** The server cannot read the choice; it renders the default and hydration corrects it. */
export function readServerSingleKeyShortcutsOn(): boolean {
  return true;
}

export function writeSingleKeyShortcutsOn(enabled: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  chosenInMemory = enabled;
  try {
    window.localStorage.setItem(
      SINGLE_KEY_SHORTCUTS_STORAGE_KEY,
      JSON.stringify(enabled),
    );
  } catch {
    // Storage denied (private mode, quota): the in-memory choice carries this page.
  }
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeSingleKeyShortcuts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A letter, digit or symbol with no Ctrl, Alt or Meta; Space and named keys are not one. */
function isCharacterKeyAlone(press: KeyPress): boolean {
  const modified = press.metaKey || press.ctrlKey || press.altKey;
  const character = press.key.length === 1 && press.key !== " ";
  const characterAlone = character && !modified;
  return characterAlone;
}

/**
 * True for a key press every page shortcut must ignore: a character key
 * alone, with the reader's shortcuts turned off.
 */
export function isSuppressedSingleKey(press: KeyPress): boolean {
  const suppressed = isCharacterKeyAlone(press) && !readSingleKeyShortcutsOn();
  return suppressed;
}
