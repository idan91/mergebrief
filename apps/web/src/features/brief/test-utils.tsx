import type { QueryClient } from "@tanstack/react-query";
import type { AnyRouter } from "@tanstack/react-router";
import { act } from "@testing-library/react";
import {
  useState,
  type Dispatch,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
} from "react";

import { I18nProvider } from "@web/i18n/I18nProvider";
import { renderInRouter } from "@web/test/router";
import type { BriefSearchParams } from "./comparison/compareState";
import { BriefView, type BriefViewProps } from "./components/BriefView";
import { briefFixture, briefSummaryFixture } from "./fixtures";

const NO_SEARCH_PARAMS: BriefSearchParams = {};

/** Routes the screen's own links point at, stubbed so they resolve. */
const SCREEN_LINK_STUBS = ["/briefs/$briefId/summary-preview"];

/** The screen's props as a test states them; an unset one takes the fixture default. */
export type BriefViewOverrides = Partial<BriefViewProps>;

interface MountBriefOptions {
  /** A client the test seeded before the mount. */
  queryClient?: QueryClient;
}

interface MountedBrief {
  queryClient: QueryClient;
  router: Pick<AnyRouter, "state">;
}

interface MountedBriefView extends MountedBrief {
  /** Re-renders in place with these props over the current ones. */
  rerender: (overrides: BriefViewOverrides) => void;
}

/** BriefView over the brief fixture: the one place a test builds the screen's props. */
export function FixtureBriefView(props: BriefViewOverrides): ReactElement {
  return (
    <BriefView
      brief={briefFixture}
      briefId={briefSummaryFixture.id}
      searchParams={NO_SEARCH_PARAMS}
      {...props}
    />
  );
}

/** Mounts a test's own host around FixtureBriefView in the screen's shell. */
export async function mountBriefHost(
  host: ReactNode,
  options: MountBriefOptions = {},
): Promise<MountedBrief> {
  return await renderInRouter(
    <I18nProvider>{host}</I18nProvider>,
    options.queryClient,
    SCREEN_LINK_STUBS,
  );
}

/** Mounts the screen at the fixture defaults with these props on top. */
export async function mountBriefView(
  overrides: BriefViewOverrides = {},
  options: MountBriefOptions = {},
): Promise<MountedBriefView> {
  let setProps: Dispatch<SetStateAction<BriefViewOverrides>> | undefined;
  function Stage() {
    const [props, setState] = useState(overrides);
    setProps = setState;
    return <FixtureBriefView {...props} />;
  }

  const mounted = await mountBriefHost(<Stage />, options);
  return {
    ...mounted,
    rerender: (next) => {
      act(() => {
        setProps?.((current) => ({ ...current, ...next }));
      });
    },
  };
}
