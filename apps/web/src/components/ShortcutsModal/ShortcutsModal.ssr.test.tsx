// No jsdom: renders the way the server does, with no window to read storage from.
import { I18nextProvider } from "react-i18next";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  readSingleKeyShortcutsOn,
  writeSingleKeyShortcutsOn,
} from "@web/utils/single-key-shortcuts";

import { appI18n } from "../../i18n/I18nProvider";
import { ShortcutsModal } from ".";

function readCheckboxTag(html: string): string | undefined {
  return /<input[^>]*type="checkbox"[^>]*>/.exec(html)?.[0];
}

describe("the server render of the single-key switch", () => {
  it("reads single-key shortcuts as on with no window", () => {
    expect(typeof window).toBe("undefined");
    expect(readSingleKeyShortcutsOn()).toBe(true);
  });

  it("ignores a write with no window", () => {
    expect(() => {
      writeSingleKeyShortcutsOn(false);
    }).not.toThrow();
    expect(readSingleKeyShortcutsOn()).toBe(true);
  });

  it("renders the open modal's switch checked", () => {
    const html = renderToString(
      <I18nextProvider i18n={appI18n}>
        <ShortcutsModal close={() => undefined} open sections={[]} />
      </I18nextProvider>,
    );

    expect(readCheckboxTag(html)).toContain('checked=""');
  });
});
