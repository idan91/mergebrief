import { Concerns, RiskSurfaceAttributes } from "../types";

const NO_TESTS = RiskSurfaceAttributes.NO_TESTS;

const EXEMPT_EXTENSIONS: ReadonlySet<string> = new Set([
  "css",
  "scss",
  "sass",
  "less",
  "md",
  "markdown",
  "svg",
  "html",
  "htm",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "ico",
  "bmp",
  "tif",
  "tiff",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "mp3",
  "wav",
  "ogg",
  "mp4",
  "webm",
  "mov",
  "pdf",
  "yml",
  "yaml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "json",
  "dockerfile",
  "mk",
  "sh",
  "bash",
  "zsh",
  "fish",
]);

/** Lower-cased names with no extension to go by. */
const EXEMPT_FILE_NAMES: ReadonlySet<string> = new Set([
  "dockerfile",
  "containerfile",
  "makefile",
  "gnumakefile",
]);

/** `Dockerfile.prod`: the suffix names a variant, not a language. */
const CONTAINER_FILE_VARIANT = /^(?:dockerfile|containerfile)\./;

interface NotedChunk {
  readonly file: string;
  readonly concern?: string;
  readonly riskSurface: readonly string[];
  riskNotes?: readonly { readonly attr: string }[] | undefined;
}

/** A leading dot marks a hidden file (`.gitignore`), not an extension. */
function isExemptPath(path: string): boolean {
  const baseName = path.slice(path.lastIndexOf("/") + 1);
  const name = baseName.toLowerCase();
  const isExemptName =
    EXEMPT_FILE_NAMES.has(name) || CONTAINER_FILE_VARIANT.test(name);
  if (isExemptName) {
    return true;
  }
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return false;
  }
  return EXEMPT_EXTENSIONS.has(name.slice(dot + 1));
}

/**
 * Style, markup, docs, static assets, configuration, build files and shell
 * scripts carry no finding in "no test covers this", so `no-tests` and its note
 * leave them, as they leave any chunk the model itself labels config. Everything
 * else keeps the model's call.
 */
export function dropNoTestsOnExemptFiles<Chunk extends NotedChunk>(
  chunks: readonly Chunk[],
): Chunk[] {
  return chunks.map((chunk) => {
    const hasNoTestsNote = chunk.riskNotes?.some(
      (note) => note.attr === NO_TESTS,
    );
    const flagged = chunk.riskSurface.includes(NO_TESTS) || hasNoTestsNote;
    const exempt =
      chunk.concern === Concerns.CONFIG || isExemptPath(chunk.file);
    const clearsNoTests = flagged && exempt;
    if (!clearsNoTests) {
      return chunk;
    }

    const riskSurface = chunk.riskSurface.filter((attr) => attr !== NO_TESTS);
    const riskNotes = chunk.riskNotes?.filter((note) => note.attr !== NO_TESTS);
    if (riskNotes !== undefined && riskNotes.length > 0) {
      return { ...chunk, riskSurface, riskNotes };
    }
    const dropped = { ...chunk, riskSurface };
    delete dropped.riskNotes;
    return dropped;
  });
}
