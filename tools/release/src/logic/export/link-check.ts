import { lstatSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";

import { EXCLUSION_RULE_SITES, EXPORT_PATHS } from "./paths";
import {
  type ExclusionRuleSite,
  type ExportPaths,
  type LinkHit,
  LinkHitKinds,
} from "./types";

const MARKDOWN_EXTENSION = ".md";
const INLINE_LINK = /\]\(\s*<?([^)\s>]+)>?/g;
const REFERENCE_LINK = /^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/;
const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const FRAGMENT_OR_QUERY = /[#?].*$/;
const PARENT_SEGMENT = "../";
const ROOT_SLASH = "/";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A prefix as written in prose: not inside a longer path (`~/.claude/`), not a longer name. */
function buildMentionPattern(prefix: string): RegExp {
  const bare = prefix.endsWith(ROOT_SLASH) ? prefix.slice(0, -1) : prefix;
  return new RegExp(`(?<![\\w.~/-])${escapeRegExp(bare)}(?![\\w.-])`);
}

function decodeLinkPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** The repo path a link target names from `file`, or `undefined` for a URL, an anchor or a path outside the tree. */
function resolveLinkTarget(file: string, target: string): string | undefined {
  const external = URL_SCHEME.test(target) || target.startsWith("#");
  if (external) {
    return undefined;
  }

  const bare = decodeLinkPath(target.replace(FRAGMENT_OR_QUERY, ""));
  const fromRoot = bare.startsWith(ROOT_SLASH);
  const joined = fromRoot
    ? bare.slice(1)
    : posix.join(posix.dirname(file), bare);
  const resolved = posix.normalize(joined);
  const outside = resolved === ".." || resolved.startsWith(PARENT_SEGMENT);
  return outside ? undefined : resolved;
}

function findExcludedPrefix(
  path: string,
  exclude: readonly string[],
): string | undefined {
  return exclude.find((prefix) => {
    const isDirItself = prefix.endsWith(ROOT_SLASH) && `${path}/` === prefix;
    const excludesPath = isDirItself || path.startsWith(prefix);
    return excludesPath;
  });
}

function readLinkTargets(line: string): readonly string[] {
  const inline = [...line.matchAll(INLINE_LINK)].map((match) => match[1] ?? "");
  const reference = REFERENCE_LINK.exec(line)?.[1];
  const targets = reference === undefined ? inline : [...inline, reference];
  return targets.filter((target) => target.length > 0);
}

function isExclusionRuleSite(
  file: string,
  line: string,
  sites: readonly ExclusionRuleSite[],
): boolean {
  const allowed = sites.some((site) => {
    const matchesSite = site.path === file && line.includes(site.fragment);
    return matchesSite;
  });
  return allowed;
}

/**
 * Every place a markdown file sends a reader into an excluded path: a link
 * that resolves into an exclude prefix, or the prefix written out in prose.
 * A line that states the exclusion rule itself is allowed to name it.
 */
export function findInternalLinks(
  file: string,
  text: string,
  manifest: ExportPaths = EXPORT_PATHS,
  sites: readonly ExclusionRuleSite[] = EXCLUSION_RULE_SITES,
): readonly LinkHit[] {
  const mentions = manifest.exclude.map((prefix) => ({
    prefix,
    pattern: buildMentionPattern(prefix),
  }));
  const hits: LinkHit[] = [];

  for (const [index, line] of text.split("\n").entries()) {
    if (isExclusionRuleSite(file, line, sites)) {
      continue;
    }
    const lineNumber = index + 1;
    const linked = new Set<string>();

    for (const target of readLinkTargets(line)) {
      const resolved = resolveLinkTarget(file, target);
      const prefix =
        resolved === undefined
          ? undefined
          : findExcludedPrefix(resolved, manifest.exclude);
      if (prefix !== undefined) {
        linked.add(prefix);
        hits.push({
          path: file,
          line: lineNumber,
          target,
          kind: LinkHitKinds.LINK,
        });
      }
    }
    for (const { prefix, pattern } of mentions) {
      const mentioned = !linked.has(prefix) && pattern.test(line);
      if (mentioned) {
        hits.push({
          path: file,
          line: lineNumber,
          target: prefix,
          kind: LinkHitKinds.MENTION,
        });
      }
    }
  }
  return hits;
}

/** The link check over the shipped markdown files of a materialized tree. */
export function checkTreeLinks(
  dir: string,
  shipped: readonly string[],
  manifest: ExportPaths = EXPORT_PATHS,
): readonly LinkHit[] {
  const hits: LinkHit[] = [];
  for (const path of shipped) {
    const isMarkdown = path.toLowerCase().endsWith(MARKDOWN_EXTENSION);
    if (!isMarkdown) {
      continue;
    }
    const file = join(dir, path);
    if (lstatSync(file).isSymbolicLink()) {
      continue;
    }
    const text = readFileSync(file, "utf8");
    hits.push(...findInternalLinks(path, text, manifest));
  }
  return hits;
}
