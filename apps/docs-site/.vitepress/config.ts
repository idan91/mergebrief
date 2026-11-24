import path from "node:path";
import { fileURLToPath } from "node:url";
import { createI18n } from "i18n";
import { defineConfig, type DefaultTheme, type UserConfig } from "vitepress";

import { ALERT_TITLE_RULE_NAME, createAlertTitleRule } from "../src/alerts";
import { findDeadAnchors, formatDeadAnchors } from "../src/anchors/check";
import { slugifyHeading } from "../src/anchors/slug";
import { buildFontPreloads, buildIconLinks } from "../src/head";
import { readSiteLabels } from "../src/labels";
import { createLinkRule, readGitHubRef } from "../src/links";
import { LINK_RULE_NAME, PUBLIC_REPO_URL } from "../src/links/consts";
import {
  deriveSrcExclude,
  listSitePages,
  readReleaseVersion,
  readSitePages,
} from "../src/pages";
import { HOME_PAGE_SOURCE, HOME_PAGE_TARGET } from "../src/pages/consts";
import { buildSidebar } from "../src/pages/sidebar";
import { createSearchRender } from "../src/search";
import { CODE_THEMES, createSyntaxContrastTransformer } from "../src/syntax";
import { createVueResolvePlugin } from "../src/vue-resolve";

const configFile = fileURLToPath(import.meta.url);
const memberDir = path.resolve(path.dirname(configFile), "..");
const repoRoot = path.resolve(memberDir, "../..");
const srcDir = path.join(repoRoot, "docs");
const vitepressPackage = fileURLToPath(
  import.meta.resolve("vitepress/package.json"),
);

const version = process.env["MERGEBRIEF_DOCS_VERSION"];
const base = process.env["MERGEBRIEF_DOCS_BASE"] ?? "/";
const siteUrl = process.env["MERGEBRIEF_DOCS_SITE_URL"];

const labels = readSiteLabels(createI18n().t);
const linkContext = {
  repoRoot,
  srcDir,
  sitePages: new Set(listSitePages(srcDir)),
  ref: readGitHubRef(version),
};

const config: UserConfig<DefaultTheme.Config> = {
  title: "MergeBrief",
  description: labels.description,
  base,
  srcDir,
  srcExclude: deriveSrcExclude(srcDir),
  rewrites: { [HOME_PAGE_SOURCE]: HOME_PAGE_TARGET },
  cleanUrls: true,
  lastUpdated: false,
  appearance: "dark",
  head: buildIconLinks(base),
  ignoreDeadLinks: "localhostLinks",
  markdown: {
    anchor: { slugify: slugifyHeading },
    theme: CODE_THEMES,
    codeTransformers: [createSyntaxContrastTransformer()],
    codeCopyButtonTitle: labels.copyCode,
    config(md) {
      md.core.ruler.push(LINK_RULE_NAME, createLinkRule(linkContext));
      md.core.ruler.push(
        ALERT_TITLE_RULE_NAME,
        createAlertTitleRule(labels.alerts),
      );
    },
  },
  themeConfig: {
    ...labels.chrome,
    logo: { src: "/favicon.svg", alt: "" },
    socialLinks: [
      { icon: "github", link: PUBLIC_REPO_URL, ariaLabel: "GitHub" },
    ],
    sidebar: buildSidebar(readSitePages(srcDir), labels.sidebar),
    search: {
      provider: "local",
      options: {
        translations: labels.search,
        _render: createSearchRender(labels.sidebar),
      },
    },
  },
  vite: {
    publicDir: path.join(memberDir, "public"),
    plugins: [
      createVueResolvePlugin({ srcDir, resolveFrom: vitepressPackage }),
    ],
  },
  transformHead({ assets }) {
    return buildFontPreloads(assets);
  },
  transformPageData(pageData) {
    const releaseVersion = readReleaseVersion(pageData.relativePath);
    const untitledReleaseNote =
      pageData.title === "" && releaseVersion !== undefined;
    if (untitledReleaseNote) {
      return { title: releaseVersion };
    }

    return undefined;
  },
  buildEnd(siteConfig) {
    const dead = findDeadAnchors(siteConfig.outDir, siteConfig.site.base);
    if (dead.length > 0) {
      throw new Error(formatDeadAnchors(dead));
    }
  },
};

if (siteUrl) {
  config.sitemap = { hostname: siteUrl };
}

export default defineConfig(config);
