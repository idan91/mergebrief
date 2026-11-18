import { useTranslation } from "react-i18next";

import { Button, ButtonSizes, ButtonVariants } from "@web/components/Button";
import { Markdown } from "@web/components/Markdown";
import { formatDate, renderedLocale } from "@web/i18n/locale";
import rowStyles from "../../../../rows.module.scss";
import type { ConversationThread } from "../../../../types";
import { CommentBody } from "../CommentBody";
import styles from "./ThreadComment.module.scss";

export interface ThreadCommentProps {
  comment: ConversationThread["comments"][number];
  filePath: string | undefined;
  /** The comment postdates the brief being read. */
  afterBrief: boolean;
  /** Absent where writes are off: there is no reply box to quote into. */
  quote?: (() => void) | undefined;
}

/** One comment of a thread as a card: a header band over its body. */
export function ThreadComment({
  comment,
  filePath,
  afterBrief,
  quote,
}: ThreadCommentProps) {
  const { i18n, t } = useTranslation();
  const locale = renderedLocale(i18n.resolvedLanguage);
  const createdAt = formatDate(comment.createdAt, locale);

  return (
    <article
      aria-label={t("conversation.ariaLabelComment", {
        login: comment.author.login,
      })}
      className={styles["comment"]}
    >
      <header className={styles["head"]}>
        {comment.author.avatarUrl === undefined ? null : (
          // Decorative. The adjacent login carries the identity.
          <img
            alt=""
            className={styles["avatar"]}
            decoding="async"
            loading="lazy"
            src={comment.author.avatarUrl}
          />
        )}
        <span className={rowStyles["author"]}>
          @{comment.author.login}
          {comment.author.isBot ? (
            <span className={rowStyles["botTag"]}>
              {t("conversation.botTag")}
            </span>
          ) : null}
        </span>
        <time dateTime={comment.createdAt}>{createdAt}</time>
        {afterBrief ? (
          <span className={rowStyles["chip"]} data-state="after-brief">
            {t("conversation.afterThisBrief")}
          </span>
        ) : null}
        {quote === undefined ? null : (
          <Button
            aria-label={t("conversation.ariaLabelQuoteReply", {
              login: comment.author.login,
            })}
            className={styles["quoteAction"]}
            size={ButtonSizes.SM}
            variant={ButtonVariants.QUIET}
            onClick={quote}
          >
            {t("conversation.quoteReply")}
          </Button>
        )}
      </header>
      <CommentBody>
        <Markdown
          content={comment.body}
          filePath={filePath}
          renderHtml
          renderMentions
          renderSuggestions
        />
      </CommentBody>
    </article>
  );
}
