import type { AgentLifecycleStatus } from "@getpaseo/protocol/agent-lifecycle";
import type { AgentPetLifecycle } from "./pet-sprite";

/**
 * Maps an agent's real daemon state onto the lifecycle a pet reacts to.
 *
 * The two vocabularies deliberately do not match. `AgentLifecycleStatus` is only
 * `initializing | idle | running | error | closed` — it has no "waiting on you" and
 * no "just finished". Those arrive on a separate channel, `attentionReason`, and
 * without folding it in the pet can never reach its `waiting` or `waving` states.
 * "Waving when the agent is done" is the whole point of the pet, so attention wins
 * over status wherever the two disagree.
 */
export interface AgentPetLifecycleInput {
  status: AgentLifecycleStatus;
  attentionReason?: "finished" | "error" | "permission" | null;
}

export function agentPetLifecycle(input: AgentPetLifecycleInput): AgentPetLifecycle {
  // Attention is the newer, more specific signal: an agent that finished is still
  // `idle` by status, and one awaiting a permission prompt is still `running`.
  switch (input.attentionReason) {
    case "permission":
      return "needs_input";
    case "finished":
      return "completed";
    case "error":
      return "error";
    default:
      break;
  }

  switch (input.status) {
    case "running":
      return "running";
    case "error":
      return "error";
    // Startup is work the user is waiting on, but it is not yet the agent running
    // its own loop — `thinking` is the sprite state that reads as "spinning up".
    case "initializing":
      return "thinking";
    case "idle":
    case "closed":
      return "idle";
  }
}
