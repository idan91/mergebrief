/* oxlint-disable i18next/no-literal-string -- markup standing in for what Mermaid returns, never read as text */
const SANDBOX_FRAME_SOURCE_PREFIX = "data:text/html;charset=UTF-8;base64,";

/** `markup` base64-encoded as UTF-8, the way Mermaid encodes a sandboxed frame. */
function encodeUtf8Base64(markup: string): string {
  const bytes = new TextEncoder().encode(markup);
  const binary = Array.from(bytes, (byte) => String.fromCodePoint(byte));
  return btoa(binary.join(""));
}

/** The frame markup Mermaid's sandbox mode hands back for `svgMarkup`. */
export function buildSandboxFrameMarkup(svgMarkup: string): string {
  const body = `<body style="margin:0">${svgMarkup}</body>`;
  const source = `${SANDBOX_FRAME_SOURCE_PREFIX}${encodeUtf8Base64(body)}`;
  return `<iframe style="width:100%;height:200px;border:0;margin:0;" src="${source}" sandbox="allow-top-navigation-by-user-activation allow-popups">\n  The "iframe" tag is not supported by your browser.\n</iframe>`;
}

/** An SVG of the given viewBox, holding `content`. */
export function buildDiagramSvg(viewBox: string, content = ""): string {
  return `<svg id="diagram" width="100%" xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="graphics-document document">${content}</svg>`;
}
