import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { ClaudeAgentClient } from "./agent.js";
import {
  CLAUDE_ULTRACODE_THINKING_OPTION_ID,
  claudeManifestModelSupportsFastMode,
  normalizeClaudeManifestModelId,
} from "./model-manifest.js";
import {
  findClaudeModel,
  getClaudeModels,
  mergeClaudeSdkModels,
  normalizeClaudeRuntimeModelId,
} from "./models.js";

const createdClaudeConfigDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(
    createdClaudeConfigDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
  createdClaudeConfigDirs.length = 0;
});

async function createClaudeConfigDir(settings: unknown): Promise<string> {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-claude-models-"));
  createdClaudeConfigDirs.push(configDir);
  await fs.writeFile(path.join(configDir, "settings.json"), JSON.stringify(settings, null, 2));
  return configDir;
}

async function createClaudeConfigDirWithRawSettings(settings: string): Promise<string> {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-claude-models-"));
  createdClaudeConfigDirs.push(configDir);
  await fs.writeFile(path.join(configDir, "settings.json"), settings);
  return configDir;
}

function createClaudeCatalogClient(): ClaudeAgentClient {
  return new ClaudeAgentClient({
    logger: createTestLogger(),
    discoverSdkModels: async () => [],
  });
}

describe("getClaudeModels", () => {
  it("returns all claude models", () => {
    const models = getClaudeModels();
    expect(models.map((m) => m.id)).toEqual([
      "claude-fable-5",
      "claude-opus-4-8[1m]",
      "claude-opus-4-8",
      "claude-sonnet-5",
      "claude-opus-4-7[1m]",
      "claude-opus-4-7",
      "claude-opus-4-6[1m]",
      "claude-opus-4-6",
      "claude-sonnet-4-6[1m]",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ]);
  });

  it("marks exactly one model as default", () => {
    const models = getClaudeModels();
    const defaults = models.filter((m) => m.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe("claude-opus-4-8");
  });

  it("defines context window sizes in the catalog", () => {
    const contextWindows = new Map(
      getClaudeModels().map((model) => [model.id, model.contextWindowMaxTokens]),
    );

    expect(contextWindows).toEqual(
      new Map([
        ["claude-fable-5", 1_000_000],
        ["claude-opus-4-8[1m]", 1_000_000],
        ["claude-opus-4-8", 200_000],
        ["claude-sonnet-5", 1_000_000],
        ["claude-opus-4-7[1m]", 1_000_000],
        ["claude-opus-4-7", 200_000],
        ["claude-opus-4-6[1m]", 1_000_000],
        ["claude-opus-4-6", 200_000],
        ["claude-sonnet-4-6[1m]", 1_000_000],
        ["claude-sonnet-4-6", 200_000],
        ["claude-haiku-4-5", 200_000],
      ]),
    );
  });

  it("derives thinking options from model effort capabilities", () => {
    const models = new Map(getClaudeModels().map((model) => [model.id, model]));

    expect(models.get("claude-sonnet-5")?.thinkingOptions?.map((option) => option.id)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      CLAUDE_ULTRACODE_THINKING_OPTION_ID,
    ]);
    expect(
      models
        .get("claude-sonnet-5")
        ?.thinkingOptions?.find((option) => option.id === CLAUDE_ULTRACODE_THINKING_OPTION_ID)
        ?.label,
    ).toBe("Ultra Code");

    expect(models.get("claude-opus-4-7")?.thinkingOptions?.map((option) => option.id)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      CLAUDE_ULTRACODE_THINKING_OPTION_ID,
    ]);
    expect(models.get("claude-sonnet-4-6")?.thinkingOptions?.map((option) => option.id)).toEqual([
      "low",
      "medium",
      "high",
      "max",
    ]);
    expect(models.get("claude-haiku-4-5")?.thinkingOptions).toBeUndefined();
  });

  it("returns fresh copies each call", () => {
    const a = getClaudeModels();
    const b = getClaudeModels();
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
  });
});

describe("mergeClaudeSdkModels", () => {
  it("puts newly discovered Claude Code models first and promotes the live default", () => {
    const models = mergeClaudeSdkModels(getClaudeModels(), [
      {
        value: "default",
        resolvedModel: "claude-opus-5[1m]",
        displayName: "Default (recommended)",
        description: "Opus 5 with 1M context · Best for everyday, complex tasks",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
      },
      {
        value: "opus[1m]",
        resolvedModel: "claude-opus-5[1m]",
        displayName: "Opus (1M context)",
        description: "Opus 5 with 1M context · Best for everyday, complex tasks",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
      },
      {
        value: "sonnet",
        resolvedModel: "claude-sonnet-5",
        displayName: "Sonnet",
        description: "Sonnet 5 · Efficient for routine tasks",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
      },
    ]);

    expect(models.slice(0, 2).map((model) => model.id)).toEqual([
      "claude-opus-5[1m]",
      "claude-sonnet-5",
    ]);
    expect(models.filter((model) => model.isDefault).map((model) => model.id)).toEqual([
      "claude-opus-5[1m]",
    ]);
    expect(models[0]).toMatchObject({
      label: "Opus 5 1M",
      contextWindowMaxTokens: 1_000_000,
    });
    expect(models[0].thinkingOptions?.map((option) => option.id)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      CLAUDE_ULTRACODE_THINKING_OPTION_ID,
    ]);
  });
});

describe("ClaudeAgentClient.fetchCatalog", () => {
  it("appends concrete models from Claude settings.json", async () => {
    const configDir = await createClaudeConfigDir({
      model: "us.anthropic.claude-opus-4-7[1m]",
      env: {
        ANTHROPIC_MODEL: "openrouter/anthropic/claude-sonnet-4.5",
        ANTHROPIC_SMALL_FAST_MODEL: "ollama/qwen3-coder",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "bedrock-opus-from-env",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.1",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5",
      },
    });
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    const client = createClaudeCatalogClient();

    const { models } = await client.fetchCatalog({
      scope: "workspace",
      cwd: os.tmpdir(),
      force: true,
    });

    expect(models).toEqual([
      ...getClaudeModels(),
      {
        provider: "claude",
        id: "us.anthropic.claude-opus-4-7[1m]",
        label: "us.anthropic.claude-opus-4-7[1m]",
        description: "From Claude settings.json model",
      },
      {
        provider: "claude",
        id: "openrouter/anthropic/claude-sonnet-4.5",
        label: "openrouter/anthropic/claude-sonnet-4.5",
        description: "From Claude settings.json env.ANTHROPIC_MODEL",
      },
      {
        provider: "claude",
        id: "ollama/qwen3-coder",
        label: "ollama/qwen3-coder",
        description: "From Claude settings.json env.ANTHROPIC_SMALL_FAST_MODEL",
      },
      {
        provider: "claude",
        id: "bedrock-opus-from-env",
        label: "bedrock-opus-from-env",
        description: "From Claude settings.json env.ANTHROPIC_DEFAULT_OPUS_MODEL",
      },
      {
        provider: "claude",
        id: "glm-5.1",
        label: "glm-5.1",
        description: "From Claude settings.json env.ANTHROPIC_DEFAULT_SONNET_MODEL",
      },
      {
        provider: "claude",
        id: "glm-5",
        label: "glm-5",
        description: "From Claude settings.json env.ANTHROPIC_DEFAULT_HAIKU_MODEL",
      },
    ]);
  });

  it("falls back to hardcoded models when settings.json is missing", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-claude-models-"));
    createdClaudeConfigDirs.push(configDir);
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    const client = createClaudeCatalogClient();

    const { models } = await client.fetchCatalog({
      scope: "workspace",
      cwd: os.tmpdir(),
      force: true,
    });

    expect(models).toEqual(getClaudeModels());
  });

  it("falls back to hardcoded models when settings.json is malformed", async () => {
    const configDir = await createClaudeConfigDirWithRawSettings("{ nope");
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    const client = createClaudeCatalogClient();

    const { models } = await client.fetchCatalog({
      scope: "workspace",
      cwd: os.tmpdir(),
      force: true,
    });

    expect(models).toEqual(getClaudeModels());
  });

  it("ignores empty env blocks and unexpected settings shapes", async () => {
    const configDir = await createClaudeConfigDir({
      model: " ",
      env: {
        ANTHROPIC_MODEL: "",
        ANTHROPIC_DEFAULT_OPUS_MODEL: 42,
      },
    });
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    const client = createClaudeCatalogClient();

    const { models } = await client.fetchCatalog({
      scope: "workspace",
      cwd: os.tmpdir(),
      force: true,
    });

    expect(models).toEqual(getClaudeModels());
  });

  it("deduplicates discovered settings models by ID", async () => {
    const configDir = await createClaudeConfigDir({
      model: "glm-5.1",
      env: {
        ANTHROPIC_MODEL: "glm-5.1",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-opus-4-6",
      },
    });
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    const client = createClaudeCatalogClient();

    const { models } = await client.fetchCatalog({
      scope: "workspace",
      cwd: os.tmpdir(),
      force: true,
    });

    expect(models.map((model) => model.id)).toEqual([
      ...getClaudeModels().map((model) => model.id),
      "glm-5.1",
    ]);
  });

  it("discovers every model exposed by a configured Claude gateway", async () => {
    const configDir = await createClaudeConfigDir({
      env: {
        ANTHROPIC_BASE_URL: "https://app.manifest.build/",
        ANTHROPIC_AUTH_TOKEN: "manifest-token",
        ANTHROPIC_API_KEY: "manifest-api-key",
        ANTHROPIC_CUSTOM_HEADERS: "X-Manifest-Workspace: workspace-1",
      },
    });
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            object: "list",
            data: [
              { id: "auto", object: "model", owned_by: "manifest" },
              { id: "anthropic/claude-sonnet-5", object: "model", owned_by: "anthropic" },
              { id: "openai/gpt-5.4", object: "model", owned_by: "openai" },
              { id: "claude-opus-4-8", object: "model", owned_by: "anthropic" },
              { id: "auto", object: "model", owned_by: "manifest" },
              { nope: true },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createClaudeCatalogClient();

    const { models } = await client.fetchCatalog({
      scope: "workspace",
      cwd: os.tmpdir(),
      force: true,
    });

    expect(models).toEqual([
      ...getClaudeModels(),
      {
        provider: "claude",
        id: "auto",
        label: "auto",
        description: "From app.manifest.build (manifest)",
      },
      {
        provider: "claude",
        id: "anthropic/claude-sonnet-5",
        label: "anthropic/claude-sonnet-5",
        description: "From app.manifest.build (anthropic)",
      },
      {
        provider: "claude",
        id: "openai/gpt-5.4",
        label: "openai/gpt-5.4",
        description: "From app.manifest.build (openai)",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url.toString()).toBe("https://app.manifest.build/v1/models");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer manifest-token");
    expect(headers.get("X-Api-Key")).toBe("manifest-api-key");
    expect(headers.get("X-Manifest-Workspace")).toBe("workspace-1");
  });

  it("keeps the existing catalog when gateway discovery fails", async () => {
    const configDir = await createClaudeConfigDir({
      env: {
        ANTHROPIC_BASE_URL: "https://gateway.example.com/v1",
        ANTHROPIC_AUTH_TOKEN: "gateway-token",
      },
    });
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 503 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createClaudeCatalogClient();

    const { models } = await client.fetchCatalog({
      scope: "workspace",
      cwd: os.tmpdir(),
      force: true,
    });

    expect(models).toEqual(getClaudeModels());
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0].toString()).toBe("https://gateway.example.com/v1/models");
  });
});

describe("normalizeClaudeRuntimeModelId", () => {
  it("returns exact match for known model IDs", () => {
    expect(normalizeClaudeRuntimeModelId("claude-fable-5")).toBe("claude-fable-5");
    expect(normalizeClaudeRuntimeModelId("claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(normalizeClaudeRuntimeModelId("claude-opus-4-6")).toBe("claude-opus-4-6");
    expect(normalizeClaudeRuntimeModelId("claude-opus-4-6[1m]")).toBe("claude-opus-4-6[1m]");
    expect(normalizeClaudeRuntimeModelId("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    expect(normalizeClaudeRuntimeModelId("claude-haiku-4-5")).toBe("claude-haiku-4-5");
  });

  it("normalizes dated model IDs to base model", () => {
    expect(normalizeClaudeRuntimeModelId("claude-fable-5-20260301")).toBe("claude-fable-5");
    expect(normalizeClaudeRuntimeModelId("claude-sonnet-5-20260101")).toBe("claude-sonnet-5");
    expect(normalizeClaudeRuntimeModelId("claude-opus-4-6-20260101")).toBe("claude-opus-4-6");
    expect(normalizeClaudeRuntimeModelId("claude-sonnet-4-6-20260101")).toBe("claude-sonnet-4-6");
    expect(normalizeClaudeRuntimeModelId("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
  });

  it("preserves [1m] suffix from runtime model strings", () => {
    expect(normalizeClaudeRuntimeModelId("claude-opus-4-6[1m]")).toBe("claude-opus-4-6[1m]");
  });

  it("returns null for empty/null/undefined", () => {
    expect(normalizeClaudeRuntimeModelId(null)).toBeNull();
    expect(normalizeClaudeRuntimeModelId(undefined)).toBeNull();
    expect(normalizeClaudeRuntimeModelId("")).toBeNull();
    expect(normalizeClaudeRuntimeModelId("  ")).toBeNull();
  });

  it("returns null for unrecognized strings", () => {
    expect(normalizeClaudeRuntimeModelId("gpt-5")).toBeNull();
    expect(normalizeClaudeRuntimeModelId("random")).toBeNull();
  });

  it("normalizes provider-form runtime model strings", () => {
    expect(normalizeClaudeRuntimeModelId("openrouter/anthropic/claude-opus-4-8")).toBe(
      "claude-opus-4-8",
    );
    expect(normalizeClaudeRuntimeModelId("us.anthropic.claude-opus-4-8[1m]")).toBe(
      "claude-opus-4-8[1m]",
    );
    expect(normalizeClaudeRuntimeModelId("us.anthropic.claude-opus-4-8-20260101")).toBe(
      "claude-opus-4-8",
    );
  });
});

describe("findClaudeModel", () => {
  it("resolves runtime model IDs to catalog entries", () => {
    expect(findClaudeModel("claude-sonnet-5-20260101")?.id).toBe("claude-sonnet-5");
    expect(findClaudeModel("claude-sonnet-5[1m]")?.contextWindowMaxTokens).toBe(1_000_000);
    expect(findClaudeModel("us.anthropic.claude-opus-4-8[1m]")?.contextWindowMaxTokens).toBe(
      1_000_000,
    );
  });
});

describe("claudeManifestModelSupportsFastMode", () => {
  it("keeps fast mode strict to first-party manifest model IDs", () => {
    expect(normalizeClaudeManifestModelId("openrouter/anthropic/claude-opus-4-8")).toBeNull();
    expect(claudeManifestModelSupportsFastMode("openrouter/anthropic/claude-opus-4-8")).toBe(false);
    expect(claudeManifestModelSupportsFastMode("claude-opus-4-8-20260101")).toBe(true);
  });
});
