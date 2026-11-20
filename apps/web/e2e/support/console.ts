import type { Page } from "@playwright/test";

/** A browser-side failure worth failing a spec over. */
export interface PageFault {
  kind: "console" | "pageerror";
  text: string;
}

/**
 * Record console errors and uncaught exceptions for the life of a page.
 * Attach BEFORE the first navigation: messages emitted during load are not
 * replayed to listeners registered afterwards.
 */
export function collectPageFaults(page: Page): PageFault[] {
  const faults: PageFault[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") {
      return;
    }
    const text = message.text();
    const sourceUrl = message.location().url;
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
