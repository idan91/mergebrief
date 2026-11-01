import { readdirSync, readFileSync, type Dirent } from "node:fs";
import path from "node:path";
import { parse } from "node-html-parser";

import { splitHref, toPosixPath } from "../utils";
import { AnchorProblemKinds, type BuiltPage, type DeadAnchor } from "./types";

const HTML_EXTENSION = ".html";
const NOT_FOUND_PAGE = "404.html";
const INDEX_PAGE = "index.html";
const EXTERNAL_HREF = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

/**
 * Every internal link in the built site whose page or `#fragment` does not exist. VitePress checks
 * dead pages but strips fragments first, so this runs over the shipped HTML after the build.
 */
export function findDeadAnchors(outDir: string, base: string): DeadAnchor[] {
  const site = readBuiltSite(outDir, base);
  const dead: DeadAnchor[] = [];

  for (const [page, built] of site.pages) {
    for (const href of built.hrefs) {
      const kind = checkHref(href, page, site);
      if (kind !== undefined) {
        dead.push({ page, href, kind });
      }
    }
  }

  return dead;
}

export function formatDeadAnchors(dead: readonly DeadAnchor[]): string {
  const lines = dead.map(
    (anchor) => `  ${anchor.page}: ${anchor.href} (${anchor.kind})`,
  );
  return ["Links with no target in the built site:", ...lines].join("\n");
}

interface BuiltSite {
  pages: ReadonlyMap<string, BuiltPage>;
  /** Every file in the output folder, pages included, posix paths. */
  files: ReadonlySet<string>;
  base: string;
}

function checkHref(
  href: string,
  page: string,
  site: BuiltSite,
): DeadAnchor["kind"] | undefined {
  if (EXTERNAL_HREF.test(href) || href === "") {
    return undefined;
  }

  const parts = splitHref(href);
  if (!parts.ok) {
    return AnchorProblemKinds.MALFORMED_HREF;
  }

  const { path: targetPath, fragment } = parts.value;
  const leavesSiteBase = targetPath !== "" && !targetPath.startsWith(site.base);
  if (leavesSiteBase) {
    return AnchorProblemKinds.OUTSIDE_BASE;
  }

  const sitePath = targetPath.slice(site.base.length);
  const target =
    targetPath === ""
      ? site.pages.get(page)
      : findBuiltPage(sitePath, site.pages);
  if (target === undefined) {
    return site.files.has(sitePath)
      ? undefined
      : AnchorProblemKinds.MISSING_PAGE;
  }

  const hasAnchor = fragment === "" || target.ids.has(fragment);
  return hasAnchor ? undefined : AnchorProblemKinds.MISSING_ANCHOR;
}

/**
 * `releases/0.1.0` and `releases/0.1.0.html` name the same page. Decided by what was built, never by
 * extension: a dotted page name has one.
 */
function findBuiltPage(
  sitePath: string,
  pages: ReadonlyMap<string, BuiltPage>,
): BuiltPage | undefined {
  if (sitePath === "" || sitePath.endsWith("/")) {
    return pages.get(`${sitePath}${INDEX_PAGE}`);
  }

  return pages.get(`${sitePath}${HTML_EXTENSION}`) ?? pages.get(sitePath);
}

function readBuiltSite(outDir: string, base: string): BuiltSite {
  const entries = readdirSync(outDir, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => toOutputPath(outDir, entry));
  const pages = new Map<string, BuiltPage>();

  for (const file of files) {
    if (file.endsWith(HTML_EXTENSION) && file !== NOT_FOUND_PAGE) {
      const html = readFileSync(path.join(outDir, file), "utf8");
      pages.set(file, readBuiltPage(html));
    }
  }

  return { pages, files: new Set(files), base };
}

function toOutputPath(outDir: string, entry: Dirent): string {
  const file = path.join(entry.parentPath, entry.name);
  return toPosixPath(path.relative(outDir, file));
}

function readBuiltPage(html: string): BuiltPage {
  const root = parse(html);
  const ids = root.querySelectorAll("[id]").map((element) => element.id);
  const hrefs = root
    .querySelectorAll("a[href]")
    .map((element) => element.getAttribute("href") ?? "");
  return { ids: new Set(ids), hrefs };
}
