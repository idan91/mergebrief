import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Result } from "types";

import { readHeadingSlugs } from "../anchors/slug";
import { MARKDOWN_EXTENSION } from "../consts";
import { toSiteFile } from "../pages";
import type { CoreRule, CoreState } from "../types";
import { splitHref, toPosixPath } from "../utils";
import { PASSTHROUGH_HREF, PUBLIC_REPO_URL } from "./consts";
import {
  LinkProblemKinds,
  type GitHubRef,
  type LinkContext,
  type LinkProblem,
} from "./types";

const VERSION_PREFIX = /^v/;

/** `0.1.0` and `v0.1.0` both name the `v0.1.0` tag. */
export function readGitHubRef(version: string | undefined): GitHubRef {
  if (!version) {
    return "main";
  }

  return `v${version.replace(VERSION_PREFIX, "")}`;
}

/**
 * Rewrites one relative href written for GitHub: an allow-listed page becomes its root-absolute site
 * path (VitePress then applies `base` and its dead-page check), anything else in the repo becomes a
 * GitHub URL at `context.ref`.
 */
export function resolveLink(
  href: string,
  source: string,
  context: LinkContext,
): Result<string, LinkProblem> {
  if (PASSTHROUGH_HREF.test(href)) {
    return { ok: true, value: href };
  }

  const parts = splitHref(href);
  if (!parts.ok) {
    return {
      ok: false,
      error: { kind: LinkProblemKinds.MALFORMED_HREF, href },
    };
  }

  const { fragment, hash } = parts.value;
  const target = path.resolve(path.dirname(source), parts.value.path);
  const repoPath = toPosixPath(path.relative(context.repoRoot, target));
  if (repoPath.startsWith("..") || path.isAbsolute(repoPath)) {
    return { ok: false, error: { kind: LinkProblemKinds.OUTSIDE_REPO, href } };
  }

  const sitePage = toPosixPath(path.relative(context.srcDir, target));
  if (context.sitePages.has(sitePage)) {
    return { ok: true, value: `/${toSiteFile(sitePage)}${hash}` };
  }

  return resolveGitHubLink(
    { href, target, repoPath, fragment, hash },
    context.ref,
  );
}

interface GitHubTarget {
  href: string;
  target: string;
  repoPath: string;
  /** Decoded; empty when the href has none. */
  fragment: string;
  /** As written, `#` included; empty when the href has no `#`. */
  hash: string;
}

function resolveGitHubLink(
  link: GitHubTarget,
  ref: GitHubRef,
): Result<string, LinkProblem> {
  if (!existsSync(link.target)) {
    return {
      ok: false,
      error: { kind: LinkProblemKinds.MISSING_FILE, href: link.href },
    };
  }

  const targetsMarkdownHeading =
    link.fragment !== "" && link.target.endsWith(MARKDOWN_EXTENSION);
  if (targetsMarkdownHeading) {
    const markdown = readFileSync(link.target, "utf8");
    if (!readHeadingSlugs(markdown).has(link.fragment)) {
      return {
        ok: false,
        error: { kind: LinkProblemKinds.MISSING_ANCHOR, href: link.href },
      };
    }
  }

  const view = statSync(link.target).isDirectory() ? "tree" : "blob";
  return {
    ok: true,
    value: `${PUBLIC_REPO_URL}/${view}/${ref}/${link.repoPath}${link.hash}`,
  };
}

/**
 * markdown-it core rule applying `resolveLink` to every link in a page. It runs before VitePress's
 * renderer-level link plugin, and throws to fail the build with every bad link on the page.
 */
export function createLinkRule(context: LinkContext): CoreRule {
  return (state: CoreState) => {
    const source = readSourcePath(state.env);
    if (source === undefined) {
      return;
    }

    const problems: LinkProblem[] = [];
    for (const token of state.tokens.flatMap((block) => block.children ?? [])) {
      const href =
        token.type === "link_open" ? token.attrGet("href") : undefined;
      if (typeof href !== "string") {
        continue;
      }

      const resolved = resolveLink(href, source, context);
      if (resolved.ok) {
        token.attrSet("href", resolved.value);
      } else {
        problems.push(resolved.error);
      }
    }

    if (problems.length > 0) {
      const page = path.relative(context.srcDir, source);
      throw new Error(formatProblems(page, problems));
    }
  };
}

/** The page's source file: `realPath` on the page pass (before rewrites), `path` on the search pass. */
function readSourcePath(env: unknown): string | undefined {
  if (typeof env !== "object" || env === null) {
    return undefined;
  }

  const realPath: unknown = Reflect.get(env, "realPath");
  const pagePath: unknown = Reflect.get(env, "path");
  if (typeof realPath === "string") {
    return realPath;
  }

  return typeof pagePath === "string" ? pagePath : undefined;
}

function formatProblems(
  page: string,
  problems: readonly LinkProblem[],
): string {
  const lines = problems.map(
    (problem) => `  ${problem.href} (${problem.kind})`,
  );
  return [`${toPosixPath(page)}: links with no target`, ...lines].join("\n");
}
