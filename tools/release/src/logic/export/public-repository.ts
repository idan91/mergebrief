import type { Mutable } from "types/utils";

import { REPOSITORY, REPOSITORY_URL } from "../../consts";
import type {
  ExportTokens,
  PublicRepository,
  PublicRepositoryAccess,
  RepositorySlug,
} from "./types";

function isRepositorySlug(value: string): value is RepositorySlug {
  return value.includes("/");
}

/** The repository the release goes to; `--public-remote` points a rehearsal at a scratch remote instead. */
function resolvePublicRepository(
  remote: string | undefined,
  authenticatesReads: boolean,
): PublicRepository {
  if (remote !== undefined) {
    const slug: RepositorySlug = isRepositorySlug(remote)
      ? remote
      : `./${remote}`;
    return { slug, url: remote, authenticatesReads };
  }
  return {
    slug: `${REPOSITORY.owner}/${REPOSITORY.name}`,
    url: `${REPOSITORY_URL}.git`,
    authenticatesReads,
  };
}

/**
 * The public repository and the token its reads carry, both from the one
 * value `--authenticated-reads` sets: a read never carries a token the
 * repository is not marked for, and the mark never goes without the token.
 */
export function resolvePublicRepositoryAccess(
  remote: string | undefined,
  tokens: ExportTokens,
): PublicRepositoryAccess {
  const readToken = tokens.publicRead;
  const repository = resolvePublicRepository(remote, readToken !== undefined);

  const access: Mutable<PublicRepositoryAccess> = { repository };
  if (readToken !== undefined) {
    access.readToken = readToken;
  }
  return access;
}
