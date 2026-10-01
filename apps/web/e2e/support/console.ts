import type { Page } from "@playwright/test";

/** A browser-side failure worth failing a spec over. */
export interface PageFault {
  kind: "console" | "pageerror";
  text: string;
}

/**
 * Vite's dev client and React's dev build both log through `console.error`
 * for conditions that are not page faults (an HMR socket that has not
 * connected yet, the router's dev-tools notices). Matching on the message
 * keeps the gate meaningful instead of forcing a blanket allowance.
 */
const IGNORED_CONSOLE_PATTERNS = [
  /\[vite\]/i,
  /Download the React DevTools/i,
  /WebSocket/i,
];

/**
 * Expected-404 endpoints: the browser logs a resource error for ANY 404
 * fetch, and these are designed denials the page degrades on (the mention
 * pool is unavailable in the owner world). Keyed by URL so a real 404, a
 * missing brief or a broken asset, still fails the spec.
 */
const EXPECTED_404_URLS = [/\/api\/repos\/\d+\/collaborators$/];

/**
 * Record console errors and uncaught exceptions for the life of a page.
 * Attach BEFORE the first navigation: messages emitted during load are not
 * replayed to listeners registered afterwards.
 */
export function collectPageFaults(page: Page): PageFault[] {
  const faults: PageFault[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (IGNORED_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))) return;
    const sourceUrl = message.location().url;
    if (
      /Failed to load resource/.test(text) &&
      EXPECTED_404_URLS.some((pattern) => pattern.test(sourceUrl))
    ) {
      return;
    }
    const resourceFailed = /Failed to load resource/.test(text);
    faults.push({
      kind: "console",
      text: resourceFailed ? `${text} ${sourceUrl}` : text,
    });
  });
  page.on("pageerror", (error) => {
    faults.push({ kind: "pageerror", text: error.message });
  });
  return faults;
}
