export function Screen() {
  const renderRow = (label: string) => <li>{label}</li>;

  function renderFooter() {
    return <footer />;
  }

  return (
    <ul>
      {renderRow("a")}
      {renderFooter()}
    </ul>
  );
}
