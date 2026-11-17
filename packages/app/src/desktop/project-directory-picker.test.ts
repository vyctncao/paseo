import { describe, expect, it, vi } from "vitest";
import type { DesktopDialogBridge } from "@/desktop/host";
import { chooseProjectDirectory } from "./project-directory-picker";

describe("chooseProjectDirectory", () => {
  it("opens a single-directory desktop dialog and returns the selected path", async () => {
    const open = vi.fn(async () => "/Users/test/Projects/paseo");
    const dialog: DesktopDialogBridge = { open };

    await expect(
      chooseProjectDirectory(dialog, {
        title: "Choose folder…",
        defaultPath: " /Users/test/Projects ",
      }),
    ).resolves.toBe("/Users/test/Projects/paseo");

    expect(open).toHaveBeenCalledWith({
      title: "Choose folder…",
      defaultPath: "/Users/test/Projects",
      directory: true,
      multiple: false,
    });
  });

  it("returns null when the dialog is canceled or unavailable", async () => {
    const canceledDialog: DesktopDialogBridge = { open: vi.fn(async () => null) };

    await expect(
      chooseProjectDirectory(canceledDialog, { title: "Choose folder…" }),
    ).resolves.toBeNull();
    await expect(
      chooseProjectDirectory(undefined, { title: "Choose folder…" }),
    ).resolves.toBeNull();
  });
});
