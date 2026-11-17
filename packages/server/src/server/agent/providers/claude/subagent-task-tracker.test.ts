import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, test } from "vitest";

import type { AgentMetadata } from "../../agent-sdk-types.js";
import { ClaudeSubagentTaskTracker } from "./subagent-task-tracker.js";

const TASK_ID = "a1730a6215e1f5cf6";
const TOOL_USE_ID = "toolu_01DgLoPMW9";

function createTracker(input?: {
  toolInput?: AgentMetadata | null;
  sidechainLog?: string;
}): ClaudeSubagentTaskTracker {
  return new ClaudeSubagentTaskTracker({
    getToolInput: () => input?.toolInput ?? null,
    getSidechainLog: () => input?.sidechainLog,
  });
}

function taskStarted(overrides: Record<string, unknown> = {}): SDKMessage {
  return {
    type: "system",
    subtype: "task_started",
    task_id: TASK_ID,
    tool_use_id: TOOL_USE_ID,
    task_type: "local_agent",
    subagent_type: "Explore",
    description: "Reply with banana",
    ...overrides,
  } as unknown as SDKMessage;
}

function taskUpdated(patch: Record<string, unknown>, taskId = TASK_ID): SDKMessage {
  return {
    type: "system",
    subtype: "task_updated",
    task_id: taskId,
    patch,
  } as unknown as SDKMessage;
}

function taskNotification(status: string, taskId = TASK_ID): SDKMessage {
  return {
    type: "system",
    subtype: "task_notification",
    task_id: taskId,
    tool_use_id: TOOL_USE_ID,
    status,
  } as unknown as SDKMessage;
}

function taskProgress(overrides: Record<string, unknown> = {}): SDKMessage {
  return {
    type: "system",
    subtype: "task_progress",
    task_id: TASK_ID,
    description: "Reply with banana",
    ...overrides,
  } as unknown as SDKMessage;
}

describe("ClaudeSubagentTaskTracker", () => {
  test("declares a subagent from task_started alone, with no sidechain frames", () => {
    const tracker = createTracker();

    expect(tracker.observe(taskStarted())).toEqual([
      {
        type: "tool_call",
        callId: TOOL_USE_ID,
        name: "Task",
        status: "running",
        error: null,
        detail: {
          type: "sub_agent",
          subAgentType: "Explore",
          description: "Reply with banana",
          log: "",
          actions: [],
        },
      },
    ]);
    expect(tracker.isDeclared(TOOL_USE_ID)).toBe(true);
  });

  test("routes a terminal status through the task id learned at declaration", () => {
    const tracker = createTracker();
    tracker.observe(taskStarted());

    // task_updated carries no tool_use_id — the mapping is the only way to route it.
    const [card] = tracker.observe(taskUpdated({ status: "completed" }));

    expect(card).toMatchObject({ callId: TOOL_USE_ID, status: "completed" });
  });

  test("reports where a backgrounded subagent currently is", () => {
    const tracker = createTracker();
    tracker.observe(taskStarted());
    tracker.observe(taskUpdated({ is_backgrounded: true }));

    const [card] = tracker.observe(
      taskProgress({ last_tool_name: "Grep", summary: "Scanning auth module" }),
    );

    expect(card).toMatchObject({
      callId: TOOL_USE_ID,
      status: "running",
      detail: { type: "sub_agent", log: "[Grep] Scanning auth module" },
    });
  });

  test("keeps the parent's Task card owned until the task actually settles", () => {
    const tracker = createTracker();
    tracker.observe(taskStarted());

    // The backgrounding acknowledgement resolves the blocking tool call immediately.
    expect(tracker.isAwaitingTaskOutcome(TOOL_USE_ID)).toBe(true);

    tracker.observe(taskNotification("completed"));
    expect(tracker.isAwaitingTaskOutcome(TOOL_USE_ID)).toBe(false);
  });

  test("does not re-announce a status that already holds", () => {
    const tracker = createTracker();
    tracker.observe(taskStarted());
    tracker.observe(taskUpdated({ status: "completed" }));

    // task_updated and task_notification arrive in the same millisecond on the real wire.
    expect(tracker.observe(taskNotification("completed"))).toEqual([]);
  });

  test("treats a killed task as canceled rather than failed", () => {
    const tracker = createTracker();
    tracker.observe(taskStarted());

    expect(tracker.observe(taskUpdated({ status: "killed" }))[0]).toMatchObject({
      status: "canceled",
    });
  });

  test("ignores a backgrounded shell command", () => {
    const tracker = createTracker();

    // Real wire shape: a backgrounded Bash announces with a tool_use_id but no subagent_type,
    // so filtering on the id alone would put `sleep 20` in the subagent surfaces.
    expect(
      tracker.observe(
        taskStarted({ task_type: "local_bash", subagent_type: undefined, description: "sleep 20" }),
      ),
    ).toEqual([]);
    expect(tracker.isDeclared(TOOL_USE_ID)).toBe(false);
  });

  test("ignores a workflow run and ambient housekeeping", () => {
    expect(
      createTracker().observe(
        taskStarted({ task_type: "local_workflow", subagent_type: undefined }),
      ),
    ).toEqual([]);
    expect(createTracker().observe(taskStarted({ skip_transcript: true }))).toEqual([]);
  });

  test("does not readmit a filtered task through its notification", () => {
    const tracker = createTracker();
    tracker.observe(taskStarted({ task_type: "local_bash", subagent_type: undefined }));

    expect(tracker.observe(taskNotification("completed"))).toEqual([]);
    expect(tracker.isDeclaredTaskId(TASK_ID)).toBe(false);
  });

  test("drops a status for a task it never declared", () => {
    const tracker = createTracker();
    tracker.observe(taskStarted());

    expect(tracker.observe(taskUpdated({ status: "completed" }, "unknown-task"))).toEqual([]);
  });

  test("prefers an explicit Task name over the agent type", () => {
    const tracker = createTracker({ toolInput: { name: "auth reviewer" } });

    expect(tracker.observe(taskStarted())[0]).toMatchObject({
      detail: { subAgentType: "auth reviewer" },
    });
  });

  test("defers its log to the sidechain tracker when that has richer activity", () => {
    const tracker = createTracker({ sidechainLog: "[Read] README.md\n[Edit] src/index.ts" });
    tracker.observe(taskStarted());

    expect(tracker.observe(taskProgress({ summary: "Reading files" }))[0]).toMatchObject({
      detail: { log: "[Read] README.md\n[Edit] src/index.ts" },
    });
  });

  test("cancels running foreground tasks but not backgrounded ones", () => {
    const tracker = createTracker();
    tracker.observe(taskStarted());
    tracker.observe(taskUpdated({ is_backgrounded: true }));

    expect(tracker.cancelRunningForegroundTasks()).toEqual([]);

    // A backgrounded child that settles after the interrupt still finds its card.
    expect(tracker.observe(taskNotification("completed"))[0]).toMatchObject({
      callId: TOOL_USE_ID,
      status: "completed",
    });
  });

  test("terminalizes a foreground task the canceled turn was running", () => {
    const tracker = createTracker();
    tracker.observe(taskStarted());

    expect(tracker.cancelRunningForegroundTasks()[0]).toMatchObject({
      callId: TOOL_USE_ID,
      status: "canceled",
    });

    // A late notification is free to correct the guess.
    expect(tracker.observe(taskNotification("completed"))[0]).toMatchObject({
      status: "completed",
    });
  });
});
