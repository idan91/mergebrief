import path from "node:path";
import type { UserConfig } from "vitepress";

type VitePluginOption = NonNullable<
  NonNullable<UserConfig["vite"]>["plugins"]
>[number];
type VitePlugin = Extract<VitePluginOption, { name: string }>;

export interface VueResolveOptions {
  /** Absolute `docs/`, outside the member, where no `vue` is installed. */
  srcDir: string;
  /** A file inside VitePress's own package, so `vue` resolves to the copy VitePress depends on. */
  resolveFrom: string;
}

const VUE_IMPORT = /^(?:vue|vue\/server-renderer|@vue\/.+)$/;

export function isSourceVueImport(
  id: string,
  importer: string | undefined,
  srcDir: string,
): boolean {
  const fromSource = importer?.startsWith(`${srcDir}${path.sep}`) ?? false;
  if (!fromSource) {
    return false;
  }

  return VUE_IMPORT.test(id);
}

/**
 * The SSR build resolves a page's `vue` import upward from `docs/`, which has none under pnpm's isolated
 * layout; VitePress aliases `vue` for the client build only. This resolves those imports from VitePress.
 */
export function createVueResolvePlugin(options: VueResolveOptions): VitePlugin {
  return {
    name: "docs-site:vue-resolve",
    enforce: "pre",
    async resolveId(id, importer, resolveOptions) {
      if (!isSourceVueImport(id, importer, options.srcDir)) {
        return undefined;
      }

      return this.resolve(id, options.resolveFrom, {
        ...resolveOptions,
        skipSelf: true,
      });
    },
  };
}
