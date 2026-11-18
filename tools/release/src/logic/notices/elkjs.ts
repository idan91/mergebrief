import {
  ELK_REPOSITORY,
  ELKJS_LICENSE_TEXT,
  ELKJS_PACKAGE,
  ELKJS_REPOSITORY,
  GITHUB_ORIGIN,
  RECORDED_ELKJS_VERSION_LABEL,
} from "./consts";

function formatTagUrl(version: string): string {
  return `${GITHUB_ORIGIN}/${ELKJS_REPOSITORY}/tree/${version}`;
}

/** The line appended under the libvips notices: what elkjs is, its licence, where its source is. */
export function renderElkjsNotice(version: string): string {
  return [
    "",
    "---",
    "",
    `The web app also ships ${ELKJS_PACKAGE} ${version}, the graph layout Mermaid diagrams use, unmodified under the Eclipse Public License 2.0; the full text is ${ELKJS_LICENSE_TEXT.fileName}, and its source is ${formatTagUrl(version)} (archive in SOURCES.md).`,
    "",
  ].join("\n");
}

/** The `SOURCES.md` section for elkjs: the recorded version, where it ships, and its source. */
export function renderElkjsSources(version: string): string {
  const archive = `${GITHUB_ORIGIN}/${ELKJS_REPOSITORY}/archive/refs/tags/${version}.tar.gz`;
  return [
    `## ${ELKJS_PACKAGE}`,
    "",
    `${RECORDED_ELKJS_VERSION_LABEL} ${version}`,
    "",
    `The web app ships the npm package \`${ELKJS_PACKAGE}@${version}\`, unmodified, under the Eclipse Public License 2.0 (${ELKJS_LICENSE_TEXT.fileName}): minified into Mermaid's lazily loaded layout chunk under \`/app/apps/web/dist/client/assets/\`, and as the package itself under \`/app/node_modules/.pnpm/\`.`,
    "",
    `Its source is the release tag, ${archive} (${formatTagUrl(version)}). That tag compiles the ELK layout algorithms from their Java source, ${GITHUB_ORIGIN}/${ELK_REPOSITORY}, with GWT, as its README's Building section describes.`,
    "",
  ].join("\n");
}
