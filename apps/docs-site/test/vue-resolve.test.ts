import { describe, expect, it, vi } from "vitest";

import { createVueResolvePlugin, isSourceVueImport } from "../src/vue-resolve";

const SRC_DIR = "/repo/docs";
const RESOLVE_FROM = "/repo/node_modules/vitepress/package.json";

describe("isSourceVueImport", () => {
  it.each([
    ["vue", "/repo/docs/architecture.md", true],
    ["vue/server-renderer", "/repo/docs/self-host/cli.md", true],
    ["@vue/shared", "/repo/docs/api-changelog.md", true],
    ["vue", "/repo/apps/docs-site/.vitepress/theme/index.ts", false],
    ["vue", "/repo/docs-other/page.md", false],
    ["vue", undefined, false],
    ["vuex", "/repo/docs/api-changelog.md", false],
    ["node-html-parser", "/repo/docs/api-changelog.md", false],
  ])("treats %s from %s as %s", (id, importer, expected) => {
    expect(isSourceVueImport(id, importer, SRC_DIR)).toBe(expected);
  });
});

describe("createVueResolvePlugin", () => {
  it("resolves a docs page's vue import from the member, skipping itself", async () => {
    const plugin = createVueResolvePlugin({
      srcDir: SRC_DIR,
      resolveFrom: RESOLVE_FROM,
    });
    const resolve = vi.fn().mockResolvedValue({ id: "/member/vue.js" });
    const hook = plugin.resolveId as (...args: unknown[]) => Promise<unknown>;

    const resolved = await hook.call(
      { resolve },
      "vue",
      "/repo/docs/api-changelog.md",
      { ssr: true },
    );

    expect(plugin.enforce).toBe("pre");
    expect(resolved).toEqual({ id: "/member/vue.js" });
    expect(resolve).toHaveBeenCalledWith("vue", RESOLVE_FROM, {
      ssr: true,
      skipSelf: true,
    });
  });

  it("leaves every other import to Vite", async () => {
    const plugin = createVueResolvePlugin({
      srcDir: SRC_DIR,
      resolveFrom: RESOLVE_FROM,
    });
    const resolve = vi.fn();
    const hook = plugin.resolveId as (...args: unknown[]) => Promise<unknown>;

    expect(
      await hook.call({ resolve }, "vue", RESOLVE_FROM, {}),
    ).toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();
  });
});
