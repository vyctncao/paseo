import { existsSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Logger } from "pino";
import { z } from "zod";
import type { ProviderUsage } from "../../../server/messages.js";
import type { ProviderUsageFetcher } from "../provider.js";
import { unavailableUsage } from "../usage.js";

const GeminiSettingsSchema = z.object({
  security: z
    .object({
      auth: z
        .object({
          selectedType: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

interface GeminiQuotaProviderOptions {
  logger: Logger;
  geminiHome?: string;
}

/**
 * Gemini API-key quotas do not expose consumed allowance through the public API.
 * Keep the connected provider visible and name the authoritative usage surface
 * instead of silently dropping it from Plan Usage.
 */
export class GeminiQuotaProvider implements ProviderUsageFetcher {
  readonly providerId = "gemini";
  readonly displayName = "Gemini";

  private readonly geminiHome: string;

  constructor(options: GeminiQuotaProviderOptions) {
    const cliHome = process.env["GEMINI_CLI_HOME"] || homedir();
    this.geminiHome = options.geminiHome || join(cliHome, ".gemini");
  }

  async fetchUsage(): Promise<ProviderUsage> {
    const authType = await this.readAuthType();
    const hasApiKey = Boolean(process.env["GEMINI_API_KEY"] || process.env["GOOGLE_API_KEY"]);
    if (!authType && !hasApiKey) return unavailableUsage(this);

    const usesApiKey = hasApiKey || authType === "gemini-api-key";
    return {
      providerId: this.providerId,
      displayName: this.displayName,
      status: "available",
      planLabel: usesApiKey ? "API key" : "Google account",
      windows: [],
      balances: [],
      details: [
        {
          id: "usage_source",
          label: "Usage",
          value: usesApiKey ? "Google AI Studio" : "Gemini CLI /model",
        },
      ],
      error: null,
    };
  }

  private async readAuthType(): Promise<string | null> {
    const path = join(this.geminiHome, "settings.json");
    if (!existsSync(path)) return null;
    try {
      const settings = GeminiSettingsSchema.parse(JSON.parse(await fs.readFile(path, "utf8")));
      return settings.security?.auth?.selectedType ?? null;
    } catch {
      return null;
    }
  }
}
