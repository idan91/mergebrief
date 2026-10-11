import type { PrStackMember } from "../../../../../model/types";
import styles from "./MemberRow.module.scss";

export interface MemberRowProps {
  member: PrStackMember;
}

export function MemberRow({ member }: MemberRowProps) {
  const number = `#${String(member.number)}`;
  return (
    <>
      <span className={styles["number"]}>{number}</span>
      <span className={styles["title"]} title={member.title}>
        {member.title}
      </span>
    </>
  );
}
