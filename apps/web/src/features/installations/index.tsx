// Curated feature entry (ADR 0037): single entry component. Kept as a
// re-export (not moved JSX) because OrgSwitcher carries co-located support
// files (styles, test) that belong in its component folder. Internal files
// import their targets directly, never this index (import/no-cycle).
export {
  OrgSwitcher,
  type OrgSwitcherProps,
} from "./components/OrgSwitcher/OrgSwitcher";
