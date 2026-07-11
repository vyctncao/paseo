import { describe, expect, it } from "vitest";
import {
  loadHiddenProviderIds,
  PROVIDER_USAGE_VISIBILITY_KEY,
  sanitizeHiddenProviderIds,
} from "./use-provider-usage-visibility";

function storage(value: string | null) {
  return {
    getItem: async () => value,
    setItem: async () => undefined,
  };
}

describe("provider usage visibility storage", () => {
  it("defaults to showing every provider", async () => {
    await expect(loadHiddenProviderIds(storage(null))).resolves.toEqual([]);
  });

  it("loads unique valid hidden provider ids", async () => {
    await expect(
      loadHiddenProviderIds(storage(JSON.stringify(["claude", "kimi", "claude", "", 42]))),
    ).resolves.toEqual(["claude", "kimi"]);
  });

  it("recovers from malformed storage", async () => {
    await expect(loadHiddenProviderIds(storage("not json"))).resolves.toEqual([]);
  });

  it("exports a stable storage key and sanitizer", () => {
    expect(PROVIDER_USAGE_VISIBILITY_KEY).toBe("@paseo:provider-usage-hidden-providers");
    expect(sanitizeHiddenProviderIds({ providerId: "claude" })).toEqual([]);
  });
});
