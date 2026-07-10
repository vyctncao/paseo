import { beforeEach, describe, expect, it, vi } from "vitest";
import pino from "pino";
import { SessionAutosyncService } from "./session-autosync-service.js";
import type { SessionAutosyncSettings } from "./session-autosync-service.js";
import { importProviderSession } from "./import-sessions.js";

// Import/dedup helpers stay real — only the write path (importProviderSession) is
// stubbed, so these tests exercise the actual already-imported and
// metadata-generation filters.
vi.mock("./import-sessions.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./import-sessions.js")>()),
  importProviderSession: vi.fn().mockResolvedValue({ snapshot: { id: "a" }, timelineSize: 0 }),
}));

const importProviderSessionMock = vi.mocked(importProviderSession);
const logger = pino({ level: "silent" });

const WORKSPACE_CWD = "/tmp/autosync-workspace";
const OTHER_CWD = "/tmp/somewhere-else";

interface FakeSession {
  provider: string;
  providerHandleId: string;
  cwd: string;
  firstPromptPreview?: string | null;
}

function makeSettings(overrides: Partial<SessionAutosyncSettings> = {}): SessionAutosyncSettings {
  return {
    enabled: true,
    intervalSeconds: 60,
    providers: ["claude", "codex", "opencode"],
    maxImportsPerPass: 25,
    ...overrides,
  };
}

function makeService(options: {
  sessions: FakeSession[];
  workspaces?: { workspaceId: string; cwd: string; archivedAt: string | null }[];
  existingAgents?: { provider: string; persistence: { provider: string; sessionId: string } }[];
  settings?: Partial<SessionAutosyncSettings>;
}): SessionAutosyncService {
  const agentManager = {
    listAgents: () => options.existingAgents ?? [],
    listImportableSessions: async () =>
      options.sessions.map((session) => ({
        title: null,
        lastPromptPreview: null,
        lastActivityAt: new Date(),
        firstPromptPreview: session.firstPromptPreview ?? null,
        ...session,
      })),
  };
  const agentStorage = { list: async () => [] };
  const workspaceRegistry = {
    list: async () =>
      options.workspaces ?? [{ workspaceId: "ws-1", cwd: WORKSPACE_CWD, archivedAt: null }],
  };

  return new SessionAutosyncService({
    // The service only touches the members stubbed above.
    agentManager: agentManager as never,
    agentStorage: agentStorage as never,
    workspaceRegistry: workspaceRegistry as never,
    logger,
    settings: makeSettings(options.settings),
  });
}

describe("SessionAutosyncService", () => {
  beforeEach(() => {
    importProviderSessionMock.mockClear();
  });

  it("imports a discovered session into the workspace whose directory matches its cwd", async () => {
    const service = makeService({
      sessions: [{ provider: "claude", providerHandleId: "sess-1", cwd: WORKSPACE_CWD }],
    });

    const result = await service.runOnce();

    expect(result.imported).toEqual([
      { provider: "claude", providerHandleId: "sess-1", workspaceId: "ws-1" },
    ]);
    expect(importProviderSessionMock).toHaveBeenCalledTimes(1);
    expect(importProviderSessionMock.mock.calls[0]![0]).toMatchObject({
      workspaceId: "ws-1",
      request: { provider: "claude", providerHandleId: "sess-1", cwd: WORKSPACE_CWD },
    });
  });

  it("skips sessions whose cwd matches no workspace instead of creating one", async () => {
    const service = makeService({
      sessions: [{ provider: "codex", providerHandleId: "sess-2", cwd: OTHER_CWD }],
    });

    const result = await service.runOnce();

    expect(result.imported).toEqual([]);
    expect(result.skippedUnmatchedCwd).toBe(1);
    expect(importProviderSessionMock).not.toHaveBeenCalled();
  });

  it("never re-imports a session that is already an agent", async () => {
    const service = makeService({
      sessions: [{ provider: "opencode", providerHandleId: "sess-3", cwd: WORKSPACE_CWD }],
      existingAgents: [
        { provider: "opencode", persistence: { provider: "opencode", sessionId: "sess-3" } },
      ],
    });

    const result = await service.runOnce();

    expect(result.imported).toEqual([]);
    expect(importProviderSessionMock).not.toHaveBeenCalled();
  });

  it("caps a backfill at maxImportsPerPass and defers the rest to the next pass", async () => {
    const sessions = Array.from({ length: 5 }, (_, index) => ({
      provider: "claude",
      providerHandleId: `sess-${index}`,
      cwd: WORKSPACE_CWD,
    }));
    const service = makeService({ sessions, settings: { maxImportsPerPass: 2 } });

    const result = await service.runOnce();

    expect(result.imported).toHaveLength(2);
    expect(result.deferred).toBe(3);
    expect(importProviderSessionMock).toHaveBeenCalledTimes(2);
  });

  it("ignores internal metadata-generation sessions", async () => {
    const service = makeService({
      sessions: [
        {
          provider: "claude",
          providerHandleId: "sess-meta",
          cwd: WORKSPACE_CWD,
          firstPromptPreview:
            "Generate metadata for a coding agent based on the user prompt. Do the thing.",
        },
      ],
    });

    const result = await service.runOnce();

    expect(result.imported).toEqual([]);
    expect(importProviderSessionMock).not.toHaveBeenCalled();
  });

  it("does nothing when no workspaces exist", async () => {
    const service = makeService({
      sessions: [{ provider: "claude", providerHandleId: "sess-4", cwd: WORKSPACE_CWD }],
      workspaces: [],
    });

    const result = await service.runOnce();

    expect(result.imported).toEqual([]);
    expect(importProviderSessionMock).not.toHaveBeenCalled();
  });

  it("start() is a no-op while disabled", async () => {
    const service = makeService({
      sessions: [{ provider: "claude", providerHandleId: "sess-5", cwd: WORKSPACE_CWD }],
      settings: { enabled: false },
    });

    service.start();
    await vi.waitFor(() => expect(importProviderSessionMock).not.toHaveBeenCalled());
    service.stop();
  });
});
