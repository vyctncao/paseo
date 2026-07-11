import { existsSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Logger } from "pino";
import { z } from "zod";
import type { ProviderUsage, ProviderUsageWindow } from "../../../server/messages.js";
import type { ProviderApiFetch, ProviderUsageFetcher } from "../provider.js";
import {
  ApiNumberSchema,
  ApiOptionalStringSchema,
  fetchProviderApi,
  unavailableUsage,
  windowFromUsedPct,
} from "../usage.js";

const KIMI_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
const KIMI_OAUTH_URL = "https://auth.kimi.com/api/oauth/token";
const KIMI_USAGE_URL = "https://api.kimi.com/coding/v1/usages";

const KimiUsageRowSchema = z.object({
  limit: ApiNumberSchema.optional(),
  used: ApiNumberSchema.optional(),
  remaining: ApiNumberSchema.optional(),
  resetTime: ApiOptionalStringSchema,
  resetAt: ApiOptionalStringSchema,
  reset_time: ApiOptionalStringSchema,
  reset_at: ApiOptionalStringSchema,
  name: ApiOptionalStringSchema,
  title: ApiOptionalStringSchema,
});

const KimiUsageResponseSchema = z.object({
  usage: KimiUsageRowSchema.nullish(),
  limits: z
    .array(
      z.object({
        name: ApiOptionalStringSchema,
        title: ApiOptionalStringSchema,
        scope: ApiOptionalStringSchema,
        detail: KimiUsageRowSchema.nullish(),
        window: z
          .object({
            duration: ApiNumberSchema.optional(),
            timeUnit: ApiOptionalStringSchema,
          })
          .nullish(),
      }),
    )
    .nullish(),
});

const KimiAuthSchema = z.object({
  access_token: z.string().optional(),
  refresh_token: z.string().optional(),
  expires_at: ApiNumberSchema.optional(),
  expires_in: ApiNumberSchema.optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

const KimiTokenRefreshSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: ApiNumberSchema.optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

type KimiAuth = z.infer<typeof KimiAuthSchema>;
type KimiUsageRow = z.infer<typeof KimiUsageRowSchema>;

interface KimiCredentialRecord {
  auth: KimiAuth & { access_token: string };
  path: string | null;
}

interface KimiQuotaProviderOptions {
  logger: Logger;
  fetch?: ProviderApiFetch;
  homeDir?: string;
}

export class KimiQuotaProvider implements ProviderUsageFetcher {
  readonly providerId = "kimi";
  readonly displayName = "Kimi";

  private readonly logger: Logger;
  private readonly fetchApi: ProviderApiFetch;
  private readonly homeDir?: string;

  constructor(options: KimiQuotaProviderOptions) {
    this.logger = options.logger;
    this.fetchApi = options.fetch ?? fetch;
    this.homeDir = options.homeDir;
  }

  async fetchUsage(): Promise<ProviderUsage> {
    const envToken = process.env["KIMI_TOKEN"] || process.env["KIMI_API_KEY"];
    const credential = envToken
      ? { auth: { access_token: envToken }, path: null }
      : await this.readKimiCredentials();

    if (!credential) return unavailableUsage(this);

    let res = await this.callKimiUsageApi(credential.auth.access_token);
    if ((res.status === 401 || res.status === 403) && credential.auth.refresh_token) {
      const refreshed = await this.refreshKimiToken(credential.auth.refresh_token);
      if (!refreshed) return unavailableUsage(this);

      if (credential.path) {
        await this.saveKimiCredentials(credential.path, credential.auth, refreshed);
      }
      res = await this.callKimiUsageApi(refreshed.access_token);
    }

    if (!res.ok) {
      this.logger.debug({ status: res.status }, "Kimi usage fetch failed");
      return unavailableUsage(this);
    }

    const resp = KimiUsageResponseSchema.parse(await res.json());
    const windows: ProviderUsageWindow[] = [];
    if (resp.usage) {
      windows.push(this.toWindow("coding_usage", "Weekly limit", resp.usage));
    }
    for (const [index, limit] of (resp.limits ?? []).entries()) {
      if (!limit.detail) continue;
      windows.push(
        this.toWindow(
          `coding_limit_${index}`,
          limit.name ?? limit.title ?? limit.scope ?? this.windowLabel(limit.window, index),
          limit.detail,
        ),
      );
    }

    return {
      providerId: this.providerId,
      displayName: this.displayName,
      status: "available",
      planLabel: null,
      windows,
      balances: [],
      details: [],
      error: null,
    };
  }

  private callKimiUsageApi(token: string): Promise<Response> {
    return fetchProviderApi(this.fetchApi, KIMI_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
  }

  private async refreshKimiToken(refreshToken: string) {
    const res = await fetchProviderApi(this.fetchApi, KIMI_OAUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: KIMI_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    });
    if (!res.ok) {
      this.logger.debug({ status: res.status }, "Kimi token refresh failed");
      return null;
    }
    return KimiTokenRefreshSchema.parse(await res.json());
  }

  private async readKimiCredentials(): Promise<KimiCredentialRecord | null> {
    const homeDir = this.homeDir ?? homedir();
    const paths = [
      join(
        process.env["KIMI_CODE_HOME"] || join(homeDir, ".kimi-code"),
        "credentials",
        "kimi-code.json",
      ),
      join(homeDir, ".kimi", "credentials", "kimi-code.json"),
    ];

    for (const path of paths) {
      if (!existsSync(path)) continue;
      try {
        const credentials = KimiAuthSchema.parse(JSON.parse(await fs.readFile(path, "utf8")));
        if (credentials.access_token) {
          return { auth: { ...credentials, access_token: credentials.access_token }, path };
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  private async saveKimiCredentials(
    path: string,
    previous: KimiAuth,
    refreshed: z.infer<typeof KimiTokenRefreshSchema>,
  ): Promise<void> {
    const expiresIn = refreshed.expires_in ?? previous.expires_in ?? 0;
    const next: KimiAuth = {
      ...previous,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? previous.refresh_token,
      expires_in: expiresIn,
      expires_at: expiresIn > 0 ? Date.now() / 1000 + expiresIn : previous.expires_at,
      scope: refreshed.scope ?? previous.scope,
      token_type: refreshed.token_type ?? previous.token_type,
    };
    await fs.writeFile(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  }

  private toWindow(id: string, label: string, row: KimiUsageRow): ProviderUsageWindow {
    const limit = row.limit;
    const used =
      row.used ??
      (limit !== undefined && row.remaining !== undefined ? limit - row.remaining : undefined);
    const usedPct =
      limit !== undefined && limit > 0 && used !== undefined
        ? Math.max(0, Math.min(100, (used / limit) * 100))
        : null;
    return windowFromUsedPct({
      id,
      label: row.name ?? row.title ?? label,
      utilizationPct: usedPct,
      resetsAt: row.resetTime ?? row.resetAt ?? row.reset_time ?? row.reset_at ?? null,
      tone: "ok",
    });
  }

  private windowLabel(
    window: { duration?: number; timeUnit?: string } | null | undefined,
    index: number,
  ): string {
    if (!window?.duration) return `Limit ${index + 1}`;
    const unit = window.timeUnit?.toUpperCase() ?? "";
    if (unit.includes("MINUTE") && window.duration % 60 === 0) {
      return `${window.duration / 60}h limit`;
    }
    if (unit.includes("MINUTE")) return `${window.duration}m limit`;
    if (unit.includes("HOUR")) return `${window.duration}h limit`;
    if (unit.includes("DAY")) return `${window.duration}d limit`;
    return `Limit ${index + 1}`;
  }
}
