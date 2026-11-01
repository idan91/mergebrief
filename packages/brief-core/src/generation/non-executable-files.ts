import { RiskSurfaceAttributes } from "../types";

const NO_TESTS = RiskSurfaceAttributes.NO_TESTS;

const NON_EXECUTABLE_EXTENSIONS: ReadonlySet<string> = new Set([
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
]);

interface NotedChunk {
  readonly file: string;
  readonly riskSurface: readonly string[];
  riskNotes?: readonly { readonly attr: string }[] | undefined;
}

/** A leading dot marks a hidden file (`.gitignore`), not an extension. */
function isNonExecutablePath(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return false;
  }
  const extension = name.slice(dot + 1).toLowerCase();
  return NON_EXECUTABLE_EXTENSIONS.has(extension);
}

/**
 * Style, markup, docs and static assets hold no code a test could cover, so
 * `no-tests` and its note leave them. Everything else keeps the model's call.
 */
export function dropNoTestsOnNonExecutableFiles<Chunk extends NotedChunk>(
  chunks: readonly Chunk[],
): Chunk[] {
  return chunks.map((chunk) => {
    const hasNoTestsNote = chunk.riskNotes?.some(
      (note) => note.attr === NO_TESTS,
    );
    const flagged = chunk.riskSurface.includes(NO_TESTS) || hasNoTestsNote;
    const clearsNoTests = flagged && isNonExecutablePath(chunk.file);
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
