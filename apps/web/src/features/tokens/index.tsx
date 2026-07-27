// Curated feature entry (ADR 0037): single entry component. Kept as a
// re-export (not moved JSX) because TokenSettings carries co-located support
// files (styles, test) that belong in its component folder. Internal files
// import their targets directly, never this index (import/no-cycle).
export {
  TokenSettings,
  type TokenSettingsProps,
} from "./components/TokenSettings/TokenSettings";
