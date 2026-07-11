import { expect, test, vi } from "vitest";
import {
  ensureLocalCheckoutWorkspace,
  type CreateLocalCheckoutWorkspaceDeps,
} from "./paseo-worktree-service.js";
import {
  createPersistedWorkspaceRecord,
  type PersistedWorkspaceRecord,
} from "./workspace-registry.js";

function record(overrides: Partial<Parameters<typeof createPersistedWorkspaceRecord>[0]>) {
  return createPersistedWorkspaceRecord({
    workspaceId: "wks_existing",
    projectId: "proj",
    cwd: "/repo",
    kind: "local_checkout",
    displayName: "repo",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });
}

// The create path hits git; the reuse path must not. A registry whose upsert throws
// proves reuse never falls through to creation.
function depsWith(list: PersistedWorkspaceRecord[]): CreateLocalCheckoutWorkspaceDeps {
  return {
    projectRegistry: { get: vi.fn(), list: vi.fn(), upsert: vi.fn() },
    workspaceRegistry: {
      list: vi.fn(async () => list),
      upsert: vi.fn(async () => {
        throw new Error("ensure reused an existing workspace and must not create");
      }),
    },
    workspaceGitService: {
      getCheckout: vi.fn(async () => {
        throw new Error("reuse must not inspect git");
      }),
    },
  } as unknown as CreateLocalCheckoutWorkspaceDeps;
}

test("reuses the existing non-archived workspace on the directory", async () => {
  const existing = record({ workspaceId: "wks_keep" });
  const result = await ensureLocalCheckoutWorkspace({ cwd: "/repo" }, depsWith([existing]));

  expect(result.created).toBe(false);
  expect(result.workspace.workspaceId).toBe("wks_keep");
});

test("matches the directory regardless of path normalization", async () => {
  const existing = record({ workspaceId: "wks_keep", cwd: "/repo" });
  const result = await ensureLocalCheckoutWorkspace({ cwd: "/repo/" }, depsWith([existing]));

  expect(result.created).toBe(false);
  expect(result.workspace.workspaceId).toBe("wks_keep");
});

test("does not reuse an archived workspace", async () => {
  const archived = record({ workspaceId: "wks_archived", archivedAt: "2026-02-01T00:00:00.000Z" });
  // No live workspace to reuse, so ensure would create — which this deps set makes throw,
  // proving the archived record was correctly skipped rather than returned.
  await expect(
    ensureLocalCheckoutWorkspace({ cwd: "/repo" }, depsWith([archived])),
  ).rejects.toThrow(/must not create|must not inspect git/);
});

test("does not reuse a workspace on a different directory", async () => {
  const other = record({ workspaceId: "wks_other", cwd: "/somewhere-else" });
  await expect(ensureLocalCheckoutWorkspace({ cwd: "/repo" }, depsWith([other]))).rejects.toThrow(
    /must not create|must not inspect git/,
  );
});
