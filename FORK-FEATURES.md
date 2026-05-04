# Fork Features

This private fork layers two AO behavior controls on top of upstream.

## Linear project filter

Projects using the Linear tracker can pin AO to one Linear project:

```yaml
projects:
  my-app:
    tracker:
      plugin: linear
      teamId: lin_team_...
      projectId: lin_project_...
```

- `teamId` remains the Linear team scope.
- `projectId` additionally scopes `listIssues()` and is passed to `createIssue()`.
- Use the Linear project **ID**, not the display name. Returned issue metadata may
  include `project: { id, name }`, but filtering is by ID.

## autonomyMode

Each AO project can declare its automation posture:

```yaml
projects:
  my-app:
    autonomyMode: manual
```

Modes:

- `manual` — default when omitted. Background/non-user-initiated spawns are
  blocked by `sessionManager.spawn()`. Explicit CLI spawns pass
  `userInitiated: true`; `ao spawn --force-manual <project> <issue>` is the
  documented manual-mode override.
- `review` — background spawns are allowed, but automatic agent reactions are
  routed to human review notifications instead of being sent back to agents or
  auto-merge paths.
- `full` — background spawns and configured automatic reactions may run.

CLI surface:

```bash
ao spawn --project my-app OCT-123
ao spawn --force-manual my-app OCT-124
ao batch-spawn --project my-app OCT-125 OCT-126
```

`--project` and `--force-manual` take the AO project ID from
`agent-orchestrator.yaml`; display names are not identifiers.
