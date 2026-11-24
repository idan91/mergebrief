import {
  type Dirent,
  globSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";

import { MARKDOWN_EXTENSION } from "../consts";
import { readHeadings } from "../headings";
import { toPosixPath } from "../utils";
import {
  HOME_PAGE_SOURCE,
  HOME_PAGE_TARGET,
  MARKDOWN_GLOB,
  RELEASES_FOLDER,
  SITE_PAGE_GLOBS,
} from "./consts";
import type { SitePage } from "./types";

const GLOB_SPECIAL = /[\\*?[\]{}()!+@|]/g;

export function listSitePages(srcDir: string): string[] {
  const pages = new Set(
    SITE_PAGE_GLOBS.flatMap((pattern) => globSync(pattern, { cwd: srcDir })),
  );
  return [...pages].map(toPosixPath).toSorted();
}

function isLinkedFolder(entry: Dirent): boolean {
  if (!entry.isSymbolicLink()) {
    return false;
  }

  const target = statSync(path.join(entry.parentPath, entry.name), {
    throwIfNoEntry: false,
  });
  return target?.isDirectory() === true;
}

function listLinkedFolders(srcDir: string): string[] {
  const entries = readdirSync(srcDir, { recursive: true, withFileTypes: true });
  return entries.filter(isLinkedFolder).map((entry) => {
    const folder = path.join(entry.parentPath, entry.name);
    return toPosixPath(path.relative(srcDir, folder));
  });
}

/**
 * Every markdown file under `docs/` the allow-list leaves out, so a new folder never builds by accident.
 * VitePress reads these as globs, so each path is escaped to match only itself.
 * A linked folder is excluded whole: `globSync` never enters it, VitePress does.
 */
export function deriveSrcExclude(srcDir: string): string[] {
  const pages = new Set(listSitePages(srcDir));
  const markdown = globSync(MARKDOWN_GLOB, { cwd: srcDir }).map(toPosixPath);
  const excluded = markdown.filter((file) => !pages.has(file)).toSorted();
  const linked = listLinkedFolders(srcDir).toSorted();
  return [
    ...excluded.map(escapeGlob),
    ...linked.map((folder) => `${escapeGlob(folder)}/**`),
  ];
}

function escapeGlob(file: string): string {
  return file.replace(GLOB_SPECIAL, "\\$&");
}

export function readPageTitle(markdown: string): string | undefined {
  return readHeadings(markdown).find((heading) => heading.depth === 1)?.text;
}

/** Release notes carry no H1; their filename is the version. */
export function readReleaseVersion(relativePath: string): string | undefined {
  if (!relativePath.startsWith(RELEASES_FOLDER)) {
    return undefined;
  }

  return path.posix.basename(relativePath, MARKDOWN_EXTENSION);
}

/** The home page builds as the site root; every other page keeps its path. */
export function toSiteFile(source: string): string {
  return source === HOME_PAGE_SOURCE ? HOME_PAGE_TARGET : source;
}

export function readSitePages(srcDir: string): SitePage[] {
  return listSitePages(srcDir).map((source) => {
    const markdown = readFileSync(path.join(srcDir, source), "utf8");
    const title =
      readPageTitle(markdown) ?? readReleaseVersion(source) ?? source;
    return { source, link: toSiteLink(source), title };
  });
}

function toSiteLink(source: string): SitePage["link"] {
  const siteFile = toSiteFile(source);
  if (siteFile === HOME_PAGE_TARGET) {
    return "/";
  }

  return `/${siteFile.slice(0, -MARKDOWN_EXTENSION.length)}`;
}
