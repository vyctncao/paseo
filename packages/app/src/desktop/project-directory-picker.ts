import type { DesktopDialogBridge } from "@/desktop/host";

interface ChooseProjectDirectoryOptions {
  title: string;
  defaultPath?: string;
}

export async function chooseProjectDirectory(
  dialog: DesktopDialogBridge | null | undefined,
  options: ChooseProjectDirectoryOptions,
): Promise<string | null> {
  if (typeof dialog?.open !== "function") {
    return null;
  }

  const selection = await dialog.open({
    title: options.title,
    defaultPath: options.defaultPath?.trim() || undefined,
    directory: true,
    multiple: false,
  });

  if (typeof selection === "string") {
    return selection;
  }

  return selection?.[0] ?? null;
}
