import { GrammarNames, type GrammarName, type ResolvedGrammar } from "./types";

const EXTENSION_GRAMMARS: Record<string, GrammarName> = {
  astro: GrammarNames.ASTRO,
  bash: GrammarNames.SHELLSCRIPT,
  c: GrammarNames.C,
  "c++": GrammarNames.CPP,
  cc: GrammarNames.CPP,
  cjs: GrammarNames.JAVASCRIPT,
  cpp: GrammarNames.CPP,
  cppm: GrammarNames.CPP,
  cs: GrammarNames.CSHARP,
  css: GrammarNames.CSS,
  cts: GrammarNames.TYPESCRIPT,
  cxx: GrammarNames.CPP,
  diff: GrammarNames.DIFF,
  go: GrammarNames.GO,
  gql: GrammarNames.GRAPHQL,
  graphql: GrammarNames.GRAPHQL,
  h: GrammarNames.CPP,
  "h++": GrammarNames.CPP,
  hh: GrammarNames.CPP,
  hpp: GrammarNames.CPP,
  htm: GrammarNames.HTML,
  html: GrammarNames.HTML,
  hxx: GrammarNames.CPP,
  ini: GrammarNames.INI,
  inl: GrammarNames.CPP,
  ipp: GrammarNames.CPP,
  ixx: GrammarNames.CPP,
  java: GrammarNames.JAVA,
  js: GrammarNames.JAVASCRIPT,
  json: GrammarNames.JSON,
  jsonc: GrammarNames.JSONC,
  jsx: GrammarNames.JSX,
  kt: GrammarNames.KOTLIN,
  kts: GrammarNames.KOTLIN,
  md: GrammarNames.MARKDOWN,
  mdx: GrammarNames.MDX,
  mjs: GrammarNames.JAVASCRIPT,
  mts: GrammarNames.TYPESCRIPT,
  patch: GrammarNames.DIFF,
  php: GrammarNames.PHP,
  py: GrammarNames.PYTHON,
  rs: GrammarNames.RUST,
  scss: GrammarNames.SCSS,
  sh: GrammarNames.SHELLSCRIPT,
  snap: GrammarNames.JAVASCRIPT,
  sql: GrammarNames.SQL,
  svg: GrammarNames.XML,
  swift: GrammarNames.SWIFT,
  toml: GrammarNames.TOML,
  tpp: GrammarNames.CPP,
  ts: GrammarNames.TYPESCRIPT,
  tsx: GrammarNames.TSX,
  vue: GrammarNames.VUE,
  xml: GrammarNames.XML,
  yaml: GrammarNames.YAML,
  yml: GrammarNames.YAML,
  zsh: GrammarNames.SHELLSCRIPT,
};

const BASENAME_GRAMMARS: Record<string, GrammarName> = {
  ".dockerignore": GrammarNames.INI,
  ".gitignore": GrammarNames.INI,
  ".npmignore": GrammarNames.INI,
  ".vercelignore": GrammarNames.INI,
  makefile: GrammarNames.MAKE,
};

// shiki's php grammar has no HTML mode, so a Blade template's markup and prose
// would read as PHP constants; plain text misleads less.
const BLADE_SUFFIX = ".blade.php";
const DOCKERFILE = "dockerfile";
const DOTENV_FILE = ".env";
const NOT_FOUND = -1;

/** Rows render plain when the path maps to no grammar we ship. */
export function resolveGrammar(filePath: string): ResolvedGrammar {
  const basename = readBasename(filePath).toLowerCase();
  if (basename === "" || basename.endsWith(BLADE_SUFFIX)) {
    return undefined;
  }

  const byName = readOwnGrammar(BASENAME_GRAMMARS, basename);
  if (byName !== undefined) {
    return byName;
  }

  if (isDockerfile(basename)) {
    return GrammarNames.DOCKER;
  }
  if (isDotenvFile(basename)) {
    return GrammarNames.DOTENV;
  }

  return readExtension(basename);
}

function readBasename(filePath: string): string {
  const cut = filePath.lastIndexOf("/");

  return cut === NOT_FOUND ? filePath : filePath.slice(cut + 1);
}

function isDockerfile(basename: string): boolean {
  return basename === DOCKERFILE || basename.startsWith(`${DOCKERFILE}.`);
}

function isDotenvFile(basename: string): boolean {
  return basename === DOTENV_FILE || basename.startsWith(`${DOTENV_FILE}.`);
}

function readExtension(basename: string): GrammarName | undefined {
  const dot = basename.lastIndexOf(".");
  if (dot <= 0) {
    return undefined;
  }

  return readOwnGrammar(
    EXTENSION_GRAMMARS,
    basename.slice(dot + 1).toLowerCase(),
  );
}

function readOwnGrammar(
  table: Record<string, GrammarName>,
  key: string,
): GrammarName | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}
