// PROTOTYPE (BRIEF-381): the PR page's held card, three directions.
import { useId, useState } from "react";

import { Button, ButtonSizes, ButtonVariants } from "@web/components/Button";
import { Checkbox } from "@web/components/Checkbox";
import { EmptyBlock } from "@web/components/EmptyBlock";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { Menu } from "@web/components/Menu";

import { ConditionLine } from "../ConditionLine";
import {
  type HeldCase,
  composeSentence,
  describeCondition,
  describeOwner,
  isWait,
  sortConditions,
} from "../model";
import { useHeldPrototype } from "../state";
import styles from "./HeldCard.module.scss";

const MOCK_LATENCY_MS = 900;

function useMockGenerate() {
  const [phase, setPhase] = useState<"idle" | "pending" | "queued">("idle");
  function generate(): void {
    setPhase("pending");
    window.setTimeout(() => setPhase("queued"), MOCK_LATENCY_MS);
  }
  return { phase, generate };
}

export interface HeldCardProps {
  held: HeldCase;
}

export function HeldCard({ held }: HeldCardProps) {
  const { direction } = useHeldPrototype();
  if (direction === "b") {
    return <HeldPanel held={held} />;
  }
  if (direction === "c") {
    return <HeldSentence held={held} />;
  }
  return <HeldBlock held={held} />;
}

function Sha({ sha }: { sha: string }) {
  return <code className={styles["sha"]}>{sha}</code>;
}

function Announce({ phase }: { phase: "idle" | "pending" | "queued" }) {
  return (
    <p aria-live="polite" className={styles["announce"]}>
      {phase === "queued" ? "Brief queued for this push." : ""}
    </p>
  );
}

/** A: today's not-ready card, a plain list, two buttons. */
function HeldBlock({ held }: HeldCardProps) {
  const { phase, generate } = useMockGenerate();
  const [everyPush, setEveryPush] = useState(false);
  const sorted = sortConditions(held.unmet);
  const allWaits = held.unmet.every(isWait);
  const detail = allWaits
    ? "MergeBrief generates it by itself once every condition below is met."
    : "Some of these need a change before MergeBrief generates it by itself.";

  return (
    <section aria-labelledby="held-heading" className={styles["blockA"]}>
      <EmptyBlock
        action={
          <span className={styles["actions"]}>
            <Button
              loading={phase === "pending"}
              variant={ButtonVariants.PRIMARY}
              onClick={generate}
            >
              {phase === "queued" ? "Queued" : "Generate now"}
            </Button>
            <Button
              aria-pressed={everyPush}
              variant={ButtonVariants.SECONDARY}
              onClick={() => setEveryPush(!everyPush)}
            >
              {everyPush ? "Stop generating on every push" : "Generate on every push"}
            </Button>
          </span>
        }
        detail={detail}
        ghostMark
        heading={
          <h1 id="held-heading">
            No brief for <Sha sha={held.sha} /> yet
          </h1>
        }
        note={everyPush ? "Every push on this pull request generates a brief." : undefined}
      >
        <ul className={styles["listA"]}>
          {sorted.map((condition) => (
            <ConditionLine condition={condition} key={JSON.stringify(condition)} />
          ))}
        </ul>
      </EmptyBlock>
      <Announce phase={phase} />
    </section>
  );
}

/** B: two groups by what clears them, value and owner on each, a switch. */
function HeldPanel({ held }: HeldCardProps) {
  const { phase, generate } = useMockGenerate();
  const [everyPush, setEveryPush] = useState(false);
  const switchHint = useId();
  const plain = held.unmet;
  const waits = plain.filter(isWait);
  const needs = plain.filter((condition) => !isWait(condition));
  const lead =
    needs.length === 0
      ? "It generates by itself once these finish."
      : "It won't generate by itself until the changes below are made.";

  return (
    <section aria-labelledby="held-heading" className={styles["panel"]}>
      <header className={styles["panelHead"]}>
        <div className={styles["panelTitle"]}>
          <h1 id="held-heading">
            No brief for <Sha sha={held.sha} /> yet
          </h1>
          <p className={styles["lead"]}>{lead}</p>
        </div>
        <Button
          loading={phase === "pending"}
          variant={ButtonVariants.PRIMARY}
          onClick={generate}
        >
          {phase === "queued" ? "Queued" : "Generate now"}
        </Button>
      </header>
      {waits.length === 0 ? null : (
        <div className={styles["group"]}>
          <h2 className={styles["groupTitle"]}>
            <Icon name={IconNames.HOURGLASS_MEDIUM} size={IconSizes.MD} />
            Waiting on
          </h2>
          <ul className={styles["rows"]}>
            {waits.map((condition) => (
              <ConditionLine condition={condition} key={JSON.stringify(condition)} showIcon={false} />
            ))}
          </ul>
        </div>
      )}
      {needs.length === 0 ? null : (
        <div className={styles["group"]}>
          <h2 className={styles["groupTitle"]}>
            <Icon name={IconNames.HAND_PALM} size={IconSizes.MD} />
            Needs a change first
          </h2>
          <ul className={styles["rows"]}>
            {needs.map((condition) => (
              <ConditionLine condition={condition} key={JSON.stringify(condition)} showIcon={false} />
            ))}
          </ul>
        </div>
      )}
      <footer className={styles["panelFoot"]}>
        <Checkbox checked={everyPush} describedBy={switchHint} onChange={setEveryPush}>
          Generate on every push
        </Checkbox>
        <p className={styles["hint"]} id={switchHint}>
          Each new push on this pull request generates a brief, conditions or not. Turn it off any time.
        </p>
      </footer>
      <Announce phase={phase} />
    </section>
  );
}

/** C: one composed sentence leads; details behind a disclosure; split button. */
function HeldSentence({ held }: HeldCardProps) {
  const { phase, generate } = useMockGenerate();
  const [everyPush, setEveryPush] = useState(false);
  const { lead, blocked } = composeSentence(held.unmet);
  const blockers = held.unmet.filter((condition) => !isWait(condition));
  const sorted = sortConditions(held.unmet);

  return (
    <section aria-labelledby="held-heading" className={styles["sentence"]}>
      <h1 className={styles["sentenceLead"]} id="held-heading">
        {lead}
      </h1>
      <p className={styles["shaLine"]}>
        No brief for <Sha sha={held.sha} /> yet.
      </p>
      {blocked ? (
        <ul className={styles["because"]}>
          {blockers.map((condition) => (
            <BlockerSentence condition={condition} key={JSON.stringify(condition)} />
          ))}
        </ul>
      ) : null}
      <div className={styles["split"]}>
        <Button
          className={styles["splitMain"]}
          loading={phase === "pending"}
          variant={ButtonVariants.PRIMARY}
          onClick={generate}
        >
          {phase === "queued" ? "Queued" : "Generate now"}
        </Button>
        <Menu placement="bottom-end">
          <Menu.Trigger>
            <Button
              aria-label="More ways to generate"
              className={styles["splitCaret"]}
              size={ButtonSizes.MD}
              variant={ButtonVariants.PRIMARY}
            >
              <Icon name={IconNames.CARET_DOWN} size={IconSizes.MD} />
            </Button>
          </Menu.Trigger>
          <Menu.Content>
            <Menu.Item onSelect={generate}>Generate this push</Menu.Item>
            <Menu.Item onSelect={() => setEveryPush(!everyPush)}>
              {everyPush ? "Stop generating on every push" : "Generate on every push"}
            </Menu.Item>
          </Menu.Content>
        </Menu>
      </div>
      {everyPush ? (
        <p className={styles["everyPush"]}>
          <Icon name={IconNames.ARROWS_CLOCKWISE} size={IconSizes.SM} />
          Every push on this pull request generates a brief.
        </p>
      ) : null}
      <details className={styles["why"]}>
        <summary>Why this push is held</summary>
        <ul className={styles["whyList"]}>
          {sorted.map((condition) => (
            <ConditionLine condition={condition} key={JSON.stringify(condition)} />
          ))}
        </ul>
      </details>
      <Announce phase={phase} />
    </section>
  );
}

function BlockerSentence({ condition }: { condition: HeldCase["unmet"][number] }) {
  if (condition.kind === "any") {
    const options = condition.conditions
      .map((member) => describeCondition(member, 3)[0] ?? "")
      .join(", or ");
    return <li>Needs one of these to change: {options}.</li>;
  }
  const owner = `(${describeOwner(condition.source)}'s setting)`;
  return (
    <>
      {describeCondition(condition, 3).map((line) => (
        <li key={line}>
          {line} <span className={styles["ownerNote"]}>{owner}</span>
        </li>
      ))}
    </>
  );
}
