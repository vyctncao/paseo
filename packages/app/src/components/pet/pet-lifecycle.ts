import type { AgentLifecycleStatus } from "@getpaseo/protocol/agent-lifecycle";
import type { AgentPetLifecycle } from "./pet-sprite";

/**
 * Maps an agent's real daemon state onto the lifecycle a pet reacts to.
 *
 * The two vocabularies deliberately do not match. `AgentLifecycleStatus` is only
 * `initializing | idle | running | error | closed` — it has no "waiting on you" and
 * no "just finished". Pending permissions and `attentionReason` carry those more
 * specific signals, and without folding them in the pet can never reliably reach
 * its `waiting` or `waving` states. A fresh run still outranks stale completion
 * attention left from the previous turn.
 */
export interface AgentPetLifecycleInput {
  status: AgentLifecycleStatus;
  pendingPermissionCount?: number;
  attentionReason?: "finished" | "error" | "permission" | null;
}

export function agentPetLifecycle(input: AgentPetLifecycleInput): AgentPetLifecycle {
  // Pending permissions are the canonical live signal. `attentionReason: permission`
  // remains accepted for snapshots produced by older daemons.
  if ((input.pendingPermissionCount ?? 0) > 0 || input.attentionReason === "permission") {
    return "needs_input";
  }

  if (input.status === "error" || input.attentionReason === "error") {
    return "error";
  }

  // A fresh run outranks unread completion attention left from the previous turn.
  if (input.status === "running") {
    return "running";
  }

  // Startup is work the user is waiting on, but it is not yet the agent running
  // its own loop — `thinking` is the sprite state that reads as "spinning up".
  if (input.status === "initializing") {
    return "thinking";
  }

  if (input.attentionReason === "finished") {
    return "completed";
  }

  return "idle";
}
