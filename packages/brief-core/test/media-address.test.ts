import { describe, expect, it } from "vitest";
import {
  buildCommittedFileUrl,
  CommittedFileParseErrorCodes,
  isCommittedFileInRepository,
  isServableCommittedFile,
  normalizeMediaAddress,
  parseCommittedFileUrl,
  readCommittedMediaExtension,
  readQualifiedRef,
} from "../src/media-address";

const BLOB = "https://github.com/acme/app/blob/main/docs/shot.png?raw=true";
const RAW = "https://github.com/acme/app/raw/main/docs/shot.png";
const RAW_HOST =
  "https://raw.githubusercontent.com/acme/app/main/docs/shot.png";
const NORMALISED = "https://github.com/acme/app/raw/main/docs/shot.png";

const NOT_COMMITTED = {
  ok: false,
  error: CommittedFileParseErrorCodes.NOT_A_COMMITTED_FILE,
};
const UNSAFE = { ok: false, error: CommittedFileParseErrorCodes.UNSAFE_PATH };

describe("parseCommittedFileUrl", () => {
  it("reads a blob address with the raw query into its parts", () => {
    expect(parseCommittedFileUrl(BLOB)).toEqual({
      ok: true,
      value: {
        owner: "acme",
        repo: "app",
        pathSegments: ["main", "docs", "shot.png"],
      },
    });
  });

  it("reads the raw and raw host forms into the same parts", () => {
    const blob = parseCommittedFileUrl(BLOB);

    expect(parseCommittedFileUrl(RAW)).toEqual(blob);
    expect(parseCommittedFileUrl(RAW_HOST)).toEqual(blob);
  });

  it("keeps a ref with a slash as plain segments for the api to split", () => {
    const parsed = parseCommittedFileUrl(
      "https://github.com/acme/app/blob/assets/brief-362/after.png?raw=true",
    );

    expect(parsed).toEqual({
      ok: true,
      value: {
        owner: "acme",
        repo: "app",
        pathSegments: ["assets", "brief-362", "after.png"],
      },
    });
  });

  it("decodes each segment once", () => {
    const parsed = parseCommittedFileUrl(
      "https://github.com/acme/app/raw/main/my%20shot%281%29.png",
    );

    expect(parsed.ok && parsed.value.pathSegments).toEqual([
      "main",
      "my shot(1).png",
    ]);
  });

  it("refuses a blob address without exactly the raw query", () => {
    const pageUrl = "https://github.com/acme/app/blob/main/shot.png";

    expect(parseCommittedFileUrl(pageUrl)).toEqual(NOT_COMMITTED);
    expect(parseCommittedFileUrl(`${BLOB}&x=1`)).toEqual(NOT_COMMITTED);
    expect(parseCommittedFileUrl(`${pageUrl}?raw=1`)).toEqual(NOT_COMMITTED);
  });

  it("refuses a query on the raw forms and a hash on any form", () => {
    expect(parseCommittedFileUrl(`${RAW}?token=abc`)).toEqual(NOT_COMMITTED);
    expect(parseCommittedFileUrl(`${RAW_HOST}?token=abc`)).toEqual(
      NOT_COMMITTED,
    );
    expect(parseCommittedFileUrl(`${RAW}#top`)).toEqual(NOT_COMMITTED);
    expect(parseCommittedFileUrl(`${BLOB}#top`)).toEqual(NOT_COMMITTED);
  });

  it("refuses http, a port, credentials and another host", () => {
    for (const url of [
      RAW.replace("https:", "http:"),
      RAW.replace("github.com", "github.com:8443"),
      RAW.replace("github.com", "user:pass@github.com"),
      RAW.replace("github.com", "gist.github.com"),
      RAW.replace("github.com", "github.com.evil.example"),
      "https://example.com/acme/app/raw/main/shot.png",
    ]) {
      expect(parseCommittedFileUrl(url)).toEqual(NOT_COMMITTED);
    }
  });

  it("refuses an address naming only a ref, or no file at all", () => {
    expect(
      parseCommittedFileUrl("https://github.com/acme/app/raw/main"),
    ).toEqual(NOT_COMMITTED);
    expect(
      parseCommittedFileUrl("https://github.com/acme/app/tree/main/a.png"),
    ).toEqual(NOT_COMMITTED);
    expect(parseCommittedFileUrl("not a url")).toEqual(NOT_COMMITTED);
  });

  it("refuses an encoded slash or backslash inside a segment", () => {
    for (const segment of [
      "a%2Fb.png",
      "a%2fb.png",
      "a%5Cb.png",
      "a%5cb.png",
    ]) {
      expect(
        parseCommittedFileUrl(
          `https://github.com/acme/app/raw/main/${segment}`,
        ),
      ).toEqual(UNSAFE);
    }
  });

  it("refuses a double-encoded escape", () => {
    for (const segment of ["%252E%252E", "a%252Fb.png", "%25.png"]) {
      expect(
        parseCommittedFileUrl(
          `https://github.com/acme/app/raw/main/${segment}`,
        ),
      ).toEqual(UNSAFE);
    }
  });

  it("refuses control, hidden and bidi characters", () => {
    for (const segment of ["a%00.png", "a%0A.png", "a%7F.png", "a%C2%85.png"]) {
      expect(
        parseCommittedFileUrl(
          `https://github.com/acme/app/raw/main/${segment}`,
        ),
      ).toEqual(UNSAFE);
    }
    for (const char of ["​", "‮", "⁦", "﻿"]) {
      const segment = encodeURIComponent(`a${char}.png`);
      expect(
        parseCommittedFileUrl(
          `https://github.com/acme/app/raw/main/${segment}`,
        ),
      ).toEqual(UNSAFE);
    }
  });

  it("refuses a malformed escape", () => {
    expect(
      parseCommittedFileUrl("https://github.com/acme/app/raw/main/a%E0%A4.png"),
    ).toEqual(UNSAFE);
  });

  it("never names a file outside the repository through dot segments", () => {
    const escaped = parseCommittedFileUrl(
      "https://github.com/acme/app/raw/main/%2e%2e/%2e%2e/%2e%2e/evil/x/raw/main/a.png",
    );

    expect(escaped.ok && escaped.value.owner).not.toBe("acme");
  });

  it("refuses an empty segment", () => {
    expect(
      parseCommittedFileUrl("https://github.com/acme/app/raw/main//a.png"),
    ).toEqual(UNSAFE);
  });

  it("refuses an address past the length bound", () => {
    const long = "a".repeat(2048);

    expect(
      parseCommittedFileUrl(`https://github.com/acme/app/raw/main/${long}.png`),
    ).toEqual(UNSAFE);
  });
});

describe("buildCommittedFileUrl", () => {
  it("writes the raw form with owner and repo lower-cased", () => {
    const url = buildCommittedFileUrl({
      owner: "Acme",
      repo: "App",
      pathSegments: ["Main", "my shot.png"],
    });

    expect(url).toBe("https://github.com/acme/app/raw/Main/my%20shot.png");
  });

  it("writes an address the parser reads back to the same parts", () => {
    const source = {
      owner: "acme",
      repo: "app",
      pathSegments: ["feature", "x", "a #1?.png"],
    };

    expect(parseCommittedFileUrl(buildCommittedFileUrl(source))).toEqual({
      ok: true,
      value: source,
    });
  });
});

describe("normalizeMediaAddress", () => {
  it("brings all three committed forms to one address", () => {
    expect(normalizeMediaAddress(BLOB)).toBe(NORMALISED);
    expect(normalizeMediaAddress(RAW)).toBe(NORMALISED);
    expect(normalizeMediaAddress(RAW_HOST)).toBe(NORMALISED);
    expect(normalizeMediaAddress(RAW.replace("acme/app", "ACME/App"))).toBe(
      NORMALISED,
    );
  });

  it("gives a fully qualified ref the key of its bare spelling", () => {
    const heads =
      "https://raw.githubusercontent.com/acme/app/refs/heads/main/docs/shot.png";
    const tags = "https://github.com/acme/app/raw/refs/tags/main/docs/shot.png";

    expect(normalizeMediaAddress(heads)).toBe(NORMALISED);
    expect(normalizeMediaAddress(tags)).toBe(NORMALISED);
  });

  it("leaves any other address as written", () => {
    const outside = "https://example.com/a.png";

    expect(normalizeMediaAddress(outside)).toBe(outside);
    expect(
      normalizeMediaAddress("https://github.com/acme/app/raw/main//a.png"),
    ).toBe("https://github.com/acme/app/raw/main//a.png");
  });
});

describe("readQualifiedRef", () => {
  it("reads the namespace and the segments after it", () => {
    expect(
      readQualifiedRef(["refs", "heads", "feature", "x", "a.png"]),
    ).toEqual({
      namespace: "heads",
      unqualifiedSegments: ["feature", "x", "a.png"],
    });
    expect(readQualifiedRef(["refs", "tags", "v1", "a.png"])).toEqual({
      namespace: "tags",
      unqualifiedSegments: ["v1", "a.png"],
    });
  });

  it("reads no qualifier on a bare ref or an unknown namespace", () => {
    expect(readQualifiedRef(["main", "a.png"])).toBeUndefined();
    expect(readQualifiedRef(["refs", "pull", "1", "a.png"])).toBeUndefined();
  });

  it("reads no qualifier that would leave no file after the ref", () => {
    expect(readQualifiedRef(["refs", "heads", "a.png"])).toBeUndefined();
  });
});

describe("isCommittedFileInRepository", () => {
  const source = {
    owner: "Acme",
    repo: "App",
    pathSegments: ["main", "a.png"],
  };

  it("matches the repository without regard to case", () => {
    expect(isCommittedFileInRepository(source, "acme/app")).toBe(true);
    expect(isCommittedFileInRepository(source, "ACME/APP")).toBe(true);
  });

  it("refuses another repository or a malformed slug", () => {
    expect(isCommittedFileInRepository(source, "acme/other")).toBe(false);
    expect(isCommittedFileInRepository(source, "other/app")).toBe(false);
    expect(isCommittedFileInRepository(source, "acme/app/extra")).toBe(false);
    expect(isCommittedFileInRepository(source, "acme")).toBe(false);
  });
});

describe("readCommittedMediaExtension", () => {
  it("reads a served extension without regard to case", () => {
    expect(readCommittedMediaExtension(["main", "a.PNG"])).toBe("png");
    expect(readCommittedMediaExtension(["main", "docs", "b.svg"])).toBe("svg");
  });

  it("reads nothing for another format or a file with no extension", () => {
    expect(readCommittedMediaExtension(["main", "hero.avif"])).toBeUndefined();
    expect(readCommittedMediaExtension(["main", "hero"])).toBeUndefined();
    expect(readCommittedMediaExtension(["main", "png"])).toBeUndefined();
  });
});

describe("isServableCommittedFile", () => {
  it("serves a file whose extension the proxy allows", () => {
    const source = {
      owner: "acme",
      repo: "app",
      pathSegments: ["main", "a.gif"],
    };

    expect(isServableCommittedFile(source)).toBe(true);
  });

  it("refuses a file in any other format", () => {
    const source = {
      owner: "acme",
      repo: "app",
      pathSegments: ["main", "a.bmp"],
    };

    expect(isServableCommittedFile(source)).toBe(false);
  });
});
