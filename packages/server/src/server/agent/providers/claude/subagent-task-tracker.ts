import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import type {
  AgentMetadata,
  AgentTimelineItem,
  ToolCallTimelineItem,
} from "../../agent-sdk-types.js";
import {
  mapClaudeCanceledToolCall,
  mapClaudeCompletedToolCall,
  mapClaudeFailedToolCall,
  mapClaudeRunningToolCall,
} from "./tool-call-mapper.js";

/**
 * Claude Code announces subagent lifecycle on the SDK stream (`task_started`, `task_updated`,
 * `task_progress`, `task_notification`). Reading those announcements is the only way to see a
 * backgrounded subagent: once a Task is backgrounded it emits no frames carrying
 * `parent_tool_use_id`, so the sidechain tracker — which derives everything from that field —
 * never runs for one and its Task card would stay an unlabeled, permanently running row.
 *
 * Only `task_started` carries `tool_use_id`, so the map from task id to the Task tool-use id
 * (the id the parent transcript keys its card on) has to be remembered. The table is
 * session-scoped, because task ids are: a backgrounded child settles after the turn that spawned
 * it, and must still find its card.
 */

export type SubagentTaskStatus = "running" | "completed" | "failed" | "canceled";

/** Task-tool subagents. Backgrounded shell commands announce as `local_bash`. */
const SUBAGENT_TASK_TYPE = "local_agent";
const MAX_PROGRESS_SUMMARY_CHARS = 160;

interface TaskStartedMessage {
  task_id?: unknown;
  tool_use_id?: unknown;
  description?: unknown;
  subagent_type?: unknown;
  task_type?: unknown;
  skip_transcript?: unknown;
}

interface TaskUpdatedMessage {
  task_id?: unknown;
  patch?: { status?: unknown; is_backgrounded?: unknown };
}

interface TaskProgressMessage {
  task_id?: unknown;
  last_tool_name?: unknown;
  summary?: unknown;
  description?: unknown;
}

interface TaskNotificationMessage {
  task_id?: unknown;
  status?: unknown;
  summary?: unknown;
}

interface SubagentTaskState {
  taskId: string;
  subAgentType?: string;
  description?: string;
  progress?: string;
  status: SubagentTaskStatus;
  backgrounded: boolean;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return undefined;
  }
  return normalized.length <= MAX_PROGRESS_SUMMARY_CHARS
    ? normalized
    : `${normalized.slice(0, MAX_PROGRESS_SUMMARY_CHARS)}...`;
}

/**
 * Not every announced task is a subagent. A backgrounded shell announces `task_type: "local_bash"`
 * with a `tool_use_id` and no `subagent_type`, so filtering on the id alone puts `sleep 20` in the
 * subagent surfaces. Releases predating `task_type` are covered by requiring a subagent type.
 */
function isSubagentTask(message: TaskStartedMessage): boolean {
  const taskType = readString(message.task_type);
  if (taskType) {
    return taskType === SUBAGENT_TASK_TYPE;
  }
  return readString(message.subagent_type) !== undefined;
}

/** Neither `pending` nor `paused` is terminal, and `killed` is a cancellation, not a failure. */
function mapTaskStatus(status: unknown): SubagentTaskStatus | undefined {
  switch (readString(status)?.toLowerCase()) {
    case "pending":
    case "running":
    case "paused":
      return "running";
    case "completed":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    case "killed":
    case "stopped":
    case "canceled":
    case "cancelled":
      return "canceled";
    default:
      return undefined;
  }
}

export interface ClaudeSubagentTaskTrackerInput {
  /**
   * The parent's Task tool input, by tool-use id. An explicit `name` on the Task call is a better
   * title than the agent type: without it a fan-out of five Explores reads as five identical rows.
   */
  getToolInput: (toolUseId: string) => AgentMetadata | null | undefined;
  /**
   * The sidechain tracker's action log for this subagent, when it has one. A foreground subagent's
   * per-tool log is richer than `task_progress`, and both write the same card, so the declarative
   * source defers to it rather than overwriting it with a sparser line.
   */
  getSidechainLog: (toolUseId: string) => string | undefined;
}

export class ClaudeSubagentTaskTracker {
  private readonly subagentIdByTaskId = new Map<string, string>();
  private readonly states = new Map<string, SubagentTaskState>();
  private readonly getToolInput: ClaudeSubagentTaskTrackerInput["getToolInput"];
  private readonly getSidechainLog: ClaudeSubagentTaskTrackerInput["getSidechainLog"];

  constructor(input: ClaudeSubagentTaskTrackerInput) {
    this.getToolInput = input.getToolInput;
    this.getSidechainLog = input.getSidechainLog;
  }

  /** Whether this tracker declared the given Task tool-use id as a subagent. */
  isDeclared(toolUseId: string): boolean {
    return this.states.has(toolUseId);
  }

  /** Whether a task id belongs to a subagent this tracker declared. */
  isDeclaredTaskId(taskId: string): boolean {
    const id = this.subagentIdByTaskId.get(taskId);
    return id !== undefined && this.states.has(id);
  }

  /**
   * A declared subagent whose card the task protocol still owns.
   *
   * Backgrounding resolves the blocking Task call immediately with a "running in the background"
   * tool_result. Treating that as the real outcome marks a working child completed and drops its
   * card, so the caller checks this before finalizing a Task tool_result.
   */
  isAwaitingTaskOutcome(toolUseId: string): boolean {
    return this.states.get(toolUseId)?.status === "running";
  }

  observe(message: SDKMessage): AgentTimelineItem[] {
    if (message.type !== "system") {
      return [];
    }
    switch (message.subtype) {
      case "task_started":
        return this.observeTaskStarted(message as unknown as TaskStartedMessage);
      case "task_updated":
        return this.observeTaskUpdated(message as unknown as TaskUpdatedMessage);
      case "task_progress":
        return this.observeTaskProgress(message as unknown as TaskProgressMessage);
      case "task_notification":
        return this.observeTaskNotification(message as unknown as TaskNotificationMessage);
      default:
        return [];
    }
  }

  /**
   * Terminalize the subagents a canceled turn was running.
   *
   * Cancellation is a fact about the turn, not the task table: task ids are session-scoped, so the
   * routing stays intact and a later `task_notification` is free to correct this guess.
   * Backgrounded children are skipped — being backgrounded is the declaration that they outlive
   * the turn.
   */
  cancelRunningForegroundTasks(): AgentTimelineItem[] {
    const items: AgentTimelineItem[] = [];
    for (const [id, state] of this.states) {
      if (state.backgrounded || state.status !== "running") {
        continue;
      }
      state.status = "canceled";
      const card = this.buildCard(id, state);
      if (card) {
        items.push(card);
      }
    }
    return items;
  }

  reset(): void {
    this.subagentIdByTaskId.clear();
    this.states.clear();
  }

  private observeTaskStarted(message: TaskStartedMessage): AgentTimelineItem[] {
    const id = readString(message.tool_use_id);
    const taskId = readString(message.task_id);
    // skip_transcript marks ambient housekeeping the transcript should not show.
    if (!id || !taskId || message.skip_transcript === true || !isSubagentTask(message)) {
      return [];
    }

    const state: SubagentTaskState = {
      taskId,
      status: "running",
      backgrounded: false,
      ...((readString(this.getToolInput(id)?.name) ?? readString(message.subagent_type))
        ? {
            subAgentType:
              readString(this.getToolInput(id)?.name) ?? readString(message.subagent_type),
          }
        : {}),
      ...(readString(message.description) ? { description: readString(message.description) } : {}),
    };
    this.subagentIdByTaskId.set(taskId, id);
    this.states.set(id, state);

    const card = this.buildCard(id, state);
    return card ? [card] : [];
  }

  private observeTaskUpdated(message: TaskUpdatedMessage): AgentTimelineItem[] {
    const entry = this.resolve(message.task_id);
    if (!entry) {
      return [];
    }
    const backgrounded = message.patch?.is_backgrounded;
    if (typeof backgrounded === "boolean") {
      entry.state.backgrounded = backgrounded;
    }
    return this.applyStatus(entry, mapTaskStatus(message.patch?.status));
  }

  /**
   * `task_progress` fires once per tool use, not on a timer, so it is an accurate live signal of
   * where a subagent currently is. It matters most for a backgrounded child, which emits no
   * sidechain frames at all and would otherwise show no activity while it works.
   */
  private observeTaskProgress(message: TaskProgressMessage): AgentTimelineItem[] {
    const entry = this.resolve(message.task_id);
    if (!entry) {
      return [];
    }
    const summary = readString(message.summary);
    const toolName = readString(message.last_tool_name);
    const progress = summary && toolName ? `[${toolName}] ${summary}` : (summary ?? toolName);
    const description = readString(message.description);
    if (description && description !== entry.state.description) {
      entry.state.description = description;
    } else if (!progress || progress === entry.state.progress) {
      return [];
    }
    if (progress) {
      entry.state.progress = progress;
    }
    const card = this.buildCard(entry.id, entry.state);
    return card ? [card] : [];
  }

  private observeTaskNotification(message: TaskNotificationMessage): AgentTimelineItem[] {
    const entry = this.resolve(message.task_id);
    if (!entry) {
      return [];
    }
    const summary = readString(message.summary);
    if (summary) {
      entry.state.progress = summary;
    }
    return this.applyStatus(entry, mapTaskStatus(message.status));
  }

  private resolve(taskId: unknown): { id: string; state: SubagentTaskState } | null {
    const normalized = readString(taskId);
    if (!normalized) {
      return null;
    }
    const id = this.subagentIdByTaskId.get(normalized);
    if (!id) {
      return null;
    }
    const state = this.states.get(id);
    return state ? { id, state } : null;
  }

  private applyStatus(
    entry: { id: string; state: SubagentTaskState },
    status: SubagentTaskStatus | undefined,
  ): AgentTimelineItem[] {
    if (!status || status === entry.state.status) {
      return [];
    }
    entry.state.status = status;
    const card = this.buildCard(entry.id, entry.state);
    return card ? [card] : [];
  }

  private mapStatusToToolCall(id: string, state: SubagentTaskState): ToolCallTimelineItem | null {
    const params = { name: "Task", callId: id, input: null, output: null };
    switch (state.status) {
      case "running":
        return mapClaudeRunningToolCall(params);
      case "completed":
        return mapClaudeCompletedToolCall(params);
      case "canceled":
        return mapClaudeCanceledToolCall(params);
      case "failed":
        return mapClaudeFailedToolCall({
          ...params,
          error: { message: state.progress ?? "Subagent failed" },
        });
    }
  }

  private buildCard(id: string, state: SubagentTaskState): AgentTimelineItem | null {
    const toolCall = this.mapStatusToToolCall(id, state);
    if (!toolCall) {
      return null;
    }
    return {
      ...toolCall,
      detail: {
        type: "sub_agent",
        ...(state.subAgentType ? { subAgentType: state.subAgentType } : {}),
        ...(state.description ? { description: state.description } : {}),
        log: this.getSidechainLog(id) ?? state.progress ?? "",
        actions: [],
      },
    };
  }
}
