import { useTranslation } from "react-i18next";

import {
  Specificities,
  type Specificity,
  type IntentCheck,
  type PrimaryTicket,
} from "brief-core/types";
import { AccessibleLink } from "@web/components/AccessibleLink";
import { Badge } from "@web/components/Badge";
import { InlineCodeText } from "../../InlineCodeText";
import { isHttpUrl } from "../utils";
import styles from "./TicketAlignment.module.scss";
import { deriveTicketFacts, deriveTicketLinkText } from "./utils";

export interface TicketAlignmentProps {
  primaryTicket: PrimaryTicket;
  alignment: IntentCheck["alignment"];
  specificity: Specificity;
}

export interface AlignmentRowsProps {
  alignment: IntentCheck["alignment"];
  specificity: Specificity;
}

/** Why there is no read: a broad source, or a precise one whose ticket states no quotable goal. */
const NO_READ_KEY = {
  [Specificities.BROAD]: "brief.intent.noRead",
  [Specificities.NONE]: "brief.intent.noReadPrecise",
  [Specificities.PRECISE]: "brief.intent.noReadPrecise",
} as const satisfies Record<Specificity, string>;

/** The labelled pair, side by side; a missing read keeps "This PR" as the no-read line. */
function AlignmentRows({ alignment, specificity }: AlignmentRowsProps) {
  const { t } = useTranslation();
  return (
    <dl className={styles["rows"]}>
      {alignment ? (
        <div className={styles["row"]}>
          <dt>{t("brief.intent.ticketAsks")}</dt>
          <dd>
            <q className={styles["goal"]}>
              <InlineCodeText text={alignment.goal} />
            </q>
          </dd>
        </div>
      ) : null}
      <div className={styles["row"]}>
        <dt>{t("brief.intent.thisPr")}</dt>
        {alignment ? (
          <dd>
            <span
              className={styles["readWord"]}
              data-testid="ticket-alignment-read"
            >
              {t(`brief.intent.read.${alignment.read}`)}
            </span>
            <span className={styles["response"]}>
              <InlineCodeText text={alignment.response} />
            </span>
          </dd>
        ) : (
          <dd
            className={styles["noRead"]}
            data-testid="ticket-alignment-no-read"
          >
            {t(NO_READ_KEY[specificity])}
          </dd>
        )}
      </div>
    </dl>
  );
}

export interface UnreadNoticeProps {
  primaryTicket: PrimaryTicket;
}

/** A fetch failure is a deployment fact, not a model read, so amber is allowed here. */
function UnreadNotice({ primaryTicket }: UnreadNoticeProps) {
  const { t } = useTranslation();
  const { reason, tracker } = primaryTicket;
  const reasonSentence =
    reason === ""
      ? null
      : t(`brief.intent.reason.${reason}`, {
          tracker: t(`brief.intent.tracker.${tracker}`),
        });

  return (
    <p
      className={styles["notice"]}
      data-testid="ticket-alignment-notice"
      role="status"
    >
      <b>
        {t("brief.intent.ticketUnread", {
          key: deriveTicketLinkText(primaryTicket),
        })}
      </b>{" "}
      {reasonSentence === null ? null : `${reasonSentence}. `}
      {t("brief.intent.noAlignmentRead")}
    </p>
  );
}

/**
 * The Ticket alignment subsection of the Intent bar: the primary ticket as
 * fetched and the read against it, as one card. The read is a word, no
 * glyph, no colour, and never a gate.
 */
export function TicketAlignment({
  primaryTicket,
  alignment,
  specificity,
}: TicketAlignmentProps) {
  const { t } = useTranslation();
  const { key, url, tracker, foundIn, title, status } = primaryTicket;
  const linkText = deriveTicketLinkText(primaryTicket);
  const facts = deriveTicketFacts(primaryTicket);
  const unread = status === "unread";
  const showTitle = key !== "" && title !== "";

  return (
    <section className={styles["alignment"]} data-testid="ticket-alignment">
      <h3 className={styles["heading"]}>{t("brief.intent.alignmentTitle")}</h3>
      <div className={styles["card"]}>
        <p className={styles["ticket"]}>
          <Badge className={styles["tracker"]}>
            {t(`brief.intent.tracker.${tracker}`)}
          </Badge>
          {isHttpUrl(url) ? (
            <AccessibleLink
              className={styles["key"]}
              href={url}
              target="_blank"
            >
              {linkText}
            </AccessibleLink>
          ) : (
            <span className={styles["key"]}>{linkText}</span>
          )}
          {showTitle ? (
            <span className={styles["ticketTitle"]}>
              <InlineCodeText text={title} />
            </span>
          ) : null}
        </p>
        {unread ? (
          <UnreadNotice primaryTicket={primaryTicket} />
        ) : (
          <AlignmentRows alignment={alignment} specificity={specificity} />
        )}
        <p className={styles["foot"]}>
          {facts !== "" ? (
            <span className={styles["facts"]}>{facts}</span>
          ) : null}
          <span className={styles["foundIn"]}>
            {t(`brief.intent.foundIn.${foundIn}`)}
          </span>
        </p>
      </div>
    </section>
  );
}
