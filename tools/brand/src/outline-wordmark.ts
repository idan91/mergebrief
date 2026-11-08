// One-off: fetches the pinned Archivo variable font, refuses bytes whose hash
// is not the pinned one, and writes the outlined wordmark master. Run it only
// when the wordmark's type settings change; `generate` reads its output.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// oxlint-disable-next-line import/default -- Node loads the CommonJS build, whose API arrives only as the default export
import opentype from "opentype.js";

import {
  WORDMARK_FONT_SHA256,
  WORDMARK_FONT_URL,
  WORDMARK_MASTER_FILE,
} from "./consts";
import { buildWordmarkMasterSvg, outlineWordmark } from "./wordmark";

const toolRoot = fileURLToPath(new URL("..", import.meta.url));
const response = await fetch(WORDMARK_FONT_URL);

if (!response.ok) {
  process.stderr.write(`font fetch failed: ${response.status}\n`);
  process.exit(1);
}

const fontBytes = await response.arrayBuffer();
const digest = createHash("sha256")
  .update(new Uint8Array(fontBytes))
  .digest("hex");

if (digest !== WORDMARK_FONT_SHA256) {
  process.stderr.write(
    `font hash ${digest} is not the pinned ${WORDMARK_FONT_SHA256}\n`,
  );
  process.exit(1);
}

const wordmark = outlineWordmark(
  // oxlint-disable-next-line import/no-named-as-default-member -- the named export does not exist at runtime; see the import
  opentype.parse(fontBytes),
);

writeFileSync(
  join(toolRoot, WORDMARK_MASTER_FILE),
  buildWordmarkMasterSvg(wordmark),
);
process.stdout.write(`wrote ${WORDMARK_MASTER_FILE}\n`);
