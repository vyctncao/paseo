import { useMemo } from "react";
import { Image, View } from "react-native";
import { Globe } from "lucide-react-native";
import invariant from "tiny-invariant";
import { BrowserPane } from "@/components/browser-pane";
import { PanelChromeHeader } from "@/components/panel-chrome-header";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import type { PanelDescriptor, PanelIconProps, PanelRegistration } from "@/panels/panel-registry";
import { useBrowserStore } from "@/stores/browser-store";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";

const FLEX_FILL_STYLE = { flex: 1, minHeight: 0 } as const;

function getBrowserLabel(input: { title: string; url: string }): string {
  const title = input.title.trim();
  if (title) {
    return title;
  }

  try {
    const parsed = new URL(input.url);
    return parsed.hostname || input.url;
  } catch {
    return input.url;
  }
}

function createBrowserTabIcon(faviconUrl: string | null) {
  return function BrowserTabIcon({ size, color }: PanelIconProps) {
    const source = useMemo(() => (faviconUrl ? { uri: faviconUrl } : undefined), []);
    const imageStyle = useMemo(() => ({ width: size, height: size, borderRadius: 3 }), [size]);

    if (faviconUrl) {
      return <Image accessibilityIgnoresInvertColors source={source} style={imageStyle} />;
    }

    return <Globe size={size} color={color} />;
  };
}

function useBrowserPanelDescriptor(target: {
  kind: "browser";
  browserId: string;
}): PanelDescriptor {
  const browser = useBrowserStore((state) => state.browsersById[target.browserId] ?? null);
  const url = browser?.url ?? "https://example.com";
  const icon = createBrowserTabIcon(browser?.faviconUrl ?? null);

  return {
    label: getBrowserLabel({ title: browser?.title ?? "", url }),
    subtitle: url,
    titleState: "ready",
    icon,
    statusBucket: browser?.isLoading ? "running" : null,
  };
}

function BrowserPanel() {
  const { serverId, workspaceId, target, closeCurrentTab } = usePaneContext();
  const { focusPane, isInteractive } = usePaneFocus();
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  invariant(target.kind === "browser", "BrowserPanel requires browser target");
  const browser = useBrowserStore((state) => state.browsersById[target.browserId] ?? null);
  const browserLabel = getBrowserLabel({
    title: browser?.title ?? "",
    url: browser?.url ?? "https://example.com",
  });
  return (
    <View style={FLEX_FILL_STYLE}>
      <PanelChromeHeader
        icon="browser"
        title={browserLabel}
        subtitle={browser?.url}
        closeLabel="Close browser"
        onClose={closeCurrentTab}
      />
      <BrowserPane
        browserId={target.browserId}
        serverId={serverId}
        workspaceId={workspaceId}
        cwd={cwd}
        isInteractive={isInteractive}
        onFocusPane={focusPane}
      />
    </View>
  );
}

export const browserPanelRegistration: PanelRegistration<"browser"> = {
  kind: "browser",
  component: BrowserPanel,
  useDescriptor: useBrowserPanelDescriptor,
};
