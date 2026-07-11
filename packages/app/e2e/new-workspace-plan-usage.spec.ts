import { expect, test, type Page } from "./fixtures";
import { gotoAppShell } from "./helpers/app";
import { openGlobalNewWorkspaceComposer } from "./helpers/new-workspace";
import { installProviderUsageFixture } from "./helpers/provider-usage";

async function expectUsageBeforeWorkspaceForm(page: Page) {
  const usage = page.getByTestId("new-workspace-plan-usage");
  const title = page.getByTestId("new-workspace-title");
  const form = page.getByTestId("new-workspace-ref-picker-row");
  const composer = page.getByTestId("message-input-root");

  await expect(usage).toBeVisible({ timeout: 30_000 });
  await expect(title).toBeVisible();
  await expect(form).toBeVisible();
  await expect(composer).toBeVisible();

  const [usageBox, titleBox, formBox, composerBox] = await Promise.all([
    usage.boundingBox(),
    title.boundingBox(),
    form.boundingBox(),
    composer.boundingBox(),
  ]);
  expect(usageBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  expect(formBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  if (!usageBox || !titleBox || !formBox || !composerBox) return;

  expect(usageBox.y + usageBox.height).toBeLessThanOrEqual(titleBox.y);
  expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(formBox.y);
  expect(formBox.y + formBox.height).toBeLessThanOrEqual(composerBox.y);

  await usage.scrollIntoViewIfNeeded();
  const visibleUsageBox = await usage.boundingBox();
  expect(visibleUsageBox).not.toBeNull();
  if (!visibleUsageBox) return;
  expect(visibleUsageBox.y).toBeGreaterThanOrEqual(0);

  await composer.scrollIntoViewIfNeeded();
  const visibleComposerBox = await composer.boundingBox();
  expect(visibleComposerBox).not.toBeNull();
  if (!visibleComposerBox) return;
  expect(visibleComposerBox.y + visibleComposerBox.height).toBeLessThanOrEqual(
    page.viewportSize()?.height ?? 0,
  );
}

test("renders plan usage above the new workspace form", async ({ page }) => {
  test.setTimeout(120_000);
  const usageFixture = await installProviderUsageFixture(page, [
    {
      fetchedAt: "2026-07-10T00:00:00.000Z",
      providers: [
        {
          providerId: "codex",
          displayName: "Codex",
          status: "available",
          planLabel: "Pro",
          windows: [
            { id: "session", label: "Session", usedPct: 16 },
            { id: "weekly", label: "Weekly", usedPct: 44 },
          ],
        },
        {
          providerId: "claude",
          displayName: "Claude",
          status: "available",
          planLabel: "Max 20x",
          windows: [
            { id: "session", label: "Session", usedPct: 32 },
            { id: "weekly", label: "Weekly", usedPct: 51 },
          ],
        },
        {
          providerId: "glm",
          displayName: "GLM coding plan",
          status: "available",
          planLabel: "Coding plan",
          windows: [
            { id: "daily", label: "Daily", usedPct: 23 },
            { id: "monthly", label: "Monthly", usedPct: 68 },
          ],
          balances: [{ id: "credits", label: "Credits", remaining: 1234, unit: "credits" }],
        },
        {
          providerId: "minimax",
          displayName: "MiniMax",
          status: "available",
          planLabel: null,
          windows: [
            { id: "general-interval", label: "general · Interval", usedPct: 1 },
            { id: "general-weekly", label: "general · Weekly", usedPct: 8 },
            { id: "video-interval", label: "video · Interval", usedPct: 0 },
            { id: "video-weekly", label: "video · Weekly", usedPct: 0 },
          ],
        },
        {
          providerId: "cursor",
          displayName: "Cursor",
          status: "unavailable",
          planLabel: null,
          windows: [],
        },
        {
          providerId: "grok",
          displayName: "Grok",
          status: "unavailable",
          planLabel: null,
          windows: [],
        },
        {
          providerId: "kimi",
          displayName: "Kimi",
          status: "unavailable",
          planLabel: null,
          windows: [],
        },
      ],
    },
  ]);

  await page.setViewportSize({ width: 1512, height: 982 });
  await gotoAppShell(page);
  await openGlobalNewWorkspaceComposer(page);
  await usageFixture.waitForRequestCount(1);
  await expectUsageBeforeWorkspaceForm(page);
  await expect(page.getByTestId("new-workspace-plan-usage")).not.toContainText("Cursor");
  await expect(page.getByTestId("new-workspace-plan-usage")).not.toContainText("Grok");
  await expect(page.getByTestId("new-workspace-plan-usage")).not.toContainText("Kimi");

  await page.setViewportSize({ width: 390, height: 844 });
  await expectUsageBeforeWorkspaceForm(page);
});
