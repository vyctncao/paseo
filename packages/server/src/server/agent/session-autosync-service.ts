import type { Logger } from "pino";
import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";
import type { AgentManager } from "./agent-manager.js";
import type { AgentStorage } from "./agent-storage.js";
import type { WorkspaceRegistry } from "../workspace-registry.js";
import {
  collectImportedProviderSessionHandles,
  importProviderSession,
  isMetadataGenerationSession,
  toProviderSessionHandleKey,
} from "./import-sessions.js";
import { createRealpathAwarePathMatcher } from "../../utils/path.js";

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_MAX_IMPORTS_PER_PASS = 25;

// Providers return their most-recent sessions up to this bound. It has to sit well
// above `maxImportsPerPass` so a full backfill keeps making progress: each pass
// imports at most `maxImportsPerPass`, and the ones it skipped resurface next pass
// because they are still un-imported.
const LIST_LIMIT = 1_000;

// Sourced from the protocol schema rather than redeclared, so the service and the
// daemon config store cannot drift (the schema is `.passthrough()`, hence the index
// signature this carries along).
export type SessionAutosyncSettings = MutableDaemonConfig["sessionAutosync"];

export interface SessionAutosyncServiceOptions {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  workspaceRegistry: Pick<WorkspaceRegistry, "list">;
  logger: Logger;
  settings: SessionAutosyncSettings;
}

export interface SessionAutosyncPassResult {
  imported: { provider: string; providerHandleId: string; workspaceId: string }[];
  /** Discovered, not yet imported, but held back by `maxImportsPerPass`. */
  deferred: number;
  /** Discovered but whose cwd matches no active workspace. Never imported. */
  skippedUnmatchedCwd: number;
  failed: number;
  durationMs: number;
}

/**
 * Imports external CLI sessions (Claude Code, Codex, OpenCode, ...) into Paseo on an
 * interval, so agents started in a terminal show up without anyone opening the
 * "Import session" picker.
 *
 * Two invariants keep this from running away:
 *
 * 1. A session whose `cwd` does not resolve to an existing, non-archived workspace is
 *    skipped, not imported. Autosync never creates workspaces — every directory you
 *    have ever run an agent in would otherwise become one.
 * 2. Each pass imports at most `maxImportsPerPass`. A first-run backfill of a large
 *    history drains across passes instead of importing hundreds of agents at once.
 *
 * Deduplication reuses the same `{provider, providerHandleId}` key the manual import
 * path uses, so a session imported by hand is never re-imported here, and vice versa.
 */
export class SessionAutosyncService {
  private readonly agentManager: AgentManager;
  private readonly agentStorage: AgentStorage;
  private readonly workspaceRegistry: Pick<WorkspaceRegistry, "list">;
  private readonly logger: Logger;
  private settings: SessionAutosyncSettings;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(options: SessionAutosyncServiceOptions) {
    this.agentManager = options.agentManager;
    this.agentStorage = options.agentStorage;
    this.workspaceRegistry = options.workspaceRegistry;
    this.logger = options.logger.child({ module: "session-autosync" });
    this.settings = options.settings;
  }

  private get intervalMs(): number {
    const seconds = this.settings.intervalSeconds;
    return seconds > 0 ? seconds * 1_000 : DEFAULT_INTERVAL_MS;
  }

  start(): void {
    if (this.timer || !this.settings.enabled) return;
    this.logger.info(
      { intervalMs: this.intervalMs, providers: this.settings.providers },
      "Starting session autosync service",
    );
    this.timer = setInterval(() => void this.runSafe(), this.intervalMs);
    void this.runSafe();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Apply a config change. Restarts the timer when the interval moved, and starts or
   * stops the service when `enabled` flipped.
   */
  updateSettings(settings: SessionAutosyncSettings): void {
    const wasEnabled = this.settings.enabled;
    const previousIntervalMs = this.intervalMs;
    this.settings = settings;

    if (!settings.enabled) {
      if (wasEnabled) this.logger.info("Session autosync disabled");
      this.stop();
      return;
    }
    if (!wasEnabled) {
      this.start();
      return;
    }
    if (previousIntervalMs !== this.intervalMs) {
      this.stop();
      this.start();
    }
  }

  async runOnce(): Promise<SessionAutosyncPassResult> {
    return this.sync();
  }

  private async runSafe(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sync();
    } catch (error) {
      this.logger.error({ err: error }, "Session autosync pass failed");
    } finally {
      this.running = false;
    }
  }

  private async sync(): Promise<SessionAutosyncPassResult> {
    const start = Date.now();
    const imported: SessionAutosyncPassResult["imported"] = [];
    let deferred = 0;
    let skippedUnmatchedCwd = 0;
    let failed = 0;

    const maxImports = this.settings.maxImportsPerPass || DEFAULT_MAX_IMPORTS_PER_PASS;
    const providerFilter =
      this.settings.providers.length > 0 ? new Set(this.settings.providers) : undefined;

    const workspaces = (await this.workspaceRegistry.list()).filter(
      (workspace) => !workspace.archivedAt,
    );
    if (workspaces.length === 0) {
      return { imported, deferred, skippedUnmatchedCwd, failed, durationMs: Date.now() - start };
    }

    // Path *equivalence* (symlink/realpath variants of the same directory), not
    // containment: a session's cwd must be the workspace directory itself. A session
    // started in a subdirectory matches nothing and is skipped.
    const matchers = workspaces.map((workspace) => ({
      workspaceId: workspace.workspaceId,
      matches: createRealpathAwarePathMatcher(workspace.cwd),
    }));

    const importedHandles = await collectImportedProviderSessionHandles(
      this.agentManager,
      this.agentStorage,
    );
    const sessions = await this.agentManager.listImportableSessions({
      limit: LIST_LIMIT,
      providerFilter,
    });

    for (const session of sessions) {
      if (isMetadataGenerationSession(session)) continue;
      if (
        importedHandles.has(toProviderSessionHandleKey(session.provider, session.providerHandleId))
      )
        continue;

      const workspace = matchers.find((candidate) => candidate.matches(session.cwd));
      if (!workspace) {
        skippedUnmatchedCwd += 1;
        continue;
      }
      if (imported.length >= maxImports) {
        deferred += 1;
        continue;
      }

      try {
        await importProviderSession({
          request: {
            provider: session.provider,
            providerHandleId: session.providerHandleId,
            cwd: session.cwd,
            requestId: `autosync:${session.provider}:${session.providerHandleId}`,
          },
          workspaceId: workspace.workspaceId,
          agentManager: this.agentManager,
          agentStorage: this.agentStorage,
          logger: this.logger,
        });
        imported.push({
          provider: session.provider,
          providerHandleId: session.providerHandleId,
          workspaceId: workspace.workspaceId,
        });
      } catch (error) {
        failed += 1;
        this.logger.warn(
          { err: error, provider: session.provider, providerHandleId: session.providerHandleId },
          "Failed to autosync provider session",
        );
      }
    }

    const durationMs = Date.now() - start;
    if (imported.length > 0 || failed > 0 || deferred > 0) {
      this.logger.info(
        { importedCount: imported.length, deferred, skippedUnmatchedCwd, failed, durationMs },
        "Session autosync pass complete",
      );
    }
    return { imported, deferred, skippedUnmatchedCwd, failed, durationMs };
  }
}
