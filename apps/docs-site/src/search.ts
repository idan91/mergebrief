import type { DefaultTheme } from "vitepress";

import { readReleaseVersion } from "./pages";
import { readPageTrail } from "./pages/sidebar";
import type { SidebarLabels } from "./pages/types";

type SearchEnv = Parameters<
  NonNullable<DefaultTheme.LocalSearchOptions["_render"]>
>[1];

/** The one renderer method the hook calls, so VitePress's renderer and a test's both fit. */
interface SearchMarkdown {
  render: (src: string, env: SearchEnv) => string;
}

type SearchRender = (src: string, env: SearchEnv, md: SearchMarkdown) => string;

const TRAIL_SEPARATOR = " / ";
const FIRST_H1_OPEN = /<h1[^>]*>/i;

/** Indexes each page under its sidebar trail, so a search result names the group its heading sits in. Only the index changes: the page renders as written. */
export function createSearchRender(labels: SidebarLabels): SearchRender {
  return function renderForSearch(src, env, md) {
    const html = md.render(src, env);
    if (env.frontmatter?.["search"] === false) {
      return "";
    }

    const trail = readPageTrail(env.relativePath, labels);
    const releaseVersion = readReleaseVersion(env.relativePath);
    return prefixPageTrail(html, trail, releaseVersion);
  };
}

/** Puts the trail before the page's H1 text. A page with no H1, a release note, gets one from the trail and `untitledName`. */
export function prefixPageTrail(
  html: string,
  trail: readonly string[],
  untitledName: string | undefined,
): string {
  if (trail.length === 0) {
    return html;
  }

  const prefix = escapeHtml(trail.join(TRAIL_SEPARATOR));
  if (FIRST_H1_OPEN.test(html)) {
    return html.replace(
      FIRST_H1_OPEN,
      (open) => `${open}${prefix}${TRAIL_SEPARATOR}`,
    );
  }

  const names = untitledName === undefined ? [] : [escapeHtml(untitledName)];
  const title = [prefix, ...names].join(TRAIL_SEPARATOR);
  return `<h1 tabindex="-1">${title} <a class="header-anchor" href="#"></a></h1>\n${html}`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
