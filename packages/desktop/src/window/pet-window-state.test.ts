import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_DESKTOP_PET_ACTIVITIES,
  createPetPositionStore,
  readDesktopPetOverlayState,
  resolvePetWindowBounds,
  resolvePetWindowSize,
  type DesktopPetActivity,
} from "./pet-window-state";

const activity: DesktopPetActivity = {
  key: "host:agent",
  serverId: "host",
  agentId: "agent",
  workspaceId: "workspace",
  title: "Fix the build",
  hostLabel: "My Mac",
  status: "running",
  statusLabel: "Running",
};

const visibleState = {
  visible: true as const,
  spritesheetUrl: "http://127.0.0.1:6768/api/pets/mofu/spritesheet",
  rows: 9,
  lifecycle: "running" as const,
  size: 112,
  totalActivityCount: 1,
  trayTitle: "Active chats",
  activities: [activity],
};

describe("readDesktopPetOverlayState", () => {
  it("accepts a bounded visible snapshot", () => {
    expect(readDesktopPetOverlayState(visibleState)).toEqual(visibleState);
  });

  it("accepts an explicit hidden snapshot without asset fields", () => {
    expect(
      readDesktopPetOverlayState({ visible: false, spritesheetUrl: "file:///etc/passwd" }),
    ).toEqual({ visible: false });
  });

  it("rejects file URLs and invalid lifecycle values", () => {
    expect(
      readDesktopPetOverlayState({ ...visibleState, spritesheetUrl: "file:///etc/passwd" }),
    ).toBeNull();
    expect(readDesktopPetOverlayState({ ...visibleState, lifecycle: "unknown" })).toBeNull();
  });

  it("accepts only bounded Bearer authorization headers", () => {
    expect(
      readDesktopPetOverlayState({
        ...visibleState,
        spritesheetAuthorizationHeader: "Bearer shared-secret",
      }),
    ).toMatchObject({ spritesheetAuthorizationHeader: "Bearer shared-secret" });
    expect(
      readDesktopPetOverlayState({
        ...visibleState,
        spritesheetAuthorizationHeader: "Bearer secret\r\nx-injected: yes",
      }),
    ).toBeNull();
    expect(
      readDesktopPetOverlayState({ ...visibleState, spritesheetAuthorizationHeader: "Basic x" }),
    ).toBeNull();
  });

  it("clamps the pet size and bounds activity rows", () => {
    const state = readDesktopPetOverlayState({
      ...visibleState,
      size: 10_000,
      totalActivityCount: 25,
      activities: Array.from({ length: 25 }, (_, index) => ({
        ...activity,
        key: `host:agent-${index}`,
        agentId: `agent-${index}`,
      })),
    });
    expect(state?.visible).toBe(true);
    if (!state?.visible) return;
    expect(state.size).toBe(224);
    expect(state.activities).toHaveLength(MAX_DESKTOP_PET_ACTIVITIES);
    expect(state.totalActivityCount).toBe(25);
  });
});

describe("pet window geometry", () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1080 };

  it("opens at the bottom-right of the primary work area", () => {
    const size = resolvePetWindowSize(visibleState, false);
    expect(resolvePetWindowBounds({ size, anchor: null, workAreas: [primary] })).toEqual({
      x: 1920 - 24 - size.width,
      y: 1080 - 24 - size.height,
      ...size,
    });
  });

  it("expands the tray left and up while preserving the pet anchor", () => {
    const closedSize = resolvePetWindowSize(visibleState, false);
    const closed = resolvePetWindowBounds({ size: closedSize, anchor: null, workAreas: [primary] });
    const anchor = { right: closed.x + closed.width, bottom: closed.y + closed.height };
    const openSize = resolvePetWindowSize(visibleState, true);
    const open = resolvePetWindowBounds({ size: openSize, anchor, workAreas: [primary] });

    expect(open.x + open.width).toBe(anchor.right);
    expect(open.y + open.height).toBe(anchor.bottom);
    expect(open.width).toBeGreaterThan(closed.width);
  });

  it("falls back to the primary display for an off-screen saved anchor", () => {
    const size = resolvePetWindowSize(visibleState, false);
    const bounds = resolvePetWindowBounds({
      size,
      anchor: { right: 9000, bottom: 9000 },
      workAreas: [primary],
    });
    expect(bounds.x + bounds.width).toBe(primary.width - 24);
    expect(bounds.y + bounds.height).toBe(primary.height - 24);
  });
});

describe("pet position store", () => {
  const directories = new Set<string>();

  afterEach(async () => {
    await Promise.all(
      [...directories].map((directory) => rm(directory, { recursive: true, force: true })),
    );
    directories.clear();
  });

  it("round-trips the bottom-right anchor", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "paseo-pet-position-"));
    directories.add(directory);
    const store = createPetPositionStore(directory);
    await store.save({ right: 1800, bottom: 980 });
    expect(await store.load()).toEqual({ right: 1800, bottom: 980 });
  });
});
