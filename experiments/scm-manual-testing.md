# SCM Redesign: Manual Testing Plan

After the refactor is complete, verify that AO behaves identically. The behavior should not change — only the internal structure.

## 1. The basic loop — does polling work?

```bash
ao start
ao spawn --issue <some-issue>
```

Watch the session go through its lifecycle:

| What to check | How | What confirms it works |
|---|---|---|
| PR detection | Agent creates a PR | Dashboard shows PR link, status moves to `pr_open` |
| CI tracking | PR triggers CI | Dashboard shows CI status (passing/failing/pending) |
| CI failure reaction | Make CI fail (bad test) | Status moves to `ci_failed`, agent gets notified |
| Review tracking | Leave a review comment on the PR | Status moves to `review_pending` or `changes_requested`, agent gets the comment |
| Merge readiness | Approve PR + CI passes | Status moves to `mergeable` |
| PR merged | Merge the PR | Status moves to `merged` → `cleanup` → `done` |

If all those transitions happen correctly, `poll()` is working.

## 2. CLI status — does it read cached data?

```bash
# While a session is active with a PR:
ao status
```

**Before the change:** takes a few seconds (4 API calls per session).
**After the change:** should be instant (reads last poll result from metadata).

If `ao status` is instant and shows correct PR/CI/review data, the metadata path works.

## 3. Merge from dashboard — do mutations work?

Open the dashboard, find a mergeable PR, click merge.

- PR should merge on GitHub/GitLab
- Session should transition to `merged` → `cleanup` → `done`
- Next poll should pick up the merged state

## 4. Review comments — do they reach the agent?

Leave an inline review comment on the PR. Wait for the next poll cycle (~30s).

- Agent should receive the comment and start working on it
- Dashboard should show the unresolved comment count
- After agent pushes a fix, comment tracking should update

## 5. Merge conflicts — does conflict detection work?

Push a conflicting change to the base branch while a session's PR is open.

- Dashboard should show conflict indicator
- Agent should get notified about the conflict

## 6. Auth preflight — does `checkAuth()` work?

```bash
# Log out of gh CLI:
gh auth logout

# Try to spawn:
ao spawn --issue <some-issue>
```

Should fail with a clear auth error from the plugin, not a cryptic failure later.

## 7. Web URLs — no hardcoded github.com?

If you have a GitLab project, check:

- Branch URL in session detail → should point to GitLab, not GitHub
- Compare URL for conflicts → should point to GitLab

## 8. The real proof — does GitLab actually work?

Point AO at a GitLab repo:

```yaml
projects:
  my-project:
    repo: my-org/my-repo
    scm:
      plugin: gitlab
```

Run the same flow (spawn → PR → CI → review → merge). If it all works through the same AO code paths that work for GitHub, the provider-agnostic refactor is real.

## 9. Regressions to watch for

| Regression | How you'd notice |
|---|---|
| Poll returns stale data | Dashboard shows wrong CI status or review state |
| Poll misses PR detection | Session stays in `working` even after agent created a PR |
| Review throttle broken | Agent gets spammed with duplicate review comments, or never gets them |
| Cache invalidation broken | After merging, dashboard still shows PR as open |
| Metrics missing | Observability/logging for SCM calls disappears (check logs) |

## Summary

No special test harness needed. Spawn a session, let it create a PR, interact with the PR on GitHub/GitLab (review it, fail CI, merge it), and watch if AO reacts correctly at each step. If the lifecycle transitions match reality, the refactor works.
