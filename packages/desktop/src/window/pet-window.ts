import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, screen, type WebContents } from "electron";

import { readDesktopPetImport } from "./pet-import.js";
import {
  createPetPositionStore,
  readDesktopPetOverlayState,
  resolvePetWindowBounds,
  resolvePetWindowSize,
  type DesktopPetActivity,
  type DesktopPetOverlayState,
  type PetPositionStore,
  type PetWindowAnchor,
} from "./pet-window-state.js";

const POSITION_SAVE_DEBOUNCE_MS = 400;
export const PET_OVERLAY_ROUTE_PATH = "/__pet_overlay";
export const PET_OVERLAY_DOCUMENT = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src http: https: paseo: data: blob:; connect-src http: https:; style-src 'unsafe-inline';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Paseo Pet</title>
  </head>
  <body></body>
</html>`;

export interface PetWindowManagerDependencies {
  isMainWebContents: (contents: WebContents) => boolean;
  onOpenActivity: (activity: DesktopPetActivity) => Promise<void> | void;
  onMainRendererReady: (contents: WebContents) => Promise<void> | void;
}

let petWindow: BrowserWindow | null = null;
let creatingPetWindow: Promise<BrowserWindow> | null = null;
let latestState: DesktopPetOverlayState = { visible: false };
let trayOpen = false;
let overlayReady = false;
let positionStore: PetPositionStore | null = null;
let savedAnchor: PetWindowAnchor | null = null;
let positionSaveTimer: ReturnType<typeof setTimeout> | null = null;
let registered = false;
let dependencies: PetWindowManagerDependencies | null = null;
let dragState: { pointerX: number; pointerY: number; windowX: number; windowY: number } | null =
  null;

function isWayland(): boolean {
  return process.platform === "linux" && process.env.XDG_SESSION_TYPE?.toLowerCase() === "wayland";
}

function workAreas(): Electron.Rectangle[] {
  const primary = screen.getPrimaryDisplay();
  const remaining = screen.getAllDisplays().filter((display) => display.id !== primary.id);
  return [primary, ...remaining].map((display) => display.workArea);
}

function currentAnchor(win: BrowserWindow): PetWindowAnchor {
  const bounds = win.getBounds();
  return { right: bounds.x + bounds.width, bottom: bounds.y + bounds.height };
}

function schedulePositionSave(win: BrowserWindow): void {
  if (isWayland() || win.isDestroyed()) return;
  savedAnchor = currentAnchor(win);
  if (positionSaveTimer) clearTimeout(positionSaveTimer);
  positionSaveTimer = setTimeout(() => {
    positionSaveTimer = null;
    if (!savedAnchor) return;
    void positionStore?.save(savedAnchor).catch((error) => {
      console.warn("[pet-window] Failed to persist position", error);
    });
  }, POSITION_SAVE_DEBOUNCE_MS);
}

function applyWindowBounds(
  win: BrowserWindow,
  state: Extract<DesktopPetOverlayState, { visible: true }>,
): void {
  const anchor = win.isVisible() ? currentAnchor(win) : savedAnchor;
  const bounds = resolvePetWindowBounds({
    size: resolvePetWindowSize(state, trayOpen),
    anchor,
    workAreas: workAreas(),
  });
  win.setBounds(bounds);
  savedAnchor = { right: bounds.x + bounds.width, bottom: bounds.y + bounds.height };
}

function sendLatestState(win: BrowserWindow): void {
  if (!overlayReady || win.isDestroyed() || win.webContents.isDestroyed()) return;
  const state =
    latestState.visible && isWayland()
      ? { ...latestState, useNativeWindowDrag: true }
      : latestState;
  win.webContents.send("paseo:pet:state", state);
}

function showLatestState(win: BrowserWindow): void {
  if (!latestState.visible) {
    win.hide();
    return;
  }
  applyWindowBounds(win, latestState);
  if (!overlayReady) return;
  sendLatestState(win);
  if (!win.isVisible()) win.showInactive();
}

function resetWindow(win: BrowserWindow): void {
  if (petWindow !== win) return;
  petWindow = null;
  overlayReady = false;
  trayOpen = false;
  dragState = null;
}

async function createPetWindow(): Promise<BrowserWindow> {
  positionStore ??= createPetPositionStore(app.getPath("userData"));
  savedAnchor ??= await positionStore.load().catch((error) => {
    console.warn("[pet-window] Failed to restore position", error);
    return null;
  });

  const initialState = latestState.visible ? latestState : null;
  const initialSize = initialState
    ? resolvePetWindowSize(initialState, false)
    : { width: 128, height: 138 };
  const initialBounds = resolvePetWindowBounds({
    size: initialSize,
    anchor: savedAnchor,
    workAreas: workAreas(),
  });
  const win = new BrowserWindow({
    ...initialBounds,
    title: "Paseo Pet",
    show: false,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    focusable: false,
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, "../pet-overlay-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });
  petWindow = win;
  overlayReady = false;
  win.setAlwaysOnTop(true, "floating");
  if (process.platform === "darwin" || process.platform === "linux") {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  win.on("moved", () => schedulePositionSave(win));
  win.on("closed", () => resetWindow(win));
  win.webContents.on("render-process-gone", () => {
    if (petWindow === win && latestState.visible) {
      win.destroy();
      void ensurePetWindow();
    }
  });
  await win.loadURL(`paseo://app${PET_OVERLAY_ROUTE_PATH}`);
  return win;
}

async function ensurePetWindow(): Promise<BrowserWindow> {
  if (petWindow && !petWindow.isDestroyed()) return petWindow;
  if (creatingPetWindow) return await creatingPetWindow;
  creatingPetWindow = createPetWindow().finally(() => {
    creatingPetWindow = null;
  });
  return await creatingPetWindow;
}

async function updatePetState(rawState: unknown, sender: WebContents): Promise<void> {
  if (!dependencies?.isMainWebContents(sender)) {
    throw new Error("Pet state updates are only accepted from a Paseo app window.");
  }
  const state = readDesktopPetOverlayState(rawState);
  if (!state) throw new Error("Invalid desktop pet state.");
  latestState = state;
  if (!state.visible) {
    trayOpen = false;
    petWindow?.setFocusable(false);
    petWindow?.hide();
    return;
  }
  const win = await ensurePetWindow();
  showLatestState(win);
}

function isPetSender(sender: WebContents): boolean {
  return Boolean(petWindow && !petWindow.isDestroyed() && petWindow.webContents === sender);
}

function readDragPoint(
  input: unknown,
): { phase: "start" | "move" | "end"; x: number; y: number } | null {
  if (!input || typeof input !== "object") return null;
  const { phase, x, y } = input as { phase?: unknown; x?: unknown; y?: unknown };
  if (
    (phase !== "start" && phase !== "move" && phase !== "end") ||
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    typeof y !== "number" ||
    !Number.isFinite(y)
  ) {
    return null;
  }
  return { phase, x, y };
}

function handlePetDrag(sender: WebContents, rawPoint: unknown): void {
  if (!isPetSender(sender) || !petWindow || isWayland()) return;
  const point = readDragPoint(rawPoint);
  if (!point) return;
  if (point.phase === "start") {
    const [windowX, windowY] = petWindow.getPosition();
    dragState = { pointerX: point.x, pointerY: point.y, windowX, windowY };
    return;
  }
  if (!dragState) return;
  if (point.phase === "move") {
    const deltaX = point.x - dragState.pointerX;
    const deltaY = point.y - dragState.pointerY;
    if (Math.abs(deltaX) <= 10_000 && Math.abs(deltaY) <= 10_000) {
      petWindow.setPosition(
        Math.round(dragState.windowX + deltaX),
        Math.round(dragState.windowY + deltaY),
      );
    }
    return;
  }
  dragState = null;
  if (latestState.visible) applyWindowBounds(petWindow, latestState);
  schedulePositionSave(petWindow);
}

async function importPetFromDirectory(sender: WebContents): Promise<unknown> {
  if (!dependencies?.isMainWebContents(sender)) {
    throw new Error("Pet imports are only accepted from a Paseo app window.");
  }
  const parent = BrowserWindow.fromWebContents(sender);
  if (!parent) throw new Error("The Paseo window is unavailable.");
  const result = await dialog.showOpenDialog(parent, {
    properties: ["openDirectory"],
  });
  const directory = result.canceled ? null : (result.filePaths[0] ?? null);
  return directory ? await readDesktopPetImport(directory) : null;
}

export function registerPetWindowManager(nextDependencies: PetWindowManagerDependencies): void {
  dependencies = nextDependencies;
  if (registered) return;
  registered = true;

  ipcMain.handle("paseo:pet:update-state", (event, state: unknown) =>
    updatePetState(state, event.sender),
  );
  ipcMain.handle("paseo:pet:import", (event) => importPetFromDirectory(event.sender));
  ipcMain.handle("paseo:pet:main-renderer-ready", (event) => {
    if (!dependencies?.isMainWebContents(event.sender)) return;
    return dependencies.onMainRendererReady(event.sender);
  });
  ipcMain.handle("paseo:pet:set-tray-open", (event, open: unknown) => {
    if (!isPetSender(event.sender) || typeof open !== "boolean" || !petWindow) return;
    trayOpen = open && latestState.visible && latestState.activities.length > 0;
    if (latestState.visible) applyWindowBounds(petWindow, latestState);
    petWindow.setFocusable(trayOpen);
    if (trayOpen) petWindow.focus();
  });
  ipcMain.handle("paseo:pet:open-activity", async (event, key: unknown) => {
    if (!isPetSender(event.sender) || typeof key !== "string" || !latestState.visible) return;
    const activity = latestState.activities.find((candidate) => candidate.key === key);
    if (activity) await dependencies?.onOpenActivity(activity);
  });
  ipcMain.on("paseo:pet:overlay-ready", (event) => {
    if (!isPetSender(event.sender) || !petWindow) return;
    overlayReady = true;
    showLatestState(petWindow);
  });
  ipcMain.on("paseo:pet:drag", (event, point: unknown) => handlePetDrag(event.sender, point));
}

export function destroyPetWindow(): void {
  if (positionSaveTimer) {
    clearTimeout(positionSaveTimer);
    positionSaveTimer = null;
  }
  if (petWindow && !petWindow.isDestroyed()) petWindow.destroy();
  petWindow = null;
  overlayReady = false;
  dragState = null;
}
