import GithubSlugger, { slug } from "github-slugger";

import { readHeadings } from "../headings";

/** GitHub's heading id, so an `#anchor` written for the repo resolves on the site. */
export function slugifyHeading(heading: string): string {
  return slug(heading);
}

/** Every heading id GitHub renders for a markdown file, repeats numbered `-1`, `-2`. */
export function readHeadingSlugs(markdown: string): Set<string> {
  const slugger = new GithubSlugger();
  const slugs = new Set<string>();

  for (const heading of readHeadings(markdown)) {
    slugs.add(slugger.slug(heading.text));
  }

  return slugs;
}
