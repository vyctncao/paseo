import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const MIN_DESKTOP_PET_SIZE = 80;
export const MAX_DESKTOP_PET_SIZE = 224;
export const MAX_DESKTOP_PET_ACTIVITIES = 20;
export const PET_TRAY_WIDTH = 320;

const PET_CELL_ASPECT_RATIO = 208 / 192;
const PET_WINDOW_PADDING = 8;
const PET_TRAY_GAP = 8;
const PET_TRAY_HEADER_HEIGHT = 46;
const PET_TRAY_ROW_HEIGHT = 56;
const PET_TRAY_MAX_HEIGHT = 420;
const DEFAULT_SCREEN_EDGE_MARGIN = 24;
const PET_POSITION_FILENAME = "pet-window-position.json";

export type DesktopPetLifecycle =
  | "idle"
  | "running"
  | "thinking"
  | "needs_input"
  | "error"
  | "completed";
export type DesktopPetActivityStatus = "needs_input" | "failed" | "attention" | "running";

export interface DesktopPetActivity {
  key: string;
  serverId: string;
  agentId: string;
  workspaceId: string | null;
  title: string;
  hostLabel: string;
  status: DesktopPetActivityStatus;
  statusLabel: string;
}

export type DesktopPetOverlayState =
  | { visible: false }
  | {
      visible: true;
      spritesheetUrl: string;
      spritesheetAuthorizationHeader?: string;
      rows: number;
      lifecycle: DesktopPetLifecycle;
      size: number;
      totalActivityCount: number;
      trayTitle: string;
      activities: DesktopPetActivity[];
    };

export interface PetWindowAnchor {
  right: number;
  bottom: number;
}

export interface PetWindowRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PetPositionStore {
  load(): Promise<PetWindowAnchor | null>;
  save(anchor: PetWindowAnchor): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result.length > 0 && result.length <= maxLength ? result : null;
}

function readNullableBoundedString(value: unknown, maxLength: number): string | null | undefined {
  if (value === null || value === undefined) return null;
  const result = readBoundedString(value, maxLength);
  return result ?? undefined;
}

function readSpritesheetUrl(value: unknown): string | null {
  const raw = readBoundedString(value, 4096);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "paseo:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function readAuthorizationHeader(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    value.includes("\r") ||
    value.includes("\n")
  ) {
    return undefined;
  }
  const header = value.trim();
  return header.startsWith("Bearer ") && header.slice("Bearer ".length).trim().length > 0
    ? header
    : undefined;
}

const LIFECYCLES = new Set<DesktopPetLifecycle>([
  "idle",
  "running",
  "thinking",
  "needs_input",
  "error",
  "completed",
]);
const ACTIVITY_STATUSES = new Set<DesktopPetActivityStatus>([
  "needs_input",
  "failed",
  "attention",
  "running",
]);

function readActivity(input: unknown): DesktopPetActivity | null {
  if (!isRecord(input)) return null;
  const key = readBoundedString(input.key, 500);
  const serverId = readBoundedString(input.serverId, 300);
  const agentId = readBoundedString(input.agentId, 300);
  const workspaceId = readNullableBoundedString(input.workspaceId, 300);
  const title = readBoundedString(input.title, 500);
  const hostLabel = readBoundedString(input.hostLabel, 300);
  const statusLabel = readBoundedString(input.statusLabel, 100);
  const status = input.status;
  if (
    !key ||
    !serverId ||
    !agentId ||
    workspaceId === undefined ||
    !title ||
    !hostLabel ||
    !statusLabel ||
    typeof status !== "string" ||
    !ACTIVITY_STATUSES.has(status as DesktopPetActivityStatus)
  ) {
    return null;
  }
  return {
    key,
    serverId,
    agentId,
    workspaceId,
    title,
    hostLabel,
    status: status as DesktopPetActivityStatus,
    statusLabel,
  };
}

export function readDesktopPetOverlayState(input: unknown): DesktopPetOverlayState | null {
  if (!isRecord(input) || typeof input.visible !== "boolean") return null;
  if (!input.visible) return { visible: false };

  const spritesheetUrl = readSpritesheetUrl(input.spritesheetUrl);
  const spritesheetAuthorizationHeader = readAuthorizationHeader(
    input.spritesheetAuthorizationHeader,
  );
  const rows = input.rows;
  const lifecycle = input.lifecycle;
  const size = input.size;
  const totalActivityCount = input.totalActivityCount;
  const trayTitle = readBoundedString(input.trayTitle, 100);
  if (
    !spritesheetUrl ||
    spritesheetAuthorizationHeader === undefined ||
    typeof rows !== "number" ||
    !Number.isSafeInteger(rows) ||
    rows < 9 ||
    rows > 32 ||
    typeof lifecycle !== "string" ||
    !LIFECYCLES.has(lifecycle as DesktopPetLifecycle) ||
    typeof size !== "number" ||
    !Number.isFinite(size) ||
    typeof totalActivityCount !== "number" ||
    !Number.isSafeInteger(totalActivityCount) ||
    totalActivityCount < 0 ||
    !trayTitle
  ) {
    return null;
  }

  const activities = Array.isArray(input.activities)
    ? input.activities
        .slice(0, MAX_DESKTOP_PET_ACTIVITIES)
        .map(readActivity)
        .filter((activity): activity is DesktopPetActivity => activity !== null)
    : [];
  return {
    visible: true,
    spritesheetUrl,
    ...(spritesheetAuthorizationHeader ? { spritesheetAuthorizationHeader } : {}),
    rows,
    lifecycle: lifecycle as DesktopPetLifecycle,
    size: Math.min(MAX_DESKTOP_PET_SIZE, Math.max(MIN_DESKTOP_PET_SIZE, Math.round(size))),
    totalActivityCount,
    trayTitle,
    activities,
  };
}

export function resolvePetWindowSize(
  state: Extract<DesktopPetOverlayState, { visible: true }>,
  trayOpen: boolean,
): { width: number; height: number } {
  const spriteHeight = Math.ceil(state.size * PET_CELL_ASPECT_RATIO);
  const closedWidth = state.size + PET_WINDOW_PADDING * 2;
  const closedHeight = spriteHeight + PET_WINDOW_PADDING * 2;
  if (!trayOpen) return { width: closedWidth, height: closedHeight };

  const trayHeight = Math.min(
    PET_TRAY_MAX_HEIGHT,
    PET_TRAY_HEADER_HEIGHT + Math.max(1, state.activities.length) * PET_TRAY_ROW_HEIGHT,
  );
  return {
    width: closedWidth + PET_TRAY_GAP + PET_TRAY_WIDTH,
    height: Math.max(closedHeight, trayHeight),
  };
}

function containsAnchor(workArea: PetWindowRectangle, anchor: PetWindowAnchor): boolean {
  return (
    anchor.right >= workArea.x &&
    anchor.right <= workArea.x + workArea.width &&
    anchor.bottom >= workArea.y &&
    anchor.bottom <= workArea.y + workArea.height
  );
}

export function resolvePetWindowBounds(input: {
  size: { width: number; height: number };
  anchor: PetWindowAnchor | null;
  workAreas: readonly PetWindowRectangle[];
}): PetWindowRectangle {
  const primary = input.workAreas[0] ?? {
    x: 0,
    y: 0,
    width: input.size.width + DEFAULT_SCREEN_EDGE_MARGIN * 2,
    height: input.size.height + DEFAULT_SCREEN_EDGE_MARGIN * 2,
  };
  const target =
    (input.anchor
      ? input.workAreas.find((workArea) => containsAnchor(workArea, input.anchor!))
      : null) ?? primary;
  const defaultAnchor = {
    right: target.x + target.width - DEFAULT_SCREEN_EDGE_MARGIN,
    bottom: target.y + target.height - DEFAULT_SCREEN_EDGE_MARGIN,
  };
  const anchor =
    input.anchor && containsAnchor(target, input.anchor) ? input.anchor : defaultAnchor;
  const width = Math.min(input.size.width, target.width);
  const height = Math.min(input.size.height, target.height);
  const x = Math.min(Math.max(anchor.right - width, target.x), target.x + target.width - width);
  const y = Math.min(Math.max(anchor.bottom - height, target.y), target.y + target.height - height);
  return { x, y, width, height };
}

function coerceAnchor(input: unknown): PetWindowAnchor | null {
  if (!isRecord(input)) return null;
  if (
    typeof input.right !== "number" ||
    !Number.isFinite(input.right) ||
    typeof input.bottom !== "number" ||
    !Number.isFinite(input.bottom)
  ) {
    return null;
  }
  return { right: Math.round(input.right), bottom: Math.round(input.bottom) };
}

export function createPetPositionStore(userDataPath: string): PetPositionStore {
  const filePath = path.join(userDataPath, PET_POSITION_FILENAME);
  let persistQueue = Promise.resolve();
  return {
    async load(): Promise<PetWindowAnchor | null> {
      try {
        const document = JSON.parse(await readFile(filePath, "utf8")) as unknown;
        return isRecord(document) ? coerceAnchor(document.position) : null;
      } catch (error) {
        if (error instanceof SyntaxError) return null;
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async save(anchor: PetWindowAnchor): Promise<void> {
      const contents = `${JSON.stringify({ version: 1, position: anchor }, null, 2)}\n`;
      const write = async () => {
        await mkdir(userDataPath, { recursive: true });
        const tempPath = `${filePath}.tmp.${process.pid}.${randomUUID()}`;
        await writeFile(tempPath, contents, "utf8");
        await rename(tempPath, filePath);
      };
      const queued = persistQueue.then(write, write);
      persistQueue = queued.catch(() => undefined);
      await queued;
    },
  };
}
