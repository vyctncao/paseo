import { useEffect, useMemo, useState } from "react";
import {
  getIsElectronRuntimeMac,
  getIsElectronRuntime,
  DESKTOP_TRAFFIC_LIGHT_WIDTH,
  DESKTOP_TRAFFIC_LIGHT_HEIGHT,
  DESKTOP_WINDOW_CONTROLS_WIDTH,
  DESKTOP_WINDOW_CONTROLS_HEIGHT,
} from "@/constants/layout";
import { getDesktopWindow } from "@/desktop/electron/window";
import { usePanelStore } from "@/stores/panel-store";
import { isNative, isWeb } from "@/constants/platform";

interface RawWindowControlsPadding {
  left: number;
  right: number;
  top: number;
}

type WindowControlsPaddingRole =
  | "sidebar"
  | "header"
  | "detailHeader"
  | "tabRow"
  | "explorerSidebar";

// Module-level cache so hook remounts (e.g., on navigation) don't briefly
// fall back to the default `false` while the async fullscreen check resolves.
// Without this, in fullscreen the sidebar flashes with traffic-light padding
// on first frame and then snaps to 0 once the async read completes.
let cachedIsFullscreen = false;
const fullscreenSubscribers = new Set<(value: boolean) => void>();
let fullscreenSubscriptionStarted = false;

function setCachedFullscreen(value: boolean) {
  if (cachedIsFullscreen === value) return;
  cachedIsFullscreen = value;
  for (const sub of fullscreenSubscribers) {
    sub(value);
  }
}

function startFullscreenSubscription() {
  if (fullscreenSubscriptionStarted) return;
  if (isNative || !getIsElectronRuntime()) return;
  fullscreenSubscriptionStarted = true;

  void (async () => {
    const win = getDesktopWindow();
    if (!win) return;

    if (typeof win.isFullscreen === "function") {
      try {
        setCachedFullscreen(await win.isFullscreen());
      } catch (error) {
        console.warn("[DesktopWindow] Failed to read fullscreen state", error);
      }
    }

    if (typeof win.onResized !== "function") return;

    try {
      await win.onResized(async () => {
        if (typeof win.isFullscreen !== "function") return;
        try {
          setCachedFullscreen(await win.isFullscreen());
        } catch (error) {
          console.warn("[DesktopWindow] Failed to read fullscreen state", error);
        }
      });
    } catch (error) {
      console.warn("[DesktopWindow] Failed to subscribe to resize", error);
    }
  })();
}

// The native window controls — macOS traffic lights placed at a fixed
// `trafficLightPosition`, and the Windows/Linux control overlay — are drawn by the
// OS in device-independent points and do not scale with Electron's zoom factor.
// Everything we render is in CSS pixels, which do. So a constant like
// DESKTOP_TRAFFIC_LIGHT_WIDTH reserves `width * zoomFactor` points: zoom out and the
// reservation shrinks until our own chrome slides under the traffic lights (and the
// native buttons then swallow its clicks); zoom in and it opens a dead gap. Dividing
// by the zoom factor keeps the reserved area the same physical size at every zoom.
let cachedZoomFactor = 1;
const zoomSubscribers = new Set<(value: number) => void>();
let zoomSubscriptionStarted = false;

function readZoomFactor(): number {
  const win = getDesktopWindow();
  if (!win || typeof win.getZoomFactor !== "function") return 1;
  try {
    const value = win.getZoomFactor();
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
  } catch (error) {
    console.warn("[DesktopWindow] Failed to read zoom factor", error);
    return 1;
  }
}

function setCachedZoomFactor(value: number) {
  if (cachedZoomFactor === value) return;
  cachedZoomFactor = value;
  for (const sub of zoomSubscribers) {
    sub(value);
  }
}

function startZoomSubscription() {
  if (zoomSubscriptionStarted) return;
  if (isNative || !isWeb || !getIsElectronRuntime()) return;
  zoomSubscriptionStarted = true;

  setCachedZoomFactor(readZoomFactor());

  // Changing the zoom factor resizes the layout viewport in CSS pixels, so the
  // renderer gets a `resize` event for every zoom source — the View menu, the
  // Cmd+scroll gesture, and a restored zoom level on load. Listening here rather
  // than to a main-process broadcast means no zoom entry point can be missed.
  window.addEventListener("resize", () => {
    setCachedZoomFactor(readZoomFactor());
  });
}

function useRawWindowControlsPadding(): RawWindowControlsPadding {
  const [isFullscreen, setIsFullscreen] = useState(cachedIsFullscreen);
  const [zoomFactor, setZoomFactor] = useState(cachedZoomFactor);

  useEffect(() => {
    startFullscreenSubscription();
    // Sync to any value that resolved between render and effect.
    setIsFullscreen(cachedIsFullscreen);
    fullscreenSubscribers.add(setIsFullscreen);
    return () => {
      fullscreenSubscribers.delete(setIsFullscreen);
    };
  }, []);

  useEffect(() => {
    startZoomSubscription();
    setZoomFactor(cachedZoomFactor);
    zoomSubscribers.add(setZoomFactor);
    return () => {
      zoomSubscribers.delete(setZoomFactor);
    };
  }, []);

  return resolveRawWindowControlsPadding({
    isElectron: getIsElectronRuntime(),
    isMac: getIsElectronRuntimeMac(),
    isFullscreen,
    zoomFactor,
  });
}

export function resolveRawWindowControlsPadding(input: {
  isElectron: boolean;
  isMac: boolean;
  isFullscreen: boolean;
  /** Electron renderer zoom factor; 1 at 100%. */
  zoomFactor?: number;
}): RawWindowControlsPadding {
  if (!input.isElectron || input.isFullscreen) {
    return { left: 0, right: 0, top: 0 };
  }

  // The constants below describe native chrome measured in device-independent
  // points, so they have to be converted into the CSS pixels we lay out in.
  const toCssPixels = (points: number) => points / normalizeZoomFactor(input.zoomFactor);

  if (input.isMac) {
    return {
      left: toCssPixels(DESKTOP_TRAFFIC_LIGHT_WIDTH),
      right: 0,
      top: toCssPixels(DESKTOP_TRAFFIC_LIGHT_HEIGHT),
    };
  }

  return {
    left: 0,
    right: toCssPixels(DESKTOP_WINDOW_CONTROLS_WIDTH),
    top: toCssPixels(DESKTOP_WINDOW_CONTROLS_HEIGHT),
  };
}

function normalizeZoomFactor(zoomFactor: number | undefined): number {
  return typeof zoomFactor === "number" && Number.isFinite(zoomFactor) && zoomFactor > 0
    ? zoomFactor
    : 1;
}

export function useWindowControlsPadding(role: WindowControlsPaddingRole): {
  left: number;
  right: number;
  top: number;
} {
  const sidebarOpen = usePanelStore((state) => state.desktop.agentListOpen);
  const explorerOpen = usePanelStore((state) => state.desktop.fileExplorerOpen);
  const focusModeEnabled = usePanelStore((state) => state.desktop.focusModeEnabled);
  const rawPadding = useRawWindowControlsPadding();
  const sidebarClosed = !sidebarOpen;

  const { left, right, top } = resolveWindowControlsPadding({
    role,
    rawPadding,
    sidebarClosed,
    explorerOpen,
    focusModeEnabled,
  });

  return useMemo(() => ({ left, right, top }), [left, right, top]);
}

export function resolveWindowControlsPadding(input: {
  role: WindowControlsPaddingRole;
  rawPadding: RawWindowControlsPadding;
  sidebarClosed: boolean;
  explorerOpen: boolean;
  focusModeEnabled: boolean;
}): RawWindowControlsPadding {
  if (input.role === "sidebar") {
    return {
      left: input.rawPadding.left,
      right: 0,
      top: input.rawPadding.top,
    };
  }

  if (input.role === "header") {
    return {
      left: input.sidebarClosed ? input.rawPadding.left : 0,
      right: input.explorerOpen ? 0 : input.rawPadding.right,
      top: 0,
    };
  }

  if (input.role === "detailHeader") {
    return {
      left: 0,
      right: input.rawPadding.right,
      top: 0,
    };
  }

  if (input.role === "tabRow") {
    return {
      left: input.focusModeEnabled ? input.rawPadding.left : 0,
      right: input.focusModeEnabled ? input.rawPadding.right : 0,
      top: 0,
    };
  }

  return {
    left: 0,
    right: input.rawPadding.right,
    top: 0,
  };
}
