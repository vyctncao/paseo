import { describe, expect, it } from "vitest";
import { getProviderUsageColors } from "./provider-colors";

describe("getProviderUsageColors", () => {
  it.each(["claude", "codex", "grok"])("returns distinct colors for %s", (providerId) => {
    const colors = getProviderUsageColors(providerId);

    expect(colors).not.toBeNull();
    expect(colors?.icon).not.toBe(colors?.bar);
  });

  it("matches provider ids without case sensitivity", () => {
    expect(getProviderUsageColors("Claude")).toEqual(getProviderUsageColors("claude"));
  });

  it("keeps unknown providers on the theme defaults", () => {
    expect(getProviderUsageColors("unknown")).toBeNull();
  });
});
