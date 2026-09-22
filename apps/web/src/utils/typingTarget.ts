const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

// Focus parked on a click-operated input (a checkbox, a button) must not
// stand single-key shortcuts down; only actual text entry does.
const CLICK_INPUT_TYPES = new Set(["checkbox", "radio", "button", "submit"]);

/** A key pressed while typing belongs to the field, never to a page shortcut. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) {
    return !CLICK_INPUT_TYPES.has(target.type);
  }
  return TYPING_TAGS.has(target.tagName) || target.isContentEditable;
}
