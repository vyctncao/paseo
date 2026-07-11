export function shouldShowAgentContextPanel(input: {
  isWeb: boolean;
  isBelowBreakpoint: boolean;
  paneCount: number;
}): boolean {
  return input.isWeb && !input.isBelowBreakpoint && input.paneCount <= 1;
}
