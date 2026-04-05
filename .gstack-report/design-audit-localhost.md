# Design Audit: Agent Orchestrator Dashboard

**Date:** 2026-04-05
**URL:** http://localhost:3000
**Branch:** ashish921998/design-review-fixes
**Mode:** Diff-aware (feature branch)
**DESIGN.md:** Present and used as calibration baseline

---

## First Impression

The site communicates **operational control**. Dark mode with blue-tinted graphite surfaces, status-aware color coding, and a dense but scannable layout. This reads like a monitoring dashboard for someone running an operation, not a project management tool. The "Industrial Precision" direction from DESIGN.md is well-executed.

One word: **Clean.**

---

## Scores

| Metric | Baseline | Final |
|--------|----------|-------|
| **Design Score** | **B** | **B+** |
| **AI Slop Score** | **A** | **A** |

### Category Grades

| Category | Baseline | Final | Notes |
|----------|----------|-------|-------|
| Visual Hierarchy | B | B | Good focal points, surface hierarchy works |
| Typography | B- | B | Fixed weight, tracking, letter-spacing |
| Color & Contrast | A- | A | Fixed neutral-gray override to blue-tinted graphite |
| Spacing & Layout | A- | A- | Consistent 4px grid, correct border-radius hierarchy |
| Interaction States | C | C | Touch targets deferred (source/server mismatch) |
| Responsive | A- | A- | Good mobile accordion layout |
| Motion | C | B | Removed concurrent animations, added prefers-reduced-motion |
| Content Quality | C | B | Contextual empty state messages per column |
| AI Slop | A | A | No patterns detected |
| Performance | B | B | Good containment, dev-server TTFB expected |

---

## Findings

| # | Finding | Impact | Status | Commit |
|---|---------|--------|--------|--------|
| 001 | No `prefers-reduced-motion` media query | HIGH | verified | 5be327c9 |
| 002 | Touch targets undersized (16-28px) | HIGH | deferred | -- |
| 003 | Concurrent breathe+pulse animations on status pills | HIGH | verified | dc8feba5 |
| 004 | Dashboard title weight 600, should be 680 | MEDIUM | verified | 0eef8bb7 |
| 005 | Detail-card text colors neutral gray, not blue-tinted | MEDIUM | verified | eccfb9a6 |
| 006 | H2 "Attention Board" semantic mismatch (12px label) | MEDIUM | verified | 3c5e1931 |
| 007 | Empty states bare "No sessions" text | MEDIUM | verified | 633f3b17 |
| 008 | Headings use text-wrap: wrap, not balance | POLISH | verified | eb1dbd0f |
| 009 | Section label letter-spacing 0.16em, should be 0.06em | POLISH | verified | 3c5e1931 |

### Deferred

- **FINDING-002 (Touch targets):** The dev server at port 3000 runs from `/Users/ashishhuddar/agent-orchestrator` (main repo), not this workspace. Sidebar icon buttons use Tailwind `h-6 w-6` (24px) and `h-4 w-4` (16px) classes that don't exist in the workspace source. Fix requires locating these buttons in the main repo.

---

## Fixes Applied

**Total:** 7 verified, 0 best-effort, 0 reverted, 1 deferred

### FINDING-001: prefers-reduced-motion
- **File:** `packages/web/src/app/globals.css`
- **Change:** Added `@media (prefers-reduced-motion: reduce)` that disables all animations and transitions
- **Why:** DESIGN.md requires "All animations must respect prefers-reduced-motion: reduce"

### FINDING-003: Remove concurrent breathe animations
- **File:** `packages/web/src/app/globals.css`
- **Change:** Removed 3 breathe keyframes and their animation declarations on status pills. Kept dot-pulse on child dots only.
- **Why:** DESIGN.md says "One animation per element, one purpose per animation" and "Keep dot pulse, remove border heartbeat"
- **Lines deleted:** 42

### FINDING-004: Fix dashboard title weight and tracking
- **File:** `packages/web/src/app/globals.css`
- **Change:** `.dashboard-title` weight 600 -> 680, letter-spacing -0.05em -> -0.035em
- **Why:** DESIGN.md specifies display headings at weight 680 and -0.035em

### FINDING-005: Fix detail-card text to blue-tinted graphite
- **File:** `packages/web/src/app/globals.css`
- **Change:** `.dark .detail-card` text-secondary #9898a0 -> #a5afc4, text-muted/tertiary #5c5c66 -> #6f7c94
- **Why:** Neutral grays break the blue-tinted graphite palette established in DESIGN.md

### FINDING-006/009: Fix section label semantics and letter-spacing
- **Files:** `Dashboard.tsx`, `globals.css`
- **Change:** Changed `<h2>` to `<div role="heading" aria-level={2}>`, letter-spacing 0.16em -> 0.06em
- **Why:** Element styled as 12px uppercase label shouldn't be an H2. DESIGN.md specifies 0.06em for UI labels.

### FINDING-007: Contextual empty state messages
- **Files:** `AttentionZone.tsx`, `components.test.tsx`
- **Change:** Replaced generic "No sessions" with per-column messages (e.g., "No agents need your input", "No code waiting for review")
- **Why:** DESIGN.md and audit checklist require warm empty states

### FINDING-008: text-wrap: balance on headings
- **File:** `packages/web/src/app/globals.css`
- **Change:** Added `text-wrap: balance` to `.dashboard-title` and `.kanban-column__title`
- **Why:** Better line breaks on narrow viewports

---

## PR Summary

Design review found 9 issues, fixed 7 (1 deferred). Design score B -> B+, AI slop score A (no change).
