interface RowProps {
  readonly label: string;
}

function Row({ label }: RowProps) {
  return <li>{label}</li>;
}

// A helper that is not render-prefixed and returns no JSX: the rule targets
// the name, so this is the shape a `renderRow` should become.
function toTitle(label: string): string {
  return label.toUpperCase();
}

export function Screen() {
  return (
    <ul>
      <Row label={toTitle("a")} />
      <Row label={toTitle("b")} />
    </ul>
  );
}
