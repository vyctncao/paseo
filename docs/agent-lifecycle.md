# Agent lifecycle

How an agent is created, runs, becomes a subagent, gets archived, and disappears from the UI. The model spans the daemon (lifecycle, archive) and the client (tabs, the subagents track).

## States

```
initializing → idle → running → idle (or error → closed)
                 ↑        │
                 └────────┘  (agent completes a turn, awaits next prompt)
```

Each agent in `AgentManager` carries a `lastStatus` of `initializing`, `idle`, `running`, `error`, or `closed`. State transitions persist to disk and stream to subscribed clients via WebSocket.

## Relationships

Agents can launch other agents via the agent-scoped `create_agent` MCP tool. Agent-scoped creation is always asynchronous. `relationship` and `workspace` are separate decisions:

- `relationship` decides whether the new agent belongs under the caller.
- `workspace` decides where the new agent lives and whether a new workspace/worktree is created.

`relationship: { kind: "subagent" }` stamps the created agent with `paseo.parent-agent-id`, pointing back at the creating agent. The client surfaces that as `agent.parentAgentId`. This requires an agent-scoped MCP session.

`relationship: { kind: "detached" }` creates a sibling/root agent (e.g. handoffs, fire-and-forget delegations). The daemon may still use the creating agent for cwd/config inheritance, but it does not write `paseo.parent-agent-id`.

- **Subagents** — exist as part of the creating agent's work, appear in that agent's subagent track, and are archived with it.
- **Detached agents** — stand on their own, do not appear in the creating agent's subagent track, and are not archived with it.

`workspace: { kind: "current" }` uses the caller's workspace and can optionally override the runtime cwd. It requires an agent-scoped MCP session. `workspace: { kind: "create", source: { kind: "directory" | "worktree", ... } }` creates a new workspace for the new agent; worktree creation goes through the Paseo worktree workflow and stamps the agent with that fresh workspace id.

Users can also detach an existing subagent from the subagents track. Detach removes the `paseo.parent-agent-id` label only: it does not stop, archive, move, or restart the agent. The agent keeps its current `cwd` and `workspaceId`, leaves the former parent's track, and behaves like a root agent for tab close, workspace activity, and future parent archive.

`notifyOnFinish` defaults to `true` for agent-scoped creation and background prompt follow-ups because most delegated work needs to report back to the creating agent. Set it to `false` only for truly fire-and-forget agents or prompts.

## Archive

Archive is a **soft delete**: the agent record stays on disk with `archivedAt` set, the runtime is closed, and the agent disappears from active lists. Archive is **global** — it lives on the server and propagates to every connected client.

`create_agent_request` can opt an agent into `autoArchive`. In that mode the daemon archives the agent after the first terminal turn event (`turn_completed`, `turn_failed`, or `turn_canceled`). If the same request created a Paseo worktree through its `worktree` field, auto-archive archives that worktree too, which removes the agent records inside the worktree.

Archiving runs through `AgentManager.archiveAgent` (`packages/server/src/server/agent/agent-manager.ts`):

1. Snapshot the current session into the registry
2. Set `archivedAt` and normalize `lastStatus` away from `running`/`initializing`
3. Notify subscribers
4. Close the runtime (kills the process if still running)
5. **Cascade-archive children** — any agent whose `paseo.parent-agent-id` label matches the archived agent gets archived too, recursively

Cascade is what keeps subagent fleets from outliving their orchestrator.

## Tabs vs archive

These are two distinct concepts that used to be conflated:

| Concept                    | Scope      | Triggers                   |
| -------------------------- | ---------- | -------------------------- |
| **Tab** (workspace layout) | Per-client | User opens/closes a view   |
| **Archive** (lifecycle)    | Global     | Explicit lifecycle gesture |

Closing a tab on a **root agent** still archives — the tab is the agent's home, so closing it means "I'm done with this agent." A confirm dialog protects against archiving a running agent by accident.

Closing a tab on a **subagent** (any agent with `parentAgentId`) is **layout-only**. The agent stays unarchived and stays in its parent's track. The user can re-open the tab from the track at any time. This is implemented in `handleCloseAgentTab` (`packages/app/src/screens/workspace/workspace-screen.tsx`).

The asymmetry is intentional: a subagent's home is the parent's track, not the tab. Tabs are ephemeral viewing slots; the track is the persistent record of the parent's children.

## Sidebar vs tab strip

The left sidebar is **workspace navigation only**: projects and their workspace rows. It never lists agent sessions, terminals, or any other tab as its own row, including for a project that owns exactly one workspace. Agent sessions live in the workspace tab strip (`WorkspaceDesktopTabsRow` on desktop, `MobileWorkspaceTabSwitcher` on compact).

A workspace row still reflects its agents through the aggregate status bucket described below — that is the sidebar's only agent-derived signal.

An earlier iteration projected each workspace's open agent tabs back into the sidebar and hid the desktop tab strip, so the same session appeared as both a sidebar row and a tab. If you are tempted to re-add per-agent sidebar rows, note the constraint that made it wrong: sidebar rows were derived from open tabs, so they could never be a reliable inventory of running agents (a root agent in an unvisited workspace has no tab yet, and subagents never auto-open). Tab reconciliation — `deriveWorkspaceAgentVisibility` and `reconcileWorkspaceTabs` — is what guarantees every active root agent has a tab, and it runs from the focused workspace screen.

## Workspace activity

Agent lifecycle status stays literal: a parent agent is `idle` when its own turn is idle, even if a child is running.

Workspace status is an aggregate activity signal computed **per `workspaceId`**: a workspace's status reflects only records whose `workspaceId === workspace.id`. Ownership is never derived from `cwd` — many workspaces may share one directory, and same-`cwd` siblings do not clump under one status. A root agent contributes its normal state bucket to its owning workspace only. Running subagents contribute `running` to their root parent's owning workspace (by the parent agent's `workspaceId`), not to the subagent's current `cwd` or worktree. Non-running subagent attention, permission, and error states stay in the parent's subagents track and do not escalate the workspace bucket.

## The subagents track

The collapsible track above the composer in an agent's pane (`packages/app/src/subagents/track.tsx`). Membership rule (`packages/app/src/subagents/select.ts`):

```
parentAgentId === thisAgent.id  AND  !archivedAt
```

Archived subagents disappear from the track, by design. To remove a subagent from the track without closing its tab, use the **archive button (X)** on the row — it opens a confirm dialog and archives the subagent on confirm. That same archive shows the subagent leave the track on every connected client.

To keep the agent alive but remove it from the parent's track, use **detach**. The daemon clears the parent label, emits the normal agent update, and every client reclassifies the agent from subagent to root/sibling from that updated snapshot.

### Claude in-process subagents: the task protocol

A Claude `Task` subagent is **not** a Paseo agent record, so it never appears in the track above. It surfaces as a `sub_agent` tool call on the parent's timeline, which the agent context panel projects into its Subagents section (`collectAgentContextTimelineSubagents`).

Two sources write that one card, and they must not fight over it:

- `sidechain-tracker.ts` derives the per-tool action log from frames carrying `parent_tool_use_id`.
- `subagent-task-tracker.ts` reads Claude's declarative announcements (`task_started` / `task_updated` / `task_progress` / `task_notification`) and owns identity and status. When the sidechain has a log it defers to it, so a foreground subagent keeps its richer log.

Gotchas that are not obvious from the SDK types:

- **A backgrounded subagent emits no frames carrying `parent_tool_use_id` at all.** Everything keyed off that field sees nothing for one, so it is visible only because the task protocol announces it. This is why the declarative source exists.
- **Backgrounding resolves the blocking `Task` call immediately** with a "running in the background" `tool_result`. Treating that as the real outcome marks a live subagent completed and strands it — the exact bug that made background work invisible. `handleToolResult` defers to the task protocol while a declared task is still running; only a terminal `task_updated`/`task_notification` finalizes the card.
- **Not every announced task is a subagent.** A backgrounded shell announces `task_type: "local_bash"` with a `tool_use_id` and no `subagent_type`; workflows announce `local_workflow`; ambient housekeeping sets `skip_transcript`. Filtering on the presence of a `tool_use_id` alone puts `sleep 20` in the subagent surfaces.
- **Only `task_started` carries `tool_use_id`.** Status arrives keyed by `task_id`, so the task-id → tool-use-id map is the only way to route it. A status for a task that was never declared is dropped rather than creating a nameless row that never finishes.
- **Task ids are session-scoped, not turn-scoped.** Cancelling a turn must not clear the routing table: a backgrounded child settles after the interrupt and still needs its card. Cancellation terminalizes only declared _foreground_ tasks (`cancelRunningForegroundTasks`), and a later `task_notification` is free to correct that guess. Backgrounded children are identified by `task_updated.patch.is_backgrounded`.
- **`task_progress` fires once per tool use, not on a timer**, so it is an accurate live signal of where a subagent currently is. Its `summary` field requires the `agentProgressSummaries` query option, which Paseo enables.

## Why this shape

The decision was to **decouple "close tab" from "archive" only for subagents**, rather than universally:

- **Closing a tab on a root agent still archives** — preserves the existing UX users are trained on
- **Closing a tab on a subagent is layout-only** — fixes the lossy "click to read, close to dismiss view, lose the row" flow
- **Archive button on track rows** — gives subagents an explicit lifecycle gesture in their home surface
- **Detach button on track rows** — lets a subagent continue independently without killing its work
- **Cascade archive on parent** — keeps subagents from leaking when the parent is archived

We considered universal decoupling (no tab close ever archives, archive is always explicit) but rejected it: it changes a behavior root-agent users rely on.

## Limitations

### Subagent accumulation under long-lived parents

A parent that spawns many subagents will see the track grow. There's no automatic cleanup for completed subagents — the user prunes via the archive button on each row. A bulk gesture (e.g. "archive all idle children") could land later if this becomes a real problem.

### Cross-client tab dismissal

Closing a subagent's tab on one client doesn't affect other clients' layouts. This is the expected behavior of decoupled tabs and is consistent with how layouts have always worked. Archive remains the global gesture for cross-client cleanup.

## Storage

```
$PASEO_HOME/agents/{cwd-with-dashes}/{agent-id}.json
```

`{cwd-with-dashes}` is derived from the agent's filesystem `cwd`. It is not the workspace id; agent storage stays cwd-keyed while workspace identity is the opaque workspace id.

Each agent is a single JSON file. Fields relevant to this doc:

| Field                             | Type          | Meaning                                                                                      |
| --------------------------------- | ------------- | -------------------------------------------------------------------------------------------- |
| `id`                              | `string`      | Stable identifier                                                                            |
| `archivedAt`                      | `string?`     | Soft-delete timestamp (ISO 8601)                                                             |
| `labels["paseo.parent-agent-id"]` | `string?`     | Parent agent ID, set automatically by `create_agent` when `relationship.kind === "subagent"` |
| `lastStatus`                      | `AgentStatus` | `initializing` / `idle` / `running` / `error` / `closed`                                     |

See [`docs/data-model.md`](./data-model.md) for the full agent record.
