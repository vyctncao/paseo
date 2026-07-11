import { describe, expect, it } from "vitest";
import { agentPetLifecycle } from "./pet-lifecycle";
import { petStateForLifecycle } from "./pet-sprite";

describe("agentPetLifecycle", () => {
  it("maps each daemon status when there is no attention reason", () => {
    expect(agentPetLifecycle({ status: "running" })).toBe("running");
    expect(agentPetLifecycle({ status: "error" })).toBe("error");
    expect(agentPetLifecycle({ status: "initializing" })).toBe("thinking");
    expect(agentPetLifecycle({ status: "idle" })).toBe("idle");
    expect(agentPetLifecycle({ status: "closed" })).toBe("idle");
  });

  it("treats a null or absent attention reason as no attention", () => {
    expect(agentPetLifecycle({ status: "running", attentionReason: null })).toBe("running");
    expect(agentPetLifecycle({ status: "running", attentionReason: undefined })).toBe("running");
  });

  // A finished agent's status is still `idle`; reading status alone leaves
  // `completed` unreachable.
  it("lets completion and error attention win over status", () => {
    expect(agentPetLifecycle({ status: "idle", attentionReason: "finished" })).toBe("completed");
    expect(agentPetLifecycle({ status: "idle", attentionReason: "error" })).toBe("error");
  });

  it("keeps legacy permission attention working", () => {
    expect(agentPetLifecycle({ status: "running", attentionReason: "permission" })).toBe(
      "needs_input",
    );
  });

  it("waits whenever the agent has a pending permission", () => {
    expect(
      agentPetLifecycle({
        status: "running",
        attentionReason: null,
        pendingPermissionCount: 1,
      }),
    ).toBe("needs_input");
  });

  it("prioritizes a pending permission over stale completion attention", () => {
    expect(
      agentPetLifecycle({
        status: "idle",
        attentionReason: "finished",
        pendingPermissionCount: 1,
      }),
    ).toBe("needs_input");
  });

  it("shows a new run instead of stale completion attention", () => {
    expect(
      agentPetLifecycle({
        status: "running",
        attentionReason: "finished",
        pendingPermissionCount: 0,
      }),
    ).toBe("running");
  });

  it("reaches the waving and waiting sprite states, which status alone cannot", () => {
    const done = agentPetLifecycle({ status: "idle", attentionReason: "finished" });
    const blocked = agentPetLifecycle({ status: "running", pendingPermissionCount: 1 });
    expect(petStateForLifecycle(done)).toBe("waving");
    expect(petStateForLifecycle(blocked)).toBe("waiting");
  });

  it("never returns a lifecycle the sprite cannot render", () => {
    const statuses = ["initializing", "idle", "running", "error", "closed"] as const;
    const reasons = [null, "finished", "error", "permission"] as const;
    const pendingPermissionCounts = [0, 1] as const;
    for (const status of statuses) {
      for (const attentionReason of reasons) {
        for (const pendingPermissionCount of pendingPermissionCounts) {
          expect(() =>
            petStateForLifecycle(
              agentPetLifecycle({ status, attentionReason, pendingPermissionCount }),
            ),
          ).not.toThrow();
        }
      }
    }
  });
});
