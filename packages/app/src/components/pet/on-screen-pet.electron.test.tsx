/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnScreenPet } from "./on-screen-pet.electron";

const mocks = vi.hoisted(() => ({
  desktopEventHandler: null as ((payload: unknown) => void) | null,
  markReady: vi.fn(async () => undefined),
  navigate: vi.fn(),
  updateOverlay: vi.fn(async () => undefined),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "pet.activity.status.needsInput": "Needs input",
        "pet.activity.status.blocked": "Blocked",
        "pet.activity.status.ready": "Ready",
        "pet.activity.status.running": "Running",
        "pet.activity.untitled": "Untitled chat",
        "pet.activity.title": "Active chats",
      })[key] ?? key,
  }),
}));

vi.mock("@/desktop/pets/desktop-pet-bridge", () => ({
  updateDesktopPetOverlay: mocks.updateOverlay,
  markDesktopPetRendererReady: mocks.markReady,
}));

vi.mock("@/desktop/electron/events", () => ({
  listenToDesktopEvent: async (_event: string, handler: (payload: unknown) => void) => {
    mocks.desktopEventHandler = handler;
    return () => {
      mocks.desktopEventHandler = null;
    };
  },
}));

vi.mock("@/hooks/use-aggregated-agents", () => ({
  useAggregatedAgents: () => ({ agents: [] }),
}));

vi.mock("@/hooks/use-codex-pets", () => ({
  useCodexPets: () => ({
    petForProvider: () => ({
      id: "mofu",
      displayName: "Mofu",
      spritesheetUrl: "http://host/api/pets/mofu/spritesheet",
      rows: 9,
    }),
  }),
}));

vi.mock("@/hooks/use-server-http-base-url", () => ({
  useServerHttpBaseUrl: () => "http://host",
  useServerHttpAuthorizationHeader: () => "Bearer secret",
}));

vi.mock("@/hooks/use-settings", () => ({
  useAppSettings: () => ({ settings: { selectedPetId: "mofu", petSize: 160 } }),
}));

vi.mock("@/utils/navigate-to-agent", () => ({ navigateToAgent: mocks.navigate }));
vi.mock("./pet-assignment", () => ({ PASEO_COMPANION_PET_KEY: "paseo-companion" }));
vi.mock("./on-screen-pet-model", () => ({
  selectOnScreenPetModel: () => ({
    lifecycle: "running",
    counts: { needs_input: 0, failed: 0, attention: 0, running: 1 },
    primary: null,
    activities: [
      {
        key: "host:agent",
        serverId: "host",
        agentId: "agent",
        workspaceId: "workspace",
        title: "Fix the build",
        cwd: "/repo",
        serverLabel: "My Mac",
        bucket: "running",
      },
    ],
  }),
}));

describe("OnScreenPet Electron bridge", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.desktopEventHandler = null;
    mocks.markReady.mockClear();
    mocks.navigate.mockClear();
    mocks.updateOverlay.mockClear();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("publishes selected art, size, authorization, and ordered activities", async () => {
    await act(async () => {
      root.render(<OnScreenPet serverId="host" visible />);
    });

    expect(mocks.updateOverlay).toHaveBeenCalledWith({
      visible: true,
      spritesheetUrl: "http://host/api/pets/mofu/spritesheet",
      spritesheetAuthorizationHeader: "Bearer secret",
      rows: 9,
      lifecycle: "running",
      size: 160,
      totalActivityCount: 1,
      trayTitle: "Active chats",
      activities: [
        {
          key: "host:agent",
          serverId: "host",
          agentId: "agent",
          workspaceId: "workspace",
          title: "Fix the build",
          hostLabel: "My Mac",
          status: "running",
          statusLabel: "Running",
        },
      ],
    });
    expect(mocks.markReady).toHaveBeenCalledOnce();
  });

  it("routes a selected desktop activity back into Paseo", async () => {
    await act(async () => {
      root.render(<OnScreenPet serverId="host" visible />);
    });
    mocks.desktopEventHandler?.({
      key: "host:agent",
      serverId: "host",
      agentId: "agent",
      workspaceId: "workspace",
    });

    expect(mocks.navigate).toHaveBeenCalledWith({
      serverId: "host",
      agentId: "agent",
      workspaceId: "workspace",
      pin: true,
    });
  });
});
