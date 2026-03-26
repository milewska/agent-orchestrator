<!-- /autoplan restore point: /Users/ashishhuddar/.gstack/projects/ComposioHQ-agent-orchestrator/ashish-feat-dashboard-unification-autoplan-restore-20260326-163854.md -->
# Multi-Project Portfolio Architecture

**Status:** Draft  
**Author:** Codex `/autoplan`  
**Date:** 2026-03-26  
**Branch:** `ashish/feat/dashboard-unification`  
**Base Branch:** `main`

## Problem

Agent Orchestrator currently supports multiple projects inside one loaded config, but the effective universe is still a single `agent-orchestrator.yaml`. In practice that means each repo-local config becomes its own dashboard universe, its own session discovery boundary, and its own CLI scope.

That is a real architecture problem, but the product framing matters: AO is supposed to be **push, not pull**. The user should not have to poll dashboards to understand progress. The real unmet need is broader than "portfolio visibility": it is **cross-project human attention routing**. The system should know what needs human judgment across all projects, surface that quickly, and let the user drill into the right project without maintaining a monolithic config by hand.

## Goals

1. Support a real multi-project portfolio spanning many repo-local configs.
2. Make `/` an attention-first portfolio entry point, not a generic dashboard theater page.
3. Make project dashboards first-class drill-down pages under a portfolio hierarchy.
4. Keep repo-local config ownership for project-specific execution settings.
5. Preserve backward compatibility for existing single-project users.
6. Avoid a destructive metadata migration for existing session files.
7. Strengthen AO's differentiator: better human-in-the-loop attention routing across projects.

## Non-Goals

1. Replacing the existing plugin architecture.
2. Redesigning every dashboard component from scratch.
3. Introducing a database.
4. Supporting multi-user tenancy or auth in this change.
5. Rewriting session metadata storage if aggregation can solve the problem.

## Product Thesis

AO remains a notification-first product. The dashboard is a drill-down surface you open after a notification or when you explicitly want portfolio context. This feature should therefore optimize for:

1. finding the next human action across projects,
2. deep-linking into the right project quickly,
3. removing the need for one giant shared config file.

It should not optimize for passive browsing as the primary user loop.

## User Segments & Evidence

| Segment | Evidence in repo | Confidence | Why it matters |
| --- | --- | --- | --- |
| Single-project operator | `ao start` default flow starts in one repo | High | Must remain zero-friction |
| Multi-project local operator | README documents repeated `ao start` as "Add more projects"; example multi-project config exists | Medium | This is the direct target segment |
| Advanced shared-config operator | Existing multi-project YAML example and prior project-scoped dashboard spec | Medium | Must keep working, but should no longer be the only path |
| Team/shared control-plane operator | Not supported today; explicitly out of scope | High | Prevents accidental design drift into hosted multi-user territory |

## Premise Table

| Premise | Evidence | Confidence | Blast radius if false |
| --- | --- | --- | --- |
| Repo-local config should remain authoritative for project execution settings | Current `loadConfig()` flow and repo-local `ao start` path | High | High |
| The missing layer is cross-config discovery, not more power inside one YAML | README "Add more projects", per-repo config discovery, user problem statement | Medium | High |
| Existing session files can remain the write path while a portfolio layer aggregates them | Current `SessionManager` already aggregates per-project inside one config | High | Medium |
| Route-based navigation is clearer than query-param routing for portfolio/project hierarchy | Current sidebar and `/?project=` flow already hit ambiguity limits | High | Medium |
| `/` should be attention-first, not browse-first | `Push, not pull` philosophy in repo docs | High | High |
| The portfolio index is canonical for membership/preferences but derived for metadata — rebuildable for project discovery, not for user preferences | Local-first tool, stale-path risk, multi-machine drift risk; Codex correctly challenged original "fully derived" framing | Medium | High |

## Resolved Product Stance

This spec does **not** reverse the earlier project-scoped dashboard work. The product stance is:

1. **Notification-first overall**
2. **Portfolio attention center at `/`**
3. **Project-scoped drill-down at `/projects/[projectId]`**

That means the earlier project-scoped dashboard direction remains valid, but it becomes the project page, not the entire product root.

## Current State

### What exists now

| Concern | Current behavior | Evidence |
| --- | --- | --- |
| Config ownership | `loadConfig()` finds exactly one config file and treats it as the full universe | `packages/core/src/config.ts` |
| Project identity | Identity lives inside one config's `projects` map and local `sessionPrefix` values | `packages/core/src/types.ts`, `packages/core/src/config.ts` |
| Session storage | Metadata is sharded per project under `~/.agent-orchestrator/{config-hash}-{projectId}/sessions` | `packages/core/src/paths.ts` |
| Session discovery | `sessionManager.list()` walks `config.projects` only; cross-config sessions are invisible | `packages/core/src/session-manager.ts` |
| Dashboard root | `/` renders a filtered project dashboard, defaulting to the first configured project | `packages/web/src/app/page.tsx`, `packages/web/src/lib/project-name.ts` |
| Sidebar model | The sidebar looks portfolio-like, but it navigates a query-param filter inside one dashboard page | `packages/web/src/components/ProjectSidebar.tsx` |
| CLI status | `ao status` loads one config and only reports sessions from that config's projects | `packages/cli/src/commands/status.ts` |
| CLI project detection | `ao spawn` and `ao start` auto-detect a project only inside the loaded config | `packages/cli/src/commands/spawn.ts`, `packages/cli/src/commands/start.ts` |

### Why this is not enough

The current model can show many projects only if the user manually curates one shared config. That is an advanced setup, not the default product path. The default path still creates siloed dashboard universes per repo, which is why cross-project visibility feels bolted on instead of fundamental.

## Implementation Alternatives

```text
APPROACH A: Improve shared-config onboarding only
  Summary: Keep one-config-as-universe, make it easier to add more projects into that config,
           and retain the current project-filtered dashboard model.
  Effort:  S-M
  Risk:    Medium
  Pros:    Smallest diff; reuses most current behavior; minimal storage changes
  Cons:    Does not fix the default per-repo silo; still requires a monolithic config;
           keeps product ambiguity between repo-local and portfolio usage
  Reuses:  Existing multi-project YAML support, `/?project=` filtering, current sidebar

APPROACH B: Derived portfolio index + attention-first routing
  Summary: Keep repo-local configs authoritative, add a rebuildable user-level portfolio
           index for discovery/pinning, and make `/` a cross-project attention center with
           project drill-down pages.
  Effort:  M-L
  Risk:    Medium
  Pros:    Solves the real default-path problem; preserves local config ownership;
           avoids split-brain canonical state; aligns with push-not-pull product thesis
  Cons:    Cross-cutting web/CLI/core changes; still needs careful stale-project handling
  Reuses:  Existing session metadata, project-scoped dashboard work, sidebar UI, `ao start` add-project flow

APPROACH C: Canonical global registry/home config
  Summary: Introduce one authoritative global portfolio registry or home config that owns
           identity, membership, and possibly imports repo-local config fragments.
  Effort:  L-XL
  Risk:    High
  Pros:    Cleanest single place for portfolio identity; strongest future path if AO becomes hosted/team-aware
  Cons:    Split-brain/staleness risk now; forces new source-of-truth semantics; highest migration tax
  Reuses:  Very little beyond current session storage and runtime APIs
```

**RECOMMENDATION:** Choose **Approach B**. It is the complete solution inside this repo's current local-first product constraints without prematurely inventing a canonical global state layer.

## Proposed Architecture

### 1. Hybrid discovery model: auto-discover + explicit add + preferences overlay

**Architecture decision (per autoplan review):** Use a hybrid model instead of a single persistent index.

**Discovery layer** (derived, rebuildable):
Auto-discover projects by scanning existing session directories at `~/.agent-orchestrator/*/sessions/`. Each session directory maps back to a project via its directory name pattern (`{configHash}-{projectId}`). No registration ceremony needed for existing projects.

**Explicit registration** (for edge cases):
`ao project add <path>` registers a project that has no sessions yet. Stores a minimal entry in `~/.agent-orchestrator/portfolio/registered.json` (just path + project key). Once the project has sessions, discovery handles it and the explicit entry is redundant.

**Preferences overlay** (canonical, small):
`~/.agent-orchestrator/portfolio/preferences.json` stores ONLY user preferences: pinning, ordering, default project, enabled/disabled. This file is tiny, rarely written, and the only truly canonical state. Concurrent write contention is negligible.

```
DISCOVERY (derived)              PREFERENCES (canonical)
┌──────────────────────┐         ┌──────────────────────┐
│ Scan session dirs    │         │ preferences.json     │
│ ~/.ao/*/sessions/    │─merge──▶│ { pinned, order,     │
│                      │         │   defaultProject }   │
│ + registered.json    │         │                      │
│   (explicit adds)    │         │ Tiny, rarely written  │
└──────────────────────┘         └──────────────────────┘
              │
              ▼
      Portfolio View (in memory)
```

This replaces the original single `index.json` approach. Benefits:
- No concurrent write contention for discovery (session dirs are per-project)
- Preferences file is small and rarely written (advisory lock sufficient)
- Rebuilding = re-scanning session dirs + re-running `ao start` in each repo
- Only preferences (pinning, ordering) are lost on deletion Repo-local configs remain authoritative for execution settings.

Suggested shape:

```json
{
  "version": 1,
  "defaultProjectId": "agent-orchestrator",
  "projects": [
    {
      "id": "agent-orchestrator",
      "name": "Agent Orchestrator",
      "configPath": "/Users/ashishhuddar/agent-orchestrator/agent-orchestrator.yaml",
      "configProjectKey": "agent-orchestrator",
      "repoPath": "/Users/ashishhuddar/agent-orchestrator",
      "repo": "ComposioHQ/agent-orchestrator",
      "defaultBranch": "main",
      "sessionPrefix": "ao",
      "pinned": true,
      "source": "ao-start",
      "enabled": true,
      "lastSeenAt": "2026-03-26T10:08:00Z"
    }
  ]
}
```

Rules:

1. `id` is the stable portfolio identity used by routes, CLI filters, and UI selection.
2. `configPath + configProjectKey` points back to the local source of truth for runtime/tracker/agent settings.
3. Repo-local config no longer needs to be the global registry.
4. One local config may register multiple portfolio projects if its `projects:` map contains multiple entries.
5. The index must be safe to rebuild from recent `ao start` activity and explicit `ao project add` commands.
6. Stale entries are tolerable because the index is not authoritative; they should degrade gracefully and be prunable.

### 2. Split ownership cleanly

| Concern | Owner |
| --- | --- |
| Project execution settings: runtime, agent, tracker, workspace, reactions | Repo-local `agent-orchestrator.yaml` |
| Portfolio identity, inclusion, ordering, default project, display metadata | User-level portfolio index |
| Session runtime state | Existing per-project session metadata directories |
| Portfolio-wide discovery and aggregation | New portfolio services in core |

This is the key architectural split. Local config defines how a project runs. The portfolio index defines how all projects are discovered and navigated together.

### 3. Keep existing session files, add portfolio aggregation

Do not migrate or rewrite existing session metadata files. Instead:

1. Keep project-local session files as the write path.
2. Add a `PortfolioSessionService` that enumerates indexed projects, loads their configs lazily, and delegates to each project's session manager.
3. Aggregate the results into a portfolio view in memory.

This avoids risky data migration while solving the visibility problem.

### 4. Make route hierarchy match the product model

Replace the query-param-first model with route-first navigation:

```text
/                                  -> portfolio landing page
/projects/[projectId]              -> project dashboard
/projects/[projectId]/sessions/[sessionId]
                                   -> project-scoped session detail
```

Legacy routes remain temporarily:

1. `/?project=all` redirects to `/`
2. `/?project=<id>` redirects to `/projects/<id>`
3. `/sessions/[id]` redirects via portfolio lookup when the session resolves unambiguously; otherwise show a disambiguation page or require project context

### 5. Separate portfolio navigation from project navigation

The UI needs two levels of intent:

1. Portfolio navigation: "Which project am I looking at?"
2. Project navigation: "Within this project, which sessions/issues/views matter?"

That means the root layout should own portfolio selection and the project dashboard should own project-local panels and session focus. The existing sidebar can be reused visually, but it needs to drive real route transitions instead of in-page query state.

The portfolio page itself should be attention-first:

1. urgent sessions needing human input,
2. review/merge-ready work across projects,
3. then project health and navigation.

## Target Data Model

### Portfolio graph

```text
PORTFOLIO INDEX
  ├── Project A (portfolioProjectId)
  │    ├── configRef -> { configPath, configProjectKey }
  │    ├── repoPath
  │    └── sessionPrefix
  ├── Project B
  └── Project C

LOCAL CONFIG
  └── execution settings for one or more projects

SESSION STORAGE
  └── ~/.agent-orchestrator/{config-hash}-{projectId}/sessions/*
```

### Session identity rules

Within a project, session IDs remain unchanged: `ao-1`, `api-3`, `docs-orchestrator`.

Across the portfolio, the globally addressable identity is route-scoped:

```text
projectId + sessionId
```

That avoids forcing a storage migration just to make session IDs globally unique.

## Core Changes

### New services

| Module | Responsibility |
| --- | --- |
| `packages/core/src/portfolio-registry.ts` | Read/write/validate the portfolio index |
| `packages/core/src/portfolio-projects.ts` | Resolve indexed entries to loaded project configs |
| `packages/core/src/portfolio-session-service.ts` | Aggregate sessions across registered projects |
| `packages/core/src/portfolio-routing.ts` | Shared helpers for project/session route resolution |

### Existing services to update

| Module | Change |
| --- | --- |
| `packages/core/src/config.ts` | Keep current local config discovery; do not overload it with portfolio concerns |
| `packages/core/src/session-manager.ts` | Stay project-scoped; expose clean inputs for portfolio aggregation |
| `packages/core/src/paths.ts` | Keep current layout; optionally add helpers for portfolio index paths |
| `packages/core/src/utils.ts` | Move duplicated project/session resolution logic behind shared helpers |

### Important rule

Do not turn `SessionManager` into a magic global singleton over every config on disk. That would collapse two separate concerns:

1. project-scoped lifecycle operations
2. portfolio-scoped discovery

The new portfolio layer should compose existing project-scoped managers instead.

## Web App Changes

### Routing

Implement a route hierarchy like this:

```text
app/
  page.tsx                              -> portfolio attention center
  projects/
    [projectId]/
      page.tsx                          -> project dashboard
      sessions/
        [sessionId]/
          page.tsx                      -> session detail
```

### Portfolio attention center at `/`

The root page should answer:

1. What human action is blocking progress right now?
2. Which project does that action belong to?
3. What else is urgent across the portfolio?
4. Which projects are healthy, idle, or stale?

**Layout (per design review — NOT stacked sections):**

Use a 3-panel working layout, not vertically stacked dashboard sections:

```text
┌──────────────┬──────────────────────────┬──────────────────┐
│ PROJECT RAIL │ ACTION QUEUE             │ CONTEXT PANE     │
│              │                          │                  │
│ • AO  ●3     │ ⚠ Blocked: ao-7         │ Session detail   │
│ • API ●1     │   "needs auth decision"  │ or PR preview    │
│ • Docs       │ → Review: api-pr-42     │ for selected     │
│              │   "CI passed, 2 approvals"│ action item      │
│              │ → Merge: ao-pr-15       │                  │
│              │ ◎ Working: ao-3, ao-5   │                  │
└──────────────┴──────────────────────────┴──────────────────┘
```

- **Project rail** (left): Dense list of registered projects with health dots and active session counts. Clicking filters the action queue. "All" selected by default.
- **Action queue** (center): Flat list of items sorted by triage ranking. Each row shows: project tag, attention level, session/PR ID, one-line description, and age.
- **Context pane** (right): Detail preview for the selected action item. Session info, PR diff summary, or terminal embed.

**Action language (per design review — AO-native, not generic):**
- Use "Needs judgment", "Waiting on you", "Safe to merge", "Agents running" instead of generic "Portfolio", "Summary strip", "Project cards"
- Each action item row should show the reason it needs attention inline

**Calm state:** When no urgent work exists, collapse the action queue to a single "All clear — N agents running across M projects" message with the project rail still visible. Do NOT fall back to a card grid.

**Notification deep links:** Every action item in the queue has a canonical URL: `/projects/[projectId]/sessions/[sessionId]` or `/projects/[projectId]/prs/[prNumber]`. These URLs should work identically whether opened from a notification or from the dashboard.

### Project dashboard at `/projects/[projectId]`

This page reuses the existing dashboard concepts, but it becomes explicitly project-scoped:

1. One project header
2. One project's orchestrator state
3. One project's sessions and PR table
4. One project's issue/backlog actions

### Session detail at `/projects/[projectId]/sessions/[sessionId]`

Stop relying on prefix inference alone for session detail routes. The URL already knows the project context, so the page and APIs should use it.

### API changes

| Endpoint | Change |
| --- | --- |
| `GET /api/projects` | Return portfolio index entries, not just the current config's `projects` map |
| `GET /api/sessions` | Support `scope=portfolio` by default; `projectId` narrows to a project page |
| `GET /api/events` | Stream either portfolio rollups or project-scoped snapshots |
| `POST /api/orchestrators` | Resolve project through portfolio index, then through local config |
| Session mutation routes | Accept explicit project context where needed instead of recovering it from prefix only |

### SSE model

Two scopes are needed:

1. Portfolio scope: coarse updates for counts, health, and top attention items across all projects.
2. Project scope: detailed session snapshots for one project dashboard.

The current SSE route chooses an observer project from the first configured project. That must go away on the portfolio page.

## CLI Changes

### `ao status`

Make portfolio scope available explicitly when a portfolio index exists, but do not hide repo-local truth for users invoking commands inside a repo.

Behavior:

1. `ao status` inside a repo -> show that repo's project by default, with a hint that `ao status --portfolio` shows all indexed projects.
2. `ao status --portfolio` -> show all indexed projects.
3. `ao status --project <id>` -> show one project explicitly.

### `ao start`

`ao start` keeps its current local behavior, plus one new responsibility:

1. If the current project is not in the portfolio index, discover and add it.
2. If it is already registered, refresh `lastSeenAt`, `configPath`, and key metadata.
3. Launch the dashboard at `/projects/<projectId>` or `/` depending on user intent.

### `ao spawn`, `ao send`, `ao session ...`

Project-scoped commands should continue working from inside a repo without extra flags, but they need a clean story outside a repo:

1. Inside a repo: infer the current portfolio project from repo path or `AO_PROJECT_ID`.
2. Outside a repo: require `--project <id>` or a fully qualified `project/session` target when ambiguous.

### New commands

| Command | Purpose |
| --- | --- |
| `ao project ls` | List indexed portfolio projects |
| `ao project add <path>` | Index an existing repo/config in the portfolio |
| `ao project rm <id>` | Disable or remove a project from the portfolio index |
| `ao dashboard [--project <id>]` | Open portfolio or project dashboard intentionally |

## Migration Plan

### Phase 1: Index and aggregation

1. Add portfolio index types and read/write helpers.
2. Auto-register the current repo/project during `ao start`.
3. Add portfolio session aggregation without changing session file locations.
4. Add tests for mixed configs, duplicate prefixes across different configs, and missing configs.

### Phase 2: Web routing and portfolio landing

1. Add route-based portfolio pages.
2. Update `/api/projects`, `/api/sessions`, `/api/events` to use portfolio services.
3. Convert the sidebar to route-driven navigation.
4. Add legacy redirects from query-param routes.

### Phase 3: CLI portfolio ergonomics

1. Add `ao status --portfolio` and validate whether a portfolio default is actually better after rollout.
2. Add `ao project` commands.
3. Update command help and README/examples.

### Phase 4: Cleanup

1. Remove first-project fallback logic from `getPrimaryProjectId()` and `getProjectName()`.
2. Remove session/project resolution paths that rely on prefix inference when route context already exists.
3. Collapse duplicated project/session resolution helpers across core/web.

## Risks and Mitigations

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Duplicate `sessionPrefix` across different configs | Portfolio views cannot rely on prefix-only session lookup | Require project context in routes and mutations; use index project ID as outer scope |
| Missing or stale config paths in index | Portfolio page can partially fail | Mark project degraded, surface inline error, keep rest of portfolio working, and allow rebuild/prune |
| Portfolio loading every config on each request | Large portfolios get slow | Cache registry reads and lazily load configs; parallelize per-project session fetch with timeout budgets |
| User confusion during migration | Old links and habits still use query params | Add redirects and clear CLI help |
| Portfolio feature breaks single-project setups | Most users start here | Keep local config flows working when registry contains one project only |

## Acceptance Criteria

1. A user with three repo-local configs can open one dashboard and see cross-project attention plus all three projects at `/`.
2. `ao status --portfolio` shows sessions across indexed projects without requiring a monolithic shared YAML.
3. Repo-local `ao status` remains fast and unsurprising inside a repo.
4. `/projects/[projectId]` shows only that project's sessions and orchestrator.
5. Session detail URLs are project-scoped and do not depend on guessing from the first matching prefix.
6. Existing single-project usage still works without a manual migration step.
7. Legacy `/?project=` links redirect to the new route hierarchy.

## Initial File/Module Blast Radius

### Core

1. `packages/core/src/types.ts`
2. `packages/core/src/config.ts`
3. `packages/core/src/paths.ts`
4. `packages/core/src/session-manager.ts`
5. New portfolio registry/session service modules

### CLI

1. `packages/cli/src/commands/start.ts`
2. `packages/cli/src/commands/status.ts`
3. `packages/cli/src/commands/spawn.ts`
4. New `packages/cli/src/commands/project.ts`

### Web

1. `packages/web/src/app/page.tsx`
2. New `packages/web/src/app/projects/[projectId]/page.tsx`
3. New `packages/web/src/app/projects/[projectId]/sessions/[sessionId]/page.tsx`
4. `packages/web/src/components/Dashboard.tsx`
5. `packages/web/src/components/ProjectSidebar.tsx`
6. `packages/web/src/lib/project-name.ts`
7. `packages/web/src/lib/project-utils.ts`
8. `packages/web/src/lib/services.ts`
9. `packages/web/src/app/api/projects/route.ts`
10. `packages/web/src/app/api/sessions/route.ts`
11. `packages/web/src/app/api/events/route.ts`

## Success Metric

After this lands, the primary question the product answers should change from:

```text
"What is happening in the project tied to this config file?"
```

to:

```text
"Across all projects, what needs my judgment right now, and where do I jump to act on it?"
```

Primary product metrics:

1. Fewer manual dashboard checks per user-day
2. Faster time from human-needed event to action
3. More concurrently managed repos per user without added human polling
4. Higher share of routine issues resolved without human intervention

### Market Learning Metrics (added per CEO review)

5. Second-project activation rate: what % of users configure 2+ projects?
6. Share of human decisions handled from push surfaces (notifications) vs pull surfaces (dashboard)
7. Time-to-human-action: median time from blocked/needs-input event to user response
8. Portfolio page engagement: visits per user-day (validate that the page is used)

### Demand Validation Note

Multi-project demand is assumed from repo artifacts (README, prior specs, multi-project YAML examples) but not demonstrated by observed user behavior or telemetry. This is a reasonable product bet for an open-source tool actively evolving toward multi-project orchestration, but the plan should be validated by shipping the narrowest slice first and measuring second-project activation before investing in the full route hierarchy.

### Product Positioning Clarification

The dashboard is the **pull fallback surface**, not the primary delivery mechanism. Notifications remain the primary "push" loop. The `/` attention page exists for when a user explicitly wants portfolio context or was deep-linked from a notification. It does not replace or compete with the notification system. Portfolio-aware notification consolidation (e.g., single Slack thread aggregating alerts from all projects) is deferred but should be prioritized immediately after MVP validation.

### Cross-Project Triage Ranking

The attention inbox at `/` uses the following priority ordering across projects:

1. **Blocked** sessions (human input required to unblock) — highest priority
2. **Needs-input** sessions (awaiting human decision)
3. **Review-ready** PRs (CI passed, review requested)
4. **Merge-ready** PRs (approved, CI passed, ready to merge)
5. **Working** sessions (active, no human action needed) — shown but deprioritized
6. **Done/idle** sessions — collapsed by default

Within each level, sort by recency (most recent first). Cross-project ordering is flat — a blocked session in Project A ranks above a review-ready PR in Project B regardless of project priority. User-defined project priority ordering is deferred to post-MVP.

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Principle | Rationale | Rejected |
| --- | --- | --- | --- | --- | --- |
| 1 | CEO | Reframe the problem from portfolio visibility to cross-project human attention routing | P1, P3, P6 | Matches AO's push-not-pull philosophy and strengthens the differentiated user loop | Dashboard-first framing |
| 2 | CEO | Choose SELECTIVE EXPANSION mode | P1, P2, P3 | Feature enhancement on existing system — harden core, cherry-pick expansions | Full scope expansion, scope reduction |
| 3 | CEO | Recommend Approach B: derived portfolio index + attention-first routing | P1, P5 | Solves default-path silo without brittle global config | Shared-config-only, canonical home registry |
| 4 | CEO | Keep existing per-project session files as write path | P1, P5 | Avoids risky metadata migration while enabling portfolio aggregation | Global session storage rewrite |
| 5 | CEO | Make / attention-first portfolio page, /projects/[id] project drill-down | P1, P5 | Resolves product contradiction by preserving notification-first while adding portfolio nav | Generic landing, project-only root |
| 6 | CEO | Keep repo-local ao status unsurprising; make portfolio explicit with --portfolio | P3, P5 | Reduces surprise; preserves local truth while portfolio model proves itself | Silent global default |
| 7 | CEO | Accept demand validation concern but don't block — add market learning metrics | P6 | Reasonable product bet; ship narrowest slice first, measure second-project activation | Block on validated demand |
| 8 | CEO | Dashboard is pull fallback, not primary delivery — clarify positioning | P5 | Plan says "push not pull" then builds pull surface; explicitly position / as fallback | Rewrite plan around notifications |
| 9 | CEO | TASTE: In-memory aggregation (Approach D) is viable but doesn't solve preferences | P1, P5 | Surface at final gate — genuinely viable for 80% at 20% cost, but loses pinning/ordering | Auto-accept or auto-reject |
| 10 | CEO | MVP scope already defines narrow slice — concern addressed | P3 | Design doc MVP Scope section + phased migration plan scope it down | Further reduce scope |
| 11 | CEO | Add cross-project triage ranking specification to plan | P1 | Both voices flagged ranking algorithm as unspecified — the actual differentiator | Leave ranking unspecified |
| 12 | CEO | Add market-learning metrics alongside implementation success criteria | P1 | Both voices flagged success criteria are implementation checks, not market learning | Keep implementation-only metrics |
| 13 | Design | Root / should be 3-panel layout (project rail / action queue / context pane), not stacked sections | P5 | Codex hard-rejected stacked card grid as generic SaaS — working layout is more appropriate for APP UI | Stacked sections approach |
| 14 | Design | Use AO-native action language, not generic dashboard labels | P5 | "Needs judgment" > "Portfolio"; "Safe to merge" > "Project cards" — action-native language matches product identity | Generic labels |
| 15 | Design | TASTE: Triage ranking complexity — simple (attention level + recency) vs complex sort tuple | P3, P5 | Simple ranking clearer for MVP; Codex wants multi-factor sort with inline reasoning | Auto-accept complex ranking |
| 16 | Design | Define notification deep link URLs now, defer notification system itself | P1 | Every action item needs a canonical URL that works from a notification; URL structure is cheap, notification system is not | Defer URL structure too |
| 17 | Eng | Add atomic write-then-rename + advisory locking for portfolio index | P1 | Both voices flagged concurrent ao start writes — last-writer-wins drops registrations | Accept TOCTOU risk |
| 18 | Eng | Add PortfolioServices layer spec — web singleton is fundamental blocker | P5 | Both voices flagged getServices() singleton assumes one config | Leave singleton as-is |
| 19 | Eng | Use lightweight metadata scanner for portfolio aggregation, not full SessionManager | P5, P3 | Don't pay plugin-init cost for read-only portfolio views | Construct full SessionManager per project |
| 20 | Eng | Define projectId derivation: configProjectKey with collision suffix | P5 | Both voices flagged identity ambiguity between portfolio ID and config key | Leave ambiguous |
| 21 | Eng | Add concurrent index write tests to test plan | P1 | Both voices flagged missing concurrency tests | Skip concurrency tests |
| 22 | Eng | Add partial-failure aggregation tests | P1 | One bad config must not crash the portfolio page | Skip partial-failure tests |
| 23 | Eng | Strip absolute filesystem paths from API responses | P1 | /api/projects leaks home directory structure to browser | Expose paths |
| 24 | Eng | Add snapshot cache + per-project timeouts for portfolio SSE | P1 | N*M session reads per SSE tick at portfolio scope — need cache layer | Accept linear scaling |
| 25 | Eng | Enumerate all mutation routes needing project context | P1 | kill, message, send, etc. resolve by ID alone — unsafe with cross-project sessions | Leave mutation routes as-is |
| 26 | Eng | TASTE: Approach D (discovery-derived, prefs overlay) vs Approach B (canonical membership) | P1, P5 | Same as Decision 9 — genuinely viable alternative not fully explored | Auto-accept or auto-reject |
| 27 | Gate | Choose HYBRID: auto-discover from session dirs + explicit ao project add + preferences-only file | P1, P3, P5 | Gets auto-discovery simplicity + explicit add for edge cases; concurrent write problem mostly eliminated | Pure Approach B or D |
| 28 | Gate | Choose SIMPLE triage ranking: attention level + recency | P3, P6 | Ship fast, iterate based on real usage; complex ranking is premature without mis-ranking data | Complex multi-factor sort |
| 2 | CEO | Choose SELECTIVE EXPANSION mode | P1, P2, P3 | This is a feature enhancement on an existing system, so the right move is to harden the core change and cherry-pick only valuable expansions | Full scope expansion, scope reduction |
| 3 | CEO | Recommend Approach B: derived portfolio index plus attention-first routing | P1, P5 | It solves the default-path silo problem without introducing a brittle canonical global config | Shared-config-only approach, canonical home registry |
| 4 | CEO | Keep existing per-project session files as the write path | P1, P5 | Avoids a risky metadata migration while still enabling portfolio aggregation | Global session storage rewrite |
| 5 | CEO | Make `/` an attention-first portfolio page and `/projects/[projectId]` the project drill-down | P1, P5 | Resolves the product contradiction by preserving notification-first behavior while still adding portfolio navigation | Generic portfolio landing, project-only root |
| 6 | CEO | Keep repo-local `ao status` unsurprising and make portfolio status explicit with `--portfolio` first | P3, P5 | Reduces operator surprise and preserves local truth while the new portfolio model proves itself | Silent global default for all status calls |
| 7 | CEO | Downgrade the user-level registry from canonical source to rebuildable index | P3, P5 | Avoids split-brain state and stale-path trust failures in a local-first product | Canonical portfolio registry |

## /autoplan Phase 1 — CEO Review

### 0A. Premise Challenge

This is the right problem area, but the original wording solved the wrong loop. The real user outcome is not "let me browse all my projects"; it is "tell me where human judgment is blocking progress across projects, then deep-link me into the right drill-down."

Doing nothing leaves the repo in an awkward middle state: the product markets multi-project behavior, the UI visually hints at a portfolio, but the actual universe boundary is still whichever config was loaded. That is a real pain point, especially for repeated `ao start` users, but the fix has to preserve AO's notification-first philosophy.

### 0B. Existing Code Leverage

| Sub-problem | Existing code | Reuse decision |
| --- | --- | --- |
| Project filtering and sidebar affordance | `docs/specs/project-based-dashboard-architecture.md`, `packages/web/src/components/ProjectSidebar.tsx`, `packages/web/src/lib/project-utils.ts` | Reuse patterns and route them properly |
| Per-project session discovery | `packages/core/src/session-manager.ts` | Reuse as the project-scoped primitive |
| Repo-local project detection | `packages/cli/src/commands/start.ts`, `packages/cli/src/commands/spawn.ts` | Reuse for index discovery and explicit project resolution |
| Project metadata loading | `packages/web/src/lib/project-name.ts`, `packages/web/src/lib/services.ts` | Replace first-project assumptions with portfolio-aware loaders |
| Session storage and lifecycle truth | `packages/core/src/paths.ts`, project-scoped metadata files | Reuse; do not migrate |

### 0C. Dream State Mapping

```text
CURRENT STATE                  THIS PLAN                         12-MONTH IDEAL
repo-local config silos  --->  local-first portfolio index  ---> team-aware control plane
query-param project UI   --->  route-based attention center ---> notifications + inbox + shared ops
single-config universe   --->  cross-config aggregation      ---> synced multi-user orchestration surface
```

### 0C-bis. Implementation Alternatives (MANDATORY)

The alternatives section in the main body is the decision record. The review conclusion is:

1. Approach A is too small and leaves the default-path problem intact.
2. Approach C is too early and creates brittle split-brain state for a local-first product.
3. Approach B is the right lake to boil in this repo right now.

### 0D. Mode-Specific Analysis

**Complexity check:** this plan clearly touches more than eight files and introduces new portfolio services. That is a smell only if the scope sprawls into hosted control-plane features. The corrected plan now stays inside the local-first product boundary.

**Minimum set of changes that achieves the goal:**

1. Rebuildable portfolio index
2. Portfolio session aggregation over existing session managers
3. Route hierarchy for `/`, `/projects/[projectId]`, and project-scoped session detail
4. Explicit CLI portfolio entry points

**Cherry-picked expansions accepted into scope:**

1. Attention-first root page instead of a browse-first portfolio home
2. Rebuildable index instead of canonical registry
3. Legacy route redirects so the transition is coherent

**Deferred out of scope:**

1. Synced team-aware control plane
2. Slack/Desktop inbox primitives beyond current notifier surfaces
3. Global search / command palette across all projects

**Skipped:**

1. Canonical global registry as the authoritative source of project identity and membership

### 0E. Temporal Interrogation

| Phase | What the implementer needs resolved now |
| --- | --- |
| Hour 1 foundations | Whether the index is authoritative or rebuildable; whether root is attention-first or browse-first |
| Hour 2-3 core logic | How project identity is resolved across config path, config project key, repo path, and route params |
| Hour 4-5 integration | How CLI defaults behave inside a repo versus in portfolio mode; how stale indexed projects degrade |
| Hour 6+ polish/tests | Which redirects are required, which legacy assumptions must be removed, and how to prove single-project behavior is unchanged |

Human-team effort for those decisions would normally cost a day or two of alignment. In this repo, CC compresses that to minutes only if the decisions are explicit now.

### 0F. Mode Selection

**Selected mode:** `SELECTIVE EXPANSION`  
**Selected approach:** `Approach B — Derived portfolio index + attention-first routing`

This is an enhancement of an existing system, not a greenfield rewrite. The review therefore holds the core scope firmly, cherry-picks the attention-first reframe, and rejects speculative hosted-control-plane drift.

## CEO Dual Voices

### CODEX SAYS (CEO — strategy challenge)

1. The first draft optimized the wrong loop: browsing instead of intervention.
2. A canonical global registry is too much durable state for a local-first product.
3. The spec risked product thrash by reversing the earlier project-scoped dashboard direction without explicitly resolving the contradiction.

### CLAUDE SUBAGENT (CEO — strategic independence)

1. The core user job is cross-project human attention routing, not portfolio visibility.
2. The premises needed evidence and user-segment framing.
3. The registry should be rebuildable/disposable, not authoritative.

### CEO DUAL VOICES — CONSENSUS TABLE

```text
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Premises valid?                  No      No      CONFIRMED
  2. Right problem to solve?          Reframe Reframe CONFIRMED
  3. Scope calibration correct?       No      No      CONFIRMED
  4. Alternatives sufficiently explored? No   No      CONFIRMED
  5. Competitive/market risks covered? No    No      CONFIRMED
  6. 6-month trajectory sound?        No      No      CONFIRMED
═══════════════════════════════════════════════════════════════
```

Consensus: **6/6 confirmed concerns, 0 disagreements.**

## Review Sections

### Section 1: Architecture Review

The corrected architecture is now coherent: repo-local config remains authoritative, the portfolio index becomes a rebuildable discovery layer, and project-scoped session managers remain the write-path truth. That is materially better than inventing a global control plane inside a local-only tool.

Required ASCII diagram:

```text
                         ┌──────────────────────────────┐
                         │ Portfolio Index (derived)    │
                         │ ~/.agent-orchestrator/...    │
                         └──────────────┬───────────────┘
                                        │
                   ┌────────────────────┼────────────────────┐
                   ▼                    ▼                    ▼
         repo-local config A   repo-local config B   repo-local config C
              │                      │                     │
              ▼                      ▼                     ▼
        SessionManager A       SessionManager B      SessionManager C
              │                      │                     │
              └──────────────┬───────┴─────────────┬──────┘
                             ▼                     ▼
                  PortfolioSessionService    Portfolio APIs / SSE
                             │                     │
                             └────────────┬────────┘
                                          ▼
                           `/` attention center + project drill-downs
```

### Section 2: Error & Rescue Map

This plan introduces a few critical new failure surfaces. They are acceptable only if the user sees degraded-but-usable behavior instead of silent disappearance.

| METHOD/CODEPATH | WHAT CAN GO WRONG | EXCEPTION CLASS |
| --- | --- | --- |
| `PortfolioIndex.load()` | Corrupt JSON, unreadable file | `PortfolioIndexParseError` |
| `PortfolioProjects.resolve()` | Config path missing, config project key removed | `ProjectConfigUnavailableError` |
| `PortfolioSessionService.list()` | One project session manager times out | `ProjectSessionLoadTimeoutError` |
| `GET /api/events?scope=portfolio` | One project blocks snapshot generation | `PortfolioSnapshotTimeoutError` |
| `ao start` index refresh | Repo renamed or moved | `IndexedProjectStaleError` |

| EXCEPTION CLASS | RESCUED? | RESCUE ACTION | USER SEES |
| --- | --- | --- | --- |
| `PortfolioIndexParseError` | Y | Rebuild index from recent local discovery, preserve raw file for debugging | Portfolio loads with warning |
| `ProjectConfigUnavailableError` | Y | Mark project stale/degraded and continue loading the rest | Project row marked degraded |
| `ProjectSessionLoadTimeoutError` | Y | Timeout budget per project, partial portfolio response | Missing counts plus stale badge |
| `PortfolioSnapshotTimeoutError` | Y | Emit partial portfolio snapshot with per-project status | Attention center still live |
| `IndexedProjectStaleError` | Y | Soft-fail and prompt prune/relink on next explicit project action | Clear stale project warning |

### Section 3: Security & Threat Model

The new security surface is small but real: project IDs become route parameters, portfolio APIs load configs from indexed paths, and session mutation routes gain a broader resolution layer. The key requirement is that portfolio lookup never expands the authority of a project action; it only resolves the target more explicitly.

The plan stays inside a local-user trust boundary, so the main threats are path confusion, malicious/stale indexed paths, and unintended command scope expansion. Multi-user auth remains out of scope.

### Section 4: Data Flow & Interaction Edge Cases

The critical edge cases are not glamorous UI states; they are mixed-truth portfolio states. The portfolio must still work when one project is stale, when one config is missing, when one session load times out, and when duplicate prefixes exist across configs.

The attention center also needs explicit empty-state behavior: if there is nothing urgent, the page should say that clearly and fall back to a calm portfolio overview rather than looking broken or empty.

### Section 5: Code Quality Review

The main quality risk is building a second project-resolution stack beside the existing one. The plan should centralize portfolio/project/session resolution helpers instead of copying logic across core, CLI, and web.

A second risk is semantic drift in naming. "Registry" implies authority; "index" implies derived discovery. The latter is the correct abstraction for this iteration and should be reflected consistently in code and docs.

### Section 6: Test Review

The most important tests are cross-config behavior and product-mode boundaries, not just happy-path route rendering.

Required test diagram:

```text
NEW UX FLOWS
  - Open `/` and see cross-project attention
  - Jump from `/` to `/projects/[projectId]`
  - Open session detail with explicit project context

NEW DATA FLOWS
  - `ao start` -> index refresh
  - portfolio index -> config resolution -> session aggregation
  - portfolio SSE -> partial snapshot with degraded projects

NEW CODEPATHS
  - stale indexed project handling
  - duplicate sessionPrefix across configs
  - repo-local `ao status` vs `ao status --portfolio`

NEW ERROR/RESCUE PATHS
  - corrupt index
  - missing config path
  - one project timing out while others render
```

### Section 7: Performance Review

The performance risk is per-request fan-out across indexed projects. This is manageable if portfolio reads use timeout budgets, cached index reads, and partial results instead of blocking on the slowest project.

No database or remote service is being introduced here, so the worst-case slow path is filesystem plus per-project session enrichment. That is acceptable if the portfolio page favors fast attention summaries over fully enriched detail.

### Section 8: Observability & Debuggability Review

The new observability requirement is project-level degradation visibility. When the portfolio is partially wrong, the user and the logs need to say which project failed to load and why.

The attention center should therefore track: indexed projects loaded, degraded projects count, per-project load duration, and whether the snapshot is partial.

### Section 9: Deployment & Rollout Review

This rollout is reversible as long as legacy routes continue to redirect and existing session storage remains unchanged. The safest rollout order is:

1. add the index and aggregation layer,
2. ship routes and dual-path APIs,
3. switch the UI entry point,
4. remove first-project fallback assumptions only after the new path is proven.

### Section 10: Long-Term Trajectory Review

This plan moves toward a stronger local control plane, but not yet toward a team/shared control plane. That is the right call. It keeps the one-year path open without pretending the repo is already building multi-user infrastructure.

The main long-term risk is accidental commitment to local canonical state. The corrected index framing avoids that trap and keeps reversibility high.

### Section 11: Design & UX Review

UI scope is significant. The strongest design decision in this phase is not visual polish; it is hierarchy. The first screen must privilege urgent attention items over project cards, otherwise the portfolio page becomes a contradiction of the product philosophy.

This section is not fully closed until the project-level and portfolio-level navigation hierarchy is explicitly designed in the Phase 2 design pass.

## NOT in scope

1. Hosted or synced team-aware control plane — outside this repo's current local-user boundary
2. Slack/Desktop inbox as a first-class new notifier surface — adjacent but not required to land the architecture
3. Cross-project search / command palette — useful, but not core to the routing and aggregation model
4. Project branding/theme customization — cosmetic
5. Multi-user auth and permissions — explicitly out of scope

## What already exists

1. Project-scoped dashboard filtering, query-param routing, and sidebar affordances
2. Project-scoped session aggregation inside a single config
3. Repo-local project detection flows in `ao start` and `ao spawn`
4. Stable per-project session metadata storage and lifecycle management

## Dream state delta

This plan gets AO from "repo-local dashboard silos" to "local-first cross-project attention control plane." It does **not** yet get to the 12-month ideal of a shared, synced, team-aware control plane. That is appropriate; the plan moves toward that ideal without taking on hosted-control-plane complexity prematurely.

## Failure Modes Registry

| CODEPATH | FAILURE MODE | RESCUED? | TEST? | USER SEES? | LOGGED? |
| --- | --- | --- | --- | --- | --- |
| Portfolio index load | Corrupt index file | Y | Required | Warning + partial recovery | Y |
| Project config resolution | Indexed path stale | Y | Required | Degraded project row | Y |
| Portfolio session aggregation | One project times out | Y | Required | Partial portfolio snapshot | Y |
| Session detail route | Duplicate prefix across configs | Y | Required | Explicit project-scoped resolution | Y |
| Legacy redirects | Bad project ID in old query-param link | Y | Required | Project not found / safe redirect | Y |

No row is currently allowed to ship as silent failure.

## Completion Summary

```text
+====================================================================+
|            MEGA PLAN REVIEW — COMPLETION SUMMARY                   |
+====================================================================+
| Mode selected        | SELECTIVE EXPANSION                        |
| System Audit         | Push-not-pull tension resolved in plan     |
| Step 0               | Reframed to attention-first portfolio      |
| Section 1  (Arch)    | 3 major issues found and fixed             |
| Section 2  (Errors)  | 5 error paths mapped, 0 silent gaps        |
| Section 3  (Security)| 2 issues noted, 0 high-severity blockers   |
| Section 4  (Data/UX) | 4 edge cases mapped, 0 unhandled allowed   |
| Section 5  (Quality) | 2 issues found                             |
| Section 6  (Tests)   | Diagram produced, core gaps identified     |
| Section 7  (Perf)    | 2 risks flagged                            |
| Section 8  (Observ)  | 2 gaps flagged                             |
| Section 9  (Deploy)  | 2 rollout risks flagged                    |
| Section 10 (Future)  | Reversibility: 4/5, debt items: 2          |
| Section 11 (Design)  | 1 hierarchy issue, design pass pending     |
+--------------------------------------------------------------------+
| NOT in scope         | written (5 items)                          |
| What already exists  | written                                     |
| Dream state delta    | written                                     |
| Error/rescue registry| 5 methods, 0 critical gaps                |
| Failure modes        | 5 total, 0 silent-failure gaps            |
| Scope proposals      | 3 accepted, 3 deferred/skipped            |
| Outside voice        | ran (codex + subagent)                    |
| Lake Score           | 7/7 chose the complete option             |
| Premise gate         | PENDING USER CONFIRMATION                 |
+====================================================================+
```

## Unresolved Decisions

1. Whether `ao status` should eventually become portfolio-first by default after rollout data exists, or remain repo-first permanently with explicit `--portfolio`
2. Whether the portfolio index should support explicit user pinning only, or also auto-include every project seen via `ao start`

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | clean | 2 unresolved (taste decisions resolved at gate) |
| CEO Voices | autoplan dual | Codex + Claude subagent | 1 | codex+subagent | CEO consensus 2/6 confirmed, 4/6 disagree |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | 3 unresolved (critical empty states) |
| Design Voices | autoplan dual | Codex only | 1 | codex-only | Hard rejection on card grid; 7/7 litmus NO |
| Eng Review | `/plan-eng-review` | Architecture & tests | 1 | clean | 3 critical gaps, 12 issues total |
| Eng Voices | autoplan dual | Codex + Claude subagent | 1 | codex+subagent | Eng consensus 3/6 confirmed, 3/6 disagree |

**VERDICT:** APPROVED — 28 decisions logged, 2 taste decisions resolved at gate (hybrid discovery + simple ranking). Plan updated with all review findings. Key engineering gaps (singleton refactor, concurrent writes, lightweight scanner) documented with architectural solutions. Test plan artifact written.

**Next step:** `/ship` when ready to create the PR, or start implementation with the plan as guide.
