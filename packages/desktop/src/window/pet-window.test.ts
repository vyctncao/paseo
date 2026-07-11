import { ipcMain } from "electron";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type RecordedCallback = (...args: unknown[]) => unknown;
interface FakeWindowOptions extends Record<string, unknown> {
  x: number;
  y: number;
  width: number;
  height: number;
}

const electronMocks = vi.hoisted(() => {
  const handlers = new Map<string, RecordedCallback>();
  const listeners = new Map<string, RecordedCallback>();
  const windows: FakeBrowserWindow[] = [];

  class FakeWebContents {
    destroyed = false;
    listeners = new Map<string, RecordedCallback>();
    sent: Array<[string, unknown]> = [];

    isDestroyed(): boolean {
      return this.destroyed;
    }

    on(event: string, listener: RecordedCallback): void {
      this.listeners.set(event, listener);
    }

    send(channel: string, payload: unknown): void {
      this.sent.push([channel, payload]);
    }
  }

  class FakeBrowserWindow {
    static fromWebContents(contents: FakeWebContents): FakeBrowserWindow | null {
      return windows.find((win) => win.webContents === contents) ?? null;
    }

    readonly webContents = new FakeWebContents();
    readonly listeners = new Map<string, RecordedCallback>();
    readonly setAlwaysOnTop = vi.fn();
    readonly setVisibleOnAllWorkspaces = vi.fn();
    readonly setFocusable = vi.fn();
    readonly focus = vi.fn();
    readonly showInactive = vi.fn(() => {
      this.visible = true;
    });
    readonly hide = vi.fn(() => {
      this.visible = false;
    });
    readonly loadURL = vi.fn(async () => undefined);
    options: FakeWindowOptions;
    bounds: { x: number; y: number; width: number; height: number };
    visible = false;
    destroyed = false;

    constructor(options: FakeWindowOptions) {
      this.options = options;
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      windows.push(this);
    }

    on(event: string, listener: RecordedCallback): void {
      this.listeners.set(event, listener);
    }

    getBounds() {
      return { ...this.bounds };
    }

    setBounds(bounds: typeof this.bounds): void {
      this.bounds = { ...bounds };
    }

    getPosition(): [number, number] {
      return [this.bounds.x, this.bounds.y];
    }

    setPosition(x: number, y: number): void {
      this.bounds.x = x;
      this.bounds.y = y;
    }

    isVisible(): boolean {
      return this.visible;
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }

    destroy(): void {
      this.destroyed = true;
      this.listeners.get("closed")?.();
    }
  }

  return { handlers, listeners, windows, FakeBrowserWindow };
});

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/paseo-pet-window-test" },
  BrowserWindow: electronMocks.FakeBrowserWindow,
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel: string, callback: unknown) => {
      electronMocks.handlers.set(channel, callback as RecordedCallback);
    }),
    on: vi.fn((channel: string, callback: unknown) => {
      electronMocks.listeners.set(channel, callback as RecordedCallback);
    }),
  },
  screen: {
    getPrimaryDisplay: () => ({ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getAllDisplays: () => [{ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
  },
}));

import { destroyPetWindow, registerPetWindowManager } from "./pet-window";

const mainSender = { id: 7 } as Electron.WebContents;
const activity = {
  key: "host:agent",
  serverId: "host",
  agentId: "agent",
  workspaceId: "workspace",
  title: "Fix the build",
  hostLabel: "My Mac",
  status: "running",
  statusLabel: "Running",
};
const state = {
  visible: true,
  spritesheetUrl: "http://127.0.0.1:6768/api/pets/mofu/spritesheet",
  rows: 9,
  lifecycle: "running",
  size: 112,
  totalActivityCount: 1,
  trayTitle: "Active chats",
  activities: [activity],
};
const openActivity = vi.fn();
const rendererReady = vi.fn();

function registeredHandler(channel: string): RecordedCallback {
  const result = electronMocks.handlers.get(channel);
  if (!result) throw new Error(`Missing handler for ${channel}`);
  return result;
}

describe("desktop pet window manager", () => {
  beforeAll(() => {
    registerPetWindowManager({
      isMainWebContents: (contents) => contents === mainSender,
      onOpenActivity: openActivity,
      onMainRendererReady: rendererReady,
    });
  });

  beforeEach(() => {
    openActivity.mockReset();
    rendererReady.mockReset();
    electronMocks.windows.length = 0;
  });

  afterEach(() => {
    destroyPetWindow();
  });

  it("creates a secure transparent always-on-top window and waits for overlay readiness", async () => {
    await registeredHandler("paseo:pet:update-state")({ sender: mainSender }, state);
    const win = electronMocks.windows[0];
    expect(win).toBeDefined();
    expect(win?.options).toMatchObject({
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focusable: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
      },
    });
    expect(win?.showInactive).not.toHaveBeenCalled();
    expect(win?.loadURL).toHaveBeenCalledWith("paseo://app/__pet_overlay");

    electronMocks.listeners.get("paseo:pet:overlay-ready")?.({ sender: win?.webContents });

    expect(win?.webContents.sent.at(-1)).toEqual(["paseo:pet:state", state]);
    expect(win?.showInactive).toHaveBeenCalledOnce();
  });

  it("rejects state updates from non-app web contents", async () => {
    await expect(
      registeredHandler("paseo:pet:update-state")({ sender: { id: 99 } }, state),
    ).rejects.toThrow("only accepted from a Paseo app window");
    expect(electronMocks.windows).toHaveLength(0);
  });

  it("expands and focuses only while the activity tray is open", async () => {
    await registeredHandler("paseo:pet:update-state")({ sender: mainSender }, state);
    const win = electronMocks.windows[0]!;
    electronMocks.listeners.get("paseo:pet:overlay-ready")?.({ sender: win.webContents });
    const closedWidth = win.bounds.width;

    await registeredHandler("paseo:pet:set-tray-open")({ sender: win.webContents }, true);
    expect(win.bounds.width).toBeGreaterThan(closedWidth);
    expect(win.setFocusable).toHaveBeenLastCalledWith(true);
    expect(win.focus).toHaveBeenCalledOnce();

    await registeredHandler("paseo:pet:set-tray-open")({ sender: win.webContents }, false);
    expect(win.bounds.width).toBe(closedWidth);
    expect(win.setFocusable).toHaveBeenLastCalledWith(false);
  });

  it("opens only an activity from the sanitized current snapshot", async () => {
    await registeredHandler("paseo:pet:update-state")({ sender: mainSender }, state);
    const win = electronMocks.windows[0]!;

    await registeredHandler("paseo:pet:open-activity")({ sender: win.webContents }, activity.key);
    await registeredHandler("paseo:pet:open-activity")({ sender: win.webContents }, "unknown");

    expect(openActivity).toHaveBeenCalledOnce();
    expect(openActivity).toHaveBeenCalledWith(activity);
  });

  it("registers the narrow pet IPC surface", () => {
    expect(vi.mocked(ipcMain.handle)).toHaveBeenCalledWith(
      "paseo:pet:update-state",
      expect.any(Function),
    );
    expect(vi.mocked(ipcMain.handle)).toHaveBeenCalledWith(
      "paseo:pet:import",
      expect.any(Function),
    );
    expect(vi.mocked(ipcMain.handle)).toHaveBeenCalledWith(
      "paseo:pet:main-renderer-ready",
      expect.any(Function),
    );
  });
});
