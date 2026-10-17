// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  entryPlanList: "coding_plan__personal_lite,start_plan__start",
  status: "ready" as "ready" | "loading" | "error",
  retry: vi.fn(),
  renderedTargets: [] as Array<
    | {
        providerId: string;
        initialAudience?: "personal" | "team";
      }
    | undefined
  >,
  onOpenResult: undefined as undefined | ((opened: boolean) => void),
}));

vi.mock("@/hooks/usePlatform.js", () => ({
  usePlatform: () => ({}),
}));

vi.mock("@/settings/CodingPlanUpgradeDialog.js", () => ({
  CodingPlanUpgradeDialog: ({
    target,
    onOpenResult,
  }: {
    onOpenResult?: (opened: boolean) => void;
    target?: {
      providerId: string;
      initialAudience?: "personal" | "team";
    };
  }) => {
    h.renderedTargets.push(target);
    h.onOpenResult = onOpenResult;
    return null;
  },
}));

import {
  CodingPlanUpgradeDialogProvider,
  useCodingPlanUpgradeDialog,
} from "@/settings/CodingPlanUpgradeDialogProvider.js";

function Launcher({ loginVersion }: { loginVersion: number }) {
  const { openCodingPlanUpgrade } = useCodingPlanUpgradeDialog();
  return createElement(
    "button",
    {
      type: "button",
      "data-login-version": loginVersion,
      onClick: () =>
        openCodingPlanUpgrade({
          providerId: "zai-coding-plan",
          initialAudience: "personal",
        }),
    },
    "Upgrade",
  );
}

afterEach(() => {
  cleanup();
  h.status = "ready";
  h.renderedTargets.length = 0;
});

describe("CodingPlanUpgradeDialogProvider", () => {
  it.each([true, false])("observes opening result %s once", (opened) => {
    const result = vi.fn();
    function ObservedLauncher() {
      const { openCodingPlanUpgrade } = useCodingPlanUpgradeDialog();
      return createElement(
        "button",
        {
          onClick: () =>
            openCodingPlanUpgrade(
              { providerId: "builtin:bigmodel-coding-plan" },
              { signal: new AbortController().signal, onResult: result },
            ),
        },
        "Observed",
      );
    }
    render(createElement(CodingPlanUpgradeDialogProvider, null, createElement(ObservedLauncher)));
    fireEvent.click(screen.getByText("Observed"));
    expect(result).not.toHaveBeenCalled();
    h.onOpenResult?.(opened);
    h.onOpenResult?.(opened);
    expect(result).toHaveBeenCalledExactlyOnceWith(opened);
  });
  it("aborts an observed opening and ignores late ready", () => {
    const signal = new AbortController();
    const result = vi.fn();
    function ObservedLauncher() {
      const { openCodingPlanUpgrade } = useCodingPlanUpgradeDialog();
      return createElement(
        "button",
        {
          onClick: () =>
            openCodingPlanUpgrade(
              { providerId: "builtin:bigmodel-coding-plan" },
              { signal: signal.signal, onResult: result },
            ),
        },
        "Observed",
      );
    }
    render(createElement(CodingPlanUpgradeDialogProvider, null, createElement(ObservedLauncher)));
    fireEvent.click(screen.getByText("Observed"));
    signal.abort();
    h.onOpenResult?.(true);
    expect(result).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("opens the selected purchase dialog", async () => {
    render(
      createElement(
        CodingPlanUpgradeDialogProvider,
        null,
        createElement(Launcher, { loginVersion: 0 }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
    expect(h.renderedTargets.at(-1)).toEqual({
      providerId: "zai-coding-plan",
      initialAudience: "personal",
    });
  });

  it("keeps the purchase target when OAuth login rerenders the app", () => {
    const view = render(
      createElement(
        CodingPlanUpgradeDialogProvider,
        null,
        createElement(Launcher, { loginVersion: 0 }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));

    // OAuth callback 会刷新用户与购买凭据并触发 Root 重渲染，但不应重建 provider。
    view.rerender(
      createElement(
        CodingPlanUpgradeDialogProvider,
        null,
        createElement(Launcher, { loginVersion: 1 }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
  });
});
