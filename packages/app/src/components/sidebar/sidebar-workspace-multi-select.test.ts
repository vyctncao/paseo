import { describe, expect, it } from "vitest";
import type { GestureResponderEvent } from "react-native";
import {
  hasWorkspaceMultiSelectModifier,
  selectWorkspaceKeyRange,
  workspaceMultiSelectModifier,
} from "./sidebar-workspace-multi-select";

function pressEvent(modifiers: {
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}): GestureResponderEvent {
  return { nativeEvent: modifiers } as unknown as GestureResponderEvent;
}

describe("hasWorkspaceMultiSelectModifier", () => {
  it.each(["shiftKey", "metaKey", "ctrlKey"] as const)(
    "enables workspace multi-select for %s presses",
    (modifier) => {
      expect(hasWorkspaceMultiSelectModifier(pressEvent({ [modifier]: true }))).toBe(true);
    },
  );

  it("leaves a regular workspace press as navigation", () => {
    expect(hasWorkspaceMultiSelectModifier(pressEvent({}))).toBe(false);
  });

  it("prefers Shift range selection when another modifier is also held", () => {
    expect(workspaceMultiSelectModifier(pressEvent({ shiftKey: true, metaKey: true }))).toBe(
      "range",
    );
    expect(workspaceMultiSelectModifier(pressEvent({ metaKey: true }))).toBe("toggle");
  });
});

describe("selectWorkspaceKeyRange", () => {
  const orderedWorkspaceKeys = ["one", "two", "three", "four"];

  it("selects a contiguous range in either direction", () => {
    expect([
      ...selectWorkspaceKeyRange({
        orderedWorkspaceKeys,
        anchorKey: "one",
        targetKey: "three",
      }),
    ]).toEqual(["one", "two", "three"]);
    expect([
      ...selectWorkspaceKeyRange({
        orderedWorkspaceKeys,
        anchorKey: "four",
        targetKey: "two",
      }),
    ]).toEqual(["two", "three", "four"]);
  });

  it("selects only the target when there is no visible anchor", () => {
    expect([
      ...selectWorkspaceKeyRange({
        orderedWorkspaceKeys,
        anchorKey: "missing",
        targetKey: "three",
      }),
    ]).toEqual(["three"]);
  });
});
