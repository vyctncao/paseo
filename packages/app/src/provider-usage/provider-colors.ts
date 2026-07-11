export interface ProviderUsageColors {
  icon: string;
  bar: string;
}

const PROVIDER_USAGE_COLORS: Readonly<Record<string, ProviderUsageColors>> = {
  claude: {
    icon: "#D97757",
    bar: "#39D0BE",
  },
  codex: {
    icon: "#10A37F",
    bar: "#7C8CFF",
  },
  grok: {
    icon: "#FF6B7A",
    bar: "#F472B6",
  },
};

export function getProviderUsageColors(providerId: string): ProviderUsageColors | null {
  return PROVIDER_USAGE_COLORS[providerId.toLowerCase()] ?? null;
}
