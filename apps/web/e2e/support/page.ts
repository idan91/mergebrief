import { expect, type Locator, type Page } from "@playwright/test";

/** The shortcuts dialog's outer wrapper — `display:none` while closed. */
export function shortcutsDialog(page: Page): Locator {
  return page.locator('[aria-labelledby="shortcuts-modal-heading"]');
}

/**
 * Resolve once the page's window-level keydown listeners are live.
 *
 * The brief screen is server-rendered, so every control is in the DOM long
 * before React hydrates and attaches handlers — a keystroke sent in that
 * window is simply lost, with no DOM signal that it was. Nothing observable
 * marks the transition either: `__TSR_ROUTER__` is set by the client entry
 * before hydration, and a React fiber lands on the container before the
 * effects that register the listeners run (both measured, both still raced).
 *
 * So the gate is the behaviour itself: press the shortcut, assert the dialog
 * opened, retry the pair until it does. Asserting after EVERY press is what
 * keeps a toggle safe — a press either lands (assertion passes, loop ends) or
 * is lost (nothing toggled, retry). The dialog is closed again before
 * returning, leaving the page in its arrival state.
 */
export async function waitForInteractive(
  page: Page,
  { timeout = 20_000 }: { timeout?: number } = {},
): Promise<void> {
  const dialog = shortcutsDialog(page);
  await expect(async () => {
    await page.keyboard.press("Shift+Slash");
    await expect(dialog).toBeVisible({ timeout: 500 });
  }).toPass({ timeout });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

/** Navigate to a local-brief URL and wait for the page to be interactive. */
export async function gotoBrief(
  page: Page,
  path: string,
  options?: { timeout?: number },
): Promise<void> {
  await page.goto(path);
  await waitForInteractive(page, options);
}
