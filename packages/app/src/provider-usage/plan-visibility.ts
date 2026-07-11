import type { ProviderUsage } from "./types";

/** New Workspace shows actionable, user-enabled plan data. */
export function visiblePlanUsageProviders(
  providers: readonly ProviderUsage[],
  hiddenProviderIds: ReadonlySet<string> = new Set(),
): ProviderUsage[] {
  return providers.filter(
    (provider) => provider.status !== "unavailable" && !hiddenProviderIds.has(provider.providerId),
  );
}
