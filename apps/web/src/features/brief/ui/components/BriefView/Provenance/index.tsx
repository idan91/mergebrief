import type { Brief } from "../../../../model/types";
import type { RepoConfigContext } from "../../../../model/utils/repo-config";
import type { BriefViewModel } from "../../../../model/utils/view-model";
import { computeConcernShares } from "../Masthead/utils";
import { BriefDetailsPanel } from "./BriefDetailsPanel";
import { ProviderBadge } from "./ProviderBadge";
import { RepoConfigChip } from "./RepoConfigChip";
import { TOOL_ACCESS_PROVIDERS } from "./consts";
import { ToolAccessNote } from "./ToolAccessNote";
import styles from "./Provenance.module.scss";

export interface ProvenanceProps {
  brief: Brief;
  model: BriefViewModel;
  /** Absent or null renders as if no repo config exists. */
  repoConfig?: RepoConfigContext | null | undefined;
  /** False where the caller's own Split rows sit beside it. */
  listsSplit?: boolean;
}

/** How the brief was generated: the provider badge, the details panel and any repo-config trouble. */
export function Provenance({
  brief,
  model,
  repoConfig,
  listsSplit = true,
}: ProvenanceProps) {
  const provider = brief.generation?.provider;
  const hasToolAccess =
    provider !== undefined && TOOL_ACCESS_PROVIDERS.has(provider);
  const shares = listsSplit
    ? computeConcernShares(brief.concernView, model.unattributed)
    : undefined;

  return (
    <span className={styles["provenance"]}>
      <ProviderBadge generation={brief.generation} />
      <BriefDetailsPanel
        brief={brief}
        repoConfig={repoConfig}
        shares={shares}
        totalAdded={model.totalAdded}
        totalDeleted={model.totalDeleted}
        totalCoreAdded={model.totalCoreAdded}
        totalCoreDeleted={model.totalCoreDeleted}
      />
      {repoConfig ? <RepoConfigChip repoConfig={repoConfig} /> : null}
      {hasToolAccess ? <ToolAccessNote /> : null}
    </span>
  );
}
