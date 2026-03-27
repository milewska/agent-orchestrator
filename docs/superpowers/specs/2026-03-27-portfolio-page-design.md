# Portfolio Page — Design Spec

## Overview

The portfolio page is the home surface (`/`) of Agent Orchestrator. It shows all registered projects with health indicators and provides onboarding actions (clone, scaffold, add local project). It renders inside `DashboardShell` with the `UnifiedSidebar` as a persistent left rail on desktop and a drawer on mobile.

**Who it's for:** Developers managing multiple AI-assisted projects who need a bird's-eye view across their fleet before drilling into a specific project's dashboard.

## Architecture

### Routing

- **Route:** `/` — the home page. Currently renders `Dashboard` directly; this spec changes it to render `DashboardShell > PortfolioPage`.
- **Project route:** `/projects/[id]` — already exists. Modified to wrap `Dashboard` in `DashboardShell` so the sidebar persists.
- **Server component:** `app/page.tsx` loads portfolio data, renders `DashboardShell > PortfolioPage`
- **Client component:** `<PortfolioPage>` receives project summaries as props
- **No SSE/real-time:** Server-rendered snapshot. Refresh by navigating.

### Layout shell

`DashboardShell` + `UnifiedSidebar` is the shared layout shell for the entire app. Both the portfolio home and per-project dashboards render inside it. There is no secondary shell — `ProjectSidebar` and `MobileBottomNav` from main are replaced by this architecture.

```
┌──────────────────────────────────────────────┐
│ DashboardShell                               │
│ ┌────────┬───────────────────────────────┐   │
│ │Unified │                               │   │
│ │Sidebar │  children (PortfolioPage      │   │
│ │        │           or Dashboard)       │   │
│ │        │                               │   │
│ └────────┴───────────────────────────────┘   │
└──────────────────────────────────────────────┘
```

- **Desktop:** `UnifiedSidebar` (228px) is always visible as a persistent left rail. It provides project switching, filters, and workspace actions.
- **Mobile (≤767px):** `UnifiedSidebar` becomes an off-canvas drawer triggered by a hamburger button. The main content is full-width.

### Data loading

New file: `lib/portfolio-page-data.ts` — a parallel to the existing `dashboard-page-data.ts`, not a replacement. The dashboard helper loads sessions for a single project; the portfolio helper aggregates project-level summaries across all projects. Same pattern (React `cache()`, `getServices()` pipeline), different shape.

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

- Renders inside `DashboardShell` — `UnifiedSidebar` on the left, portfolio content on the right
- Content area: padded within the main panel (`px-6 py-10`), max-width 760px
- Header section: "Portfolio" title (IBM Plex Sans 700, 17px) + "N workspaces" subtitle
- Project cards in a responsive grid: `grid-cols-3` on wide panels, `grid-cols-2` on narrower
- Action cards ("Clone from URL", "Quick start", "Add local project") in the same grid, visually distinct
- Design system tokens throughout — see Styling section

### Mobile (≤767px)

- `UnifiedSidebar` hidden (available as drawer via hamburger)
- Single column, full-width with horizontal padding
- Header: "Portfolio" title + count, hamburger button (top left), "+" icon button (top right)
- Project cards stacked vertically, 8px gap
- Action cards in 2-column grid below project cards
- Safe area padding at bottom: `env(safe-area-inset-bottom)`

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
- Click/tap navigates to `/projects/<id>`
- Min height: 64px (touch target compliance)
- Swatch colors: defined as CSS custom properties `--swatch-1` through `--swatch-6` in `globals.css`, cycling per project index. This keeps the palette in the design system rather than hardcoded in components.

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

- **Desktop:** Centered modal via `Modal.tsx` with backdrop, `border-radius: var(--radius-lg)`, `var(--color-bg-elevated)` background
- **Mobile:** Same `Modal.tsx` component renders as a full-width bottom-anchored sheet with drag handle. `Modal.tsx` must be updated to accept an `isMobile` prop (or use `useMediaQuery` internally) and switch between centered overlay and bottom-sheet presentation. This is a concrete implementation change — see modified files table.

On successful project creation, navigate to `/projects/<newId>`.

## Navigation integration

### UnifiedSidebar

Already built with design-system polish. The sidebar provides:

- "Activity" link at the top (home/portfolio — highlights when on `/`)
- "Workspaces" section with project list, colored swatches, and inline filters
- Workspace items link to `/projects/<id>`
- Add menu (folder+ icon) with "Open project", "Clone from URL", "Quick start"
- Footer with help and settings links

**Mobile behavior:** Off-canvas drawer (280px max-width) triggered by hamburger button. Backdrop overlay with `backdrop-blur`. Focus trap and Escape-to-close.

### DashboardShell

Wraps both the portfolio page and per-project dashboards. Provides:

- `UnifiedSidebar` with project list and mobile drawer
- Mobile hamburger button (fixed, top-right on small screens)
- Wires modal state (add project, clone, quick start) to sidebar actions

## Styling

All styling follows DESIGN.md:

- **Typography:** IBM Plex Sans for text, IBM Plex Mono (10px uppercase, +0.06em tracking) for section labels
- **Colors:** CSS variable tokens throughout — `var(--color-bg-*)`, `var(--color-text-*)`, `var(--color-border-*)`, `var(--color-accent-*)`
- **Swatches:** Project swatch palette defined as `--swatch-1` through `--swatch-6` custom properties in `globals.css`, with both light and dark mode values. Components reference `var(--swatch-N)`.
- **Dark mode:** Automatic via CSS variables.
- **Border radius:** `0` for project cards (utilitarian), `var(--radius-sm)` for pills/swatches, `var(--radius-lg)` for modals
- **Spacing:** 4px base unit, comfortable density
- **Motion:** `var(--transition-quick)` (0.1s) on hover states. `prefers-reduced-motion` respected.
- **Card surfaces:** `var(--card-bg)` with `var(--card-inset)` in dark mode for depth

## Files to create/modify

### New files

| File | Purpose |
|------|---------|
| `components/PortfolioPage.tsx` | Client component — portfolio page UI |
| `components/PortfolioProjectCard.tsx` | Project card component |
| `components/PortfolioActionCard.tsx` | Action card component |
| `lib/portfolio-page-data.ts` | Server data aggregation — parallel to `dashboard-page-data.ts`, uses `portfolio-services.ts` cache |
| `app/api/projects/register/route.ts` | POST — register a local project directory |
| `app/api/projects/clone/route.ts` | POST — clone a git repo and register it |
| `app/api/projects/quick-start/route.ts` | POST — scaffold a new project from template |

### Modified files

| File | Change |
|------|--------|
| `app/page.tsx` | Render `DashboardShell > PortfolioPage` instead of direct `Dashboard` |
| `app/projects/[projectId]/page.tsx` | Wrap existing `Dashboard` in `DashboardShell` so sidebar persists |
| `lib/types.ts` | Add `PortfolioProjectSummary` type |
| `app/globals.css` | Portfolio page styles, `--swatch-*` tokens, mobile breakpoints |
| `components/DashboardShell.tsx` | Wire to portfolio data, pass projects to UnifiedSidebar |
| `components/UnifiedSidebar.tsx` | Minor: active state highlighting when on `/` |
| `components/Modal.tsx` | Add responsive split: centered overlay on desktop, bottom-anchored sheet with drag handle on mobile (via `useMediaQuery`) |
| `components/Dashboard.tsx` | Remove `ProjectSidebar` usage — sidebar is now provided by `DashboardShell` parent |

### Reused WIP files (cleanup needed)

| File | Status |
|------|--------|
| `components/CloneFromUrlModal.tsx` | Exists as untracked WIP — clean up |
| `components/QuickStartModal.tsx` | Same |
| `components/AddProjectModal.tsx` | Same |
| `hooks/useModal.ts` | Modal state hook — ready to use |

## Out of scope

- Real-time SSE updates on portfolio page (can add later)
- Cross-project attention triage / action queue
- Project reordering, pinning, or grouping
- Settings page for portfolio preferences
