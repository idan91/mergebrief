import { AccessibleLink } from "./AccessibleLink";

export function Good() {
  return (
    <div>
      <a href="/internal" target="_self">
        x
      </a>
      <AccessibleLink href="https://example.com" target="_blank">
        y
      </AccessibleLink>
    </div>
  );
}
