import { ipcRenderer } from "electron";

type PetLifecycle = "idle" | "running" | "thinking" | "needs_input" | "error" | "completed";
type PetState =
  | "idle"
  | "running-right"
  | "running-left"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review";

interface PetActivity {
  key: string;
  title: string;
  hostLabel: string;
  status: "needs_input" | "failed" | "attention" | "running";
  statusLabel: string;
}

interface VisiblePetState {
  visible: true;
  spritesheetUrl: string;
  spritesheetAuthorizationHeader?: string;
  rows: number;
  lifecycle: PetLifecycle;
  size: number;
  totalActivityCount: number;
  trayTitle: string;
  activities: PetActivity[];
  useNativeWindowDrag?: boolean;
}

type PetOverlayState = { visible: false } | VisiblePetState;

const FRAME_DURATIONS: Readonly<Record<PetState, readonly number[]>> = {
  idle: [280, 110, 110, 140, 140, 320],
  "running-right": [120, 120, 120, 120, 120, 120, 120, 220],
  "running-left": [120, 120, 120, 120, 120, 120, 120, 220],
  waving: [140, 140, 140, 280],
  jumping: [140, 140, 140, 140, 280],
  failed: [140, 140, 140, 140, 140, 140, 140, 240],
  waiting: [150, 150, 150, 150, 150, 260],
  running: [120, 120, 120, 120, 120, 220],
  review: [150, 150, 150, 150, 150, 280],
};
const STATE_ROWS: Readonly<Record<PetState, number>> = {
  idle: 0,
  "running-right": 1,
  "running-left": 2,
  waving: 3,
  jumping: 4,
  failed: 5,
  waiting: 6,
  running: 7,
  review: 8,
};
const WAVE_SETTLE_MS = 4_000;
const DRAG_THRESHOLD_PX = 4;

function petStateForLifecycle(lifecycle: PetLifecycle): PetState {
  switch (lifecycle) {
    case "running":
    case "thinking":
      return "running";
    case "needs_input":
      return "waiting";
    case "error":
      return "failed";
    case "completed":
      return "waving";
    case "idle":
      return "idle";
  }
}

function installStyle(): void {
  const style = document.createElement("style");
  style.textContent = `
    :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; user-select: none; }
    button { font: inherit; }
    #pet-shell { width: 100%; height: 100%; display: flex; align-items: flex-end; justify-content: flex-end; gap: 8px; padding: 0; }
    #pet-tray { display: none; width: 320px; max-height: 100%; overflow: auto; border: 1px solid rgba(127,127,127,.28); border-radius: 14px; background: rgba(24,27,26,.96); color: #f4f4f5; box-shadow: 0 12px 34px rgba(0,0,0,.32); -webkit-app-region: no-drag; }
    #pet-shell.tray-open #pet-tray { display: block; }
    #pet-tray-title { height: 46px; display: flex; align-items: center; padding: 0 14px; color: #d4d4d8; font-size: 13px; font-weight: 650; border-bottom: 1px solid rgba(127,127,127,.2); }
    #pet-activities { display: flex; flex-direction: column; }
    .pet-activity { width: 100%; min-height: 56px; display: grid; grid-template-columns: 10px minmax(0,1fr); gap: 10px; align-items: center; padding: 8px 12px; border: 0; border-bottom: 1px solid rgba(127,127,127,.14); color: inherit; text-align: left; background: transparent; cursor: pointer; }
    .pet-activity:last-child { border-bottom: 0; }
    .pet-activity:hover, .pet-activity:focus-visible { background: rgba(255,255,255,.08); outline: none; }
    .pet-status { width: 9px; height: 9px; border-radius: 999px; background: #3b82f6; }
    .pet-status.needs_input { background: #f59e0b; }
    .pet-status.failed { background: #ef4444; }
    .pet-status.attention { background: #22c55e; }
    .pet-activity-copy { min-width: 0; }
    .pet-activity-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; }
    .pet-activity-description { margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #a1a1aa; font-size: 11px; }
    #pet-stage { position: relative; flex: none; display: flex; align-items: flex-end; justify-content: center; padding: 8px; cursor: grab; -webkit-app-region: no-drag; }
    #pet-stage.dragging { cursor: grabbing; }
    #pet-viewport { position: relative; overflow: hidden; pointer-events: none; }
    #pet-sheet { position: absolute; max-width: none; image-rendering: pixelated; pointer-events: none; }
    #pet-badge { position: absolute; top: 4px; right: 4px; min-width: 24px; height: 24px; display: none; align-items: center; justify-content: center; padding: 0 6px; border: 2px solid rgba(24,27,26,.95); border-radius: 999px; color: white; background: #6366f1; font-size: 11px; font-weight: 700; cursor: pointer; -webkit-app-region: no-drag; }
    #pet-badge.visible { display: flex; }
    @media (prefers-color-scheme: light) {
      #pet-tray { background: rgba(255,255,255,.97); color: #18181b; box-shadow: 0 12px 34px rgba(0,0,0,.18); }
      #pet-tray-title { color: #3f3f46; }
      .pet-activity:hover, .pet-activity:focus-visible { background: rgba(0,0,0,.06); }
      .pet-activity-description { color: #71717a; }
      #pet-badge { border-color: rgba(255,255,255,.95); }
    }
  `;
  document.head.appendChild(style);
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  id?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (id) element.id = id;
  return element;
}

function mountOverlay(): void {
  installStyle();
  const shell = createElement("main", "pet-shell");
  const tray = createElement("section", "pet-tray");
  const trayTitle = createElement("div", "pet-tray-title");
  const activities = createElement("div", "pet-activities");
  tray.append(trayTitle, activities);

  const stage = createElement("div", "pet-stage");
  const viewport = createElement("div", "pet-viewport");
  const sheet = createElement("img", "pet-sheet");
  sheet.alt = "";
  sheet.draggable = false;
  viewport.appendChild(sheet);
  const badge = createElement("button", "pet-badge");
  badge.type = "button";
  stage.append(viewport, badge);
  shell.append(tray, stage);
  document.body.appendChild(shell);

  let current: VisiblePetState | null = null;
  let currentPetState: PetState = "idle";
  let lastLifecycle: PetLifecycle | null = null;
  let lastSpritesheetUrl: string | null = null;
  let loadedSpritesheetIdentity: string | null = null;
  let spritesheetObjectUrl: string | null = null;
  let spritesheetRequest = 0;
  let frame = 0;
  let animationTimer: ReturnType<typeof setTimeout> | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let trayOpen = false;
  let dragStart: { pointerId: number; x: number; y: number; moved: boolean } | null = null;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const clearAnimation = () => {
    if (animationTimer) clearTimeout(animationTimer);
    if (settleTimer) clearTimeout(settleTimer);
    animationTimer = null;
    settleTimer = null;
  };

  const revokeSpritesheetObjectUrl = () => {
    if (!spritesheetObjectUrl) return;
    URL.revokeObjectURL(spritesheetObjectUrl);
    spritesheetObjectUrl = null;
  };

  const loadSpritesheet = (state: VisiblePetState) => {
    const identity = `${state.spritesheetUrl}\n${state.spritesheetAuthorizationHeader ?? ""}`;
    if (loadedSpritesheetIdentity === identity) return;
    loadedSpritesheetIdentity = identity;
    const request = ++spritesheetRequest;
    if (!state.spritesheetAuthorizationHeader) {
      revokeSpritesheetObjectUrl();
      sheet.src = state.spritesheetUrl;
      return;
    }
    void fetch(state.spritesheetUrl, {
      headers: { Authorization: state.spritesheetAuthorizationHeader },
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Pet spritesheet request failed (${response.status})`);
        return await response.blob();
      })
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        if (request !== spritesheetRequest) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        revokeSpritesheetObjectUrl();
        spritesheetObjectUrl = objectUrl;
        sheet.src = objectUrl;
        return undefined;
      })
      .catch((error) => {
        if (request === spritesheetRequest) {
          console.warn("[pet-overlay] Failed to load spritesheet", error);
        }
      });
  };

  const renderFrame = () => {
    if (!current) return;
    const spriteHeight = current.size * (208 / 192);
    sheet.style.width = `${current.size * 8}px`;
    sheet.style.height = `${spriteHeight * current.rows}px`;
    sheet.style.left = `${-frame * current.size}px`;
    sheet.style.top = `${-STATE_ROWS[currentPetState] * spriteHeight}px`;
  };

  const scheduleAnimation = () => {
    if (reducedMotion.matches) return;
    const durations = FRAME_DURATIONS[currentPetState];
    animationTimer = setTimeout(
      () => {
        frame = (frame + 1) % durations.length;
        renderFrame();
        scheduleAnimation();
      },
      durations[frame] ?? durations[0] ?? 120,
    );
  };

  const startAnimation = (nextState: PetState) => {
    clearAnimation();
    currentPetState = nextState;
    frame = 0;
    renderFrame();
    scheduleAnimation();
    if (nextState === "waving") {
      settleTimer = setTimeout(() => startAnimation("idle"), WAVE_SETTLE_MS);
    }
  };

  const setTrayOpen = (open: boolean) => {
    if (trayOpen === open) return;
    trayOpen = open;
    shell.classList.toggle("tray-open", open);
    badge.setAttribute("aria-expanded", String(open));
    void ipcRenderer.invoke("paseo:pet:set-tray-open", open);
  };

  const renderActivities = (state: VisiblePetState) => {
    trayTitle.textContent = state.trayTitle;
    activities.replaceChildren();
    for (const activity of state.activities) {
      const button = createElement("button");
      button.type = "button";
      button.className = "pet-activity";
      const dot = createElement("span");
      dot.className = `pet-status ${activity.status}`;
      const copy = createElement("span");
      copy.className = "pet-activity-copy";
      const title = createElement("div");
      title.className = "pet-activity-title";
      title.textContent = activity.title;
      const description = createElement("div");
      description.className = "pet-activity-description";
      description.textContent = `${activity.statusLabel} · ${activity.hostLabel}`;
      copy.append(title, description);
      button.append(dot, copy);
      button.addEventListener("click", () => {
        void ipcRenderer.invoke("paseo:pet:open-activity", activity.key);
        setTrayOpen(false);
      });
      activities.appendChild(button);
    }
  };

  const renderState = (state: PetOverlayState) => {
    if (!state.visible) {
      current = null;
      lastLifecycle = null;
      lastSpritesheetUrl = null;
      clearAnimation();
      loadedSpritesheetIdentity = null;
      spritesheetRequest += 1;
      revokeSpritesheetObjectUrl();
      sheet.removeAttribute("src");
      return;
    }
    current = state;
    const spriteHeight = state.size * (208 / 192);
    stage.style.width = `${state.size + 16}px`;
    stage.style.height = `${Math.ceil(spriteHeight) + 16}px`;
    stage.style.setProperty("-webkit-app-region", state.useNativeWindowDrag ? "drag" : "no-drag");
    viewport.style.width = `${state.size}px`;
    viewport.style.height = `${spriteHeight}px`;
    loadSpritesheet(state);
    const count = state.totalActivityCount;
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.classList.toggle("visible", count > 0);
    badge.setAttribute("aria-label", `${state.trayTitle}: ${count}`);
    renderActivities(state);
    if (count === 0 && trayOpen) setTrayOpen(false);
    const shouldRestartAnimation =
      lastLifecycle !== state.lifecycle || lastSpritesheetUrl !== state.spritesheetUrl;
    lastLifecycle = state.lifecycle;
    lastSpritesheetUrl = state.spritesheetUrl;
    if (shouldRestartAnimation) {
      startAnimation(petStateForLifecycle(state.lifecycle));
    } else {
      renderFrame();
    }
  };

  badge.addEventListener("click", (event) => {
    event.stopPropagation();
    if (current?.totalActivityCount) setTrayOpen(!trayOpen);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && trayOpen) {
      event.preventDefault();
      setTrayOpen(false);
    }
  });

  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target === badge) return;
    dragStart = { pointerId: event.pointerId, x: event.screenX, y: event.screenY, moved: false };
    stage.setPointerCapture(event.pointerId);
    ipcRenderer.send("paseo:pet:drag", { phase: "start", x: event.screenX, y: event.screenY });
  });
  stage.addEventListener("pointermove", (event) => {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    if (
      !dragStart.moved &&
      Math.hypot(event.screenX - dragStart.x, event.screenY - dragStart.y) >= DRAG_THRESHOLD_PX
    ) {
      dragStart.moved = true;
      stage.classList.add("dragging");
    }
    if (dragStart.moved) {
      ipcRenderer.send("paseo:pet:drag", { phase: "move", x: event.screenX, y: event.screenY });
    }
  });
  const finishDrag = (event: PointerEvent) => {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    const moved = dragStart.moved;
    dragStart = null;
    stage.classList.remove("dragging");
    ipcRenderer.send("paseo:pet:drag", { phase: "end", x: event.screenX, y: event.screenY });
    if (!moved && current?.totalActivityCount) setTrayOpen(!trayOpen);
  };
  stage.addEventListener("pointerup", finishDrag);
  stage.addEventListener("pointercancel", finishDrag);

  reducedMotion.addEventListener("change", () => {
    if (current) startAnimation(currentPetState);
  });
  ipcRenderer.on("paseo:pet:state", (_event, state: PetOverlayState) => renderState(state));
  ipcRenderer.send("paseo:pet:overlay-ready");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountOverlay, { once: true });
} else {
  mountOverlay();
}
