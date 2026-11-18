/** Elements a page shows a reader nothing of. `<header>` is not `<head>`. */
const UNSHOWN_ELEMENTS = ["head", "script", "style", "template", "noscript"];
/** A comment first: a tag named inside one opens nothing. */
const UNSHOWN_OPENER = new RegExp(
  `<!--|<(${UNSHOWN_ELEMENTS.join("|")})(?=[\\s/>])`,
  "gi",
);
const COMMENT_CLOSE = "-->";
const HEAD_CLOSE = /<\/head(?=[\s/>])/gi;
const BODY_OPENER = /<body(?=[\s/>])/gi;
const NOT_FOUND = -1;

type ForwardFinder = (from: number) => number;

/**
 * A search asked at rising positions. A hit still ahead is the answer again,
 * and a miss holds for every later position, so a page of openers that
 * never close costs one scan, not one each.
 */
function createForwardFinder(search: ForwardFinder): ForwardFinder {
  let hit = NOT_FOUND;
  let missedFrom = Number.POSITIVE_INFINITY;
  return (from) => {
    if (from >= missedFrom) {
      return NOT_FOUND;
    }
    if (hit < from) {
      hit = search(from);
      missedFrom = hit === NOT_FOUND ? from : missedFrom;
    }
    return hit;
  };
}

function createPatternFinder(pattern: RegExp, page: string): ForwardFinder {
  return createForwardFinder((from) => {
    pattern.lastIndex = from;
    return pattern.exec(page)?.index ?? NOT_FOUND;
  });
}

/** Past the next `>`, or the end of the page when the tag never ends. */
function findTagEnd(page: string, from: number): number {
  const close = page.indexOf(">", from);
  return close === NOT_FOUND ? page.length : close + 1;
}

/**
 * HTML lets a head go unclosed: it then ends where the body starts. With
 * neither in sight only its own tag goes, and the scripts and styles inside
 * are still dropped one by one.
 */
function createHeadEndFinder(page: string): ForwardFinder {
  const findClose = createPatternFinder(HEAD_CLOSE, page);
  const findBody = createPatternFinder(BODY_OPENER, page);
  return (from) => {
    const close = findClose(from);
    const body = findBody(from);
    const closesFirst =
      close !== NOT_FOUND && (body === NOT_FOUND || close < body);
    if (closesFirst) {
      return findTagEnd(page, close);
    }
    return body === NOT_FOUND ? findTagEnd(page, from) : body;
  };
}

/** Past the first closing tag of `element`; one that never closes takes the rest of the page. */
function findElementEnd(page: string, element: string, from: number): number {
  const closing = new RegExp(`</${element}(?=[\\s/>])[^>]*>?`, "gi");
  closing.lastIndex = from;
  return closing.exec(page) === null ? page.length : closing.lastIndex;
}

function findCommentEnd(page: string, from: number): number {
  const close = page.indexOf(COMMENT_CLOSE, from);
  return close === NOT_FOUND ? page.length : close + COMMENT_CLOSE.length;
}

/**
 * An HTML page without its comments, head, scripts, styles, templates and
 * noscript blocks, each a space so the words around it never join. They hold
 * no prose a reader sees, they can hold the page's inline state, and they
 * fill the snippet cap before the text starts. The first closing tag ends an
 * element, as it does for a browser's script and style.
 */
export function removeUnshownElements(page: string): string {
  const findHeadEnd = createHeadEndFinder(page);
  const kept: string[] = [];
  let cursor = 0;
  UNSHOWN_OPENER.lastIndex = 0;

  for (
    let opener = UNSHOWN_OPENER.exec(page);
    opener !== null;
    opener = UNSHOWN_OPENER.exec(page)
  ) {
    const from = UNSHOWN_OPENER.lastIndex;
    const element = opener[1]?.toLowerCase();
    kept.push(page.slice(cursor, opener.index), " ");

    if (element === undefined) {
      cursor = findCommentEnd(page, from);
    } else if (element === "head") {
      cursor = findHeadEnd(from);
    } else {
      cursor = findElementEnd(page, element, from);
    }
    UNSHOWN_OPENER.lastIndex = cursor;
  }

  kept.push(page.slice(cursor));
  return kept.join("");
}
