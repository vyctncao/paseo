import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";

export const PROVIDER_USAGE_VISIBILITY_KEY = "@paseo:provider-usage-hidden-providers";
export const PROVIDER_USAGE_VISIBILITY_QUERY_KEY = ["provider-usage-visibility"] as const;
const EMPTY_HIDDEN_PROVIDER_IDS: string[] = [];

interface VisibilityStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function sanitizeHiddenProviderIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (providerId): providerId is string =>
          typeof providerId === "string" &&
          providerId.trim().length > 0 &&
          providerId.length <= 100,
      ),
    ),
  ];
}

export async function loadHiddenProviderIds(
  storage: VisibilityStorage = AsyncStorage,
): Promise<string[]> {
  const stored = await storage.getItem(PROVIDER_USAGE_VISIBILITY_KEY);
  if (!stored) return [];
  try {
    return sanitizeHiddenProviderIds(JSON.parse(stored));
  } catch {
    return [];
  }
}

export function useProviderUsageVisibility() {
  const queryClient = useQueryClient();
  const { data } = useFetchQuery({
    queryKey: PROVIDER_USAGE_VISIBILITY_QUERY_KEY,
    queryFn: () => loadHiddenProviderIds(),
    dataShape: "value",
    staleTimeMs: 60_000,
    gcTime: Infinity,
  });
  const hiddenProviderIds = data ?? EMPTY_HIDDEN_PROVIDER_IDS;
  const hiddenProviderIdSet = useMemo(() => new Set(hiddenProviderIds), [hiddenProviderIds]);

  const setProviderVisible = useCallback(
    async (providerId: string, visible: boolean) => {
      const current =
        queryClient.getQueryData<string[]>(PROVIDER_USAGE_VISIBILITY_QUERY_KEY) ??
        (await loadHiddenProviderIds());
      const next = new Set(current);
      if (visible) next.delete(providerId);
      else next.add(providerId);
      const nextIds = [...next];
      queryClient.setQueryData(PROVIDER_USAGE_VISIBILITY_QUERY_KEY, nextIds);
      await AsyncStorage.setItem(PROVIDER_USAGE_VISIBILITY_KEY, JSON.stringify(nextIds));
    },
    [queryClient],
  );

  return { hiddenProviderIds, hiddenProviderIdSet, setProviderVisible };
}
