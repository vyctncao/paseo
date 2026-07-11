import { describe, expect, it } from "vitest";
import type { AttachmentMetadata, UserComposerAttachment } from "@/attachments/types";
import type { StreamItem } from "@/types/stream";
import {
  collectAgentContextOutputs,
  collectAgentContextSources,
  collectAgentContextTimelineSubagents,
} from "./agent-context-panel-model";

function toolCall(input: {
  id: string;
  path: string;
  type: "edit" | "write";
  status?: "running" | "completed" | "failed" | "canceled";
}): StreamItem {
  const status = input.status ?? "completed";
  return {
    kind: "tool_call",
    id: input.id,
    timestamp: new Date(0),
    payload: {
      source: "agent",
      data: {
        provider: "codex",
        callId: input.id,
        name: input.type,
        status,
        error: status === "failed" ? "failed" : null,
        detail: { type: input.type, filePath: input.path },
      },
    },
  };
}

function image(id: string, fileName: string): AttachmentMetadata {
  return {
    id,
    mimeType: "image/png",
    storageType: "desktop-file",
    storageKey: `/tmp/${fileName}`,
    fileName,
    createdAt: 0,
  };
}

describe("collectAgentContextOutputs", () => {
  it("keeps the most recent successful edit for each file", () => {
    const streamItems = [
      toolCall({ id: "one", path: "/repo/hot.md", type: "write" }),
      toolCall({ id: "two", path: "/repo/log.md", type: "edit" }),
      toolCall({ id: "three", path: "/repo/hot.md", type: "edit" }),
      toolCall({ id: "four", path: "/repo/ignored.md", type: "write", status: "failed" }),
    ];

    expect(collectAgentContextOutputs(streamItems)).toEqual([
      { path: "/repo/hot.md", label: "hot.md" },
      { path: "/repo/log.md", label: "log.md" },
    ]);
  });

  it("includes local images delivered by the assistant", () => {
    const streamItems: StreamItem[] = [
      {
        kind: "assistant_message",
        id: "generated-image",
        text: [
          "![Generated dog](/tmp/paseo-attachments/dog.png)",
          "![Windows image](file:///C:/Temp/generated-cat.png)",
          "![Remote image](https://example.com/remote.png)",
          "![Inline image](data:image/png;base64,abc)",
        ].join("\n"),
        timestamp: new Date(0),
      },
    ];

    expect(collectAgentContextOutputs(streamItems)).toEqual([
      { path: "/tmp/paseo-attachments/dog.png", label: "dog.png" },
      { path: "C:/Temp/generated-cat.png", label: "generated-cat.png" },
    ]);
  });

  it("deduplicates image outputs against later file writes", () => {
    const streamItems: StreamItem[] = [
      {
        kind: "assistant_message",
        id: "generated-image",
        text: "![Generated dog](/repo/dog.png)",
        timestamp: new Date(0),
      },
      toolCall({ id: "write-image", path: "/repo/dog.png", type: "write" }),
    ];

    expect(collectAgentContextOutputs(streamItems)).toEqual([
      { path: "/repo/dog.png", label: "dog.png" },
    ]);
  });
});

describe("collectAgentContextTimelineSubagents", () => {
  it("projects native provider subagent calls and keeps their latest status", () => {
    const subagentCall = (
      id: string,
      status: "running" | "completed" | "failed" | "canceled",
      description: string,
    ): StreamItem => ({
      kind: "tool_call",
      id: `${id}-${status}`,
      timestamp: new Date(0),
      payload: {
        source: "agent",
        data: {
          provider: "codex",
          callId: id,
          name: "Sub-agent",
          status,
          error: status === "failed" ? "failed" : null,
          detail: {
            type: "sub_agent",
            subAgentType: "Researcher",
            description,
            log: "",
          },
        },
      },
    });
    const streamItems = [
      subagentCall("biology", "running", "Research molecular biology\nUse primary sources."),
      subagentCall("ecology", "failed", "Research ecology"),
      subagentCall("biology", "completed", "Research molecular biology"),
    ];

    expect(collectAgentContextTimelineSubagents(streamItems)).toEqual([
      {
        key: "timeline-subagent:ecology",
        label: "Research ecology",
        status: "failed",
      },
      {
        key: "timeline-subagent:biology",
        label: "Research molecular biology",
        status: "completed",
      },
    ]);
  });
});

describe("collectAgentContextSources", () => {
  it("combines draft and sent sources while deduplicating attachment identities", () => {
    const sharedImage = image("image-1", "reference.png");
    const draftAttachments: UserComposerAttachment[] = [
      { kind: "image", metadata: sharedImage },
      {
        kind: "github_pr",
        item: {
          kind: "pr",
          number: 42,
          title: "Improve context panel",
          url: "https://github.com/example/repo/pull/42",
          state: "open",
          body: null,
          labels: [],
        },
      },
    ];
    const streamItems: StreamItem[] = [
      {
        kind: "user_message",
        id: "message-1",
        text: "Use these",
        timestamp: new Date(0),
        images: [sharedImage, image("image-2", "layout.png")],
      },
    ];

    expect(
      collectAgentContextSources({
        streamItems,
        draftAttachments,
      }).map((source) => ({ kind: source.kind, label: source.label })),
    ).toEqual([
      { kind: "image", label: "reference.png" },
      { kind: "link", label: "#42 Improve context panel" },
      { kind: "image", label: "layout.png" },
    ]);
  });

  it("includes web searches, result links, and assistant citations", () => {
    const streamItems: StreamItem[] = [
      {
        kind: "tool_call",
        id: "search-running",
        timestamp: new Date(0),
        payload: {
          source: "agent",
          data: {
            provider: "codex",
            callId: "search-running",
            name: "web_search",
            status: "running",
            error: null,
            detail: {
              type: "search",
              query: "spatial transcriptomics",
              toolName: "web_search",
            },
          },
        },
      },
      {
        kind: "tool_call",
        id: "search-complete",
        timestamp: new Date(1),
        payload: {
          source: "agent",
          data: {
            provider: "claude",
            callId: "search-complete",
            name: "web_search",
            status: "completed",
            error: null,
            detail: {
              type: "search",
              query: "cell atlas roadmap",
              toolName: "web_search",
              webResults: [
                { title: "Human Cell Atlas", url: "https://www.humancellatlas.org/roadmap" },
              ],
            },
          },
        },
      },
      {
        kind: "assistant_message",
        id: "answer",
        text: "See [Human Cell Atlas](https://www.humancellatlas.org/roadmap) for details.",
        timestamp: new Date(2),
      },
    ];

    expect(
      collectAgentContextSources({ streamItems, draftAttachments: [] }).map((source) => ({
        kind: source.kind,
        label: source.label,
        url: source.url,
      })),
    ).toEqual([
      {
        kind: "link",
        label: "Human Cell Atlas",
        url: "https://www.humancellatlas.org/roadmap",
      },
      {
        kind: "text",
        label: "Search: spatial transcriptomics",
        url: undefined,
      },
    ]);
  });
});
