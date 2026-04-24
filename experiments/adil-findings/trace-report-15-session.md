# Trace Report — 15-Session Run

**Trace:** `gh-trace-real-1777042913.jsonl`
**Date:** 2026-04-24
**Duration:** 22.6 min
**Sessions:** 15 (15 branches, 15 issues)
**Total calls:** 126 (5.6/min)

## Operations

| Operation | Calls | Rate |
|-----------|------:|------|
| `gh.pr.list` (detectPR) | 66 | 2.9/min |
| `gh.issue.view` | 35 | 1.5/min |
| `gh.api.guard-pr-list` | 20 | 0.9/min |
| `gh.api.graphql-batch` | 3 | 0.1/min |
| `gh.api.guard-review-comments` | 1 | — |
| `gh.api.graphql` (review threads) | 1 | — |

## ETag Guards

| Guard | Calls | 304 | 200 | Hit Rate |
|-------|------:|----:|----:|---------|
| Guard 1 (PR list) | 20 | 14 | 6 | 70% |
| Guard 2 (commit status) | 0 | — | — | — |
| Guard 3 (review comments) | 1 | 0 | 1 | 0% |

## detectPR

- 66 calls, only on Guard 1 200 cycles (6 cycles × ~11 PR-less sessions = 66)

## Issue View

- 35 calls across 15 unique issues
- 2.3 calls per issue average

## GraphQL Budget

- Remaining: 4,815 → 4,779
- Consumed: **36 points** in 22.6 min
- Projected: **~96 pts/hr**
- Per session: **~6.4 pts/hr**
- Max sessions (5,000 budget): **~785**

## Batch Cost

- Batch 1: 19 points
- Batch 2: 17 points

## Latency

| Operation | Avg | Total |
|-----------|----:|------:|
| `gh.issue.view` | 14,408ms | 504.3s |
| `gh.pr.list` | 2,696ms | 177.9s |
| `gh.api.guard-pr-list` | 2,432ms | 48.6s |
| `gh.api.graphql-batch` | 2,284ms | 6.9s |
| `gh.api.graphql` | 6,564ms | 6.6s |
| `gh.api.guard-review-comments` | 4,320ms | 4.3s |

Total wall time in gh calls: 748.6s (55.2% of trace window)
