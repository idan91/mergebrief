// Curated feature entry: the Account menu, mounted in every Header's end slot,
// the viewer's sign-out sync the root route runs, and the viewer's login.
export { AccountMenu, type AccountMenuProps } from "./components/AccountMenu";
export { useSyncViewerOnSignOut } from "./hooks/useSyncViewerOnSignOut";
export { useViewerLogin } from "./hooks/useViewerLogin";
