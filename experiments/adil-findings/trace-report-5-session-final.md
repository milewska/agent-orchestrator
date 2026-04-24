# Comprehensive Trace Report — 5-Session Benchmark (Post All Optimizations)

**Date:** 2026-04-24
**AO trace:** `gh-trace-real-1777062815.jsonl` ([gist](https://gist.github.com/iamasx/687d9cbaf454fca2159ccf424c4a7744))
**Agent trace:** `agent-gh-trace-1777062815.jsonl`
**Duration:** 1862s (31.0 min)
**Sessions:** 5

---

## AO-Side (lifecycle manager)

**Total calls:** 288 (9.3/min)

### Operations

| Operation | Calls | Rate |
|-----------|------:|------|
| `gh.api.guard-commit-status` | 114 | 3.7/min |
| `gh.api.guard-pr-list` | 63 | 2.0/min |
| `gh.api.guard-review-comments` | 35 | 1.1/min |
| `gh.issue.view` | 25 | 0.8/min |
| `gh.api.graphql-batch` | 18 | 0.6/min |
| `gh.pr.list` (detectPR) | 13 | 0.4/min |
| `gh.api.graphql` (review threads) | 9 | 0.3/min |
| `gh.pr.view` | 6 | 0.2/min |
| `gh.pr.checks` | 3 | 0.1/min |
| `gh.pr.merge` | 2 | 0.1/min |

### ETag Guards

| Guard | Calls | 304 | 200 | Hit Rate |
|-------|------:|----:|----:|---------|
| Guard 1 (PR list) | 63 | 49 | 14 | 78% |
| Guard 2 (commit status) | 114 | 107 | 7 | 94% |
| Guard 3 (review comments) | 35 | 26 | 9 | 74% |

### GraphQL Budget (from `rateLimit` in response body)

- AO GraphQL calls: **27**
- Cost per call: **1** (every call — confirmed by `rateLimit.cost`)
- AO total cost: **27 pts**
- Remaining: 4,971 → 4,885 (delta=86)
- Unaccounted: **59 pts** (consumed by agents)

**Batch calls (18):**

| # | Cost | Remaining | Size |
|---|-----:|----------:|-----:|
| 1 | 1 | 4,971 | 2,762B |
| 2 | 1 | 4,965 | 2,775B |
| 3 | 1 | 4,961 | 2,777B |
| 4 | 1 | 4,953 | 5,843B |
| 5 | 1 | 4,948 | 5,861B |
| 6 | 1 | 4,947 | 5,861B |
| 7 | 1 | 4,941 | 7,431B |
| 8 | 1 | 4,935 | 8,979B |
| 9 | 1 | 4,933 | 8,993B |
| 10 | 1 | 4,932 | 8,993B |
| 11 | 1 | 4,925 | 8,996B |
| 12 | 1 | 4,922 | 7,435B |
| 13 | 1 | 4,919 | 7,450B |
| 14 | 1 | 4,917 | 7,441B |
| 15 | 1 | 4,913 | 7,450B |
| 16 | 1 | 4,912 | 7,447B |
| 17 | 1 | 4,892 | 7,455B |
| 18 | 1 | 4,885 | 5,911B |

**Review thread calls (9):**

| # | Cost | Remaining | Size |
|---|-----:|----------:|-----:|
| 1 | 1 | 4,966 | 1,316B |
| 2 | 1 | 4,949 | 1,315B |
| 3 | 1 | 4,950 | 1,316B |
| 4 | 1 | 4,939 | 1,314B |
| 5 | 1 | 4,934 | 1,316B |
| 6 | 1 | 4,927 | 2,116B |
| 7 | 1 | 4,918 | 2,134B |
| 8 | 1 | 4,916 | 2,515B |
| 9 | 1 | 4,911 | 2,326B |

### REST Budget

- REST calls: 212 (182×304 free, 30×200)
- Remaining: 4,999 → 4,977 (consumed=22)

### detectPR

- 13 calls, 5 unique branches
- Only fired on Guard 1 200 cycles

### Issue View

- 25 calls, 5 unique issues, 5.0 avg/issue

### Latency

| Operation | Avg | Total |
|-----------|----:|------:|
| `gh.pr.merge` | 3,916ms | 7.8s |
| `gh.pr.list` | 1,476ms | 19.2s |
| `gh.pr.checks` | 1,301ms | 3.9s |
| `gh.api.graphql-batch` | 1,269ms | 22.8s |
| `gh.api.guard-pr-list` | 1,219ms | 76.8s |
| `gh.issue.view` | 1,132ms | 28.3s |
| `gh.api.graphql` | 858ms | 7.7s |
| `gh.api.guard-commit-status` | 795ms | 90.6s |
| `gh.api.guard-review-comments` | 772ms | 27.0s |
| `gh.pr.view` | 752ms | 4.5s |

**Total wall time:** 288.7s (15.5% of trace window)

---

## Agent-Side (via `~/.ao/bin/gh` wrapper)

**Total calls:** 46

### Operations

| Operation | Calls |
|-----------|------:|
| (uncategorized) | 23 |
| `gh.api.graphql` (mutations) | 7 |
| `gh.auth.token` | 6 |
| `gh.pr.create` | 5 |
| REST API calls (reviews, replies) | 5 |

### Agent GraphQL Mutations

| Mutation | Calls |
|----------|------:|
| `resolveReviewThread` | 5 |
| `addPullRequestReviewThreadReply` | 2 |

Estimated cost: 7 × 5 = **35 pts**

### Agent Wrapper Cache

| Result | Count |
|--------|------:|
| passthrough | 23 |
| no-trace-field | 23 |

---

## Combined Budget

| Source | Cost | Calls |
|--------|-----:|------:|
| AO GraphQL | 27 pts | 27 calls × 1 pt |
| Agent GraphQL | 35 pts | 7 calls × 5 pts |
| **Total GraphQL** | **62 pts** | **34 calls** |
| Actual delta | 86 pts | (includes untraced agent calls) |

| Metric | Value |
|--------|-------|
| Projected | ~166 pts/hr |
| Per session | ~33.2 pts/hr |
| Max sessions (5,000 budget) | ~150 |

---

## Poll Architecture

```
pollAll()
  |
  +-- Phase 1: populatePREnrichmentCache()
  |     +-- Guard 1 (PR list ETag)               63 calls (49×304, 14×200)
  |     +-- Guard 2 (commit status ETag)        114 calls (107×304, 7×200)
  |     +-- GraphQL Batch Query                  18 calls (18 pts)
  |     +-- detectPR (only on Guard 1 200)       13 calls
  |
  +-- Phase 2: checkSession() × N
  |     +-- determineStatus()
  |           +-- PR Auto-Detect                  0 calls (moved to Phase 1)
  |           +-- Fallback Individual Calls       0 calls (removed)
  |
  +-- Phase 3: maybeDispatchReviewBacklog() × N
  |     +-- Guard 3 (review comments ETag)       35 calls (26×304, 9×200)
  |     +-- GraphQL review threads + reviews      9 calls (9 pts)
  |
  +-- Phase 4-5: CI/Conflicts                    0 calls (batch has data)
  |
  +-- Issue view (5-min TTL + dedup)             25 calls (5.0/issue)

  Agent-side:
  +-- GraphQL mutations (resolve/reply)           7 calls (35 pts)
  +-- REST calls (pr create, auth, etc)          39 calls

  Total: 334 calls | 10.8/min
```

---

## Key Findings

1. **AO GraphQL = 1 pt/call** — `contexts(first: 10)` reduction confirmed working. Batch with up to 5 PRs = 1 pt. Review threads with `reviews(last: 5)` = 1 pt.

2. **Agent mutations = 5 pts each** — 7 mutations (resolve threads + reply) = 35 pts. Agents ARE using thread IDs from our prompt instead of re-fetching review data.

3. **Guard hit rates** — Guard 1: 78%, Guard 2: 94%, Guard 3: 74%. Combined, these skip ~80% of expensive GraphQL/REST calls.

4. **Issue view dedup working** — 25 calls for 5 issues (5.0 avg). Concurrent dedup prevents duplicate calls.

5. **Budget** — ~166 pts/hr for 5 sessions → max ~150 sessions before GraphQL exhaustion. GraphQL is no longer the bottleneck.
