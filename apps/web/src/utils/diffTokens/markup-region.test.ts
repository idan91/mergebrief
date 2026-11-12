import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { beforeAll, describe, expect, it } from "vitest";

import {
  deriveCommentedRegionPrelude,
  deriveRegionPrelude,
} from "./markup-region";
import { SYNTAX_PALETTE } from "./palette";
import { MERGEBRIEF_DARK } from "./theme";
import {
  tokenizeChunkRows,
  tokenizeSide,
  tokenizeStandaloneRows,
} from "./tokenizeChunk";
import { DiffLineKinds } from "types/diff-lines";
import {
  GrammarNames,
  Preludes,
  SideStarts,
  type DerivedPrelude,
  type GrammarName,
  type RowTokenLine,
  type SideStart,
  type TokenizableRow,
} from "./types";

type RegionCase = [string, GrammarName, string[], DerivedPrelude];

const MARKED_CASES: RegionCase[] = [
  [
    "opens the frontmatter above an Astro closing fence",
    GrammarNames.ASTRO,
    ['const title = "Home";', "---", "<Layout title={title}>"],
    Preludes.OPEN_FRONTMATTER,
  ],
  [
    "leaves an Astro fence that follows markup alone",
    GrammarNames.ASTRO,
    ["<p>above</p>", "---", "<p>below</p>"],
    undefined,
  ],
  [
    "ignores a fence in a Vue side",
    GrammarNames.VUE,
    ["<p>above</p>", "---", "<p>below</p>"],
    undefined,
  ],
  [
    "opens a script above an Astro closing script tag",
    GrammarNames.ASTRO,
    ["  count += 1;", "</script>", "<p>after</p>"],
    Preludes.OPEN_SCRIPT,
  ],
  [
    "opens a script above a Vue closing script tag",
    GrammarNames.VUE,
    ["const count = ref<number>(0);", "</script>", "<template>"],
    Preludes.OPEN_SCRIPT,
  ],
  [
    "opens a script above an uppercase HTML closing tag",
    GrammarNames.HTML,
    ["  start();", "</SCRIPT>"],
    Preludes.OPEN_SCRIPT,
  ],
  [
    "opens a style above an HTML closing style tag",
    GrammarNames.HTML,
    ["  h1 { color: red; }", "</style>", "</head>"],
    Preludes.OPEN_STYLE,
  ],
  [
    "opens the frontmatter above a fence that ends in a carriage return",
    GrammarNames.ASTRO,
    ['const title = "Home";\r', "---\r", "<h1>{title}</h1>\r"],
    Preludes.OPEN_FRONTMATTER,
  ],
  [
    "leaves a closing style tag inside a string alone",
    GrammarNames.ASTRO,
    [
      "const html = await response.text();",
      'const end = html.indexOf("</style>");',
    ],
    undefined,
  ],
  [
    "leaves the closing tag of a style-named element alone",
    GrammarNames.VUE,
    ["      </n-space>", "    </style-provider>", "  </div>"],
    undefined,
  ],
  [
    "leaves a fence under prose alone",
    GrammarNames.ASTRO,
    ["  A paragraph of plain words", "---", "  and more words."],
    undefined,
  ],
  [
    "leaves a fence under closing brackets alone",
    GrammarNames.ASTRO,
    ["  ],", "};", "---", "<h1>x</h1>"],
    undefined,
  ],
  [
    "opens the script tag above wrapped Vue attributes",
    GrammarNames.VUE,
    ["  setup", '  lang="ts"', ">", "const count = ref(0);", "</script>"],
    Preludes.OPEN_SCRIPT_TAG,
  ],
  [
    "opens the script tag for a side that starts on its closing bracket",
    GrammarNames.ASTRO,
    [">", "  start();", "</script>"],
    Preludes.OPEN_SCRIPT_TAG,
  ],
  [
    "opens the script tag when the bracket hugs the last attribute",
    GrammarNames.VUE,
    ['  lang="ts">', "const count = ref(0);", "</script>"],
    Preludes.OPEN_SCRIPT_TAG,
  ],
  [
    "opens the script tag above an attribute that holds an expression",
    GrammarNames.ASTRO,
    [
      "  is:inline",
      "  define:vars={{ id, name }}",
      ">",
      "  start(id);",
      "</script>",
    ],
    Preludes.OPEN_SCRIPT_TAG,
  ],
  [
    "opens the style tag above wrapped attributes",
    GrammarNames.VUE,
    [
      "  scoped",
      '  lang="scss"',
      ">",
      ".card {",
      "  margin: 0;",
      "}",
      "</style>",
    ],
    Preludes.OPEN_STYLE_TAG,
  ],
  [
    "opens a script above a comparison broken after its operator",
    GrammarNames.VUE,
    ["    count.value >", "    props.limit,", ")", "</script>"],
    Preludes.OPEN_SCRIPT,
  ],
  [
    "leaves a closing script tag under a lone bracket of code alone",
    GrammarNames.VUE,
    ["  number", ">", "const props = defineProps()", "</script>"],
    undefined,
  ],
  [
    "leaves a side that starts inside an attribute value alone",
    GrammarNames.ASTRO,
    ["    name,", "  }}", ">", "  start(id);", "</script>"],
    undefined,
  ],
  [
    "opens a script above a bare word that hugs a bracket",
    GrammarNames.HTML,
    ["  number>", "  start();", "</script>"],
    Preludes.OPEN_SCRIPT,
  ],
  [
    "leaves a script side that starts inside a template string alone",
    GrammarNames.VUE,
    ["  two", "`;", "const after = 1;", "</script>"],
    undefined,
  ],
  [
    "leaves a frontmatter side that starts inside a template string alone",
    GrammarNames.ASTRO,
    ["  from dual", "`;", "const after = 1;", "---", "<h1>x</h1>"],
    undefined,
  ],
  [
    "opens a script above a whole template string",
    GrammarNames.VUE,
    ["const label = `${title} (${count})`;", "</script>"],
    Preludes.OPEN_SCRIPT,
  ],
  [
    "leaves a closing script tag under a line of markup alone",
    GrammarNames.HTML,
    ['  target.innerHTML = "<b>bold</b>";', "</script>"],
    undefined,
  ],
  [
    "leaves a side that opens its own script alone",
    GrammarNames.ASTRO,
    ["<script>", "  count += 1;", "</script>"],
    undefined,
  ],
  [
    "leaves a side that opens its own style alone",
    GrammarNames.VUE,
    ['<style scoped lang="scss">', ".card { margin: 0; }", "</style>"],
    undefined,
  ],
  [
    "reads the closing tag before a later fence",
    GrammarNames.ASTRO,
    ["  margin: 0;", "</style>", "---"],
    Preludes.OPEN_STYLE,
  ],
];

const SHAPED_CASES: RegionCase[] = [
  [
    "reads Astro imports as frontmatter",
    GrammarNames.ASTRO,
    ['import Layout from "../layouts/Layout.astro";', "", "const items = []"],
    Preludes.OPEN_FRONTMATTER,
  ],
  [
    "reads a Props interface body as frontmatter",
    GrammarNames.ASTRO,
    ["  title: string;", "  description?: string;", "}"],
    Preludes.OPEN_FRONTMATTER,
  ],
  [
    "reads a generic type as code and not a tag",
    GrammarNames.ASTRO,
    ["const posts: Array<Post> = await getCollection<Post>(name);"],
    Preludes.OPEN_FRONTMATTER,
  ],
  [
    "reads a chained call that opens a block as code",
    GrammarNames.ASTRO,
    ["  .filter((post) => {", "    return !post.data.draft", "  })"],
    Preludes.OPEN_FRONTMATTER,
  ],
  [
    "reads a comment that names a tag as code",
    GrammarNames.ASTRO,
    ["// Drawn once with <use>.", 'import mark from "../mark.svg?raw";'],
    Preludes.OPEN_FRONTMATTER,
  ],
  [
    "reads a generic call that opens a block as code",
    GrammarNames.VUE,
    [
      "const byTag = posts",
      "  .reduce<Record<string, Post[]>>((all, post) => {",
    ],
    Preludes.OPEN_SCRIPT,
  ],
  [
    "reads a private field initializer as code",
    GrammarNames.VUE,
    ["  #cache = {", "    size: 0,", "  };"],
    Preludes.OPEN_SCRIPT,
  ],
  [
    "reads tag-free Vue code as a script",
    GrammarNames.VUE,
    ["const count = ref(0)", "function increment() {", "  count.value += 1"],
    Preludes.OPEN_SCRIPT,
  ],
  [
    "reads tag-free HTML code as a script",
    GrammarNames.HTML,
    ["  if (button !== null) {", "    button.disabled = true;", "  }"],
    Preludes.OPEN_SCRIPT,
  ],
  [
    "reads a class selector as a style",
    GrammarNames.ASTRO,
    [".card {", "  color: red;", "}"],
    Preludes.OPEN_STYLE,
  ],
  [
    "reads a selector with an attribute match as a style",
    GrammarNames.ASTRO,
    ['.card[data-open="true"] > .title {', "  color: red;", "}"],
    Preludes.OPEN_STYLE,
  ],
  [
    "reads a hyphenated property as a style",
    GrammarNames.VUE,
    ["  font-size: larger;", "  color: red;"],
    Preludes.OPEN_STYLE,
  ],
  [
    "reads a custom property as a style",
    GrammarNames.HTML,
    ["  --brand: teal;"],
    Preludes.OPEN_STYLE,
  ],
  [
    "reads a length value as a style",
    GrammarNames.ASTRO,
    ["  margin: 0 1rem;", "  color: red;"],
    Preludes.OPEN_STYLE,
  ],
  [
    "reads an at-rule as a style",
    GrammarNames.ASTRO,
    ["@media (min-width: 40rem) {", "  h1 { margin: 0; }"],
    Preludes.OPEN_STYLE,
  ],
  [
    "reads a nested parent selector as a style",
    GrammarNames.VUE,
    ["  &:hover {", "    color: red;", "  }"],
    Preludes.OPEN_STYLE,
  ],
  [
    "reads a pseudo-class selector as a style",
    GrammarNames.ASTRO,
    [":root {", "  color: red;", "}"],
    Preludes.OPEN_STYLE,
  ],
  [
    "reads code around a header-shaped string line as code",
    GrammarNames.ASTRO,
    ["const head = `", "content-type: text/html", "`", "const title = name"],
    Preludes.OPEN_FRONTMATTER,
  ],
  [
    "leaves plain declarations in an Astro style alone",
    GrammarNames.ASTRO,
    ["    position: relative;", "    display: flex;", "    cursor: pointer;"],
    undefined,
  ],
  [
    "leaves plain declarations in a Vue style alone",
    GrammarNames.VUE,
    ["    position: relative;", "    display: flex;", "    cursor: pointer;"],
    undefined,
  ],
  [
    "leaves plain declarations in an HTML style alone",
    GrammarNames.HTML,
    ["    position: relative;", "    display: flex;", "    cursor: pointer;"],
    undefined,
  ],
  [
    "leaves an element selector rule alone",
    GrammarNames.ASTRO,
    ["h1 {", "  color: red;", "}"],
    undefined,
  ],
  [
    "leaves a line comment over plain declarations alone",
    GrammarNames.VUE,
    ["  // spacing", "  margin: 0;", "  color: red;"],
    undefined,
  ],
  [
    "leaves the tail of a multi-line value alone",
    GrammarNames.ASTRO,
    ["    opacity 0.2s,", "    transform 0.2s;"],
    undefined,
  ],
  [
    "leaves a side of line comments alone",
    GrammarNames.ASTRO,
    ["// first note", "// second note"],
    undefined,
  ],
  [
    "leaves object entries with no statement alone",
    GrammarNames.ASTRO,
    ["  a: 1,", "  b: {", "    c: 2,", "  },"],
    undefined,
  ],
  [
    "leaves a decorator that shares an at-rule name alone",
    GrammarNames.VUE,
    ["@property({ type: String })", "label"],
    undefined,
  ],
  [
    "leaves a side that mixes a selector and an assignment alone",
    GrammarNames.VUE,
    [".card {", "  count.value += 1;"],
    undefined,
  ],
  [
    "leaves a template expression line alone",
    GrammarNames.ASTRO,
    ["{items.map((item) => (", "  item.name", "))}"],
    undefined,
  ],
  [
    "reads an SCSS variable as a style",
    GrammarNames.VUE,
    ["$font: Inter;", "$gap: none;"],
    Preludes.OPEN_STYLE,
  ],
  [
    "reads a Tailwind apply rule as a style",
    GrammarNames.ASTRO,
    ["  @apply flex;"],
    Preludes.OPEN_STYLE,
  ],
  [
    "reads a member typed as an array as code",
    GrammarNames.ASTRO,
    ["  items: Item[];", "  total: number;"],
    Preludes.OPEN_FRONTMATTER,
  ],
  [
    "reads a member call as code",
    GrammarNames.HTML,
    ['  document.documentElement.classList.add("js");'],
    Preludes.OPEN_SCRIPT,
  ],
  [
    "reads a spaced assignment as code",
    GrammarNames.VUE,
    ["  count.value += 1", "  open.value = false"],
    Preludes.OPEN_SCRIPT,
  ],
  [
    "leaves prose that holds an arrow alone",
    GrammarNames.VUE,
    ["  Open Settings => Profile", "  and choose a new avatar."],
    undefined,
  ],
  [
    "leaves prose that holds an equals sign alone",
    GrammarNames.ASTRO,
    ["  Set retries = 3 to retry", "  three times before failing."],
    undefined,
  ],
  [
    "leaves a prose label over a type word alone",
    GrammarNames.VUE,
    ["    Status: unknown", "    until the first sync finishes."],
    undefined,
  ],
  [
    "leaves prose that holds pipes alone",
    GrammarNames.HTML,
    ["    Plans: Free | Pro | Team", "    billed monthly."],
    undefined,
  ],
  [
    "leaves object keys that start with a dollar sign alone",
    GrammarNames.VUE,
    ['  $schema: "https://json-schema.org/draft-07/schema#",', '  $id: "a",'],
    undefined,
  ],
  [
    "leaves an Angular flow block alone",
    GrammarNames.HTML,
    ["@if (user) {", "  {{ user.name }}", "}"],
    undefined,
  ],
  [
    "leaves an Angular loop block alone",
    GrammarNames.HTML,
    ["  @for (item of items; track item.id) {", "    {{ item.name }}", "  }"],
    undefined,
  ],
  [
    "leaves a pseudo-class named after a type alone",
    GrammarNames.ASTRO,
    ["a:any-link {", "  color: red;", "}"],
    undefined,
  ],
  [
    "leaves prose that starts on a hyphenated label alone",
    GrammarNames.ASTRO,
    ["  follow-up: we ship this next week", "  after the review."],
    undefined,
  ],
  [
    "reads a property whose value starts on the next line as a style",
    GrammarNames.VUE,
    ["  grid-template-columns:", "    [full-start] minmax(0, 1fr)"],
    Preludes.OPEN_STYLE,
  ],
  [
    "leaves tag-free code that ends a template string alone",
    GrammarNames.HTML,
    ["  two", "`;", "const after = 1;"],
    undefined,
  ],
  [
    "leaves template markup alone",
    GrammarNames.ASTRO,
    ["<Layout title={title}>", "  <h1>{title}</h1>", "</Layout>"],
    undefined,
  ],
  [
    "leaves text that ends in a closing tag alone",
    GrammarNames.ASTRO,
    ["  the last words of a paragraph;", "  and its end</p>"],
    undefined,
  ],
  [
    "leaves a self-closing tag tail alone",
    GrammarNames.VUE,
    ['  label="Open"', '  @click="open();"', "/>"],
    undefined,
  ],
  [
    "leaves prose with no code line alone",
    GrammarNames.ASTRO,
    ["  A paragraph of plain words", "  that wraps onto a second line."],
    undefined,
  ],
  [
    "leaves prose that ends in an entity alone",
    GrammarNames.HTML,
    ["  Terms &amp; conditions&nbsp;", "  apply to you &amp;"],
    undefined,
  ],
  [
    "leaves a Vue binding that opens an object alone",
    GrammarNames.VUE,
    ['  :items="items"', '  :class="{', "    active: isActive,", '  }"'],
    undefined,
  ],
  [
    "leaves an attribute that opens a handler alone",
    GrammarNames.ASTRO,
    ["  onClick={() => {", "    open();", "  }}"],
    undefined,
  ],
  [
    "leaves a Vue directive argument line alone",
    GrammarNames.VUE,
    ['  v-bind:title="name"', '  v-on:click="open"'],
    undefined,
  ],
  [
    "leaves a template expression that opens on its own line alone",
    GrammarNames.ASTRO,
    ["{", "  hasChoice && (", "    label"],
    undefined,
  ],
  ["leaves an empty side alone", GrammarNames.ASTRO, ["", "   "], undefined],
];

type FenceCase = [string, string[], SideStart, DerivedPrelude];

// A fence that leads its side is the opener at the file's first line and the
// closer anywhere below it. A snippet cannot say which line it starts on.
const FENCE_CASES: FenceCase[] = [
  [
    "leaves a leading fence alone when the side start is unknown",
    ["---", 'import a from "a";', "---", "<h1>x</h1>"],
    SideStarts.UNKNOWN,
    undefined,
  ],
  [
    "leaves a lone leading fence alone when the side start is unknown",
    ["---", 'import a from "a";', "const b = 1;"],
    SideStarts.UNKNOWN,
    undefined,
  ],
  [
    "leaves a fence under blank lines alone when the start is unknown",
    ["", "---", "<h1>x</h1>"],
    SideStarts.UNKNOWN,
    undefined,
  ],
  [
    "reads a leading fence as the closer below the file start",
    ["---", "", "<h1>x</h1>"],
    SideStarts.MID_FILE,
    Preludes.OPEN_FRONTMATTER,
  ],
  [
    "reads a fence under frontmatter as the closer at any start",
    ["const a = 1;", "---", "<h1>x</h1>"],
    SideStarts.UNKNOWN,
    Preludes.OPEN_FRONTMATTER,
  ],
];

const FILE_START_ROWS: TokenizableRow[] = [
  { kind: DiffLineKinds.ADD, content: "---" },
  { kind: DiffLineKinds.ADD, content: 'import Layout from "./Layout.astro";' },
  { kind: DiffLineKinds.ADD, content: "---" },
  { kind: DiffLineKinds.ADD, content: "<Layout />" },
];

const UNNUMBERED_HUNK_ROWS: TokenizableRow[] = [
  { kind: DiffLineKinds.HUNK, content: "@@ -0,0 +1,4 @@" },
  ...FILE_START_ROWS,
];

const CLOSING_FENCE_ROWS: TokenizableRow[] = [
  { kind: DiffLineKinds.HUNK, content: "@@ -12,3 +12,4 @@" },
  { kind: DiffLineKinds.CTX, content: "---", oldLine: 12, newLine: 12 },
  { kind: DiffLineKinds.CTX, content: "", oldLine: 13, newLine: 13 },
  { kind: DiffLineKinds.ADD, content: "<h1>{title}</h1>", newLine: 14 },
  {
    kind: DiffLineKinds.CTX,
    content: "<p>after</p>",
    oldLine: 14,
    newLine: 15,
  },
];

type ColourCase = [string, GrammarName, string[], string, string];

// Each side is cut the way a hunk cuts it: the fence or tag that opens the
// region is above the side, so only the prelude can put the grammar in it.
const COLOUR_CASES: ColourCase[] = [
  [
    "colours a keyword in an Astro frontmatter hunk",
    GrammarNames.ASTRO,
    ['const title = "Home";', "const items = [];"],
    "const",
    "keyword",
  ],
  [
    "colours a keyword above an Astro closing fence",
    GrammarNames.ASTRO,
    ['const title = "Home";', "---", "<h1>{title}</h1>"],
    "const",
    "keyword",
  ],
  [
    "keeps the markup below an Astro closing fence as markup",
    GrammarNames.ASTRO,
    ['const title = "Home";', "---", "<h1>{title}</h1>"],
    "h1",
    "tag",
  ],
  [
    "colours a keyword above an Astro closing script tag",
    GrammarNames.ASTRO,
    ["  const count = 1;", "</script>"],
    "const",
    "keyword",
  ],
  [
    "colours a selector above an Astro closing style tag",
    GrammarNames.ASTRO,
    ["  h1 { margin: 0; }", "</style>"],
    "h1",
    "tag",
  ],
  [
    "colours a keyword in a Vue script hunk",
    GrammarNames.VUE,
    ["const count = ref<number>(0);", "const open = ref(false);"],
    "const",
    "keyword",
  ],
  [
    "colours a selector in a Vue style hunk",
    GrammarNames.VUE,
    [".card {", "  margin: 0 1rem;", "}"],
    ".card",
    "tag",
  ],
  [
    "colours a keyword in an HTML script hunk",
    GrammarNames.HTML,
    ["  const button = find();", "  button.disabled = true;"],
    "const",
    "keyword",
  ],
  [
    "colours a keyword after a comment tail in an Astro frontmatter",
    GrammarNames.ASTRO,
    [" * The page title.", " */", 'const title = "Home";'],
    "const",
    "keyword",
  ],
  [
    "colours a comment tail in a Vue script as a comment",
    GrammarNames.VUE,
    [" * Shared counter.", " */", "const count = ref(0);", "</script>"],
    "* Shared counter.",
    "comment",
  ],
  [
    "colours a keyword after a comment tail in a Vue script",
    GrammarNames.VUE,
    [" * Shared counter.", " */", "const count = ref(0);", "</script>"],
    "const",
    "keyword",
  ],
  [
    "colours a keyword above a regex that ends like a comment",
    GrammarNames.VUE,
    ["const count = ref(0)", "const leadingSpace = /^\\s*/", "</script>"],
    "const",
    "keyword",
  ],
  [
    "colours a selector after a comment tail in an HTML style",
    GrammarNames.HTML,
    [" * Page chrome.", " */", "h1 { margin: 0; }", "</style>"],
    "h1",
    "tag",
  ],
  [
    "keeps markup as markup after a comment tail and a closing fence",
    GrammarNames.ASTRO,
    [" * The page title.", " */", "---", "<h1>x</h1>"],
    "h1",
    "tag",
  ],
  [
    "colours a wrapped Vue script attribute as part of its tag",
    GrammarNames.VUE,
    ["  setup", '  lang="ts"', ">", "const count = ref(0);", "</script>"],
    "lang",
    "tag",
  ],
  [
    "colours the code under a wrapped Vue script tag",
    GrammarNames.VUE,
    ["  setup", '  lang="ts"', ">", "const count = ref(0);", "</script>"],
    "const",
    "keyword",
  ],
  [
    "colours a wrapped Astro script attribute as part of its tag",
    GrammarNames.ASTRO,
    ["  is:inline", '  type="text/partytown"', ">", "  start();", "</script>"],
    "type",
    "tag",
  ],
  [
    "colours a wrapped HTML script attribute as part of its tag",
    GrammarNames.HTML,
    ['  type="module"', "  async", ">", "  start();", "</script>"],
    "type",
    "tag",
  ],
  [
    "colours a wrapped Vue style attribute as part of its tag",
    GrammarNames.VUE,
    [
      "  scoped",
      '  lang="scss"',
      ">",
      ".card {",
      "  margin: 0;",
      "}",
      "</style>",
    ],
    "lang",
    "tag",
  ],
  [
    "colours a selector inside a media block as a selector",
    GrammarNames.ASTRO,
    ["  .page {", "    margin: 0;", "  }", "}", "</style>", "<p>after</p>"],
    ".page",
    "tag",
  ],
  [
    "keeps markup right below a style cut inside a media block",
    GrammarNames.VUE,
    ["  .page {", "    margin: 0;", "  }", "}", "</style>", "<p>after</p>"],
    "p",
    "tag",
  ],
  [
    "colours a declaration in a Vue style side that starts in a rule",
    GrammarNames.VUE,
    ["  font-size: 12px;", "  color: red;"],
    "font-size",
    "constant",
  ],
  [
    "keeps a script right below a Vue style cut inside a rule",
    GrammarNames.VUE,
    ["  color: red;", "}", "</style>", "<script setup>", "const a = 1;"],
    "const",
    "keyword",
  ],
  [
    "keeps markup right below an Astro style cut inside a rule",
    GrammarNames.ASTRO,
    ["    padding: 0;", "  }", "</style>", "<p>after</p>"],
    "p",
    "tag",
  ],
  [
    "keeps markup right below a style cut inside a nested rule",
    GrammarNames.ASTRO,
    [
      "      flex-direction: column;",
      "    }",
      "  }",
      "</style>",
      "<p>after</p>",
    ],
    "p",
    "tag",
  ],
  [
    "keeps markup right below an HTML style cut inside a rule",
    GrammarNames.HTML,
    ["        margin: 0;", "      }", "    </style>", "    <p>after</p>"],
    "p",
    "tag",
  ],
  [
    "keeps markup right below a script cut inside a template string",
    GrammarNames.VUE,
    ["  two", "`;", "const after = 1;", "</script>", "<p>after</p>"],
    "p",
    "tag",
  ],
  [
    "colours a selector above an HTML closing style tag",
    GrammarNames.HTML,
    ["  h1 { margin: 0; }", "</style>"],
    "h1",
    "tag",
  ],
];

let highlighter: HighlighterCore;

function resolvePaletteClassId(token: string): number {
  const index = SYNTAX_PALETTE.findIndex(
    (candidate) => candidate.token === token,
  );
  if (index < 0) {
    throw new Error(`no palette entry named ${token}`);
  }

  return index;
}

function readClassIdFor(lines: RowTokenLine[], content: string): number {
  const token = lines
    .flat()
    .find((candidate) => candidate.text.trim() === content);
  if (token === undefined) {
    throw new Error(`no token for ${content}`);
  }

  return token.classId;
}

beforeAll(async () => {
  highlighter = await createHighlighterCore({
    themes: [MERGEBRIEF_DARK],
    langs: [
      import("shiki/langs/astro.mjs"),
      import("shiki/langs/html.mjs"),
      import("shiki/langs/vue.mjs"),
    ],
    engine: createJavaScriptRegexEngine(),
  });
});

describe("deriveRegionPrelude", () => {
  it.each(MARKED_CASES)("%s", (_title, grammar, lines, expected) => {
    expect(deriveRegionPrelude(lines.join("\n"), grammar)).toBe(expected);
  });

  it.each(SHAPED_CASES)("%s", (_title, grammar, lines, expected) => {
    expect(deriveRegionPrelude(lines.join("\n"), grammar)).toBe(expected);
  });

  it.each(FENCE_CASES)("%s", (_title, lines, sideStart, expected) => {
    const text = lines.join("\n");

    expect(deriveRegionPrelude(text, GrammarNames.ASTRO, sideStart)).toBe(
      expected,
    );
  });

  it("keeps the comment when its body holds an arrow", () => {
    const prelude = deriveCommentedRegionPrelude(
      " * @param done (error) => void\n */",
      "\nconst count = ref(0);\n</script>",
      GrammarNames.VUE,
    );

    expect(prelude).toBe(Preludes.OPEN_SCRIPT_COMMENT);
  });

  it("reads nothing from a line longer than the shape ceiling", () => {
    const text = `.card { margin: 0; } ${"a".repeat(400)} {`;

    expect(deriveRegionPrelude(text, GrammarNames.ASTRO)).toBeUndefined();
  });

  it("leaves a grammar with no regions alone", () => {
    const text = ['import a from "a";', "const b = 1;"].join("\n");

    expect(deriveRegionPrelude(text, GrammarNames.TYPESCRIPT)).toBeUndefined();
  });
});

describe("tokenizeSide on a markup region", () => {
  it.each(COLOUR_CASES)("%s", (_title, grammar, lines, content, token) => {
    const tokens = tokenizeSide(highlighter, lines.join("\n"), grammar);

    expect(readClassIdFor(tokens, content)).toBe(resolvePaletteClassId(token));
  });

  it("reads a frontmatter hunk as plain text from a cold start", () => {
    const tokens = tokenizeSide(
      highlighter,
      'const title = "Home";',
      GrammarNames.ASTRO,
      SideStarts.FILE_START,
    );
    const classIds = new Set(tokens.flat().map((token) => token.classId));

    expect([...classIds]).toEqual([resolvePaletteClassId("text")]);
  });
});

describe("tokenizing rows that hold an Astro fence", () => {
  it("colours the frontmatter of a snippet that starts on line one", () => {
    const byRow = tokenizeStandaloneRows(
      highlighter,
      FILE_START_ROWS,
      GrammarNames.ASTRO,
    );

    expect(readClassIdFor([...byRow.values()], "import")).toBe(
      resolvePaletteClassId("keyword"),
    );
  });

  it("colours the frontmatter of a hunk whose rows carry no numbers", () => {
    const byRow = tokenizeChunkRows(
      highlighter,
      UNNUMBERED_HUNK_ROWS,
      GrammarNames.ASTRO,
    );

    expect(readClassIdFor([...byRow.values()], "import")).toBe(
      resolvePaletteClassId("keyword"),
    );
  });

  it("keeps markup as markup in a hunk that starts on the closing fence", () => {
    const byRow = tokenizeChunkRows(
      highlighter,
      CLOSING_FENCE_ROWS,
      GrammarNames.ASTRO,
    );

    expect(readClassIdFor([...byRow.values()], "h1")).toBe(
      resolvePaletteClassId("tag"),
    );
  });
});
