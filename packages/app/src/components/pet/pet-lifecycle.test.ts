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

  // The reason the pet existed but never worked: a finished agent's status is still
  // `idle`, and one awaiting a permission prompt is still `running`. Reading status
  // alone, `completed` and `needs_input` are unreachable.
  it("lets attention win over status", () => {
    expect(agentPetLifecycle({ status: "idle", attentionReason: "finished" })).toBe("completed");
    expect(agentPetLifecycle({ status: "running", attentionReason: "permission" })).toBe(
      "needs_input",
    );
    expect(agentPetLifecycle({ status: "idle", attentionReason: "error" })).toBe("error");
  });

  it("reaches the waving and waiting sprite states, which status alone cannot", () => {
    const done = agentPetLifecycle({ status: "idle", attentionReason: "finished" });
    const blocked = agentPetLifecycle({ status: "running", attentionReason: "permission" });
    expect(petStateForLifecycle(done)).toBe("waving");
    expect(petStateForLifecycle(blocked)).toBe("waiting");
  });

  it("never returns a lifecycle the sprite cannot render", () => {
    const statuses = ["initializing", "idle", "running", "error", "closed"] as const;
    const reasons = [null, "finished", "error", "permission"] as const;
    for (const status of statuses) {
      for (const attentionReason of reasons) {
        expect(() =>
          petStateForLifecycle(agentPetLifecycle({ status, attentionReason })),
        ).not.toThrow();
      }
    }
  });
});
