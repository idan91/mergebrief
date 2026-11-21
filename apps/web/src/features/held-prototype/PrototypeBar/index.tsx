// PROTOTYPE (BRIEF-381): floating switcher. Direction, case, PR-page view.
import { HELD_CASES } from "../model";
import { type Direction, setHeldPrototype, useHeldPrototype } from "../state";
import styles from "./PrototypeBar.module.scss";

const DIRECTIONS: { id: Direction; label: string }[] = [
  { id: "a", label: "Status line" },
  { id: "b", label: "Waits vs blockers" },
  { id: "c", label: "One sentence" },
];

export function PrototypeBar() {
  const state = useHeldPrototype();
  if (!state.active) {
    return null;
  }
  return (
    <div aria-label="Prototype controls" className={styles["bar"]} role="toolbar">
      <div className={styles["segments"]} role="group" aria-label="Direction">
        {DIRECTIONS.map((direction) => (
          <button
            aria-pressed={state.direction === direction.id}
            className={styles["segment"]}
            key={direction.id}
            type="button"
            onClick={() => setHeldPrototype({ direction: direction.id })}
          >
            {direction.id.toUpperCase()}
            <span className={styles["long"]}> {direction.label}</span>
          </button>
        ))}
      </div>
      <label className={styles["field"]}>
        <span>PR page case</span>
        <select
          value={state.caseId}
          onChange={(event) => setHeldPrototype({ caseId: event.target.value })}
        >
          {HELD_CASES.map((held) => (
            <option key={held.id} value={held.id}>
              {held.label}
            </option>
          ))}
        </select>
      </label>
      <button
        aria-pressed={state.view === "entry"}
        className={styles["segment"]}
        type="button"
        onClick={() => setHeldPrototype({ view: state.view === "entry" ? "card" : "entry" })}
      >
        Entry comment
      </button>
    </div>
  );
}
