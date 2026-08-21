import { describe, expect, it } from "vitest";
import {
  resolveRawWindowControlsPadding,
  resolveWindowControlsPadding,
} from "@/utils/desktop-window";

const rawPadding = {
  left: 80,
  right: 48,
  top: 28,
};

describe("resolveWindowControlsPadding", () => {
  it("keeps mac traffic-light padding available when the app window is not fullscreen", () => {
    expect(
      resolveRawWindowControlsPadding({ isElectron: true, isMac: true, isFullscreen: false }),
    ).toEqual({
      left: 78,
      right: 0,
      top: 45,
    });
  });

  it("keeps Windows and Linux window-control padding available when the app window is not fullscreen", () => {
    expect(
      resolveRawWindowControlsPadding({ isElectron: true, isMac: false, isFullscreen: false }),
    ).toEqual({
      left: 0,
      right: 140,
      top: 48,
    });
  });

  it("grows mac traffic-light padding when the renderer is zoomed out", () => {
    // The traffic lights keep their size in device-independent points while every CSS
    // pixel shrinks, so clearing them takes more CSS pixels than it does at 100%.
    expect(
      resolveRawWindowControlsPadding({
        isElectron: true,
        isMac: true,
        isFullscreen: false,
        zoomFactor: 0.75,
      }),
    ).toEqual({
      left: 104,
      right: 0,
      top: 60,
    });
  });

  it("shrinks mac traffic-light padding when the renderer is zoomed in", () => {
    expect(
      resolveRawWindowControlsPadding({
        isElectron: true,
        isMac: true,
        isFullscreen: false,
        zoomFactor: 1.5,
      }),
    ).toEqual({
      left: 52,
      right: 0,
      top: 30,
    });
  });

  it("scales Windows and Linux window-control padding with the renderer zoom", () => {
    expect(
      resolveRawWindowControlsPadding({
        isElectron: true,
        isMac: false,
        isFullscreen: false,
        zoomFactor: 2,
      }),
    ).toEqual({
      left: 0,
      right: 70,
      top: 24,
    });
  });

  it("reserves the same physical space at every zoom level", () => {
    for (const zoomFactor of [0.5, 0.75, 1, 1.25, 1.5, 2, 3]) {
      const padding = resolveRawWindowControlsPadding({
        isElectron: true,
        isMac: true,
        isFullscreen: false,
        zoomFactor,
      });
      expect(padding.left * zoomFactor).toBeCloseTo(78);
      expect(padding.top * zoomFactor).toBeCloseTo(45);
    }
  });

  it("falls back to unscaled padding when the zoom factor is missing or unusable", () => {
    for (const zoomFactor of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        resolveRawWindowControlsPadding({
          isElectron: true,
          isMac: true,
          isFullscreen: false,
          zoomFactor,
        }),
      ).toEqual({
        left: 78,
        right: 0,
        top: 45,
      });
    }
  });

  it("does not reserve window-control padding when the app window is fullscreen", () => {
    expect(
      resolveRawWindowControlsPadding({ isElectron: true, isMac: true, isFullscreen: true }),
    ).toEqual({
      left: 0,
      right: 0,
      top: 0,
    });
  });

  it("pads the main header for window controls when the app sidebar is closed", () => {
    expect(
      resolveWindowControlsPadding({
        role: "header",
        rawPadding,
        sidebarClosed: true,
        explorerOpen: false,
        focusModeEnabled: false,
      }),
    ).toEqual({
      left: 80,
      right: 48,
      top: 0,
    });
  });

  it("does not add left padding to detail headers with their own sidebar", () => {
    expect(
      resolveWindowControlsPadding({
        role: "detailHeader",
        rawPadding,
        sidebarClosed: true,
        explorerOpen: false,
        focusModeEnabled: false,
      }),
    ).toEqual({
      left: 0,
      right: 48,
      top: 0,
    });
  });

  it("pads a focus-mode tab row away from mac traffic lights even when the sidebar is logically open", () => {
    expect(
      resolveWindowControlsPadding({
        role: "tabRow",
        rawPadding,
        sidebarClosed: false,
        explorerOpen: false,
        focusModeEnabled: true,
      }),
    ).toEqual({
      left: 80,
      right: 48,
      top: 0,
    });
  });

  it("pads a focus-mode tab row away from right-side window controls even when the explorer is logically open", () => {
    expect(
      resolveWindowControlsPadding({
        role: "tabRow",
        rawPadding: { left: 0, right: 140, top: 48 },
        sidebarClosed: true,
        explorerOpen: true,
        focusModeEnabled: true,
      }),
    ).toEqual({
      left: 0,
      right: 140,
      top: 0,
    });
  });
});
