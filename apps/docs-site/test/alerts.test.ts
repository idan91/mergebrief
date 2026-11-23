import { createMarkdownRenderer } from "vitepress";
import { describe, expect, it } from "vitest";

import {
  ALERT_TITLE_RULE_NAME,
  createAlertTitleRule,
  type AlertLabels,
} from "../src/alerts";

const LABELS: AlertLabels = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};

async function renderMarkdown(source: string): Promise<string> {
  const md = await createMarkdownRenderer(process.cwd(), {
    config(renderer) {
      renderer.core.ruler.push(
        ALERT_TITLE_RULE_NAME,
        createAlertTitleRule(LABELS),
      );
    },
  });

  return md.render(source);
}

describe("createAlertTitleRule", () => {
  it.each([
    ["NOTE", "Note"],
    ["TIP", "Tip"],
    ["IMPORTANT", "Important"],
    ["WARNING", "Warning"],
    ["CAUTION", "Caution"],
  ])(
    "titles an untitled %s alert with its catalog label",
    async (marker, title) => {
      const html = await renderMarkdown(`> [!${marker}]\n> Body.\n`);

      expect(html).toContain(`<p class="custom-block-title">${title}</p>`);
    },
  );

  it("keeps a title the author wrote", async () => {
    const html = await renderMarkdown(
      "> [!WARNING] Before you upgrade\n> Body.\n",
    );

    expect(html).toContain(
      '<p class="custom-block-title">Before you upgrade</p>',
    );
  });

  it("leaves a plain blockquote alone", async () => {
    const html = await renderMarkdown("> Just a quote.\n");

    expect(html).toContain("<blockquote>");
  });
});
