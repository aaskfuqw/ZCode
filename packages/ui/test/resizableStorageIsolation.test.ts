// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResizablePanelGroup } from "@/components/ui/resizable.js";

// Keep the library's real persistence hook while avoiding unrelated resize geometry.
vi.mock("react-resizable-panels", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-resizable-panels")>();
  return {
    ...actual,
    Group: ({
      defaultLayout,
      onLayoutChange,
    }: {
      defaultLayout?: Record<string, number>;
      onLayoutChange: (layout: Record<string, number>) => void;
    }) =>
      createElement(
        "button",
        {
          "data-layout": JSON.stringify(defaultLayout ?? null),
          onClick: () => onLayoutChange({ a: 55, b: 45 }),
        },
        "resize",
      ),
  };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("resizable layout storage isolation", () => {
  it("ignores upstream layouts and writes only Next's physical key", () => {
    vi.useFakeTimers();
    const upstreamKey = "react-resizable-panels:fixture:a:b";
    const upstreamLegacyKey = "react-resizable-panels:fixture";
    localStorage.setItem(upstreamKey, JSON.stringify({ a: 75, b: 25 }));
    localStorage.setItem(upstreamLegacyKey, JSON.stringify({ "a,b": { layout: [80, 20] } }));
    const read = vi.spyOn(Storage.prototype, "getItem");
    render(createElement(ResizablePanelGroup, { layoutId: "fixture", panelIds: ["a", "b"] }));

    expect(screen.getByRole("button").getAttribute("data-layout")).toBe("null");
    expect(read).not.toHaveBeenCalledWith(upstreamKey);
    expect(read).not.toHaveBeenCalledWith(upstreamLegacyKey);
    fireEvent.click(screen.getByRole("button"));
    act(() => vi.runAllTimers());
    expect(
      JSON.parse(localStorage.getItem("react-resizable-panels:zcode-next:fixture:a:b")!),
    ).toEqual({ a: 55, b: 45 });
    expect(JSON.parse(localStorage.getItem(upstreamKey)!)).toEqual({ a: 75, b: 25 });
  });

  it("preserves the library's legacy schema migration inside Next's namespace", () => {
    localStorage.setItem(
      "react-resizable-panels:zcode-next:fixture",
      JSON.stringify({ "a,b": { layout: [80, 20] } }),
    );
    render(createElement(ResizablePanelGroup, { layoutId: "fixture", panelIds: ["a", "b"] }));
    expect(JSON.parse(screen.getByRole("button").getAttribute("data-layout")!)).toEqual({
      a: 80,
      b: 20,
    });
  });
});
