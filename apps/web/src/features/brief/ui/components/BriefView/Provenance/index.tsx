import type { Brief } from "../../../../model/types";
import type { RepoConfigContext } from "../../../../model/utils/repo-config";
import type { BriefViewModel } from "../../../../model/utils/view-model";
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
}

/** How the brief was generated: the provider badge, the details panel and any repo-config trouble. */
export function Provenance({ brief, model, repoConfig }: ProvenanceProps) {
  const provider = brief.generation?.provider;
  const hasToolAccess =
    provider !== undefined && TOOL_ACCESS_PROVIDERS.has(provider);

  return (
    <span className={styles["provenance"]}>
      <ProviderBadge generation={brief.generation} />
      <BriefDetailsPanel
        brief={brief}
        repoConfig={repoConfig}
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
