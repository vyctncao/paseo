import { afterEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import type { AgentStreamEvent, AgentTimelineItem } from "../../agent-sdk-types.js";
import { ClaudeAgentClient } from "./agent.js";
import { streamSession } from "../test-utils/session-stream-adapter.js";

/**
 * A backgrounded Task subagent emits NO frames carrying parent_tool_use_id, so everything keyed
 * off that field sees nothing for one: no sub_agent detail, and a Task card in the parent
 * transcript with no type or task on it. The task protocol still announces the subagent, so these
 * assert that a background child is visible, labeled, and live from its declaration alone.
 */

const queryFactory = vi.fn();

function buildQueryMock(events: unknown[]) {
  let index = 0;
  return {
    next: vi.fn(async () => {
      if (index >= events.length) return { done: true, value: undefined };
      const value = events[index];
      index += 1;
      return { done: false, value };
    }),
    interrupt: vi.fn(async () => undefined),
    return: vi.fn(async () => undefined),
    close: vi.fn(() => undefined),
    setPermissionMode: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    supportedModels: vi.fn(async () => []),
    supportedCommands: vi.fn(async () => []),
    rewindFiles: vi.fn(async () => ({ canRewind: true })),
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

const INIT = {
  type: "system",
  subtype: "init",
  session_id: "bg-session",
  permissionMode: "default",
} as const;

const RESULT = {
  type: "result",
  subtype: "success",
  usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 },
  total_cost_usd: 0,
} as const;

const TASK_STARTED = {
  type: "system",
  subtype: "task_started",
  task_id: "aa482d02957fe96c8",
  tool_use_id: "toolu_01TVF5JXom1yoZVoiaEWAoUV",
  task_type: "local_agent",
  subagent_type: "general-purpose",
  description: "Reply with banana",
} as const;

async function collectUntilTerminal(
  stream: AsyncGenerator<AgentStreamEvent>,
): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
    if (
      event.type === "turn_completed" ||
      event.type === "turn_failed" ||
      event.type === "turn_canceled"
    ) {
      break;
    }
  }
  return events;
}

async function runStream(events: unknown[]): Promise<AgentStreamEvent[]> {
  queryFactory.mockImplementation(() => buildQueryMock(events));
  const session = await new ClaudeAgentClient({
    logger: createTestLogger(),
    queryFactory,
    resolveBinary: async () => "/test/claude/bin",
  }).createSession({ provider: "claude", cwd: process.cwd() });
  const collected = await collectUntilTerminal(streamSession(session, "delegate work"));
  await session.close();
  return collected;
}

function subagentCards(events: AgentStreamEvent[]): AgentTimelineItem[] {
  return events
    .filter(
      (event): event is Extract<AgentStreamEvent, { type: "timeline" }> =>
        event.type === "timeline" &&
        event.item.type === "tool_call" &&
        event.item.detail.type === "sub_agent",
    )
    .map((event) => event.item);
}

describe("background Claude subagents", () => {
  afterEach(() => {
    queryFactory.mockReset();
  });

  test("labels the parent's Task card despite emitting no sidechain frames", async () => {
    const cards = subagentCards(
      await runStream([
        INIT,
        TASK_STARTED,
        {
          type: "system",
          subtype: "task_updated",
          task_id: TASK_STARTED.task_id,
          patch: { status: "completed" },
        },
        RESULT,
      ]),
    );

    expect(cards[0]).toMatchObject({
      callId: TASK_STARTED.tool_use_id,
      status: "running",
      detail: {
        type: "sub_agent",
        subAgentType: "general-purpose",
        description: "Reply with banana",
      },
    });
    expect(cards.at(-1)).toMatchObject({ status: "completed" });
  });

  test("keeps a backgrounded subagent running when its Task call returns early", async () => {
    // Backgrounding resolves the blocking Task call immediately while the child keeps working.
    // Finalizing on that result is what made a live subagent disappear as "completed".
    const events = await runStream([
      INIT,
      TASK_STARTED,
      {
        type: "system",
        subtype: "task_updated",
        task_id: TASK_STARTED.task_id,
        patch: { is_backgrounded: true },
      },
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: TASK_STARTED.tool_use_id,
              tool_name: "Task",
              content: "Task running in the background",
              is_error: false,
            },
          ],
        },
      },
      {
        type: "system",
        subtype: "task_progress",
        task_id: TASK_STARTED.task_id,
        description: "Reply with banana",
        last_tool_name: "Grep",
        summary: "Scanning the auth module",
        usage: { total_tokens: 10, tool_uses: 1, duration_ms: 5 },
      },
      RESULT,
    ]);

    const cards = subagentCards(events);
    expect(cards.at(-1)).toMatchObject({
      callId: TASK_STARTED.tool_use_id,
      status: "running",
      detail: { type: "sub_agent", log: "[Grep] Scanning the auth module" },
    });

    // No card for this subagent may claim it finished while it is still working.
    const finished = events.filter(
      (event) =>
        event.type === "timeline" &&
        event.item.type === "tool_call" &&
        event.item.callId === TASK_STARTED.tool_use_id &&
        event.item.status !== "running",
    );
    expect(finished).toEqual([]);
  });

  test("terminalizes the card instead of emitting a second, unrelated row", async () => {
    const events = await runStream([
      INIT,
      TASK_STARTED,
      {
        type: "system",
        subtype: "task_notification",
        task_id: TASK_STARTED.task_id,
        tool_use_id: TASK_STARTED.tool_use_id,
        status: "completed",
        summary: "Subagent finished",
        output_file: "/tmp/out.txt",
      },
      RESULT,
    ]);

    expect(subagentCards(events).at(-1)).toMatchObject({
      callId: TASK_STARTED.tool_use_id,
      status: "completed",
    });
    const syntheticRows = events.filter(
      (event) =>
        event.type === "timeline" &&
        event.item.type === "tool_call" &&
        event.item.name === "task_notification",
    );
    expect(syntheticRows).toEqual([]);
  });

  test("keeps a backgrounded shell command out of the subagent surfaces", async () => {
    const events = await runStream([
      INIT,
      {
        type: "system",
        subtype: "task_started",
        task_id: "b51skux0z",
        tool_use_id: "toolu_01MgVdcGPYnqE8cJQuccFtkU",
        task_type: "local_bash",
        description: "Sleep 20 seconds in background",
      },
      RESULT,
    ]);

    expect(subagentCards(events)).toEqual([]);
  });
});
