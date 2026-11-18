export interface PrLocator {
  owner: string;
  repo: string;
  number: number;
}

/**
 * GitHub owner/repo segment grammar: alphanumerics, hyphen, underscore, dot.
 * A value is checked against it before it reaches a `gh` argument list, so
 * untrusted URL input never becomes an argument.
 */
const SEGMENT = /^[A-Za-z0-9._-]+$/;

/** `.` and `..` pass the segment grammar but would walk a GitHub API path. */
export function isPathSegment(value: string): boolean {
  const isSegment = SEGMENT.test(value) && value !== "." && value !== "..";
  return isSegment;
}

const PR_URL = new RegExp(
  String.raw`^https?://github\.com/([^/]+)/([^/]+)/pull/(\d+)(?:[/?#].*)?$`,
);

export function parsePrUrl(url: string): PrLocator {
  const match = PR_URL.exec(url.trim());
  if (!match) {
    throw new Error(
      `Not a GitHub PR URL: ${url}\nExpected https://github.com/<owner>/<repo>/pull/<number>`,
    );
  }
  const [, owner, repo, num] = match;
  if (!owner || !repo || !num) {
    throw new Error(`Malformed owner/repo in PR URL: ${url}`);
  }
  const segmentsValid = isPathSegment(owner) && isPathSegment(repo);
  if (!segmentsValid) {
    throw new Error(`Malformed owner/repo in PR URL: ${url}`);
  }
  return { owner, repo, number: Number(num) };
}
