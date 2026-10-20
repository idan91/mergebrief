// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MentionCandidateKinds } from "@web/components/MarkdownTextarea/types";
import { MentionTargetsScope, type MentionTargets } from "../context";
import { Mention } from ".";

function stubTargets(
  shown: readonly string[],
  viewerLogin?: string,
): MentionTargets {
  const lowered = new Set(shown.map((target) => target.toLowerCase()));
  return {
    viewerLogin,
    isTargetShown: (target) => lowered.has(target.toLowerCase()),
    requestTarget: vi.fn(),
  };
}

function renderUserMention(targets: MentionTargets, login: string) {
  return render(
    <MentionTargetsScope value={targets}>
      <Mention kind={MentionCandidateKinds.USER} target={login}>
        {`@${login}`}
      </Mention>
    </MentionTargetsScope>,
  );
}

describe("Mention", () => {
  afterEach(cleanup);

  it("stays plain text with no mention targets in scope", () => {
    render(
      <Mention kind={MentionCandidateKinds.USER} target="cara">
        @cara
      </Mention>,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByTestId("mention").textContent).toBe("@cara");
  });

  it("asks for its target and stays plain text while the answer is pending", () => {
    const targets = stubTargets([]);
    renderUserMention(targets, "cara");

    expect(targets.requestTarget).toHaveBeenCalledWith("cara");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByTestId("mention").textContent).toBe("@cara");
  });

  it("links a resolved user to their GitHub profile", () => {
    renderUserMention(stubTargets(["cara"]), "cara");

    const link = screen.getByRole("link", { name: "@cara" });
    expect(link.getAttribute("href")).toBe("https://github.com/cara");
  });

  it("links a resolved team to its GitHub team page", () => {
    render(
      <MentionTargetsScope value={stubTargets(["acme/backend"])}>
        <Mention kind={MentionCandidateKinds.TEAM} target="acme/backend">
          @acme/backend
        </Mention>
      </MentionTargetsScope>,
    );

    const link = screen.getByRole("link", { name: "@acme/backend" });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/orgs/acme/teams/backend",
    );
  });

  it("matches a resolved target whatever case the text used", () => {
    renderUserMention(stubTargets(["Cara"]), "CARA");

    expect(screen.getByRole("link", { name: "@CARA" })).toBeTruthy();
  });

  it("highlights a mention of the viewer, ignoring case", () => {
    renderUserMention(stubTargets(["octocat"], "OctoCat"), "octocat");

    const link = screen.getByRole("link", { name: "@octocat" });
    expect(link.getAttribute("data-variant")).toBe("viewer");
  });

  it("does not highlight a mention of someone else", () => {
    renderUserMention(stubTargets(["cara"], "octocat"), "cara");

    expect(screen.getByTestId("mention").hasAttribute("data-variant")).toBe(
      false,
    );
  });

  it("never highlights a team whose org is the viewer's login", () => {
    render(
      <MentionTargetsScope value={stubTargets([], "octocat")}>
        <Mention kind={MentionCandidateKinds.TEAM} target="octocat/core">
          @octocat/core
        </Mention>
      </MentionTargetsScope>,
    );

    expect(screen.getByTestId("mention").hasAttribute("data-variant")).toBe(
      false,
    );
  });
});
