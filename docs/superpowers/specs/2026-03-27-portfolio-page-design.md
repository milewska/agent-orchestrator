# Portfolio Page — Design Spec

## Overview

A new portfolio page at `/portfolio` that serves as the fleet management view for Agent Orchestrator. It shows all registered projects with health indicators, and provides onboarding actions (clone, scaffold, add local project). It lives as a peer tab alongside Dashboard and PRs.

**Who it's for:** Developers managing multiple AI-assisted projects who need a bird's-eye view across their fleet before drilling into a specific project's dashboard.

## Architecture

### Routing

- **Route:** `/portfolio` — new Next.js page
- **Server component:** `app/portfolio/page.tsx` loads data via `getPortfolioPageData()`
- **Client component:** `<PortfolioPage>` receives project summaries as props
- **No SSE/real-time:** Server-rendered snapshot. Refresh by navigating.

### Data loading

New file: `lib/portfolio-page-data.ts`

Leverages the existing `portfolio-services.ts` cache layer (which already handles portfolio discovery, session listing, and background refresh):

1. `getPortfolioServices()` — cached project list from portfolio registry + config
2. `getCachedPortfolioSessions()` — all sessions across projects (async, cached with 10s TTL)
3. Group sessions by project, compute per-project aggregates via `getAttentionLevel()`
4. Return `PortfolioPageData`

```typescript
interface PortfolioPageData {
  projects: PortfolioProjectSummary[];
  defaultLocation: string; // for clone/scaffold modals
}

interface PortfolioProjectSummary {
  id: string;
  name: string;
  sessionCount: number;
  activeCount: number;
  attentionCounts: Record<AttentionLevel, number>;
  degraded: boolean;
  degradedReason?: string;
}
```

`PortfolioProjectSummary` is added to `lib/types.ts`.

## Page layout

### Desktop (>767px)

- Full-width page, no sidebar
- Max content width: 960px, centered
- Header row:
  - Left: "Portfolio" title (IBM Plex Sans 700, 17px) + "N workspaces" subtitle
  - Right: "New project" button
- Project cards in responsive CSS grid: 3 columns wide, 2 columns narrower
- Action cards ("Clone from URL", "Quick start", "Add local project") in the same grid
- Design system tokens throughout — see Styling section

### Mobile (≤767px)

- Single column, full-width
- Header: "Portfolio" title + count, "+" icon button (32px) top right
- Project cards stacked vertically, 8px gap
- Action cards in 2-column grid below project cards
- Bottom nav visible with Portfolio tab active
- Bottom padding: `calc(84px + env(safe-area-inset-bottom))`

### Empty state (zero projects)

- Header: "Get started"
- The 3 action cards are the main content — larger, centered, with descriptions
- No project cards

## Component anatomy

### Project card

```
┌─────────────────────────────────────────┐
│ [28px swatch]  project-name             │
│                N active sessions        │
│                                         │
│ [2 working] [1 respond] [1 ready]       │
└─────────────────────────────────────────┘
```

- 28px colored swatch, `border-radius: var(--radius-sm)` (4px)
- Project name: 13px, font-weight 600, `var(--color-text-primary)`
- Subtitle: "N active sessions", `var(--color-text-tertiary)`
- Status pills: colored per DESIGN.md status tokens, 10px font, pill backgrounds using `--color-tint-*`
- Degraded projects: muted swatch (40% opacity), "degraded" label in `var(--color-accent-red)`
- Card: `border-radius: 0` per DESIGN.md utilitarian stance, `border: 1px solid var(--color-border-subtle)`, `background: var(--card-bg)`
- Click/tap navigates to `/?project=<id>`
- Min height: 64px (touch target compliance)
- Swatch colors cycle through: `#cf73c9`, `#e49a4b`, `#7b8df1`, `#53b49f`, `#c95f67`, `#8e79d9`

### Action card

```
┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐
╎         [icon]                         ╎
╎         Clone from URL                 ╎
└╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
```

- SVG icon (16px) + label (12px)
- Dashed border: `1px dashed var(--color-border-default)`
- Background: `var(--color-accent-subtle)`
- Min height: 56px
- Click opens onboarding modal

### Three onboarding actions

| Action | Description | Modal content |
|--------|------------|---------------|
| Clone from URL | Clone a git repo | URL input + destination path picker |
| Quick start | Scaffold a new project | Template selection + project name + path |
| Add local project | Register an existing directory | Path input/picker |

## Modals

Reuse existing WIP modal components (`CloneFromUrlModal`, `QuickStartModal`, `AddProjectModal`).

- **Desktop:** Centered modal with backdrop, `border-radius: var(--radius-lg)`, `var(--color-bg-elevated)` background
- **Mobile:** Render inside `BottomSheet` component with drag-to-dismiss. Same content, different container. Uses `useMediaQuery(MOBILE_BREAKPOINT)` to choose.

On successful project creation, navigate to `/?project=<newId>`.

## Navigation integration

### MobileBottomNav

Add "Portfolio" as the first tab. New order:

| Tab | Icon | Route |
|-----|------|-------|
| Portfolio | Grid/home icon | `/portfolio` |
| Dashboard | Kanban icon | `/` or `/?project=X` |
| PRs | Git merge icon | `/prs` |

Portfolio is leftmost — easy thumb reach, natural "home" position.

Active tab detection: match on `pathname === "/portfolio"`.

### ProjectSidebar (desktop)

Add a "Portfolio" nav link at the top of the sidebar, above the project list. Uses the same styling as existing nav items. Shows active state when on `/portfolio`.

## Styling

All styling follows DESIGN.md:

- **Typography:** IBM Plex Sans for text, IBM Plex Mono (10px uppercase, +0.06em tracking) for section labels
- **Colors:** CSS variable tokens throughout — `var(--color-bg-*)`, `var(--color-text-*)`, `var(--color-border-*)`, `var(--color-accent-*)`
- **Dark mode:** Automatic via CSS variables. No hardcoded hex colors.
- **Border radius:** `0` for project cards (utilitarian), `var(--radius-sm)` for pills/swatches, `var(--radius-lg)` for modals
- **Spacing:** 4px base unit, comfortable density
- **Motion:** `var(--transition-quick)` (0.1s) on hover states. `prefers-reduced-motion` respected.
- **Card surfaces:** `var(--card-bg)` with `var(--card-inset)` in dark mode for depth

## Files to create/modify

### New files

| File | Purpose |
|------|---------|
| `app/portfolio/page.tsx` | Server component — data loading |
| `components/PortfolioPage.tsx` | Client component — page UI |
| `components/PortfolioProjectCard.tsx` | Project card component |
| `components/PortfolioActionCard.tsx` | Action card component |
| `lib/portfolio-page-data.ts` | Server data aggregation (uses existing `portfolio-services.ts` cache) |
| `app/api/projects/register/route.ts` | POST — register a local project directory |
| `app/api/projects/clone/route.ts` | POST — clone a git repo and register it |
| `app/api/projects/quick-start/route.ts` | POST — scaffold a new project from template |

### Modified files

| File | Change |
|------|--------|
| `lib/types.ts` | Add `PortfolioProjectSummary` type |
| `components/MobileBottomNav.tsx` | Add Portfolio tab, reorder |
| `components/ProjectSidebar.tsx` | Add Portfolio link at top |
| `app/globals.css` | Portfolio page styles, mobile breakpoints |

### Reused WIP files (cleanup needed)

| File | Status |
|------|--------|
| `components/CloneFromUrlModal.tsx` | Exists as untracked WIP — clean up, wire to BottomSheet on mobile |
| `components/QuickStartModal.tsx` | Same |
| `components/AddProjectModal.tsx` | Same |
| `components/Modal.tsx` | Base modal component — used on desktop |
| `hooks/useModal.ts` | Modal state hook |

## Out of scope

- Real-time SSE updates on portfolio page (can add later)
- Cross-project attention triage / action queue
- Project reordering, pinning, or grouping
- Settings page for portfolio preferences
- UnifiedSidebar replacement of ProjectSidebar (separate effort)
