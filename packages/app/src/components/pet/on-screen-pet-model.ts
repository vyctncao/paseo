import type { AgentLifecycleStatus } from "@getpaseo/protocol/agent-lifecycle";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import type { AgentPetLifecycle } from "./pet-sprite";

export type PetActivityBucket = "needs_input" | "failed" | "attention" | "running";

export interface OnScreenPetCandidate {
  id: string;
  serverId: string;
  serverLabel: string;
  workspaceId?: string | null;
  cwd: string;
  title: string | null;
  status: AgentLifecycleStatus;
  pendingPermissionCount?: number;
  requiresAttention?: boolean;
  attentionReason?: "finished" | "error" | "permission" | null;
  lastActivityAt: Date;
}

export interface PetActivityRow {
  key: string;
  agentId: string;
  serverId: string;
  serverLabel: string;
  workspaceId: string | null;
  cwd: string;
  title: string | null;
  bucket: PetActivityBucket;
  lifecycle: AgentPetLifecycle;
  lastActivityAt: Date;
}

export interface OnScreenPetModel {
  primary: PetActivityRow | null;
  lifecycle: AgentPetLifecycle;
  activities: PetActivityRow[];
  counts: Record<PetActivityBucket, number>;
}

const BUCKET_PRIORITY: Readonly<Record<PetActivityBucket, number>> = {
  needs_input: 0,
  failed: 1,
  attention: 2,
  running: 3,
};

function lifecycleForActivity(
  bucket: PetActivityBucket,
  status: AgentLifecycleStatus,
): AgentPetLifecycle {
  switch (bucket) {
    case "needs_input":
      return "needs_input";
    case "failed":
      return "error";
    case "attention":
      return "completed";
    case "running":
      return status === "initializing" ? "thinking" : "running";
  }
}

function emptyCounts(): Record<PetActivityBucket, number> {
  return { needs_input: 0, failed: 0, attention: 0, running: 0 };
}

/**
 * Builds one global activity tray across every host and model. Priority mirrors
 * Codex's companion: needs input, blocked, ready, then running. Idle/read chats
 * are omitted, and ties prefer the newest activity.
 */
export function selectOnScreenPetModel(input: {
  agents: readonly OnScreenPetCandidate[];
}): OnScreenPetModel {
  const activities: PetActivityRow[] = [];
  const counts = emptyCounts();

  for (const agent of input.agents) {
    const derivedBucket = deriveSidebarStateBucket({
      status: agent.status,
      pendingPermissionCount: agent.pendingPermissionCount,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason,
    });
    const bucket =
      derivedBucket === "done" && agent.status === "initializing" ? "running" : derivedBucket;
    if (bucket === "done") continue;

    counts[bucket] += 1;
    activities.push({
      key: `${agent.serverId}:${agent.id}`,
      agentId: agent.id,
      serverId: agent.serverId,
      serverLabel: agent.serverLabel,
      workspaceId: agent.workspaceId ?? null,
      cwd: agent.cwd,
      title: agent.title,
      bucket,
      lifecycle: lifecycleForActivity(bucket, agent.status),
      lastActivityAt: agent.lastActivityAt,
    });
  }

  activities.sort((left, right) => {
    const priority = BUCKET_PRIORITY[left.bucket] - BUCKET_PRIORITY[right.bucket];
    if (priority !== 0) return priority;
    const activity = right.lastActivityAt.getTime() - left.lastActivityAt.getTime();
    if (activity !== 0) return activity;
    return left.key.localeCompare(right.key);
  });

  const primary = activities[0] ?? null;
  return {
    primary,
    lifecycle: primary?.lifecycle ?? "idle",
    activities,
    counts,
  };
}
