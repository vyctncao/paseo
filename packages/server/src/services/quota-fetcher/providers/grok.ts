import { existsSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Logger } from "pino";
import { z } from "zod";
import type {
  ProviderUsage,
  ProviderUsageBalance,
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

const GrokUsageResponseSchema = z.object({
  config: z
    .object({
      monthlyLimit: z
        .object({
          val: ApiNumberSchema.optional(),
        })
        .nullish(),
      used: z
        .object({
          val: ApiNumberSchema.optional(),
        })
        .nullish(),
      creditUsagePercent: ApiNumberSchema.optional(),
      currentPeriod: z
        .object({
          type: ApiOptionalStringSchema,
          start: ApiOptionalStringSchema,
          end: ApiOptionalStringSchema,
        })
        .nullish(),
      billingPeriodEnd: ApiOptionalStringSchema,
    })
    .nullish(),
  usage: z
    .object({
      creditUsage: ApiNumberSchema.optional(),
    })
    .nullish(),
});

type GrokUsageResponse = z.infer<typeof GrokUsageResponseSchema>;

function creditWindowLabel(periodType: string | undefined): string {
  switch (periodType) {
    case "USAGE_PERIOD_TYPE_DAILY":
      return "Daily credits";
    case "USAGE_PERIOD_TYPE_WEEKLY":
      return "Weekly credits";
    case "USAGE_PERIOD_TYPE_MONTHLY":
      return "Monthly credits";
    default:
      return "Credits";
  }
}

function creditWindows(resp: GrokUsageResponse): ProviderUsageWindow[] {
  const creditUsagePercent = resp.config?.creditUsagePercent ?? null;
  if (creditUsagePercent === null) return [];

  return [
    windowFromUsedPct({
      id: "current_period_credits",
      label: creditWindowLabel(resp.config?.currentPeriod?.type),
      utilizationPct: creditUsagePercent,
      resetsAt: resp.config?.currentPeriod?.end ?? resp.config?.billingPeriodEnd ?? null,
    }),
  ];
}

function creditBalances(resp: GrokUsageResponse): ProviderUsageBalance[] {
  if (resp.config?.creditUsagePercent != null) return [];

  const monthlyLimit = resp.config?.monthlyLimit?.val ?? null;
  const creditUsage = resp.config?.used?.val ?? resp.usage?.creditUsage ?? null;
  if (monthlyLimit === null && creditUsage === null) return [];

  const remaining =
    monthlyLimit !== null && creditUsage !== null ? Math.max(0, monthlyLimit - creditUsage) : null;
  return [
    {
      id: "monthly_credits",
      label: "Monthly credits",
      used: creditUsage,
      remaining,
      limit: monthlyLimit,
      unit: "credits",
      resetsAt: resp.config?.billingPeriodEnd ?? null,
      tone: balanceToneFromRemaining(remaining),
    },
  ];
}

const GrokAuthEntrySchema = z.object({
  access_token: z.string().optional(),
  key: z.string().optional(),
});

const GrokAuthRecordSchema = z.record(z.string(), GrokAuthEntrySchema);

interface GrokQuotaProviderOptions {
  logger: Logger;
  fetch?: ProviderApiFetch;
  homeDir?: string;
}

export class GrokQuotaProvider implements ProviderUsageFetcher {
  readonly providerId = "grok";
  readonly displayName = "Grok";

  private readonly logger: Logger;
  private readonly fetchApi: ProviderApiFetch;
  private readonly homeDir?: string;

  constructor(options: GrokQuotaProviderOptions) {
    this.logger = options.logger;
    this.fetchApi = options.fetch ?? fetch;
    this.homeDir = options.homeDir;
  }

  async fetchUsage(): Promise<ProviderUsage> {
    const token =
      process.env["GROK_API_KEY"] || process.env["GROK_TOKEN"] || (await this.readGrokToken());

    if (!token) return unavailableUsage(this);

    const res = await fetchProviderApi(
      this.fetchApi,
      "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-XAI-Token-Auth": "xai-grok-cli",
          Accept: "application/json",
        },
      },
    );

    if (!res.ok) {
      this.logger.debug({ status: res.status }, "Grok usage fetch failed");
      return unavailableUsage(this);
    }

    const resp = GrokUsageResponseSchema.parse(await res.json());
    return {
      providerId: this.providerId,
      displayName: this.displayName,
      status: "available",
      planLabel: null,
      windows: creditWindows(resp),
      balances: creditBalances(resp),
      details: [],
      error: null,
    };
  }

  private async readGrokToken(): Promise<string | null> {
    const path = join(this.homeDir ?? homedir(), ".grok", "auth.json");
    if (!existsSync(path)) return null;
    try {
      const raw: unknown = JSON.parse(await fs.readFile(path, "utf8"));
      const directAuth = GrokAuthEntrySchema.parse(raw);
      const directToken = directAuth.access_token ?? directAuth.key;
      if (directToken) {
        return directToken;
      }

      const auth = GrokAuthRecordSchema.parse(raw);
      for (const entry of Object.values(auth)) {
        const token = entry.access_token ?? entry.key;
        if (token) return token;
      }
      return null;
    } catch {
      return null;
    }
  }
}
