import { describe, expect, it } from "vitest";
import type { AgentLifecycleStatus } from "@getpaseo/protocol/agent-lifecycle";
import { selectOnScreenPetModel, type OnScreenPetCandidate } from "./on-screen-pet-model";

function candidate(
  id: string,
  overrides: Partial<OnScreenPetCandidate> = {},
): OnScreenPetCandidate {
  return {
    id,
    serverId: "server-a",
    serverLabel: "Mac",
    workspaceId: `workspace-${id}`,
    cwd: `/repo/${id}`,
    title: id,
    status: "idle" as AgentLifecycleStatus,
    pendingPermissionCount: 0,
    requiresAttention: false,
    attentionReason: null,
    lastActivityAt: new Date("2026-07-10T12:00:00.000Z"),
    ...overrides,
  };
}

describe("selectOnScreenPetModel", () => {
  it("keeps the companion idle when no chat has activity", () => {
    expect(selectOnScreenPetModel({ agents: [candidate("idle")] })).toEqual({
      primary: null,
      lifecycle: "idle",
      activities: [],
      counts: { needs_input: 0, failed: 0, attention: 0, running: 0 },
    });
  });

  it("uses Codex activity priority across every host and provider", () => {
    const model = selectOnScreenPetModel({
      agents: [
        candidate("running", { status: "running" }),
        candidate("ready", { requiresAttention: true, attentionReason: "finished" }),
        candidate("blocked", { status: "error" }),
        candidate("needs-input", {
          serverId: "server-b",
          serverLabel: "Studio",
          status: "running",
          pendingPermissionCount: 1,
        }),
      ],
    });

    expect(model.activities.map((activity) => activity.agentId)).toEqual([
      "needs-input",
      "blocked",
      "ready",
      "running",
    ]);
    expect(model.primary?.serverId).toBe("server-b");
    expect(model.lifecycle).toBe("needs_input");
    expect(model.counts).toEqual({ needs_input: 1, failed: 1, attention: 1, running: 1 });
  });

  it("includes initializing chats as running activity with a thinking animation", () => {
    const model = selectOnScreenPetModel({
      agents: [candidate("starting", { status: "initializing" })],
    });

    expect(model.primary).toMatchObject({
      agentId: "starting",
      bucket: "running",
      lifecycle: "thinking",
    });
  });

  it("treats a fresh run as running despite stale finished attention", () => {
    const model = selectOnScreenPetModel({
      agents: [
        candidate("again", {
          status: "running",
          requiresAttention: true,
          attentionReason: "finished",
        }),
      ],
    });

    expect(model.primary).toMatchObject({ bucket: "running", lifecycle: "running" });
  });

  it("sorts equal-priority activity newest first, then by a stable composite key", () => {
    const model = selectOnScreenPetModel({
      agents: [
        candidate("z", { status: "running" }),
        candidate("new", {
          status: "running",
          lastActivityAt: new Date("2026-07-10T12:05:00.000Z"),
        }),
        candidate("a", { status: "running" }),
      ],
    });

    expect(model.activities.map((activity) => activity.agentId)).toEqual(["new", "a", "z"]);
  });
});
