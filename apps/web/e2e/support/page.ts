import { expect, type Locator, type Page } from "@playwright/test";

/** The shortcuts dialog's outer wrapper, `display:none` while closed. */
export function shortcutsDialog(page: Page): Locator {
  return page.locator('[aria-labelledby="shortcuts-modal-heading"]');
}

/**
 * How long a page gets to hydrate. A built page takes well under a second on
 * a developer machine; the rest is margin for a loaded CI runner.
 */
const HYDRATION_BUDGET_MS = 10_000;

interface WaitOptions {
  timeout?: number;
}

/** Resolve once the Inbox rows have settled after their first-load fade. */
export async function waitForFirstLoad(
  page: Page,
  { timeout = HYDRATION_BUDGET_MS }: WaitOptions = {},
): Promise<void> {
  await expect(page.locator('[data-first-load="false"]')).toBeAttached({
    timeout,
  });
}

/**
 * Click until the click's effect lands. A click sent before hydration is
 * lost with no DOM signal, like the keystrokes `waitForInteractive` retries.
 */
export async function clickUntilLanded(
  target: Locator,
  landed: () => Promise<void>,
  { timeout = HYDRATION_BUDGET_MS }: WaitOptions = {},
): Promise<void> {
  await expect(async () => {
    await target.click();
    await landed();
  }).toPass({ timeout });
}

/**
 * Resolve once the page's window-level keydown listeners are live. Nothing
 * observable marks hydration: `__TSR_ROUTER__` and the React fiber both land
 * before the listeners do, so an early keystroke is lost silently. The gate
 * is the behaviour itself. Press the shortcut, assert the dialog opened, and
 * retry the pair; asserting after every press keeps the toggle safe. The
 * dialog is closed again before returning.
 */
export async function waitForInteractive(
  page: Page,
  { timeout = HYDRATION_BUDGET_MS }: WaitOptions = {},
): Promise<void> {
  const dialog = shortcutsDialog(page);
  await expect(async () => {
    await page.keyboard.press("Shift+Slash");
    await expect(dialog).toBeVisible({ timeout: 500 });
  }).toPass({ timeout });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

/** Navigate to a brief URL (repo route) and wait for it to be interactive. */
export async function gotoBrief(
  page: Page,
  path: string,
  options?: WaitOptions,
): Promise<void> {
  await page.goto(path);
  await waitForInteractive(page, options);
}
