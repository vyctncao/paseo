import {
  getDesktopHost,
  type DesktopPetImportResult,
  type DesktopPetOverlayState,
} from "@/desktop/host";

export async function updateDesktopPetOverlay(state: DesktopPetOverlayState): Promise<void> {
  const updateState = getDesktopHost()?.pet?.updateState;
  if (typeof updateState !== "function") return;
  await updateState(state);
}

export async function importDesktopPetDirectory(): Promise<DesktopPetImportResult | null> {
  const importFromDirectory = getDesktopHost()?.pet?.importFromDirectory;
  if (typeof importFromDirectory !== "function") {
    throw new Error("Desktop pet import is unavailable in this environment.");
  }
  return await importFromDirectory();
}

export async function markDesktopPetRendererReady(): Promise<void> {
  const mainRendererReady = getDesktopHost()?.pet?.mainRendererReady;
  if (typeof mainRendererReady !== "function") return;
  await mainRendererReady();
}
