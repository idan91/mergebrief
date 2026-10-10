import { memo } from "react";

import { GroupViewKinds } from "../../../../../model/utils/remainder";
import { AttributedGroupCard } from "./AttributedGroupCard";
import { RemainderGroupCard } from "./RemainderGroupCard";
import type { GroupCardProps } from "./types";

export type { GroupCardProps } from "./types";

export const GroupCard = memo(function GroupCard(props: GroupCardProps) {
  if (props.group.kind === GroupViewKinds.UNATTRIBUTED_REMAINDER) {
    return <RemainderGroupCard {...props} group={props.group} />;
  }
  return <AttributedGroupCard {...props} group={props.group} />;
});
