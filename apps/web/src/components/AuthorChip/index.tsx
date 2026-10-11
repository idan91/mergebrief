import { useState } from "react";

import { AccessibleLink } from "../AccessibleLink";
import { buildAuthorLinks } from "./utils";
import styles from "./AuthorChip.module.scss";

export interface AuthorChipProps {
  /** The author's GitHub login, as GitHub sent it. */
  login: string;
}

/**
 * A pull request author: avatar and login, linked to their GitHub profile.
 * The avatar is decorative; the login names the link.
 */
export function AuthorChip({ login }: AuthorChipProps) {
  const [failedLogin, setFailedLogin] = useState<string>();
  const links = buildAuthorLinks(login);
  if (links === undefined) {
    return <span className={styles["chip"]}>{login}</span>;
  }

  const showImage = links.avatarUrl !== undefined && failedLogin !== login;
  const initial = login.charAt(0).toUpperCase();

  return (
    <AccessibleLink
      className={styles["chip"]}
      data-testid="author-chip"
      href={links.profileUrl}
      target="_blank"
    >
      {showImage ? (
        <img
          alt=""
          className={styles["avatar"]}
          decoding="async"
          src={links.avatarUrl}
          onError={() => {
            setFailedLogin(login);
          }}
        />
      ) : (
        <span aria-hidden="true" className={styles["avatar"]}>
          {initial}
        </span>
      )}
      {login}
    </AccessibleLink>
  );
}
