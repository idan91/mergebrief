import { AccessibleLink } from "@web/components/AccessibleLink";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { buildGithubPullUrl } from "@web/utils/github-pull-url";
import type { Brief } from "../../../../model/types";
import styles from "./PrRef.module.scss";

export interface PrRefProps {
  pr: Brief["pr"];
}

/** The repository and the PR number, linked to the pull request on GitHub once the repository is known. */
export function PrRef({ pr }: PrRefProps) {
  const prLink = buildGithubPullUrl(pr.repo, pr.number);

  return (
    <span className={styles["ref"]}>
      <b>{pr.repo}</b>{" "}
      {prLink ? (
        <AccessibleLink
          className={styles["link"]}
          href={prLink}
          target="_blank"
        >
          #{pr.number}
          <Icon name={IconNames.GITHUB_LOGO} size={IconSizes.SM} />
        </AccessibleLink>
      ) : (
        <span>#{pr.number}</span>
      )}
    </span>
  );
}
