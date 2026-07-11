import { describe, expect, it } from "vitest";
import type { ProviderUsage } from "./types";
import { visiblePlanUsageProviders } from "./plan-visibility";

function provider(providerId: string, status: ProviderUsage["status"]): ProviderUsage {
  return {
    providerId,
    displayName: providerId,
    status,
    planLabel: null,
    windows: [],
  };
}

describe("visiblePlanUsageProviders", () => {
  it("removes unavailable providers while retaining available and error states", () => {
    expect(
      visiblePlanUsageProviders([
        provider("codex", "available"),
        provider("cursor", "unavailable"),
        provider("claude", "error"),
      ]).map((entry) => entry.providerId),
    ).toEqual(["codex", "claude"]);
  });

  it("returns an empty list when every provider is unavailable", () => {
    expect(
      visiblePlanUsageProviders([
        provider("cursor", "unavailable"),
        provider("grok", "unavailable"),
      ]),
    ).toEqual([]);
  });

  it("removes providers hidden by the display preference", () => {
    expect(
      visiblePlanUsageProviders(
        [provider("codex", "available"), provider("kimi", "available")],
        new Set(["kimi"]),
      ).map((entry) => entry.providerId),
    ).toEqual(["codex"]);
  });
});
