import type { AgentAttachment } from "@getpaseo/protocol/messages";
import type { AttachmentMetadata, UserComposerAttachment } from "@/attachments/types";
import { localFileSourceToPath } from "@/attachments/utils";
import type { StreamItem } from "@/types/stream";
import { extractAssistantImageSources } from "@/utils/assistant-image-metadata";

export interface AgentContextOutput {
  path: string;
  label: string;
}

export interface AgentContextTimelineSubagent {
  key: string;
  label: string;
  status: "running" | "completed" | "failed" | "canceled";
}

export type AgentContextSourceKind = "image" | "file" | "link" | "text" | "review";

export interface AgentContextSource {
  key: string;
  kind: AgentContextSourceKind;
  label: string;
  image?: AttachmentMetadata;
  path?: string;
  url?: string;
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/");
}

function pathBasename(value: string): string {
  const normalized = normalizePath(value).replace(/\/+$/, "");
  return normalized.split("/").at(-1) ?? normalized;
}

function subagentLabel(description: string | undefined, fallback: string): string {
  const firstLine = description
    ?.split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  const label = firstLine || fallback.trim() || "Subagent";
  return label.length > 80 ? `${label.slice(0, 77)}…` : label;
}

export function collectAgentContextTimelineSubagents(
  streamItems: readonly StreamItem[],
): AgentContextTimelineSubagent[] {
  const latestByCallId = new Map<string, { row: AgentContextTimelineSubagent; index: number }>();

  for (const [index, item] of streamItems.entries()) {
    if (item.kind !== "tool_call" || item.payload.source !== "agent") {
      continue;
    }
    const toolCall = item.payload.data;
    if (toolCall.detail.type !== "sub_agent") {
      continue;
    }
    latestByCallId.set(toolCall.callId, {
      index,
      row: {
        key: `timeline-subagent:${toolCall.callId}`,
        label: subagentLabel(
          toolCall.detail.description,
          toolCall.detail.subAgentType || toolCall.name,
        ),
        status: toolCall.status,
      },
    });
  }

  return [...latestByCallId.values()]
    .sort((left, right) => left.index - right.index)
    .map(({ row }) => row);
}

export function collectAgentContextOutputs(
  streamItems: readonly StreamItem[],
): AgentContextOutput[] {
  const latestIndexByPath = new Map<string, number>();

  for (const [index, item] of streamItems.entries()) {
    if (item.kind === "assistant_message") {
      for (const source of extractAssistantImageSources(item.text)) {
        if (/^(?:https?:|data:|blob:)/i.test(source)) {
          continue;
        }
        const path = normalizePath(localFileSourceToPath(source));
        if (path) {
          latestIndexByPath.set(path, index);
        }
      }
      continue;
    }

    if (item.kind !== "tool_call" || item.payload.source !== "agent") {
      continue;
    }
    const toolCall = item.payload.data;
    if (toolCall.status === "failed" || toolCall.status === "canceled") {
      continue;
    }
    if (toolCall.detail.type !== "edit" && toolCall.detail.type !== "write") {
      continue;
    }
    const path = normalizePath(toolCall.detail.filePath);
    if (!path) {
      continue;
    }
    latestIndexByPath.set(path, index);
  }

  return [...latestIndexByPath.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([path]) => ({
      path,
      label: pathBasename(path),
    }));
}

function imageSource(image: AttachmentMetadata): AgentContextSource {
  const label = image.fileName?.trim() || pathBasename(image.storageKey) || "Image";
  return {
    key: `image:${image.id}`,
    kind: "image",
    label,
    image,
  };
}

function agentAttachmentSource(
  attachment: AgentAttachment,
  fallbackKey: string,
): AgentContextSource {
  switch (attachment.type) {
    case "uploaded_file":
      return {
        key: `file:${attachment.id}`,
        kind: "file",
        label: attachment.fileName,
      };
    case "github_issue":
      return {
        key: `github-issue:${attachment.url}`,
        kind: "link",
        label: `#${attachment.number} ${attachment.title}`,
        url: attachment.url,
      };
    case "github_pr":
      return {
        key: `github-pr:${attachment.url}`,
        kind: "link",
        label: `#${attachment.number} ${attachment.title}`,
        url: attachment.url,
      };
    case "text":
      return {
        key: fallbackKey,
        kind: "text",
        label:
          attachment.title?.trim() ||
          (attachment.contextKind === "chat_history" ? "Previous conversation" : "Text context"),
      };
    case "review":
      return {
        key: fallbackKey,
        kind: "review",
        label: "Code review",
      };
  }
}

function draftAttachmentSource(
  attachment: UserComposerAttachment,
  index: number,
): AgentContextSource {
  if (attachment.kind === "image") {
    return imageSource(attachment.metadata);
  }
  if (attachment.kind === "file") {
    return agentAttachmentSource(attachment.attachment, `draft-file:${index}`);
  }
  return {
    key: `github-${attachment.item.kind}:${attachment.item.url}`,
    kind: "link",
    label: `#${attachment.item.number} ${attachment.item.title}`,
    url: attachment.item.url,
  };
}

function appendUniqueSource(
  source: AgentContextSource,
  sources: AgentContextSource[],
  seen: Set<string>,
): void {
  if (seen.has(source.key)) {
    return;
  }
  seen.add(source.key);
  sources.push(source);
}

const MARKDOWN_HTTP_LINK_PATTERN =
  /(?<!!)\[([^\]]+)]\((https?:\/\/[^)\s]+)(?:\s+["'][^)]*["'])?\)/gi;
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*]\((?:<[^>]+>|[^)\n]+)\)/g;
const BARE_HTTP_URL_PATTERN = /https?:\/\/[^\s<>()\]]+/gi;

function trimUrlPunctuation(value: string): string {
  return value.replace(/[.,;:!?]+$/, "");
}

function assistantLinkSources(text: string): AgentContextSource[] {
  const sources: AgentContextSource[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(MARKDOWN_HTTP_LINK_PATTERN)) {
    const url = trimUrlPunctuation(match[2] ?? "");
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    sources.push({
      key: `link:${url}`,
      kind: "link",
      label: match[1]?.trim() || url,
      url,
    });
  }

  const textWithoutImages = text.replace(MARKDOWN_IMAGE_PATTERN, "");
  for (const match of textWithoutImages.matchAll(BARE_HTTP_URL_PATTERN)) {
    const url = trimUrlPunctuation(match[0]);
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    sources.push({ key: `link:${url}`, kind: "link", label: url, url });
  }
  return sources;
}

function toolCallSources(item: Extract<StreamItem, { kind: "tool_call" }>): AgentContextSource[] {
  if (item.payload.source !== "agent") {
    return [];
  }
  const toolCall = item.payload.data;
  if (toolCall.detail.type === "fetch") {
    return [
      {
        key: `link:${toolCall.detail.url}`,
        kind: "link",
        label: toolCall.detail.url,
        url: toolCall.detail.url,
      },
    ];
  }
  if (toolCall.detail.type !== "search" || toolCall.detail.toolName !== "web_search") {
    return [];
  }
  if (toolCall.detail.webResults?.length) {
    return toolCall.detail.webResults.map((result) => ({
      key: `link:${result.url}`,
      kind: "link" as const,
      label: result.title || result.url,
      url: result.url,
    }));
  }
  return [
    {
      key: `web-search:${toolCall.callId}`,
      kind: "text",
      label: `Search: ${toolCall.detail.query}`,
    },
  ];
}

export function collectAgentContextSources(input: {
  streamItems: readonly StreamItem[];
  draftAttachments: readonly UserComposerAttachment[];
}): AgentContextSource[] {
  const sources: AgentContextSource[] = [];
  const seen = new Set<string>();

  for (const [index, attachment] of input.draftAttachments.entries()) {
    appendUniqueSource(draftAttachmentSource(attachment, index), sources, seen);
  }

  for (let itemIndex = input.streamItems.length - 1; itemIndex >= 0; itemIndex -= 1) {
    const item = input.streamItems[itemIndex];
    if (item.kind === "assistant_message") {
      for (const source of assistantLinkSources(item.text)) {
        appendUniqueSource(source, sources, seen);
      }
      continue;
    }
    if (item.kind === "tool_call") {
      for (const source of toolCallSources(item)) {
        appendUniqueSource(source, sources, seen);
      }
      continue;
    }
    if (item.kind !== "user_message") {
      continue;
    }

    for (const image of item.images ?? []) {
      appendUniqueSource(imageSource(image), sources, seen);
    }
    for (const [attachmentIndex, attachment] of (item.attachments ?? []).entries()) {
      appendUniqueSource(
        agentAttachmentSource(attachment, `message:${item.id}:${attachmentIndex}`),
        sources,
        seen,
      );
    }
  }

  return sources;
}
