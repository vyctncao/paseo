import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { GestureResponderEvent } from "react-native";

type ArchiveWorkspace = () => Promise<boolean>;

interface WorkspaceMultiSelectEvent {
  nativeEvent: object;
}

interface SidebarWorkspaceMultiSelectValue {
  selectedWorkspaceKeys: ReadonlySet<string>;
  isArchiving: boolean;
  toggleFromPress: (event: GestureResponderEvent, workspaceKey: string) => boolean;
  beginRangeDrag: (event: GestureResponderEvent, workspaceKey: string) => boolean;
  extendRangeDrag: (event: WorkspaceMultiSelectEvent, workspaceKey: string) => void;
  clearSelection: () => void;
  registerArchiveHandler: (workspaceKey: string, archive: ArchiveWorkspace) => () => void;
  archiveSelected: () => Promise<void>;
}

const SidebarWorkspaceMultiSelectContext = createContext<SidebarWorkspaceMultiSelectValue | null>(
  null,
);

export function hasWorkspaceMultiSelectModifier(event: WorkspaceMultiSelectEvent): boolean {
  return workspaceMultiSelectModifier(event) !== null;
}

export function workspaceMultiSelectModifier(
  event: WorkspaceMultiSelectEvent,
): "range" | "toggle" | null {
  const nativeEvent = event.nativeEvent as {
    shiftKey?: boolean;
    metaKey?: boolean;
    ctrlKey?: boolean;
  };
  if (nativeEvent.shiftKey) return "range";
  if (nativeEvent.metaKey || nativeEvent.ctrlKey) return "toggle";
  return null;
}

export function selectWorkspaceKeyRange(input: {
  orderedWorkspaceKeys: readonly string[];
  anchorKey: string | null;
  targetKey: string;
}): Set<string> {
  const targetIndex = input.orderedWorkspaceKeys.indexOf(input.targetKey);
  const anchorIndex = input.anchorKey ? input.orderedWorkspaceKeys.indexOf(input.anchorKey) : -1;
  if (targetIndex < 0 || anchorIndex < 0) {
    return new Set([input.targetKey]);
  }
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return new Set(input.orderedWorkspaceKeys.slice(start, end + 1));
}

export function SidebarWorkspaceMultiSelectProvider({
  orderedWorkspaceKeys,
  children,
}: {
  orderedWorkspaceKeys: readonly string[];
  children: ReactNode;
}) {
  const [selectedWorkspaceKeys, setSelectedWorkspaceKeys] = useState<Set<string>>(() => new Set());
  const [isArchiving, setIsArchiving] = useState(false);
  const archiveHandlersRef = useRef(new Map<string, ArchiveWorkspace>());
  const selectionAnchorRef = useRef<string | null>(null);
  const rangeDragActiveRef = useRef(false);

  const selectRangeTo = useCallback(
    (workspaceKey: string) => {
      const anchorKey = selectionAnchorRef.current ?? workspaceKey;
      selectionAnchorRef.current = anchorKey;
      setSelectedWorkspaceKeys(
        selectWorkspaceKeyRange({
          orderedWorkspaceKeys,
          anchorKey,
          targetKey: workspaceKey,
        }),
      );
    },
    [orderedWorkspaceKeys],
  );

  const toggleFromPress = useCallback(
    (event: GestureResponderEvent, workspaceKey: string): boolean => {
      const modifier = workspaceMultiSelectModifier(event);
      if (modifier === "range") {
        selectRangeTo(workspaceKey);
        return true;
      }
      if (modifier === null) {
        selectionAnchorRef.current = workspaceKey;
        setSelectedWorkspaceKeys((current) => (current.size === 0 ? current : new Set()));
        return false;
      }
      selectionAnchorRef.current = workspaceKey;
      setSelectedWorkspaceKeys((current) => {
        const next = new Set(current);
        if (next.has(workspaceKey)) next.delete(workspaceKey);
        else next.add(workspaceKey);
        return next;
      });
      return true;
    },
    [selectRangeTo],
  );

  const beginRangeDrag = useCallback(
    (event: GestureResponderEvent, workspaceKey: string): boolean => {
      if (workspaceMultiSelectModifier(event) !== "range") {
        return false;
      }
      rangeDragActiveRef.current = true;
      selectRangeTo(workspaceKey);
      return true;
    },
    [selectRangeTo],
  );

  const extendRangeDrag = useCallback(
    (event: WorkspaceMultiSelectEvent, workspaceKey: string): void => {
      if (!rangeDragActiveRef.current) return;
      const nativeEvent = event.nativeEvent as { buttons?: number };
      if (nativeEvent.buttons === 0) {
        rangeDragActiveRef.current = false;
        return;
      }
      selectRangeTo(workspaceKey);
    },
    [selectRangeTo],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const endRangeDrag = () => {
      rangeDragActiveRef.current = false;
    };
    window.addEventListener("pointerup", endRangeDrag);
    window.addEventListener("pointercancel", endRangeDrag);
    return () => {
      window.removeEventListener("pointerup", endRangeDrag);
      window.removeEventListener("pointercancel", endRangeDrag);
    };
  }, []);

  const clearSelection = useCallback(() => {
    selectionAnchorRef.current = null;
    setSelectedWorkspaceKeys(new Set());
  }, []);
  const registerArchiveHandler = useCallback((workspaceKey: string, archive: ArchiveWorkspace) => {
    archiveHandlersRef.current.set(workspaceKey, archive);
    return () => {
      if (archiveHandlersRef.current.get(workspaceKey) === archive) {
        archiveHandlersRef.current.delete(workspaceKey);
      }
    };
  }, []);

  const archiveSelected = useCallback(async () => {
    if (isArchiving || selectedWorkspaceKeys.size === 0) return;
    setIsArchiving(true);
    const archivedKeys: string[] = [];
    try {
      for (const workspaceKey of selectedWorkspaceKeys) {
        const archive = archiveHandlersRef.current.get(workspaceKey);
        if (!archive || (await archive())) archivedKeys.push(workspaceKey);
      }
    } finally {
      setSelectedWorkspaceKeys((current) => {
        const next = new Set(current);
        for (const workspaceKey of archivedKeys) next.delete(workspaceKey);
        return next;
      });
      setIsArchiving(false);
    }
  }, [isArchiving, selectedWorkspaceKeys]);

  const value = useMemo<SidebarWorkspaceMultiSelectValue>(
    () => ({
      selectedWorkspaceKeys,
      isArchiving,
      toggleFromPress,
      beginRangeDrag,
      extendRangeDrag,
      clearSelection,
      registerArchiveHandler,
      archiveSelected,
    }),
    [
      archiveSelected,
      beginRangeDrag,
      clearSelection,
      extendRangeDrag,
      isArchiving,
      registerArchiveHandler,
      selectedWorkspaceKeys,
      toggleFromPress,
    ],
  );

  return (
    <SidebarWorkspaceMultiSelectContext.Provider value={value}>
      {children}
    </SidebarWorkspaceMultiSelectContext.Provider>
  );
}

export function useSidebarWorkspaceMultiSelect(): SidebarWorkspaceMultiSelectValue {
  const value = useContext(SidebarWorkspaceMultiSelectContext);
  if (!value) throw new Error("Workspace multi-select must be used inside its provider");
  return value;
}
