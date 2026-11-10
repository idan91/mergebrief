import { describe, expect, it } from "vitest";
import { resolvePublicRepositoryAccess } from "../../src/logic/export/public-repository";

const TOKEN = "ghs_sekrit";
const RELEASE_REPOSITORY = {
  slug: "Idan91/mergebrief",
  url: "https://github.com/Idan91/mergebrief.git",
};

describe("how a run reaches the public repository", () => {
  it("reads the release repository anonymously without a read token", () => {
    const access = resolvePublicRepositoryAccess(undefined, {});

    expect(access).toEqual({
      repository: { ...RELEASE_REPOSITORY, authenticatesReads: false },
    });
  });

  it("keeps a publish-only token away from the reads", () => {
    const access = resolvePublicRepositoryAccess(undefined, { publish: TOKEN });

    expect(access).toEqual({
      repository: { ...RELEASE_REPOSITORY, authenticatesReads: false },
    });
  });

  it("marks the repository and hands on the token together", () => {
    const tokens = { publish: TOKEN, publicRead: TOKEN };

    const access = resolvePublicRepositoryAccess(undefined, tokens);

    expect(access).toEqual({
      repository: { ...RELEASE_REPOSITORY, authenticatesReads: true },
      readToken: TOKEN,
    });
  });

  it("names a scratch remote by its path", () => {
    const bare = resolvePublicRepositoryAccess("public.git", {});
    const nested = resolvePublicRepositoryAccess("/tmp/lab/public.git", {});

    expect(bare.repository).toMatchObject({
      slug: "./public.git",
      url: "public.git",
    });
    expect(nested.repository).toMatchObject({
      slug: "/tmp/lab/public.git",
      url: "/tmp/lab/public.git",
    });
  });
});
