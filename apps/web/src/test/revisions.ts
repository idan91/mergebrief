import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

/**
 * Opens the sidebar's Revisions tab from a collapsed desktop sidebar and
 * answers its list. Clear the stored sidebar preference between tests, or a
 * remembered expanded sidebar has no expand control to press.
 */
export async function openRevisionsTab(): Promise<HTMLElement> {
  const expand = await waitFor(() =>
    screen.getByRole("button", { name: "Expand sidebar" }),
  );
  await act(async () => {
    fireEvent.click(expand);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("tab", { name: "Revisions" }));
  });
  return screen.getByTestId("revision-list");
}

/** The tab's rows oldest first, the order a meta lists its revisions in. */
export function listRevisionRows(): HTMLElement[] {
  return within(screen.getByTestId("revision-list"))
    .getAllByRole("button")
    .toReversed();
}
