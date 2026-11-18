// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SettingsTabIds,
  type SettingsPanelProps,
  type SettingsTab,
} from "../../types";
import { SettingsTabs } from ".";

afterEach(cleanup);

function TokensStub({ active }: SettingsPanelProps) {
  const state = active ? "shown" : "hidden";
  return <p>tokens panel {state}</p>;
}

function InstanceStub({ active }: SettingsPanelProps) {
  const state = active ? "shown" : "hidden";
  return <p>instance panel {state}</p>;
}

const TOKENS: SettingsTab = {
  id: SettingsTabIds.TOKENS,
  labelKey: "shell.settingsTabTokens",
  icon: "terminal",
  Panel: TokensStub,
};
const SECOND: SettingsTab = {
  id: SettingsTabIds.INSTANCE,
  labelKey: "shell.settingsHeading",
  icon: "sliders-horizontal",
  Panel: InstanceStub,
};

describe("SettingsTabs", () => {
  it("shows a lone tab's panel with no tab bar", () => {
    render(
      <SettingsTabs active={TOKENS} onSelect={() => {}} tabs={[TOKENS]} />,
    );

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByText("tokens panel shown")).toBeTruthy();
  });

  it("tells each panel whether it shows and hides the inactive one", () => {
    render(
      <SettingsTabs
        active={TOKENS}
        onSelect={() => {}}
        tabs={[TOKENS, SECOND]}
      />,
    );

    expect(screen.getByRole("tablist").getAttribute("aria-orientation")).toBe(
      "vertical",
    );
    const inactive = screen
      .getByText("instance panel hidden")
      .closest("[role=tabpanel]");
    expect(screen.getByText("tokens panel shown")).toBeTruthy();
    expect(inactive?.hasAttribute("hidden")).toBe(true);
  });

  it("names the chosen tab on select", () => {
    const onSelect = vi.fn();
    render(
      <SettingsTabs
        active={TOKENS}
        onSelect={onSelect}
        tabs={[TOKENS, SECOND]}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));

    expect(onSelect).toHaveBeenCalledWith("instance");
  });
});
