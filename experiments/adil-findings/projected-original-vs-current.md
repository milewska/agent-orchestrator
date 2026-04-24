# Projected Original vs Current — 15 Sessions, 22.6 min

## Projected Original (Before Optimizations)

Based on scaling the original 5-session trace (465 calls / 15.7 min).

### Operations

| Operation | Projected Calls |
|-----------|----------------:|
| `detectPR` | 354 |
| `pr view` (individual fallback) | 281 |
| `pr checks` (individual fallback) | 194 |
| `review threads` (GraphQL) | 238 |
| `automated comments` (REST) | 173 |
| `guard-commit-status` | 220 |
| `issue view` | 117 |
| `guard-pr-list` (×2 LMs) | 78 |
| `graphql-batch` (×2 LMs) | 63 |
| Other | 6 |
| **Total** | **1,724** |
| **Calls/min** | **76.3** |

### Budget

- GraphQL: **~6,216 pts/hr** — **OVER BUDGET** (exhausted in ~48 min)
- REST: ~504 pts/hr (within budget)

### Issues

1. ETag guard BROKEN — Guard 1 always returns "changed", batch fires every cycle
2. TWO lifecycle managers — CLI + web dashboard, doubling all traffic
3. detectPR runs every cycle — no gating, even when nothing changed
4. Individual REST fallbacks — 4 calls per PR on batch miss
5. Separate REST call for bot comments — paginated alongside GraphQL
6. No issue view dedup — concurrent calls not deduplicated

---

## Current (After All Optimizations)

From trace: `gh-trace-real-1777042913.jsonl`

### Operations

| Operation | Calls | Type |
|-----------|------:|------|
| `gh.pr.list` (detectPR) | 66 | REST |
| `gh.issue.view` | 35 | REST |
| `gh.api.guard-pr-list` | 20 | REST |
| `gh.api.graphql-batch` | 3 | GraphQL |
| `gh.api.guard-review-comments` | 1 | REST |
| `gh.api.graphql` (review threads) | 1 | GraphQL |
| **Total** | **126** | |

### Split by Type

| Type | Calls | Points consumed |
|------|------:|----------------:|
| REST | 122 | ~50 (304s are free) |
| GraphQL | 4 | 36 |
| **Total** | **126** | **~86** |

### Budget

- GraphQL: **~96 pts/hr** (~6.4 per session)
- REST: ~200 pts/hr (304s free, only 200 responses cost)

---

## Comparison

| Metric | Original (projected) | Current (actual) | Reduction |
|--------|---------------------|-----------------|-----------|
| Total calls | 1,724 | 126 | **-93%** |
| Calls/min | 76.3 | 5.6 | **-93%** |
| GraphQL pts/hr | ~6,216 | ~96 | **-98%** |
| REST pts/hr | ~504 | ~200 | **-60%** |
| Per session GraphQL | ~414 pts/hr | ~6.4 pts/hr | **-98%** |
| Max sessions | ~12 | ~50 | **+317%** |
| Budget status | Over budget at 48 min | ~2% used | — |
