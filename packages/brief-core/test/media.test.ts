import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildMermaidMediaKey,
  DiagramTypes,
  extractMedia,
  MediaKinds,
  type MediaItem,
} from "../src/media";

const OPTIONS = { repoSlug: "acme/app" };
const SHOT = "https://cdn.test/shot.png";
const ASSET =
  "https://github.com/user-attachments/assets/0f6c2a4e-1b2c-4d3e-8f90-123456789abc";
const OWN_BLOB = "https://github.com/acme/app/blob/main/docs/demo.mp4?raw=true";
const OWN_RAW = "https://github.com/acme/app/raw/main/docs/demo.mp4";

function extract(markdown: string): MediaItem[] {
  return extractMedia(markdown, OPTIONS);
}

function readAddresses(markdown: string): (string | undefined)[] {
  return extract(markdown).map((item) =>
    item.kind === MediaKinds.DIAGRAM ? item.code : item.address,
  );
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

describe("extractMedia shapes", () => {
  it("reads a Markdown image with its alt as caption", () => {
    expect(extract(`![Login screen](${SHOT})`)).toEqual([
      {
        kind: MediaKinds.IMAGE,
        key: SHOT,
        address: SHOT,
        alt: "Login screen",
        caption: "Login screen",
        stripOnly: false,
      },
    ]);
  });

  it("reads a raw img tag", () => {
    expect(readAddresses(`<img width="300" src="${SHOT}" alt="x">`)).toEqual([
      SHOT,
    ]);
  });

  it("reads only the fallback img of a picture", () => {
    const markdown = [
      "<picture>",
      '<source media="(prefers-color-scheme: dark)" srcset="https://cdn.test/dark.png">',
      `<img src="${SHOT}" alt="Chart">`,
      "</picture>",
    ].join("\n");

    expect(readAddresses(markdown)).toEqual([SHOT]);
  });

  it("reads a raw video tag as a confirmed video", () => {
    const [item] = extract(`<video src="${OWN_RAW}" controls></video>`);

    expect(item).toMatchObject({
      kind: MediaKinds.VIDEO,
      address: OWN_RAW,
      requiresConfirmation: false,
      stripOnly: false,
    });
  });

  it("reads a pasted asset alone on its line as a video to confirm", () => {
    const [item] = extract(`Before the fix:\n${ASSET}\n\nMore text.`);

    expect(item).toEqual({
      kind: MediaKinds.VIDEO,
      key: ASSET,
      address: ASSET,
      caption: "Before the fix",
      requiresConfirmation: true,
      stripOnly: false,
    });
  });

  it.each([
    ["CRLF", "\r\n"],
    ["lone CR", "\r"],
  ])("reads a bare asset line between %s line breaks", (_name, lineBreak) => {
    const markdown = ["Before the fix:", ASSET, "After text."].join(lineBreak);

    const [item] = extract(markdown);

    expect(item).toMatchObject({ kind: MediaKinds.VIDEO, address: ASSET });
  });

  it("reads an own-repository link to a video as strip only", () => {
    const [item] = extract(`Watch [the demo](${OWN_BLOB}).`);

    expect(item).toEqual({
      kind: MediaKinds.VIDEO,
      key: OWN_RAW,
      address: OWN_BLOB,
      caption: "the demo",
      requiresConfirmation: false,
      stripOnly: true,
    });
  });

  it("reads an own-repository link to an image as strip only", () => {
    const link = "https://raw.githubusercontent.com/Acme/App/main/a/b.svg";

    expect(extract(`[diagram](${link})`)).toEqual([
      {
        kind: MediaKinds.IMAGE,
        key: "https://github.com/acme/app/raw/main/a/b.svg",
        address: link,
        caption: "diagram",
        stripOnly: true,
      },
    ]);
  });

  it("reads an own-repository file page link as strip only", () => {
    const page = "https://github.com/acme/app/blob/main/docs/demo.mp4";

    expect(extract(`Watch [the demo](${page}).`)).toEqual([
      {
        kind: MediaKinds.VIDEO,
        key: OWN_RAW,
        address: OWN_RAW,
        caption: "the demo",
        requiresConfirmation: false,
        stripOnly: true,
      },
    ]);
  });

  it("reads a mermaid fence as a typed diagram keyed by its code", () => {
    const code = "sequenceDiagram\nA->>B: hi\n";
    const [item] = extract("```mermaid\nsequenceDiagram\nA->>B: hi\n```");

    expect(item).toEqual({
      kind: MediaKinds.DIAGRAM,
      key: `mermaid:${hashCode(code)}`,
      code,
      diagramType: DiagramTypes.SEQUENCE,
    });
  });

  it("keeps document order across shapes", () => {
    const markdown = [
      "```mermaid\ngraph TD\nA-->B\n```",
      `![one](${SHOT})`,
      `[clip](${OWN_RAW})`,
    ].join("\n\n");

    expect(extract(markdown).map((item) => item.kind)).toEqual([
      MediaKinds.DIAGRAM,
      MediaKinds.IMAGE,
      MediaKinds.VIDEO,
    ]);
  });

  it("returns nothing for text without Media", () => {
    expect(extract("Plain *text* with [a link](https://x.test).")).toEqual([]);
  });
});

describe("extractMedia duplicates", () => {
  it("keeps one item per address at its first place", () => {
    const markdown = `![first](${SHOT})\n\n![second](${SHOT})`;

    expect(extract(markdown).map((item) => item.caption)).toEqual(["first"]);
  });

  it("treats the three committed-file forms as one address", () => {
    const markdown = [
      "![a](https://github.com/acme/app/blob/main/s.png?raw=true)",
      "![b](https://github.com/acme/app/raw/main/s.png)",
      "![c](https://raw.githubusercontent.com/acme/app/main/s.png)",
      "![d](https://raw.githubusercontent.com/acme/app/refs/heads/main/s.png)",
    ].join("\n\n");

    expect(extract(markdown)).toEqual([
      expect.objectContaining({
        key: "https://github.com/acme/app/raw/main/s.png",
        caption: "a",
      }),
    ]);
  });

  it("keys a file page link as the raw form of the same file", () => {
    const markdown = [
      "![a](https://github.com/acme/app/raw/main/s.png)",
      "[page](https://github.com/acme/app/blob/refs/heads/main/s.png)",
    ].join("\n\n");

    expect(extract(markdown)).toEqual([
      expect.objectContaining({
        key: "https://github.com/acme/app/raw/main/s.png",
        caption: "a",
      }),
    ]);
  });

  it("keeps one item for the same diagram written twice", () => {
    const fence = '```mermaid\npie\n"a": 1\n```';

    expect(extract(`${fence}\n\n${fence}`)).toHaveLength(1);
  });
});

describe("extractMedia exclusions", () => {
  it("skips an image wrapped in a link such as a badge", () => {
    const markdown = [
      "[![build](https://img.shields.io/badge/x.svg)](https://ci.test)",
      '<a href="https://cubic.test"><img src="https://cubic.test/r.svg"></a>',
    ].join("\n\n");

    expect(extract(markdown)).toEqual([]);
  });

  it("ignores Media inside an HTML comment", () => {
    expect(extract(`<!-- ![hidden](${SHOT}) <img src="${SHOT}"> -->`)).toEqual(
      [],
    );
  });

  it("skips a pasted asset that shares its line with text", () => {
    expect(extract(`See ${ASSET} for the clip.`)).toEqual([]);
  });

  it("skips a pasted asset inside a code block", () => {
    expect(extract(`\`\`\`\n${ASSET}\n\`\`\``)).toEqual([]);
  });

  it("skips a link to a file in another repository", () => {
    expect(
      extract("[clip](https://github.com/other/app/raw/main/demo.mp4)"),
    ).toEqual([]);
  });

  it("skips a file page link of another repository or with a query", () => {
    expect(
      extract("[clip](https://github.com/other/app/blob/main/demo.mp4)"),
    ).toEqual([]);
    expect(
      extract("[clip](https://github.com/acme/app/blob/main/demo.mp4?plain=1)"),
    ).toEqual([]);
  });

  it("skips an own-repository link to a file that is not Media", () => {
    expect(
      extract("[notes](https://github.com/acme/app/raw/main/NOTES.md)"),
    ).toEqual([]);
  });

  it("skips a fence in another language", () => {
    expect(extract("```ts\nconst a = 1;\n```")).toEqual([]);
  });
});

describe("extractMedia nesting", () => {
  it("reads images inside table cells with the header as caption", () => {
    const markdown = [
      "| Before | After |",
      "| --- | --- |",
      `| ![](https://cdn.test/a.png) | ![](https://cdn.test/b.png) |`,
    ].join("\n");

    expect(extract(markdown).map((item) => item.caption)).toEqual([
      "Before",
      "After",
    ]);
  });

  it("takes header cells from a raw table's first row of th cells", () => {
    const markdown = [
      "<table>",
      "<tr><th>Before</th><th>After</th></tr>",
      '<tr><td><img src="https://cdn.test/a.png"></td>',
      '<td><img src="https://cdn.test/b.png"></td></tr>',
      "</table>",
    ].join("\n");

    expect(extract(markdown).map((item) => item.caption)).toEqual([
      "Before",
      "After",
    ]);
  });

  it("reads no header from a raw table whose first row holds data", () => {
    const markdown = [
      "<table>",
      '<tr><td><img src="https://cdn.test/a.png"></td></tr>',
      "</table>",
    ].join("\n");

    expect(extract(markdown)[0]?.caption).toBe("a.png");
  });

  it("reads images inside details", () => {
    const markdown = `<details><summary>Shots</summary>\n\n![x](${SHOT})\n\n</details>`;

    expect(readAddresses(markdown)).toEqual([SHOT]);
  });
});

describe("extractMedia captions and headings", () => {
  it("falls back to the file name without alt or table", () => {
    expect(extract("![](https://cdn.test/dir/login%20page.png)")).toEqual([
      expect.objectContaining({ caption: "login page.png" }),
    ]);
  });

  it("never takes a pasted asset's id as its caption", () => {
    const branchFile =
      "https://github.com/acme/app/blob/mergebrief/attachments/1f6c2a4e-1b2c-4d3e-8f90-123456789abc.png?raw=true";
    const lineAsset = ASSET.replace("0f6c", "2f6c");
    const markdown = [`![](${ASSET})`, `![](${branchFile})`, lineAsset].join(
      "\n\n",
    );

    const items = extract(markdown);

    expect(items).toHaveLength(3);
    expect(items.map((item) => item.caption)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("leaves a blank alt out of the item", () => {
    const [item] = extract(`<img src="${SHOT}" alt="  ">`);

    expect(item).not.toHaveProperty("alt");
    expect(item?.caption).toBe("shot.png");
  });

  it("uses the sentence before a link whose text is its address", () => {
    const markdown = `First thing. Then the flow under load:\n${OWN_RAW}`;

    expect(extract(markdown)[0]?.caption).toBe("Then the flow under load");
  });

  it("uses the previous paragraph for a link alone in its own", () => {
    const markdown = `The fixed behaviour.\n\n${ASSET}`;

    expect(extract(markdown)[0]?.caption).toBe("The fixed behaviour.");
  });

  it("names the nearest heading above each item", () => {
    const markdown = [
      "# Summary",
      `![a](https://cdn.test/a.png)`,
      "## Screenshots",
      "Some text",
      `![b](https://cdn.test/b.png)`,
    ].join("\n\n");

    expect(extract(markdown).map((item) => item.heading)).toEqual([
      "Summary",
      "Screenshots",
    ]);
  });

  it("keeps alt text as a plain string", () => {
    const [item] = extract(
      `<img src="${SHOT}" alt="&lt;script&gt;alert(1)&lt;/script&gt;">`,
    );

    expect(item?.caption).toBe("<script>alert(1)</script>");
  });
});

describe("extractMedia diagram types", () => {
  it.each([
    ["sequenceDiagram", DiagramTypes.SEQUENCE],
    ["flowchart LR", DiagramTypes.FLOWCHART],
    ["graph TD", DiagramTypes.FLOWCHART],
    ["classDiagram", DiagramTypes.CLASS],
    ["stateDiagram-v2", DiagramTypes.STATE],
    ["erDiagram", DiagramTypes.ENTITY_RELATIONSHIP],
    ["gantt", DiagramTypes.GANTT],
    ["pie title Pets", DiagramTypes.PIE],
    ["journey", DiagramTypes.JOURNEY],
    ["gitGraph", DiagramTypes.GIT_GRAPH],
    ["mindmap", DiagramTypes.MINDMAP],
    ["timeline", DiagramTypes.TIMELINE],
    ["quadrantChart", DiagramTypes.OTHER],
  ])("reads %s as %s", (firstLine, diagramType) => {
    const [item] = extract(`\`\`\`mermaid\n${firstLine}\n  A\n\`\`\``);

    expect(item).toMatchObject({ diagramType });
  });

  it("skips front matter, directives and comments to the keyword", () => {
    const code = [
      "---",
      "title: Flow",
      "---",
      "%%{init: {'theme': 'dark'}}%%",
      "%% a comment",
      "",
      "sequenceDiagram",
    ].join("\n");

    expect(extract(`\`\`\`mermaid\n${code}\n\`\`\``)[0]).toMatchObject({
      diagramType: DiagramTypes.SEQUENCE,
    });
  });

  it("keys a diagram by the sha256 of its code alone", () => {
    expect(buildMermaidMediaKey("graph TD\n")).toBe(
      `mermaid:${hashCode("graph TD\n")}`,
    );
  });
});

describe("extractMedia attack inputs", () => {
  it.each([
    ["a javascript: image", "![x](javascript:alert(1))"],
    ["a data: image", '<img src="data:image/png;base64,AAAA">'],
    ["an http image", '<img src="http://cdn.test/a.png">'],
    ["a relative image", '<img src="/api/secret.png">'],
    ["a srcset-only image", '<img srcset="https://cdn.test/a.png 2x">'],
    ["a javascript: video", '<video src="javascript:alert(1)"></video>'],
    [
      "a video with only a source child",
      `<video><source src="${OWN_RAW}"></video>`,
    ],
    [
      "a javascript: own-repo look-alike",
      "[x](javascript://github.com/acme/app/raw/main/a.mp4)",
    ],
    ["a script-wrapped image", `<script><img src="${SHOT}"></script>`],
    ["an image in a textarea", `<textarea><img src="${SHOT}"></textarea>`],
    ["an image in a style block", `<style><img src="${SHOT}"></style>`],
    [
      "a mermaid fence written as raw text",
      '<pre class="mermaid">graph TD</pre>',
    ],
  ])("yields no item for %s", (_name, markdown) => {
    expect(extract(markdown)).toEqual([]);
  });

  it("keeps only the address of an image with event attributes", () => {
    expect(
      extract(`<img src="${SHOT}" onerror="alert(1)" onload="alert(2)">`),
    ).toEqual([
      {
        kind: MediaKinds.IMAGE,
        key: SHOT,
        address: SHOT,
        caption: "shot.png",
        stripOnly: false,
      },
    ]);
  });

  it("skips an asset look-alike on another host", () => {
    const lookAlike =
      "https://github.com.evil.test/user-attachments/assets/0f6c2a4e-1b2c-4d3e-8f90-123456789abc";

    expect(extract(lookAlike)).toEqual([]);
  });
});
