import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { agentPetLifecycle } from "@/components/pet/pet-lifecycle";
import { useSessionStore } from "@/stores/session-store";
import { collectAllTabs, findPaneById } from "@/stores/workspace-layout-actions";
import {
  buildWorkspaceTabPersistenceKey,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import type { SidebarAgentRowInput, SidebarWorkspaceGroupInput } from "./sidebar-agent-rows";

/**
 * Projects one workspace's open agent tabs into the shape `buildSidebarWorkspaceGroup`
 * consumes, so chats can be listed under their branch in the sidebar.
 *
 * Both store reads are deep-compared. The layout object is replaced on every focus or
 * split change, and the session store's agent map churns identity on every status tick;
 * without `useStoreWithEqualityFn` each tick would rerender every sidebar row. This is
 * the same idiom `use-sidebar-workspaces-list.ts` uses, for the same reason.
 */
export interface SidebarWorkspaceAgentGroup {
  input: SidebarWorkspaceGroupInput;
  /** Focused tab of the workspace's focused pane; drives the row's active highlight. */
  activeTabId: string | null;
  /** Provider per tab, so the caller can resolve each row's pet. */
  providerByTabId: Record<string, string>;
}

interface LayoutSlice {
  agentTabs: { tabId: string; agentId: string }[];
  activeTabId: string | null;
}

export function useSidebarWorkspaceAgentGroup(params: {
  serverId: string;
  workspaceId: string;
  branch: string | null;
  displayName: string;
}): SidebarWorkspaceAgentGroup | null {
  const { serverId, workspaceId, branch, displayName } = params;

  const layoutSlice = useStoreWithEqualityFn(
    useWorkspaceLayoutStore,
    (state): LayoutSlice | null => {
      const key = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
      const layout = key ? state.layoutByWorkspace[key] : undefined;
      if (!layout) return null;
      const agentTabs = collectAllTabs(layout.root).flatMap((tab) =>
        tab.target.kind === "agent" ? [{ tabId: tab.tabId, agentId: tab.target.agentId }] : [],
      );
      return {
        agentTabs,
        activeTabId: findPaneById(layout.root, layout.focusedPaneId)?.focusedTabId ?? null,
      };
    },
    equal,
  );

  return useStoreWithEqualityFn(
    useSessionStore,
    (state): SidebarWorkspaceAgentGroup | null => {
      if (!layoutSlice) return null;
      const agents = state.sessions[serverId]?.agents;
      const rows: SidebarAgentRowInput[] = [];
      const providerByTabId: Record<string, string> = {};

      for (const { tabId, agentId } of layoutSlice.agentTabs) {
        const agent = agents?.get(agentId);
        if (!agent) continue;
        // `agentLastActivity` is the live-coalesced freshest timestamp; the agent's own
        // `lastActivityAt` is the fallback. Same resolution as `getAgentDirectory`.
        const lastActivityAt = state.agentLastActivity.get(agentId) ?? agent.lastActivityAt;
        rows.push({
          tabId,
          agentId,
          title: agent.title ?? "",
          cwd: agent.cwd,
          lifecycle: agentPetLifecycle({
            status: agent.status,
            pendingPermissionCount: agent.pendingPermissions.length,
            attentionReason: agent.attentionReason,
          }),
          lastActivityAtMs: lastActivityAt.getTime(),
        });
        providerByTabId[tabId] = agent.provider;
      }

      return {
        input: { workspaceId, branch, displayName, agents: rows },
        activeTabId: layoutSlice.activeTabId,
        providerByTabId,
      };
    },
    equal,
  );
}
