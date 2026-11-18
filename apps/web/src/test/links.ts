/** Link values a wire parser must keep out of an `href`: script schemes, data URLs, protocol-relative and plain http. */
export const UNSAFE_LINKS = [
  "javascript:alert(1)",
  "JAVASCRIPT:alert(1)",
  " javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "//evil.example/path",
  "http://github.com/o/r",
];
