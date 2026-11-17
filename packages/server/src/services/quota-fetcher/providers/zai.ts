import type { Logger } from "pino";
import { z } from "zod";
import type {
  ProviderUsage,
  ProviderUsageBalance,
  ProviderUsageDetail,
  ProviderUsageWindow,
} from "../../../server/messages.js";
import type { ProviderApiFetch, ProviderUsageFetcher } from "../provider.js";
import {
  ApiNumberSchema,
  ApiOptionalStringSchema,
  balanceToneFromRemaining,
  fetchProviderApi,
  unavailableUsage,
  windowFromUsedPct,
} from "../usage.js";

const ZAI_ORIGIN = "https://api.z.ai";

const ZaiSubscriptionResponseSchema = z.object({
  data: z
    .array(
      z.object({
        productName: ApiOptionalStringSchema,
        status: ApiOptionalStringSchema,
        purchaseTime: ApiOptionalStringSchema,
        valid: ApiOptionalStringSchema,
      }),
    )
    .optional(),
});

const ZaiQuotaLimitSchema = z.object({
  type: ApiOptionalStringSchema,
  percentage: ApiNumberSchema.optional(),
  currentValue: ApiNumberSchema.optional(),
  usage: ApiNumberSchema.optional(),
});

const ZaiQuotaResponseSchema = z.object({
  data: z
    .object({
      limits: z.array(ZaiQuotaLimitSchema).optional(),
    })
    .optional(),
});

type ZaiQuotaLimit = z.infer<typeof ZaiQuotaLimitSchema>;

interface ZaiResolvedAuth {
  origin: string;
  token: string;
}

interface ZaiQuotaProviderOptions {
  logger: Logger;
  fetch?: ProviderApiFetch;
  env?: NodeJS.ProcessEnv;
}

function resolveOrigin(baseUrl: string | undefined): string | null {
  if (!baseUrl) return ZAI_ORIGIN;
  try {
    const parsed = new URL(baseUrl);
    if (
      parsed.hostname === "api.z.ai" ||
      parsed.hostname === "open.bigmodel.cn" ||
      parsed.hostname === "dev.bigmodel.cn"
    ) {
      return parsed.origin;
    }
  } catch {
    return null;
  }
  return null;
}

function quotaLabel(type: string | undefined): string {
  if (type === "TOKENS_LIMIT") return "5h token usage";
  if (type === "TIME_LIMIT") return "Monthly MCP calls";
  return (type ?? "Plan usage")
    .toLowerCase()
    .split("_")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function quotaId(type: string | undefined, index: number): string {
  return (type ?? `limit_${index}`).toLowerCase();
}

function toQuotaBalance(limit: ZaiQuotaLimit, index: number): ProviderUsageBalance | null {
  if (typeof limit.currentValue !== "number" || typeof limit.usage !== "number") return null;
  const remaining = Math.max(0, limit.usage - limit.currentValue);
  return {
    id: quotaId(limit.type, index),
    label: quotaLabel(limit.type),
    used: limit.currentValue,
    remaining,
    limit: limit.usage,
    unit: "requests",
    resetsAt: null,
    tone: balanceToneFromRemaining(remaining),
  };
}

function toQuotaWindow(limit: ZaiQuotaLimit, index: number): ProviderUsageWindow | null {
  if (typeof limit.percentage !== "number") return null;
  return windowFromUsedPct({
    id: quotaId(limit.type, index),
    label: quotaLabel(limit.type),
    utilizationPct: Math.max(0, Math.min(100, limit.percentage)),
    resetsAt: null,
  });
}

function parseQuotaPayload(payload: unknown): {
  windows: ProviderUsageWindow[];
  balances: ProviderUsageBalance[];
} {
  const quota = ZaiQuotaResponseSchema.parse(payload);
  const windows: ProviderUsageWindow[] = [];
  const balances: ProviderUsageBalance[] = [];
  for (const [index, limit] of (quota.data?.limits ?? []).entries()) {
    const balance = toQuotaBalance(limit, index);
    if (balance) balances.push(balance);
    else {
      const window = toQuotaWindow(limit, index);
      if (window) windows.push(window);
    }
  }
  return { windows, balances };
}

function parseSubscriptionPayload(payload: unknown): {
  planLabel: string | null;
  details: ProviderUsageDetail[];
} {
  const resp = ZaiSubscriptionResponseSchema.parse(payload);
  const sub = resp.data?.[0];
  const details: ProviderUsageDetail[] = [];
  if (sub?.status) details.push({ id: "status", label: "Status", value: sub.status });
  if (sub?.valid) details.push({ id: "valid", label: "Valid", value: sub.valid });
  if (sub?.purchaseTime) {
    details.push({ id: "purchase_time", label: "Purchased", value: sub.purchaseTime });
  }
  return { planLabel: sub?.productName ?? null, details };
}

export class ZaiQuotaProvider implements ProviderUsageFetcher {
  readonly providerId = "zai";
  readonly displayName = "GLM";

  private readonly logger: Logger;
  private readonly fetchApi: ProviderApiFetch;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: ZaiQuotaProviderOptions) {
    this.logger = options.logger;
    this.fetchApi = options.fetch ?? fetch;
    this.env = options.env ?? process.env;
  }

  async fetchUsage(): Promise<ProviderUsage> {
    const auth = this.resolveAuth();
    if (!auth) return unavailableUsage(this);

    const quotaRes = await fetchProviderApi(
      this.fetchApi,
      `${auth.origin}/api/monitor/usage/quota/limit`,
      {
        headers: {
          Authorization: auth.token,
          "Accept-Language": "en-US,en",
          Accept: "application/json",
        },
      },
    );
    const quota = quotaRes.ok
      ? parseQuotaPayload(await quotaRes.json())
      : { windows: [], balances: [] };
    if (!quotaRes.ok) {
      this.logger.debug({ status: quotaRes.status }, "GLM quota fetch failed");
    }

    const subscriptionRes = await fetchProviderApi(
      this.fetchApi,
      `${auth.origin}/api/biz/subscription/list`,
      {
        headers: {
          Authorization: auth.token.startsWith("Bearer ") ? auth.token : `Bearer ${auth.token}`,
          Accept: "application/json",
        },
      },
    );
    const subscription = subscriptionRes.ok
      ? parseSubscriptionPayload(await subscriptionRes.json())
      : { planLabel: null, details: [] };
    if (!subscriptionRes.ok) {
      this.logger.debug({ status: subscriptionRes.status }, "GLM subscription fetch failed");
    }

    if (quota.windows.length === 0 && quota.balances.length === 0 && !subscription.planLabel) {
      return unavailableUsage(this);
    }

    return {
      providerId: this.providerId,
      displayName: this.displayName,
      status: "available",
      planLabel: subscription.planLabel,
      windows: quota.windows,
      balances: quota.balances,
      details: subscription.details,
      error: null,
    };
  }

  private resolveAuth(): ZaiResolvedAuth | null {
    const anthropicToken = this.env["ANTHROPIC_AUTH_TOKEN"];
    const anthropicOrigin = resolveOrigin(this.env["ANTHROPIC_BASE_URL"]);
    if (anthropicToken && this.env["ANTHROPIC_BASE_URL"] && anthropicOrigin) {
      return { origin: anthropicOrigin, token: anthropicToken };
    }

    const apiKey = this.env["ZAI_API_KEY"] || this.env["GLM_API_KEY"];
    return apiKey ? { origin: ZAI_ORIGIN, token: apiKey } : null;
  }
}
