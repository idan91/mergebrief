/* oxlint-disable i18next/no-literal-string, house/no-shout-case-copy -- HTML and CSS for the diagram frame's own page, never read as text */
const DIAGRAM_DOCUMENT_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";

/**
 * The page our sandboxed frame shows: the SVG alone, dark and see-through,
 * filling the frame's width. Its policy allows styles only, so no script
 * runs and no address in a label is fetched.
 */
export function buildDiagramDocument(svgMarkup: string): string {
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${DIAGRAM_DOCUMENT_POLICY}">`,
    '<meta name="color-scheme" content="dark">',
    "<style>html,body{margin:0;background:transparent;color-scheme:dark}",
    "svg{display:block;width:100%;height:auto;max-width:none!important}</style>",
    `</head><body>${svgMarkup}</body></html>`,
  ].join("");
}
