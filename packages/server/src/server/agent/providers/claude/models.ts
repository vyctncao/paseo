import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Logger } from "pino";

import type { AgentModelDefinition } from "../../agent-sdk-types.js";
import {
  CLAUDE_ULTRACODE_THINKING_OPTION_ID,
  getClaudeManifestModels,
  normalizeClaudeRuntimeModelId as normalizeClaudeManifestRuntimeModelId,
} from "./model-manifest.js";

const CLAUDE_SETTINGS_MODEL_ENV_KEYS = [
  "ANTHROPIC_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
] as const;

const CLAUDE_GATEWAY_MODEL_TIMEOUT_MS = 10_000;

interface ClaudeGatewayConfig {
  baseUrl: string;
  authToken?: string;
  apiKey?: string;
  customHeaders?: string;
}

interface ClaudeSettingsCatalog {
  models: AgentModelDefinition[];
  gateway: ClaudeGatewayConfig | null;
}

export interface ClaudeSdkModelInfo {
  value: string;
  displayName: string;
  description: string;
  resolvedModel?: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: Array<"low" | "medium" | "high" | "xhigh" | "max">;
}

export function getClaudeModels(): AgentModelDefinition[] {
  return getClaudeManifestModels();
}

export function findClaudeModel(
  modelId: string | null | undefined,
): AgentModelDefinition | undefined {
  const normalizedModelId = normalizeClaudeRuntimeModelId(modelId);
  if (!normalizedModelId) {
    return undefined;
  }
  return getClaudeModels().find((model) => model.id === normalizedModelId);
}

export async function getClaudeModelsWithSettings(
  logger: Logger,
  configDir?: string,
): Promise<AgentModelDefinition[]> {
  const hardcodedModels = getClaudeModels();
  const settings = await readClaudeSettingsCatalog(logger, configDir);
  const gatewayModels = settings.gateway
    ? await readClaudeGatewayModels(logger, settings.gateway)
    : [];

  const seenModelIds = new Set(hardcodedModels.map((model) => model.id));
  const models = [...hardcodedModels];

  for (const model of [...settings.models, ...gatewayModels]) {
    if (seenModelIds.has(model.id)) {
      continue;
    }
    seenModelIds.add(model.id);
    models.push(model);
  }

  return models;
}

export function mergeClaudeSdkModels(
  configuredModels: AgentModelDefinition[],
  sdkModels: readonly ClaudeSdkModelInfo[],
): AgentModelDefinition[] {
  const configuredById = new Map(configuredModels.map((model) => [model.id, model]));
  const discoveredModels: AgentModelDefinition[] = [];
  const discoveredById = new Map<string, number>();
  let discoveredDefaultModelId: string | null = null;

  for (const sdkModel of sdkModels) {
    const model = toClaudeSdkModelDefinition(sdkModel, configuredById);
    if (!model) {
      continue;
    }

    const existingIndex = discoveredById.get(model.id);
    if (existingIndex === undefined) {
      discoveredById.set(model.id, discoveredModels.length);
      discoveredModels.push(model);
    } else {
      discoveredModels[existingIndex] = {
        ...discoveredModels[existingIndex],
        ...model,
        isDefault:
          discoveredModels[existingIndex].isDefault === true || model.isDefault === true
            ? true
            : undefined,
      };
    }

    if (model.isDefault) {
      discoveredDefaultModelId = model.id;
    }
  }

  if (discoveredModels.length === 0) {
    return configuredModels;
  }

  const discoveredIds = new Set(discoveredModels.map((model) => model.id));
  const merged = [
    ...discoveredModels,
    ...configuredModels.filter((model) => !discoveredIds.has(model.id)),
  ];

  if (!discoveredDefaultModelId) {
    return merged;
  }

  const normalizedModels: AgentModelDefinition[] = [];
  for (const model of merged) {
    if (model.id === discoveredDefaultModelId) {
      normalizedModels.push({ ...model, isDefault: true });
      continue;
    }
    if (!model.isDefault) {
      normalizedModels.push(model);
      continue;
    }
    const { isDefault: _isDefault, ...withoutDefault } = model;
    normalizedModels.push(withoutDefault);
  }
  return normalizedModels;
}

function toClaudeSdkModelDefinition(
  sdkModel: ClaudeSdkModelInfo,
  configuredById: ReadonlyMap<string, AgentModelDefinition>,
): AgentModelDefinition | null {
  const value = readNonEmptyString(sdkModel.value);
  const resolvedModel = readNonEmptyString(sdkModel.resolvedModel);
  const rawModelId = resolvedModel ?? value;
  if (!rawModelId) {
    return null;
  }

  const id = normalizeClaudeManifestRuntimeModelId(rawModelId) ?? rawModelId;
  const configured = configuredById.get(id);
  const description = readNonEmptyString(sdkModel.description) ?? configured?.description;
  const thinkingOptions = buildClaudeSdkThinkingOptions(sdkModel.supportedEffortLevels);
  const contextWindowMaxTokens =
    id.toLowerCase().includes("[1m]") || description?.toLowerCase().includes("1m context")
      ? 1_000_000
      : configured?.contextWindowMaxTokens;

  return {
    ...configured,
    provider: "claude",
    id,
    label: resolveClaudeSdkModelLabel(sdkModel, id),
    ...(description ? { description } : {}),
    ...(value === "default" ? { isDefault: true } : {}),
    ...(contextWindowMaxTokens ? { contextWindowMaxTokens } : {}),
    ...(thinkingOptions ? { thinkingOptions } : {}),
  };
}

function resolveClaudeSdkModelLabel(sdkModel: ClaudeSdkModelInfo, modelId: string): string {
  const descriptionLead = readNonEmptyString(sdkModel.description)?.split("·")[0]?.trim();
  if (descriptionLead) {
    return descriptionLead.replace(/\s+with\s+1m\s+context$/i, " 1M");
  }

  const displayName = readNonEmptyString(sdkModel.displayName);
  if (displayName && !/^default\b/i.test(displayName)) {
    return displayName;
  }

  return modelId
    .replace(/^claude-/i, "")
    .replace(/\[1m\]$/i, " 1M")
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function buildClaudeSdkThinkingOptions(
  effortLevels: ClaudeSdkModelInfo["supportedEffortLevels"],
): AgentModelDefinition["thinkingOptions"] {
  if (!effortLevels || effortLevels.length === 0) {
    return undefined;
  }

  const labels = {
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra High",
    max: "Max",
  } as const;
  const options: NonNullable<AgentModelDefinition["thinkingOptions"]> = effortLevels.map((id) => ({
    id,
    label: labels[id],
  }));
  if (effortLevels.includes("xhigh")) {
    options.push({ id: CLAUDE_ULTRACODE_THINKING_OPTION_ID, label: "Ultra Code" });
  }
  return options;
}

async function readClaudeSettingsCatalog(
  logger: Logger,
  configDir?: string,
): Promise<ClaudeSettingsCatalog> {
  const settingsPath = path.join(resolveClaudeConfigDir(configDir), "settings.json");

  let parsed: unknown;
  try {
    const rawSettings = await fs.readFile(settingsPath, "utf8");
    parsed = JSON.parse(rawSettings);
  } catch (error) {
    logger.debug({ err: error, settingsPath }, "Failed to read Claude settings models");
    return { models: [], gateway: readClaudeGatewayConfig(process.env) };
  }

  if (!isRecord(parsed)) {
    logger.debug({ settingsPath }, "Claude settings.json is not an object");
    return { models: [], gateway: readClaudeGatewayConfig(process.env) };
  }

  const models: AgentModelDefinition[] = [];
  addSettingsModel(models, parsed.model, "model");

  const env = parsed.env;
  if (env === undefined) {
    return { models, gateway: readClaudeGatewayConfig(process.env) };
  }
  if (!isRecord(env)) {
    logger.debug({ settingsPath }, "Claude settings.json env is not an object");
    return { models, gateway: readClaudeGatewayConfig(process.env) };
  }

  for (const envKey of CLAUDE_SETTINGS_MODEL_ENV_KEYS) {
    addSettingsModel(models, env[envKey], `env.${envKey}`);
  }

  return {
    models,
    gateway: readClaudeGatewayConfig({ ...process.env, ...env }),
  };
}

function readClaudeGatewayConfig(env: Record<string, unknown>): ClaudeGatewayConfig | null {
  const baseUrl = readNonEmptyString(env.ANTHROPIC_BASE_URL);
  if (!baseUrl) {
    return null;
  }

  const authToken = readNonEmptyString(env.ANTHROPIC_AUTH_TOKEN);
  const apiKey = readNonEmptyString(env.ANTHROPIC_API_KEY);
  const customHeaders = readNonEmptyString(env.ANTHROPIC_CUSTOM_HEADERS);

  return {
    baseUrl,
    ...(authToken ? { authToken } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(customHeaders ? { customHeaders } : {}),
  };
}

async function readClaudeGatewayModels(
  logger: Logger,
  gateway: ClaudeGatewayConfig,
): Promise<AgentModelDefinition[]> {
  let modelsUrl: URL;
  try {
    modelsUrl = resolveGatewayModelsUrl(gateway.baseUrl);
  } catch (error) {
    logger.debug({ err: error }, "Claude gateway model discovery has an invalid base URL");
    return [];
  }

  try {
    const headers = new Headers({ Accept: "application/json" });
    if (gateway.apiKey) {
      headers.set("X-Api-Key", gateway.apiKey);
    }
    if (gateway.authToken) {
      headers.set("Authorization", `Bearer ${gateway.authToken}`);
    }
    addCustomHeaders(headers, gateway.customHeaders);

    const response = await fetch(modelsUrl, {
      headers,
      signal: AbortSignal.timeout(CLAUDE_GATEWAY_MODEL_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.debug(
        { modelsUrl: modelsUrl.toString(), status: response.status },
        "Claude gateway model discovery request failed",
      );
      return [];
    }

    return parseClaudeGatewayModels(await response.json(), modelsUrl);
  } catch (error) {
    logger.debug(
      { err: error, modelsUrl: modelsUrl.toString() },
      "Failed to discover Claude gateway models",
    );
    return [];
  }
}

function resolveGatewayModelsUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}${basePath.endsWith("/v1") ? "/models" : "/v1/models"}`;
  url.search = "";
  url.hash = "";
  return url;
}

function addCustomHeaders(headers: Headers, customHeaders: string | undefined): void {
  if (!customHeaders) {
    return;
  }

  for (const line of customHeaders.split("\n")) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex < 0) {
      continue;
    }
    const name = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (name.length > 0) {
      headers.set(name, value);
    }
  }
}

function parseClaudeGatewayModels(payload: unknown, modelsUrl: URL): AgentModelDefinition[] {
  const items = isRecord(payload) && Array.isArray(payload.data) ? payload.data : payload;
  if (!Array.isArray(items)) {
    return [];
  }

  const gatewayLabel = modelsUrl.hostname;
  const seenModelIds = new Set<string>();
  const models: AgentModelDefinition[] = [];

  for (const item of items) {
    if (!isRecord(item)) {
      continue;
    }
    const id = readNonEmptyString(item.id);
    if (!id || seenModelIds.has(id)) {
      continue;
    }
    seenModelIds.add(id);

    const owner = readNonEmptyString(item.owned_by);
    models.push({
      provider: "claude",
      id,
      label: id,
      description: `From ${gatewayLabel}${owner ? ` (${owner})` : ""}`,
    });
  }

  return models;
}

function resolveClaudeConfigDir(configDir?: string): string {
  return configDir ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
}

function addSettingsModel(
  models: AgentModelDefinition[],
  value: unknown,
  settingsKey: string,
): void {
  if (typeof value !== "string") {
    return;
  }

  const id = value.trim();
  if (id.length === 0 || models.some((model) => model.id === id)) {
    return;
  }

  models.push({
    provider: "claude",
    id,
    label: id,
    description: `From Claude settings.json ${settingsKey}`,
  });
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalize a runtime model string (from SDK init message) to a known model ID.
 * Handles the `[1m]` suffix that the SDK appends for 1M context sessions.
 */
export function normalizeClaudeRuntimeModelId(value: string | null | undefined): string | null {
  return normalizeClaudeManifestRuntimeModelId(value);
}
